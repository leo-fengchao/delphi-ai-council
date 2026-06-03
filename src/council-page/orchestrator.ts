/**
 * 议会编排器 —— 阶段一·并行作答（ADR-0006）+ 韧性层（ADR-0004 / ADR-0011）。
 *
 * 在每站一窗的标签组里并行驱动 N 个站点同时作答，互不可见、互不影响；任一腿失败不拖垮整盘
 * （allSettled 单点降级）。在此之上叠加 Phase 4 韧性：
 *   - 全程把会话状态持久化到 chrome.storage.local（崩溃/刷新后可续跑）；
 *   - Watchdog 监控标签页存活；
 *   - 标签页**确实丢失**时自动重开重发（幂等，有次数上限）；内容级失败（未登录/验证码等）
 *     不自动重发，保留手动「重试」，避免无谓消耗额度。
 *
 * 仍是 Promise 编排；声明式状态机（XState）按 ADR-0011 推迟到 Phase 5。
 */

import type { SiteAdapter } from '../shared/adapter-schema';
import type { AskResponse, DelphiMessage, ProgressMessage, FailureCode, PingResponse } from '../shared/messaging';
import { openCouncilTabs, openSingleCouncilWindow, type CouncilTabs } from './council-tabs';
import {
  newSessionId,
  saveSession,
  patchLeg,
  type LegState,
  type SessionState,
} from '../shared/session-state';
import { Watchdog } from './watchdog';

export interface LegResult {
  adapterId: string;
  displayName: string;
  ok: boolean;
  text?: string;
  error?: string;
  code?: FailureCode;
}

export interface BroadcastHooks {
  onLegStage?: (adapterId: string, stage: ProgressMessage['stage']) => void;
  /** 某一腿出最终结果即回调（不等其它腿），用于即时刷新该卡片（修复"卡在抽取中"） */
  onLegResult?: (result: LegResult) => void;
}

export interface DriveOptions {
  /** 发送前点击各站点的「深度思考」开关（需已校准 thinkingToggle，ADR-0009） */
  enableThinking?: boolean;
}

export interface BroadcastOutcome {
  /** 本次议会开出的标签页（供重试/收尾复用） */
  council: CouncilTabs;
  results: LegResult[];
}

const READY_TIMEOUT_MS = 30000;
/** 标签页丢失时的自动重开重发上限（幂等，ADR-0004 额度友好） */
const MAX_AUTO_RECOVER = 2;

// ============ 阶段一广播（首次发起） ============

export async function broadcastStageOne(
  adapters: SiteAdapter[],
  prompt: string,
  hooks: BroadcastHooks = {},
  options: DriveOptions = {},
): Promise<BroadcastOutcome> {
  const session = createSession(adapters, prompt, options.enableThinking ?? false);
  await saveSession(session);

  const council = await openCouncilTabs(adapters);
  // 把开出的窗口/标签页登记进会话，供 Watchdog 与恢复定位。
  for (const a of adapters) {
    await patchLeg(session, a.id, {
      tabId: council.tabs.get(a.id),
      windowId: council.windows.get(a.id),
    });
  }

  const results = await runStageParallel(session, council, adapters, session.prompt, hooks);
  await finishSession(session);
  return { council, results };
}

// ============ 崩溃恢复（续跑未完成会话） ============

/**
 * 续跑一个持久化会话：已完成的腿直接返回存档输出；未完成的腿重开标签页重发。
 * adapters 由调用方（Council Page）按 session.adapterIds 从有效配置取回。
 */
export async function resumeCouncil(
  session: SessionState,
  adapters: SiteAdapter[],
  hooks: BroadcastHooks = {},
): Promise<BroadcastOutcome> {
  const council = reconstructCouncil(session);
  // Status will be handled by machine, but for legacy code we set it here
  if (session.status === ('running' as any)) session.status = 'stage1';
  await saveSession(session);
  const results = await runStageParallel(session, council, adapters, session.prompt, hooks);
  await finishSession(session);
  return { council, results };
}

// ============ 公共：并行驱动各腿 ============

export async function runStageParallel(
  session: SessionState,
  council: CouncilTabs,
  adapters: SiteAdapter[],
  prompt: string,
  hooks: BroadcastHooks,
): Promise<LegResult[]> {
  const watchdog = new Watchdog(session, {
    // 看门狗发现某腿标签页丢失：标到会话上；真正的重开重发由 driveLegResilient 在失败后处理。
    onLegLost: (adapterId) => {
      const leg = session.legs[adapterId];
      if (leg && (leg.status === 'running' || leg.status === 'pending')) leg.tabId = undefined;
    },
  });
  watchdog.start();

  try {
    const legs = adapters.map(async (adapter): Promise<LegResult> => {
      const existing = session.legs[adapter.id];
      // 续跑时：已完成的腿直接用存档，不重发（不浪费额度）。
      const result =
        existing?.status === 'done' && existing.text
          ? { adapterId: adapter.id, displayName: adapter.displayName, ok: true, text: existing.text }
          : await driveLegResilient(session, council, adapter, prompt, hooks);
      hooks.onLegResult?.(result); // 该腿一出结果就刷新卡片，不等其它腿。
      return result;
    });

    const settled = await Promise.allSettled(legs);
    return settled.map((s, i) =>
      s.status === 'fulfilled'
        ? s.value
        : {
            adapterId: adapters[i]!.id,
            displayName: adapters[i]!.displayName,
            ok: false,
            error: String(s.reason),
            code: 'unknown' as FailureCode,
          },
    );
  } finally {
    watchdog.stop();
  }
}

/**
 * 韧性版单腿驱动：保证有活标签页 → 驱动 → 收结果；标签页丢失则重开重试（上限内）。
 * 内容级失败（标签页仍在但未登录/验证码/抽取空等）不自动重试，交用户手动「重试」。
 */
export async function driveLegResilient(
  session: SessionState,
  council: CouncilTabs,
  adapter: SiteAdapter,
  prompt: string,
  hooks: BroadcastHooks,
): Promise<LegResult> {
  await patchLeg(session, adapter.id, { status: 'running', stage: undefined, error: undefined, code: undefined });
  const options: DriveOptions = { enableThinking: session.enableThinking };

  for (let attempt = 0; attempt <= MAX_AUTO_RECOVER; attempt++) {
    // 1) 确保有一个活着的标签页（首跑沿用，丢失/续跑则重开）。
    let tabId = council.tabs.get(adapter.id);
    if (tabId == null || (await isTabGone(tabId))) {
      try {
        const w = await openSingleCouncilWindow(adapter);
        tabId = w.tabId;
        council.tabs.set(adapter.id, w.tabId);
        council.windows.set(adapter.id, w.windowId);
        await patchLeg(session, adapter.id, { tabId: w.tabId, windowId: w.windowId });
      } catch (e) {
        return fail(session, adapter, `无法打开标签页：${String(e)}`, 'unknown');
      }
    }

    // 2) 驱动这一腿。
    const r = await driveLeg(adapter, tabId, prompt, hooks, options);
    if (r.ok) {
      await patchLeg(session, adapter.id, { status: 'done', stage: undefined, text: r.text, error: undefined, code: undefined });
      return r;
    }

    // 3) 失败：标签页仍在 → 内容级失败，不自动重试。
    if (!(await isTabGone(tabId))) {
      await patchLeg(session, adapter.id, { status: 'failed', error: r.error, code: r.code });
      return r;
    }
    // 否则标签页确已丢失 → 循环重开重发（直至上限）。
  }

  return fail(session, adapter, '多次重试后标签页仍失联', 'unknown');
}

async function fail(
  session: SessionState,
  adapter: SiteAdapter,
  error: string,
  code: FailureCode,
): Promise<LegResult> {
  await patchLeg(session, adapter.id, { status: 'failed', error, code });
  return { adapterId: adapter.id, displayName: adapter.displayName, ok: false, error, code };
}

// ============ 单腿底层驱动（一次尝试，无重试） ============

/**
 * 驱动单腿：等就绪 → 下发问题 → 收结果。进度经 hooks 实时上报。
 * 既用于首次广播/恢复，也用于用户登录后对单家「重试」（App 直接调用）。
 */
export async function driveLeg(
  adapter: SiteAdapter,
  tabId: number,
  prompt: string,
  hooks: BroadcastHooks = {},
  options: DriveOptions = {},
): Promise<LegResult> {
  const detach = attachProgress(tabId, (stage) => hooks.onLegStage?.(adapter.id, stage));
  let res: AskResponse;
  try {
    await waitForReady(tabId);
    res = (await chrome.tabs.sendMessage(tabId, {
      type: 'DELPHI_ASK',
      prompt,
      enableThinking: options.enableThinking,
    })) as AskResponse;
  } catch (err) {
    res = { ok: false, error: String(err), code: 'unknown' };
  } finally {
    detach();
  }
  return { adapterId: adapter.id, displayName: adapter.displayName, ...res };
}

// ============ 辅助 ============

function createSession(adapters: SiteAdapter[], prompt: string, enableThinking: boolean): SessionState {
  const now = Date.now();
  const legs: Record<string, LegState> = {};
  for (const a of adapters) {
    legs[a.id] = { adapterId: a.id, displayName: a.displayName, status: 'pending' };
  }
  return {
    id: newSessionId(),
    prompt,
    enableThinking,
    createdAt: now,
    updatedAt: now,
    adapterIds: adapters.map((a) => a.id),
    legs,
    status: 'stage1',
  };
}

function reconstructCouncil(session: SessionState): CouncilTabs {
  const tabs = new Map<string, number>();
  const windows = new Map<string, number>();
  const windowIds: number[] = [];
  for (const id of session.adapterIds) {
    const leg = session.legs[id];
    if (leg?.tabId != null) tabs.set(id, leg.tabId);
    if (leg?.windowId != null) {
      windows.set(id, leg.windowId);
      windowIds.push(leg.windowId);
    }
  }
  return { tabs, windows, windowIds };
}

async function finishSession(session: SessionState): Promise<void> {
  session.status = 'finished';
  await saveSession(session);
}

/** 标签页是否已不存在。 */
async function isTabGone(tabId: number): Promise<boolean> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab == null;
  } catch {
    return true;
  }
}

function attachProgress(
  tabId: number,
  onStage: (stage: ProgressMessage['stage']) => void,
): () => void {
  const listener = (msg: DelphiMessage, sender: chrome.runtime.MessageSender) => {
    if (sender.tab?.id === tabId && msg.type === 'DELPHI_PROGRESS') onStage(msg.stage);
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

/**
 * 轮询 ping 判就绪：content script 一挂载即应答（不依赖单次 READY 广播，避免错过）。
 * 标签页中途消失则立即抛错，让上层走重开重发；整体不超过 READY_TIMEOUT_MS。
 */
async function waitForReady(tabId: number): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isTabGone(tabId)) throw new Error('标签页已关闭');
    try {
      const res = (await chrome.tabs.sendMessage(tabId, { type: 'DELPHI_PING' })) as PingResponse | undefined;
      if (res?.ready) return;
    } catch {
      /* content script 尚未就绪（接收端不存在）→ 稍后重试 */
    }
    await delay(300);
  }
  throw new Error('等待页面就绪超时（content script 未应答 PING）');
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type { CouncilTabs };
export { waitForReady as waitForTabReady };
