/**
 * 议会标签页管理（ADR-0004 / ADR-0010）。
 *
 * 执行模式：**每站一窗、并排平铺**。
 * 后台/非激活标签页里浏览器会暂停 requestAnimationFrame、拒绝 focus()、不渲染虚拟列表，
 * 导致注入/点击/抽取全部失败（见 ADR-0010）。因此给每个站点开一个**独立窗口、平铺到屏幕网格**，
 * 让每个窗口的标签页都处于「激活且可见」状态，从而真正渲染与响应。
 *
 * 窗口以 focused:false 创建：可见、可渲染，但不抢占用户正在看的 Council Page 焦点。
 * 同时对每个标签页设 autoDiscardable=false，避免被浏览器丢弃中断生成。
 *
 * ⚠️ 这是「先确保功能」的朴素实现；窗口数量多时占屏。优化（更省屏的渲染保活）见 roadmap。
 */

import type { SiteAdapter } from '../shared/adapter-schema';

export interface CouncilTabs {
  /** 本次议会开出的全部窗口 id（每站一个） */
  windowIds: number[];
  /** adapterId → tabId */
  tabs: Map<string, number>;
  /** adapterId → windowId（恢复/关闭单站时定位用，ADR-0004 / ADR-0011） */
  windows: Map<string, number>;
}

interface Cell {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 为给定适配器各开一个窗口，平铺到屏幕网格；逐个关闭丢弃保护。 */
export async function openCouncilTabs(adapters: SiteAdapter[]): Promise<CouncilTabs> {
  if (adapters.length === 0) throw new Error('没有可用的参会站点');

  const cells = tileGrid(adapters.length);
  const tabs = new Map<string, number>();
  const windows = new Map<string, number>();
  const windowIds: number[] = [];

  for (let i = 0; i < adapters.length; i++) {
    const adapter = adapters[i]!;
    const cell = cells[i]!;
    try {
      // focused:false → 窗口可见可渲染，但不抢占 Council Page 的焦点。
      const win = await chrome.windows.create({
        url: adapter.newChatUrl,
        focused: false,
        type: 'normal',
        left: cell.left,
        top: cell.top,
        width: cell.width,
        height: cell.height,
      });
      if (win.id != null) windowIds.push(win.id);
      const tabId = win.tabs?.[0]?.id;
      if (tabId != null) {
        tabs.set(adapter.id, tabId);
        if (win.id != null) windows.set(adapter.id, win.id);
        await protect(tabId);
      }
    } catch {
      /* 单个窗口创建失败不阻断其余站点 */
    }
  }

  return { windowIds, tabs, windows };
}

/** 把屏幕可用区域切成能容纳 n 个单元的网格。 */
function tileGrid(n: number): Cell[] {
  const screenW = (globalThis.screen?.availWidth ?? 1440) || 1440;
  const screenH = (globalThis.screen?.availHeight ?? 900) || 900;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const cellW = Math.floor(screenW / cols);
  const cellH = Math.floor(screenH / rows);

  const cells: Cell[] = [];
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    cells.push({ left: col * cellW, top: row * cellH, width: cellW, height: cellH });
  }
  return cells;
}

/**
 * 重开单个站点窗口（Watchdog 恢复 / 崩溃续跑用，ADR-0004 / ADR-0011）。
 * 标签页被关/被丢弃后，用它把这一家重新拉起来再重发。
 */
export async function openSingleCouncilWindow(
  adapter: SiteAdapter,
): Promise<{ windowId: number; tabId: number }> {
  const win = await chrome.windows.create({ url: adapter.newChatUrl, focused: false, type: 'normal' });
  const windowId = win.id;
  const tabId = win.tabs?.[0]?.id;
  if (windowId == null || tabId == null) throw new Error(`无法重开 ${adapter.displayName} 窗口`);
  await protect(tabId);
  return { windowId, tabId };
}

/** 把某窗口切到前台（需要登录/验证引导时调用）。 */
export async function foregroundWindow(windowId: number): Promise<void> {
  try {
    await chrome.windows.update(windowId, { focused: true });
  } catch {
    /* 窗口可能已关闭 */
  }
}

/** 关闭本次议会开出的全部窗口。 */
export async function closeCouncilWindows(windowIds: number[]): Promise<void> {
  await Promise.allSettled(windowIds.map((id) => chrome.windows.remove(id)));
}

async function protect(tabId: number): Promise<void> {
  try {
    await chrome.tabs.update(tabId, { autoDiscardable: false });
  } catch {
    /* 个别浏览器/状态下不支持，忽略 */
  }
}
