/* ============================================================
   集思 · Delphi — leg 派生模型（Phase 9 / ADR-0015）

   设计稿的成员卡片把每个模型画成「初次作答 → 交叉评审 →（辩论）→ 主席综合」
   的 per-leg 流水线；但真实状态机（machine.ts）是**全局分阶段**跑的。本模块把
   全局机器状态 + 持久化 session（initialAnswers / reviews / debate / summary）+
   当前在途的 liveView，折叠成每个成员的 per-stage 状态与内容，供卡片/弹窗渲染。
   ============================================================ */
import type { SessionState, LegStage } from '../../shared/session-state';
import type { CardStatus } from './ui/primitives';

/** Council 运行时每条腿的瞬时视图（由 orchestrator hooks 推送）。 */
export type LegView =
  | { kind: 'pending' }
  | { kind: 'running'; stage?: LegStage }
  | { kind: 'done'; text: string }
  | { kind: 'error'; message: string };

export type StageKey = 'stage1' | 'stage2' | 'debate' | 'stage3';

export type MachineValue = 'idle' | 'stage1' | 'stage2' | 'debate' | 'stage3' | 'finished' | 'error';

export const STAGE_LABELS: Record<StageKey, string> = {
  stage1: '初次作答',
  stage2: '交叉评审',
  debate: '多轮辩论',
  stage3: '主席综合',
};

/** 弹窗里的页签名（与卡片阶段名略有区别）。 */
export const STAGE_TAB_LABELS: Record<StageKey, string> = {
  stage1: '初次作答',
  stage2: '它写的评审',
  debate: '辩论回复',
  stage3: '主席综合',
};

const SUBSTAGE_LABEL: Record<LegStage, string> = {
  injecting: '注入问题…',
  submitted: '已发送，生成中…',
  awaiting: '生成中…',
  extracting: '抽取回答…',
};

const RANK: Record<MachineValue, number> = {
  idle: 0,
  stage1: 1,
  stage2: 2,
  debate: 3,
  stage3: 4,
  finished: 5,
  error: 5,
};

export interface LegModel {
  id: string;
  displayName: string;
  isChair: boolean;
  status: CardStatus;
  stages: StageKey[];
  stageStates: Record<string, CardStatus>;
  current: StageKey;
  subtext?: string;
  failReason?: string;
  summaries: Partial<Record<StageKey, string>>;
  texts: Partial<Record<StageKey, string>>;
  debateRound?: number;
}

export interface DeriveCtx {
  session: SessionState | null;
  machineValue: MachineValue;
  live?: LegView;
  chairpersonId: string;
}

function preview(text: string | undefined, max = 96): string {
  if (!text) return '';
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

/** 该腿在辩论里被点名的回合与回复（按真实 id 反查 session.debate）。 */
function debateForLeg(session: SessionState | null, id: string) {
  const rounds = session?.debate?.rounds ?? [];
  const turns: { round: number; question: string; answer?: string; status: 'pending' | 'done' | 'failed' }[] = [];
  for (const r of rounds) {
    for (const t of r.targets) {
      if (t.adapterId === id) turns.push({ round: r.round, question: t.question, answer: t.answer, status: t.status });
    }
  }
  return turns;
}

export function deriveLeg(
  adapter: { id: string; displayName: string },
  ctx: DeriveCtx,
): LegModel {
  const { session, machineValue, live, chairpersonId } = ctx;
  const id = adapter.id;
  const isChair = id === chairpersonId;
  const rank = RANK[machineValue];

  const initial = session?.initialAnswers?.[id];
  const review = session?.reviews?.[id];
  const debateTurns = debateForLeg(session, id);
  const summary = session?.summary;

  const stageStates: Record<string, CardStatus> = {};
  const summaries: Partial<Record<StageKey, string>> = {};
  const texts: Partial<Record<StageKey, string>> = {};

  // —— stage1 ——
  let s1: CardStatus;
  if (initial) s1 = 'done';
  else if (machineValue === 'stage1') s1 = live ? liveToStatus(live) : 'pending';
  else if (rank > RANK.stage1) s1 = 'failed';
  else s1 = 'pending';
  stageStates.stage1 = s1;
  if (initial) {
    summaries.stage1 = preview(initial);
    texts.stage1 = initial;
  } else if (s1 === 'done' && live?.kind === 'done') {
    summaries.stage1 = preview(live.text);
    texts.stage1 = live.text;
  }

  // stage1 失败 = 该成员未能参会：只显示 stage1 这一行（与设计稿降级一致）。
  if (s1 === 'failed') {
    return {
      id,
      displayName: adapter.displayName,
      isChair,
      status: 'failed',
      stages: ['stage1'],
      stageStates,
      current: 'stage1',
      failReason: failText(live),
      summaries,
      texts,
    };
  }

  // —— stage2 ——
  let s2: CardStatus;
  if (review) s2 = 'done';
  else if (machineValue === 'stage2') s2 = live ? liveToStatus(live) : 'pending';
  else if (rank > RANK.stage2) s2 = 'failed';
  else s2 = 'pending';
  stageStates.stage2 = s2;
  if (review) {
    summaries.stage2 = preview(review);
    texts.stage2 = review;
  } else if (s2 === 'done' && live?.kind === 'done') {
    summaries.stage2 = preview(live.text);
    texts.stage2 = live.text;
  } else if (s2 === 'done') {
    summaries.stage2 = '已完成交叉评审与打分排序';
  }

  const stages: StageKey[] = ['stage1', 'stage2'];
  const debateEnabled = !!session?.enableDebate || !!session?.debate;
  let debateRound: number | undefined;

  // —— debate ——
  // 主席：辩论里是「发问方」，不会被自己追问，故没有 debateTurns。但主席在辩论阶段恰恰是
  // 最忙的（生成追问 / 综合上下文），旧逻辑下主席卡片在 debate 阶段毫无动静。这里给主席补一个
  // debate 步进行，反映「正在向匿名成员定向追问」。
  if (isChair && debateEnabled) {
    stages.push('debate');
    let sd: CardStatus;
    if (rank > RANK.debate) sd = 'done';
    else if (machineValue === 'debate') sd = 'running';
    else sd = 'pending';
    stageStates.debate = sd;
    const asked = chairDebateText(session);
    if (asked) texts.debate = asked;
    if (sd === 'done') summaries.debate = asked ? '已完成对匿名成员的定向追问' : '判断无需追问，直接综合';
    else if (sd === 'running') summaries.debate = '正在向匿名成员定向追问…';
  } else if (debateEnabled) {
    // 非主席成员：开了辩论就**始终**给一条 debate 步进行，避免「stage2 后显示已完成、之后又被点名而进度回退」。
    stages.push('debate');
    // 辩论是否已整体结束（进入 stage3/finished，或主席已声明收敛）。
    const debateOver = rank > RANK.debate || !!session?.debate?.converged;
    if (debateTurns.length > 0) {
      // 被主席点名过：单个 debate 节点随**最新轮次**覆盖（不新增第二/三轮节点），详情里堆叠各轮 Q/A。
      const anyPending = debateTurns.some((t) => t.status === 'pending');
      debateRound = debateTurns[debateTurns.length - 1]!.round;
      let sd: CardStatus;
      if (!debateOver && machineValue === 'debate') {
        // 辩论仍在进行：本轮被点名未答完 → 进行中；已答完但辩论未结束 → 等待中（可能被再次追问，**不提前置完成**）。
        sd = anyPending ? 'running' : 'waiting';
      } else {
        // 辩论已结束：据已回应内容收尾（至少答过一轮算完成，全程未答出算失败）。
        sd = debateTurns.some((t) => t.status === 'done') ? 'done' : 'failed';
      }
      stageStates.debate = sd;
      texts.debate = debateTurns.map((t) => `【第 ${t.round} 轮】追问：${t.question}\n回复：${t.answer ?? '（未回应）'}`).join('\n\n');
      if (sd === 'done') summaries.debate = preview(debateTurns.map((t) => t.answer).filter(Boolean).join(' '));
      else if (sd === 'waiting') summaries.debate = `已回应第 ${debateRound} 轮追问，等待主席是否继续追问…`;
    } else if (rank > RANK.debate) {
      // 辩论已结束、本成员始终未被点名 → 该环节按「完成（未被追问）」收尾。
      stageStates.debate = 'done';
      summaries.debate = '本环节未被主席追问';
    } else if (machineValue === 'debate') {
      // 辩论进行中、尚未被点名 → 可能稍后被问，标「等待中」。
      stageStates.debate = 'waiting';
      summaries.debate = '可能被主席追问，等待中…';
    } else {
      stageStates.debate = 'pending';
    }
  }

  if (isChair) stages.push('stage3');

  return finalize({
    id,
    displayName: adapter.displayName,
    isChair,
    stages,
    stageStates,
    summaries,
    texts,
    debateRound,
    live,
    machineValue,
    summary,
    chairpersonId,
  });
}

/** 主席在辩论里发出的全部追问（按轮列出），作为主席 debate 阶段的详情文本。 */
function chairDebateText(session: SessionState | null): string {
  const rounds = session?.debate?.rounds ?? [];
  if (rounds.length === 0) return '';
  return rounds
    .map((r) => `【第 ${r.round} 轮】\n` + r.targets.map((t) => `→ Response ${t.anonLabel}：${t.question}`).join('\n'))
    .join('\n\n');
}

function finalize(args: {
  id: string;
  displayName: string;
  isChair: boolean;
  stages: StageKey[];
  stageStates: Record<string, CardStatus>;
  summaries: Partial<Record<StageKey, string>>;
  texts: Partial<Record<StageKey, string>>;
  debateRound?: number;
  live?: LegView;
  machineValue: MachineValue;
  summary: SessionState['summary'];
  chairpersonId: string;
}): LegModel {
  const { stages, stageStates, summaries, texts, isChair, machineValue, summary, live } = args;
  const rank = RANK[machineValue];

  // —— stage3（仅主席）——
  if (isChair && stages.includes('stage3')) {
    let s3: CardStatus;
    if (summary && (summary.finalAnswer || summary.rawText)) s3 = 'done';
    else if (machineValue === 'stage3') s3 = live ? liveToStatus(live) : 'pending';
    else if (rank > RANK.stage3) s3 = 'failed';
    else s3 = 'pending';
    stageStates.stage3 = s3;
    if (s3 === 'done' && summary) {
      texts.stage3 = summary.finalAnswer || summary.rawText || '';
      summaries.stage3 = preview(summary.finalAnswer || summary.rawText) || '已输出综合结论与置信度';
    }
  }

  const states = stages.map((s) => stageStates[s] ?? 'pending');
  const inRunningPhase = machineValue === 'stage1' || machineValue === 'stage2' || machineValue === 'debate' || machineValue === 'stage3';
  let status: CardStatus;
  if (states.includes('running')) status = 'running';
  else if (states.every((s) => s === 'done')) status = 'done';
  else if (states.includes('failed')) status = 'failed';
  // 议会在跑、但本成员当前能做的都做完了（已有完成阶段或显式 waiting），在等其他成员/下一轮 → 等待中。
  else if (inRunningPhase && (states.includes('done') || states.includes('waiting'))) status = 'waiting';
  else status = 'pending';

  // current = 正在跑的阶段；否则最后一个已完成；否则第一个待开始。
  let current: StageKey = stages[0]!;
  const runningStage = stages.find((s) => stageStates[s] === 'running');
  if (runningStage) current = runningStage;
  else {
    const doneStages = stages.filter((s) => stageStates[s] === 'done');
    if (doneStages.length) current = doneStages[doneStages.length - 1]!;
    else current = stages.find((s) => stageStates[s] === 'pending') ?? stages[0]!;
  }

  let subtext: string | undefined;
  if (status === 'running' && live?.kind === 'running' && live.stage) subtext = SUBSTAGE_LABEL[live.stage];

  return {
    id: args.id,
    displayName: args.displayName,
    isChair,
    status,
    stages,
    stageStates,
    current,
    subtext,
    summaries,
    texts,
    debateRound: args.debateRound,
  };
}

function liveToStatus(v: LegView): CardStatus {
  switch (v.kind) {
    case 'pending':
      return 'pending';
    case 'running':
      return 'running';
    case 'done':
      return 'done';
    case 'error':
      return 'failed';
  }
}

function failText(live?: LegView): string {
  if (live?.kind === 'error') return live.message;
  return '未能完成作答';
}

export function stageLabel(key: StageKey, debateRound?: number): string {
  if (key === 'debate' && debateRound) return `辩论 第${debateRound}轮`;
  return STAGE_LABELS[key];
}
