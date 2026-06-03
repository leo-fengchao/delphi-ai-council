/**
 * 议会会话持久化（ADR-0004 / ADR-0011）。
 *
 * 把「当前议会的全量状态」写入 chrome.storage.local，使议会能在 Council Page
 * 刷新/崩溃后续跑。MVP 只维护**单个活动会话**（一次只跑一场议会）。
 *
 * 注意：只持久化「过程与产出」，不持久化选择器——选择器永远在运行时从
 * 内置配置 + 用户覆盖（ADR-0009）现取，避免存档里夹带过期选择器。
 */

import type { FailureCode } from './messaging';

export type LegStatus = 'pending' | 'running' | 'done' | 'failed';
export type LegStage = 'injecting' | 'submitted' | 'awaiting' | 'extracting';

/** 单条腿（单个 AI 一次作答）的状态。 */
export interface LegState {
  adapterId: string;
  displayName: string;
  status: LegStatus;
  stage?: LegStage;
  /** done 时的回答文本 */
  text?: string;
  /** failed 时的错误与分类码 */
  error?: string;
  code?: FailureCode;
  /** 承载该腿的窗口/标签页（用于 Watchdog 与恢复定位；可能因关闭而失效） */
  windowId?: number;
  tabId?: number;
}

export interface SessionState {
  id: string;
  prompt: string;
  enableThinking: boolean;
  createdAt: number;
  updatedAt: number;
  /** 参会站点（保序），恢复时据此从 config 取回 SiteAdapter */
  adapterIds: string[];
  legs: Record<string, LegState>;

  // --- Phase 2: 交叉评审 ---
  /** 记录每家在阶段二的互评输出（adapterId -> review text） */
  reviews?: Record<string, string>;

  // --- Phase 3: 主席综合 ---
  /** 用户选定的主席模型 adapterId */
  chairpersonId?: string;
  /** 主席模型的综合输出解析结果 */
  summary?: {
    finalAnswer: string;
    consensus: string;
    disputes: string;
    confidence: string;
    rawText?: string;
  };

  /** 状态机顶级阶段，用于恢复时定位 */
  status: 'stage1' | 'stage2' | 'stage3' | 'finished' | 'error';
}

const SESSION_KEY = 'delphi:session';

export function newSessionId(): string {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function saveSession(session: SessionState): Promise<void> {
  session.updatedAt = Date.now();
  try {
    await chrome.storage.local.set({ [SESSION_KEY]: session });
  } catch {
    /* 持久化失败不阻断议会本身 */
  }
}

export async function loadSession(): Promise<SessionState | null> {
  try {
    const got = await chrome.storage.local.get(SESSION_KEY);
    const raw = got[SESSION_KEY];
    return isSessionState(raw) ? raw : null;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  try {
    await chrome.storage.local.remove(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/** 是否存在「可恢复」的未完成会话（仍有腿处于 pending/running）。 */
export function hasRecoverableLegs(session: SessionState): boolean {
  return Object.values(session.legs).some((l) => l.status === 'pending' || l.status === 'running');
}

/** 原地更新某条腿并落盘。 */
export async function patchLeg(
  session: SessionState,
  adapterId: string,
  patch: Partial<LegState>,
): Promise<void> {
  const prev = session.legs[adapterId];
  if (!prev) return;
  session.legs[adapterId] = { ...prev, ...patch };
  await saveSession(session);
}

function isSessionState(raw: unknown): raw is SessionState {
  if (!raw || typeof raw !== 'object') return false;
  const s = raw as Partial<SessionState>;
  return typeof s.id === 'string' && typeof s.prompt === 'string' && !!s.legs && Array.isArray(s.adapterIds) && typeof s.status === 'string';
}
