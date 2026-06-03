/**
 * Watchdog 看门狗（ADR-0004 / ADR-0011）——运行于 Council Page。
 *
 * 持续比对「应有状态 vs 实际标签页状态」，处理两类意外：
 *   1) 被丢弃（discarded）：浏览器内存节省器丢弃了标签页 → 重新设 autoDiscardable=false
 *      并重新加载，尽量原地救活，不惊动用户。
 *   2) 被关闭（onRemoved / 窗口 onRemoved）：标签页没了 → 回调 onLegLost，由编排器决定
 *      是否重开重发（仅对进行中的腿、且本就没产出答案时）。
 *
 * 看门狗只「发现并上报」，恢复动作由编排器执行，职责清晰。
 */

import type { SessionState } from '../shared/session-state';

export interface WatchdogCallbacks {
  /** 某条进行中的腿的标签页丢失（被关/窗口被关） */
  onLegLost?: (adapterId: string) => void;
}

export class Watchdog {
  private session: SessionState;
  private cb: WatchdogCallbacks;
  private started = false;

  constructor(session: SessionState, cb: WatchdogCallbacks = {}) {
    this.session = session;
    this.cb = cb;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    chrome.tabs.onRemoved.addListener(this.onTabRemoved);
    chrome.tabs.onUpdated.addListener(this.onTabUpdated);
    chrome.windows.onRemoved.addListener(this.onWindowRemoved);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    chrome.tabs.onRemoved.removeListener(this.onTabRemoved);
    chrome.tabs.onUpdated.removeListener(this.onTabUpdated);
    chrome.windows.onRemoved.removeListener(this.onWindowRemoved);
  }

  /** 找出某 tabId / windowId 对应的「进行中」腿。 */
  private runningLegByTab(tabId: number): string | undefined {
    return Object.values(this.session.legs).find(
      (l) => l.tabId === tabId && (l.status === 'running' || l.status === 'pending'),
    )?.adapterId;
  }

  private onTabRemoved = (tabId: number): void => {
    const adapterId = this.runningLegByTab(tabId);
    if (adapterId) this.cb.onLegLost?.(adapterId);
  };

  private onWindowRemoved = (windowId: number): void => {
    for (const leg of Object.values(this.session.legs)) {
      if (leg.windowId === windowId && (leg.status === 'running' || leg.status === 'pending')) {
        this.cb.onLegLost?.(leg.adapterId);
      }
    }
  };

  private onTabUpdated = (
    tabId: number,
    changeInfo: chrome.tabs.TabChangeInfo,
  ): void => {
    if (changeInfo.discarded === true && this.runningLegByTab(tabId)) {
      // 被丢弃：重新保护 + 重载，尽量原地救活。
      void this.reviveDiscarded(tabId);
    }
  };

  private async reviveDiscarded(tabId: number): Promise<void> {
    try {
      await chrome.tabs.update(tabId, { autoDiscardable: false });
      await chrome.tabs.reload(tabId);
    } catch {
      // 救活失败则按丢失处理，交编排器重开。
      const adapterId = this.runningLegByTab(tabId);
      if (adapterId) this.cb.onLegLost?.(adapterId);
    }
  }
}
