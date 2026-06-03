/**
 * 用户可视化校准编排（ADR-0009）——运行于 Council Page。
 *
 * 校准是交互式的：为目标站点开一个**前台窗口**，并在该站点页内注入「校准工具条」
 * （见 adapters/calibration-overlay.ts）。所有角色/深度思考的点选都在站点页内完成，
 * 用户无需在 Council Page 与站点页之间来回切换。
 */

import type { SiteAdapter } from '../shared/adapter-schema';
import type { CalibrateMessage, DelphiMessage } from '../shared/messaging';
import { waitForTabReady } from './orchestrator';

export interface CalibrationSession {
  windowId: number;
  tabId: number;
  adapterId: string;
}

/** 打开校准窗口（前台），等其 content script 就绪。 */
export async function openCalibration(adapter: SiteAdapter): Promise<CalibrationSession> {
  const win = await chrome.windows.create({ url: adapter.newChatUrl, focused: true, type: 'normal' });
  const windowId = win.id;
  const tabId = win.tabs?.[0]?.id;
  if (windowId == null || tabId == null) throw new Error('无法打开校准窗口');
  await waitForTabReady(tabId);
  return { windowId, tabId, adapterId: adapter.id };
}

/**
 * 在站点页内开始校准（注入工具条），并等待用户在页内点「完成校准」。
 * 完成（或窗口被关闭）即 resolve。校准结果由 content script 直接写入本地覆盖。
 */
export function startInPageCalibration(session: CalibrationSession): Promise<void> {
  return new Promise<void>((resolve) => {
    const onMsg = (msg: DelphiMessage, sender: chrome.runtime.MessageSender) => {
      if (sender.tab?.id === session.tabId && msg.type === 'DELPHI_CALIBRATE_DONE') {
        finish();
      }
    };
    const onWinClosed = (windowId: number) => {
      if (windowId === session.windowId) finish();
    };
    function finish() {
      chrome.runtime.onMessage.removeListener(onMsg);
      chrome.windows.onRemoved.removeListener(onWinClosed);
      resolve();
    }
    chrome.runtime.onMessage.addListener(onMsg);
    chrome.windows.onRemoved.addListener(onWinClosed);

    void (async () => {
      await chrome.windows.update(session.windowId, { focused: true });
      const msg: CalibrateMessage = { type: 'DELPHI_CALIBRATE' };
      try {
        await chrome.tabs.sendMessage(session.tabId, msg);
      } catch {
        /* content script 未就绪等异常：用户可手动关窗，onRemoved 会兜底 resolve */
      }
    })();
  });
}

/** 结束校准，关闭窗口。 */
export async function closeCalibration(session: CalibrationSession): Promise<void> {
  try {
    await chrome.windows.remove(session.windowId);
  } catch {
    /* 窗口可能已被用户关闭 */
  }
}
