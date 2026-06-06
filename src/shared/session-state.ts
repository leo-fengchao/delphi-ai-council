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

// --- Phase 8: 多轮辩论（ADR-0014）---
/** 辩论一轮里被主席点名的单个匿名成员及其回复。 */
export interface DebateTarget {
  /** 匿名编号（A/B/C…），与 SessionState.anonMap 对齐 */
  anonLabel: string;
  /** 经 anonMap 反查得到的真实站点 id（中枢持有的映射，主席不可见） */
  adapterId: string;
  /** 主席对该匿名成员的追问 */
  question: string;
  /** 该成员的回复（done 时有值） */
  answer?: string;
  status: 'pending' | 'done' | 'failed';
}

/** 辩论的单轮：主席发问 + 各被点名成员的回复。 */
export interface DebateRound {
  /** 1-based 轮次 */
  round: number;
  targets: DebateTarget[];
}

export interface DebateState {
  rounds: DebateRound[];
  /** 主席声明「无需追问」或达上限即收敛 */
  converged: boolean;
}

export interface SessionState {
  id: string;
  prompt: string;
  enableThinking: boolean;
  /** 是否启用多轮辩论（Phase 8 / ADR-0014，用户开关默认关） */
  enableDebate?: boolean;
  createdAt: number;
  updatedAt: number;
  /** 参会站点（保序），恢复时据此从 config 取回 SiteAdapter */
  adapterIds: string[];
  legs: Record<string, LegState>;

  // --- Phase 1: 初始作答存档（ADR-0014）---
  /**
   * stage1 各家的原始初始回答（adapterId -> text）。单独存档而不复用 legs[].text，
   * 因为 stage2 交叉评审会把 legs[].text 覆盖为评审文本；主席综合/辩论引用初始答案均取这里。
   */
  initialAnswers?: Record<string, string>;
  /**
   * 稳定的匿名映射（anonLabel 'A'|'B'… -> adapterId），stage1 完成时一次性确定。
   * 评审/主席 prompt 的匿名标签与辩论路由全部以此为唯一真源，保证三阶段标签一致。
   */
  anonMap?: Record<string, string>;

  // --- Phase 2: 交叉评审 ---
  /** 记录每家在阶段二的互评输出（adapterId -> review text） */
  reviews?: Record<string, string>;

  // --- Phase 8: 多轮辩论 ---
  debate?: DebateState;

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
  status: 'stage1' | 'stage2' | 'debate' | 'stage3' | 'finished' | 'error';
}

/**
 * 按 adapterIds 顺序，对「有初始答案」的成员依次编号 A/B/C…，得到稳定匿名映射。
 * 评审/主席/辩论三处共用，避免各自按 index 重复匿名造成标签漂移。
 */
export function buildAnonMap(session: SessionState): Record<string, string> {
  const map: Record<string, string> = {};
  let i = 0;
  for (const id of session.adapterIds) {
    if (session.initialAnswers?.[id]) {
      map[String.fromCharCode(65 + i)] = id;
      i++;
    }
  }
  return map;
}

/** anonMap 的反查：adapterId -> anonLabel（找不到返回 undefined）。 */
export function anonLabelOf(session: SessionState, adapterId: string): string | undefined {
  const map = session.anonMap ?? {};
  for (const [label, id] of Object.entries(map)) {
    if (id === adapterId) return label;
  }
  return undefined;
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

// ============================================================
// 历史议事归档（Phase 9 / ADR-0015）
//
// 单活动会话（上面的 SESSION_KEY）用于「崩溃恢复」；议会一旦完成/中止，就把那份
// 状态快照追加进「归档列表」，供左侧历史侧栏回看各家回答与主席结论。归档与活动
// 会话互不影响：归档是只读快照、设数量上限淘汰，避免无限增长。
// ============================================================

/** 归档即一份完成时的 SessionState 快照（只读回看，不再驱动状态机）。 */
export type ArchivedSession = SessionState;

const ARCHIVE_KEY = 'delphi:archive';
/** 归档上限：超出后淘汰最旧的（FIFO）。 */
export const ARCHIVE_LIMIT = 60;

export async function loadArchive(): Promise<ArchivedSession[]> {
  try {
    const got = await chrome.storage.local.get(ARCHIVE_KEY);
    const raw = got[ARCHIVE_KEY];
    return Array.isArray(raw) ? raw.filter(isSessionState) : [];
  } catch {
    return [];
  }
}

/**
 * 把一份会话追加进归档（最新在前）。同 id 视为更新（去重后前插），超上限淘汰最旧。
 * 仅在会话「有实质内容」（至少有一家初始回答）时归档，避免空跑也留痕。
 */
export async function archiveSession(session: SessionState): Promise<void> {
  const hasContent = !!session.initialAnswers && Object.keys(session.initialAnswers).length > 0;
  if (!hasContent) return;
  try {
    const list = await loadArchive();
    const snapshot: ArchivedSession = { ...session, status: 'finished' };
    const deduped = list.filter((s) => s.id !== session.id);
    deduped.unshift(snapshot);
    const capped = deduped.slice(0, ARCHIVE_LIMIT);
    await chrome.storage.local.set({ [ARCHIVE_KEY]: capped });
  } catch {
    /* 归档失败不阻断议会 */
  }
}

export async function deleteArchived(id: string): Promise<void> {
  try {
    const list = await loadArchive();
    await chrome.storage.local.set({ [ARCHIVE_KEY]: list.filter((s) => s.id !== id) });
  } catch {
    /* ignore */
  }
}

export async function clearArchive(): Promise<void> {
  try {
    await chrome.storage.local.remove(ARCHIVE_KEY);
  } catch {
    /* ignore */
  }
}

/** 把归档按「今天 / 昨天 / M月D日」分组（保持各组内最新在前）。 */
export function groupArchiveByDate(list: ArchivedSession[]): { group: string; items: ArchivedSession[] }[] {
  const startOfDay = (t: number) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const today = startOfDay(Date.now());
  const oneDay = 86400000;
  const labelFor = (t: number): string => {
    const day = startOfDay(t);
    if (day === today) return '今天';
    if (day === today - oneDay) return '昨天';
    const d = new Date(t);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  };
  const groups: { group: string; items: ArchivedSession[] }[] = [];
  for (const s of list) {
    const label = labelFor(s.createdAt);
    let g = groups.find((x) => x.group === label);
    if (!g) {
      g = { group: label, items: [] };
      groups.push(g);
    }
    g.items.push(s);
  }
  return groups;
}
