import { setup, assign, fromPromise } from 'xstate';
import type { SiteAdapter } from '../shared/adapter-schema';
import type { SessionState, DebateState, DebateRound } from '../shared/session-state';
import { openCouncilTabs, type CouncilTabs } from './council-tabs';
import { runStageParallel, driveLegResilient, type LegResult, type BroadcastHooks } from './orchestrator';
import { saveSession, buildAnonMap, anonLabelOf } from '../shared/session-state';

/** 辩论轮数上限（ADR-0014） */
const MAX_DEBATE_ROUNDS = 3;

// 「简明作答」指令：交叉验证需把各家初始回答全量拼进同一条消息再下发，体量直接决定后续可行性，
// 故在阶段一注入时追加此要求，压住各家「长篇大论」。仅用于注入，session.prompt 仍保留干净原题，
// stage2/3 引用「原始问题」时不带这段指令。
// 「直接输出文本」指令：部分站点（如通义千问）对长回答会自作主张生成 Word/文档/表格等**附件**，
// 而非在对话里出文字 —— 这样插件抓不到正文。所有注入的 prompt 都追加此约束。
const TEXT_ONLY_DIRECTIVE =
  '请直接在对话框里用纯文字回答，**不要创建或生成 Word、文档、表格、PPT、图片或任何可下载的附件/文件**。';

const CONCISE_DIRECTIVE =
  `\n\n【作答要求】请简明扼要、直击要点：先给核心结论，再用精炼条目列出关键依据；避免冗长铺陈、重复与客套话。${TEXT_ONLY_DIRECTIVE}`;

// 阶段一注入提示词 = 用户原题 + 简明作答要求。
function buildStageOnePrompt(prompt: string): string {
  return `${prompt}${CONCISE_DIRECTIVE}`;
}

/**
 * 只有「阶段一成功作答」的成员才进入后续阶段（交叉评审 / 辩论 / 主席综合）。
 * 判据 = 有初始答案（与 buildAnonMap 同源），失败/空答的成员（如发送失败、初答失败的 Kimi）一律排除：
 *  1) 不再向其重发后续 prompt —— 否则会把残留在它输入框里的「上一阶段未发出的旧内容」连同新内容一起发出
 *     （Kimi 实测：首答 txt 未发出 + 交叉评审 txt 叠加，两个附件被一起发出）；
 *  2) 不让其它成员在 runStageParallel 的 allSettled 处空等一条注定失败/超时的腿，白白拖慢整盘。
 */
function activeAdapters(session: SessionState, adapters: SiteAdapter[]): SiteAdapter[] {
  return adapters.filter((a) => !!session.initialAnswers?.[a.id]);
}

export interface CouncilContext {
  session: SessionState;
  adapters: SiteAdapter[];
  /** 本轮议会的窗口/标签页句柄。stage1 开窗后赋值；新一轮 START / 中止 ABORT 时清空。 */
  council?: CouncilTabs;
  hooks?: BroadcastHooks;
}

export type CouncilEvents =
  | { type: 'START'; prompt: string; enableThinking: boolean; enableDebate: boolean; chairpersonId: string; adapters: SiteAdapter[] }
  | { type: 'RESUME'; session: SessionState; adapters: SiteAdapter[] }
  | { type: 'ABORT' }
  | { type: 'STAGE1_DONE' }
  | { type: 'STAGE2_DONE' }
  | { type: 'STAGE3_DONE' }
  | { type: 'ERROR'; error: string };

// 按稳定匿名映射（anonMap）拼匿名初始回答块；评审/主席/辩论三处共用，标签一致（ADR-0014）。
function formatAnonymousAnswers(session: SessionState, heading: string): string {
  const anonMap = session.anonMap ?? {};
  return Object.entries(anonMap)
    .map(([label, id]) => `=== ${heading} ${label} ===\n${session.initialAnswers?.[id] ?? ''}`)
    .join('\n\n');
}

// 评审意见块：按真实 id 取评审文本，但对外只露匿名编号（评审者身份同样匿名）。
function formatReviews(session: SessionState): string {
  return Object.entries(session.reviews || {})
    .filter(([_, text]) => !!text)
    .map(([id, text]) => {
      const label = anonLabelOf(session, id);
      return `=== 评审意见（来自 ${label ? `Response ${label}` : '匿名成员'}）===\n${text}`;
    })
    .join('\n\n');
}

// 把已发生的辩论轮次整理成可读记录，喂回主席（发问/综合两处共用）。
function formatDebateTranscript(session: SessionState): string {
  const rounds = session.debate?.rounds ?? [];
  if (rounds.length === 0) return '';
  return rounds
    .map((r) => {
      const body = r.targets
        .map((t) => {
          const ans = t.status === 'done' && t.answer ? t.answer : '（未回应）';
          return `主席 → Response ${t.anonLabel}：${t.question}\nResponse ${t.anonLabel}：${ans}`;
        })
        .join('\n\n');
      return `【第 ${r.round} 轮追问】\n${body}`;
    })
    .join('\n\n');
}

// Helper to format the cross-review prompt
function buildReviewPrompt(session: SessionState): string {
  const responses = Object.entries(session.anonMap ?? {})
    .map(([label, id]) => `=== 匿名回答 ${label} ===\n${session.initialAnswers?.[id] ?? ''}\n=== 结束匿名回答 ${label} ===`)
    .join('\n\n');

  return `请根据以下提供的原始问题以及各个匿名AI的回答，进行交叉评审。
原始问题：
${session.prompt}

各位AI的回答：
${responses}

【评审规则】
一、分项评审（每份回答按以下5维度点评，每条不超过2行）：
1. 事实准确性：是否存在常识、数据、案例类客观错误（优先标注致命硬错）
2. 论据有效性：支撑结论的依据是否完备、来源是否可验证
3. 逻辑严谨性：推导链条是否断裂、是否存在偷换概念或因果倒置
4. 概念合规性：仅核查题干或行业明确定义的关键名词是否跑偏（开放式概念跳过）
5. 内容局限性：遗漏关键视角或未覆盖题干核心诉求
二、输出内容（精简，禁止复述原文）：
1. 逐个回答的分项点评（引用具体条目位置，如"回答A第2点"）
2. 汇总【待核验疑点清单】（供主席定向追问）
3. 综合意见：区分已达成初步共识的内容 vs 天然分歧，并给出共识度判断（≥75%支持且无有效反驳视为共识）

全程简明扼要，避免长篇。${TEXT_ONLY_DIRECTIVE}`;
}

// 辩论·主席发问 prompt：要么用固定格式对指定匿名编号追问，要么声明 NONE 收敛（ADR-0014）。
function buildDebateQuestionPrompt(session: SessionState): string {
  const transcript = formatDebateTranscript(session);
  return `作为本次AI议会的主席，请判断在给出最终结论前，是否还需要向某些匿名回答**定向追问**以澄清关键分歧或补齐缺失信息。
原始问题：
${session.prompt}

各匿名回答：
${formatAnonymousAnswers(session, '初始回答')}

交叉评审意见：
${formatReviews(session)}
${transcript ? `\n此前的追问记录：\n${transcript}\n` : ''}
**追问优先级**：客观硬错误 > 论据缺失 > 逻辑矛盾 > 观点分歧。仅当存在严重影响结论可靠性的矛盾或缺失时才追问。

如果你认为还需要追问，请**严格**用下面的格式输出（每行一个追问，@ 后紧跟匿名编号，冒号后是你的问题；只能追问上面出现过的编号）：
===DEBATE===
@A: 你想问 Response A 的问题
@C: 你想问 Response C 的问题
===/DEBATE===

如果你认为信息已经足够、无需再追问，请输出：
===DEBATE===
NONE
===/DEBATE===`;
}

// 辩论·成员作答 prompt：发到被点名成员自己的标签页（其上下文里有它此前的回答）。
function buildMemberFollowupPrompt(question: string): string {
  return `（这是针对你之前回答的追问，请直接、简明地作答，不要复述原问题。）${TEXT_ONLY_DIRECTIVE}
追问：
${question}

【作答要求】
1. **直接回应**：首先明确表态——承认原回答存在错误/不足，或坚持原观点。
2. **行动选择**：
   - 若承认错误：给出明确修正后的陈述。
   - 若坚持原观点：提供新的证据、逻辑链或反驳依据。
3. 禁止重复之前的内容，禁止回避问题，禁止堆砌无关论据。`;
}

// 解析主席的 ===DEBATE=== 区块。返回合法目标（编号需在 validLabels 内）；NONE / 无合法目标 -> []。
function parseDebateQuestions(text: string, validLabels: string[]): { label: string; question: string }[] {
  const m = text.match(/===DEBATE===([\s\S]*?)===\/DEBATE===/i);
  if (!m || !m[1]) return [];
  const body = m[1].trim();
  if (/^NONE$/im.test(body)) return [];
  const valid = new Set(validLabels);
  const out: { label: string; question: string }[] = [];
  for (const line of body.split('\n')) {
    const lm = line.match(/^\s*@?\s*([A-Za-z])\s*[:：]\s*(.+)$/);
    if (!lm) continue;
    const label = lm[1]!.toUpperCase();
    const question = lm[2]!.trim();
    if (valid.has(label) && question && !out.some((o) => o.label === label)) {
      out.push({ label, question });
    }
  }
  return out;
}

// Helper to format the chairperson prompt
function buildChairpersonPrompt(session: SessionState): string {
  const transcript = formatDebateTranscript(session);
  return `作为本次AI议会的主席，请根据原始问题、各家的初始回答、交叉评审意见${transcript ? '以及多轮定向追问的记录' : ''}，输出最终的结论。请严格遵循文末的「输出契约」（这是本次任务最重要的硬性要求）。
原始问题：
${session.prompt}

初始回答：
${formatAnonymousAnswers(session, '初始回答')}

交叉评审意见：
${formatReviews(session)}
${transcript ? `\n多轮追问记录：\n${transcript}\n` : ''}
======================
【输出契约 · 务必逐条遵守】
1. 你的整份回复**必须完整包裹在一个 Markdown 代码块里**：第一行写三个反引号加 markdown（\`\`\`markdown），最后一行写三个反引号（\`\`\`）收尾，**中间不要再出现任何反引号代码块**。这样可以让你写的 # 标题、**加粗**、列表等 Markdown 源码符号被原样保留、不被渲染掉——这是硬性要求。
2. 代码块内部依次包含 ANSWER / CONSENSUS / DISPUTED / CONFIDENCE 四个区块；每个 \`===XXX===\` 与 \`===/XXX===\` 分隔符各占一行、原样保留；代码块之外不要写任何前言或说明。
3. ANSWER / CONSENSUS / DISPUTED 三个区块内部用 Markdown 排版：\`##\`/\`###\` 小标题、\`-\` 无序列表、\`1.\` 有序列表、\`**加粗**\`、必要时表格，把结论清晰分层；如需展示代码请用行内反引号，不要再用三反引号围栏。
4. CONFIDENCE 区块只写一个 0-100 的纯数字。
${TEXT_ONLY_DIRECTIVE}

请严格照下面这个**格式示例**来输出（注意最外层的 \`\`\`markdown 围栏；文字仅示意结构，正文请你根据材料自行撰写）：
\`\`\`markdown
===ANSWER===
## 核心结论
**一句话结论**……

### 关键依据
1. ……
2. ……
===/ANSWER===
===CONSENSUS===
- 各方一致认同：……
===/CONSENSUS===
===DISPUTED===
- 分歧点：……
===/DISPUTED===
===CONFIDENCE===
85
===/CONFIDENCE===
\`\`\``;
}

// 把 stage2 评审结果落进 session.reviews 并保存（debate / stage3 两条分支共用）。
function collectReviews(session: SessionState, results: LegResult[]): SessionState {
  const reviews: Record<string, string> = {};
  results.forEach((res) => {
    if (res.ok && res.text) reviews[res.adapterId] = res.text;
  });
  const newSession = { ...session, reviews };
  saveSession(newSession);
  return newSession;
}

/**
 * 剥掉一层包裹整段文本的 Markdown 代码围栏（```lang … ```）。
 * 主席有时会把整份回答、或某个区块的内容，整体塞进 ```markdown 代码块里——
 * 这样前端按纯文本渲染会把围栏一起显示出来，故解析时统一脱壳。
 */
function stripCodeFence(s: string): string {
  const t = s.trim();
  const m = t.match(/^```[^\n`]*\n([\s\S]*?)\n?```$/);
  return m && m[1] != null ? m[1].trim() : t;
}

/**
 * 取出主席输出里「真正的 Markdown 源码」。
 * 我们刻意要求主席把四个区块整体包进一个 ```markdown 代码块——因为聊天页会把普通 Markdown
 * 渲染掉（innerText 会丢失井号、星号、连字符等 Markdown 标记），唯有代码块里的内容才被原样保留、能抓到源码。
 * 解析顺序：① 优先取「包含 ===ANSWER=== 的那个代码围栏」的内部内容（容忍围栏前后有寒暄）；
 * ② 否则退回「整段被单层围栏包裹」的脱壳；③ 都没有就原样返回（模型没听话直接出了纯文本）。
 */
function unwrapChairFence(text: string): string {
  for (const f of text.matchAll(/```[^\n`]*\n([\s\S]*?)```/g)) {
    if (f[1] && /===ANSWER===/i.test(f[1])) return f[1].trim();
  }
  return stripCodeFence(text);
}

function parseChairpersonSummary(text: string) {
  // 先把内容从代码围栏里取出来，再按区块解析。
  const unwrapped = unwrapChairFence(text);
  const extract = (tag: string) => {
    const regex = new RegExp(`===${tag}===([\\s\\S]*?)===/${tag}===`, 'i');
    const match = unwrapped.match(regex);
    // 每个区块内部也可能被单独套了一层 ```markdown 围栏，一并脱掉。
    return match && match[1] ? stripCodeFence(match[1].trim()) : '';
  };
  return {
    finalAnswer: extract('ANSWER'),
    consensus: extract('CONSENSUS'),
    disputes: extract('DISPUTED'),
    confidence: extract('CONFIDENCE'),
    rawText: text,
  };
}

// ── 主席综合的「格式化轮」（ADR-0015 增补）──────────────────────────────
// 背景：主席综合那条 prompt 上下文极大（原题+全部初答+评审+辩论），末尾的「用 Markdown 排版」
// 属弱指令，长上下文下注意力被稀释、经常失效（实测 DeepSeek 反复不守规矩）。
// 方案：把「综合」与「排版」解耦成两轮——第一轮专心综合内容，第二轮拿着这份**短得多**的结论，
// 只做「重排成规定区块 + Markdown」。输入越短越聚焦，格式遵循率显著更高。

/** 文本是否已包含齐全的主席区块（至少 ANSWER + CONFIDENCE 分隔符）。 */
function hasChairBlocks(text: string): boolean {
  const u = unwrapChairFence(text);
  return /===ANSWER===[\s\S]*?===\/ANSWER===/i.test(u) && /===CONFIDENCE===/i.test(u);
}

/**
 * 第一轮输出是否「已经排版良好」——区块齐全，且 ANSWER 内含 Markdown 标记。满足则跳过第二轮格式化。
 *
 * 关键事实：聊天页会把 ```代码块``` 的**围栏吃掉**（用于生成 <pre><code> 元素），innerText 抓不到 ```，
 * 但代码块**内部的源码符号（井号、星号、连字符）会被原样保留**。反之，未套代码块的 Markdown 会被渲染、符号被吃掉。
 * 因此「是否已用代码块包裹」的可靠信号不是有无 ``` 围栏，而是 **ANSWER 内是否还留有 Markdown 标记**：
 * 有标记 ⇒ 来自代码块、源码完好 ⇒ 跳过第二轮；无标记 ⇒ 已被渲染成纯文本 ⇒ 触发第二轮补救。
 */
function looksWellFormatted(text: string): boolean {
  if (!hasChairBlocks(text)) return false;
  const u = unwrapChairFence(text);
  const ans = /===ANSWER===([\s\S]*?)===\/ANSWER===/i.exec(u)?.[1] ?? '';
  return /(^|\n)\s*(#{1,6}\s|[-*+]\s|\d+\.\s|\|)/.test(ans) || /\*\*[^*\n]+\*\*/.test(ans);
}

/**
 * 第二轮「格式化」prompt：只重排，不改动结论内容/数字/观点。
 * 因为这条 prompt 发在**同一个主席标签页、同一段对话**里，模型上下文中已有它刚才那条结论，
 * 无需再把原文塞回来——一句「把你上一条回复重排格式」即可，prompt 越短越聚焦、格式遵循率越高。
 */
function buildFormattingPrompt(): string {
  return `请把你**上一条回复**里给出的「最终结论」，**用 Markdown 重新排版，并把整份内容包进一个 \`\`\`markdown 代码块里**重新输出一遍——只调整呈现格式，**绝对不要改动其中任何观点、数据、数字与结论**。务必严格遵守下面的输出契约。

【输出契约 · 务必逐条遵守】
1. 你的整份回复**必须完整包裹在一个 Markdown 代码块里**：第一行写三个反引号加 markdown（\`\`\`markdown），最后一行写三个反引号（\`\`\`）收尾，中间不要再出现任何反引号围栏。这样能保留 # 标题、**加粗**、列表等 Markdown 源码符号、不被渲染掉。
2. 代码块内部依次包含 ANSWER / CONSENSUS / DISPUTED / CONFIDENCE 四个区块；每个 \`===XXX===\` 与 \`===/XXX===\` 分隔符各占一行、原样保留，代码块之外不写任何前言或说明。
3. ANSWER / CONSENSUS / DISPUTED 内部用 Markdown（\`##\` 小标题、\`-\` 无序列表、\`1.\` 有序列表、\`**加粗**\`、必要时表格）排版。
4. 按你上一条回复的内容如实归类填入各区块；确无对应内容的区块（如无分歧）也要保留该区块并写「无」。CONFIDENCE 区块只写一个 0-100 的纯数字。
${TEXT_ONLY_DIRECTIVE}

格式示例（注意最外层的 \`\`\`markdown 围栏；正文用你上一条回复的内容）：
\`\`\`markdown
===ANSWER===
## 核心结论
**……**

### 关键依据
1. ……
===/ANSWER===
===CONSENSUS===
- ……
===/CONSENSUS===
===DISPUTED===
- ……
===/DISPUTED===
===CONFIDENCE===
85
===/CONFIDENCE===
\`\`\``;
}

export const councilMachine = setup({
  types: {
    context: {} as CouncilContext,
    events: {} as CouncilEvents,
  },
  actors: {
    runStage1: fromPromise<{results: LegResult[], council: CouncilTabs}, { context: CouncilContext }>(async ({ input }) => {
      const { session, adapters, hooks } = input.context;
      let council = input.context.council;
      if (!council) {
        council = await openCouncilTabs(adapters);
        // Bind tabs to session
        for (const a of adapters) {
          if (session.legs[a.id]) {
            session.legs[a.id]!.tabId = council.tabs.get(a.id);
            session.legs[a.id]!.windowId = council.windows.get(a.id);
          }
        }
        await saveSession(session);
      }
      const results = await runStageParallel(session, council, adapters, buildStageOnePrompt(session.prompt), hooks || {});
      return { results, council };
    }),
    runStage2: fromPromise<LegResult[], { context: CouncilContext }>(async ({ input }) => {
      const { session, adapters, council, hooks } = input.context;
      // Phase 2: 互评 —— 仅限阶段一**成功作答**的成员参与（排除失败/空答者，见 activeAdapters）。
      const participants = activeAdapters(session, adapters);
      const reviewPrompt = buildReviewPrompt(session);

      // 把参与者重置为 pending 让 UI 显示本阶段进度；runStageParallel→driveLegResilient 会把
      // legs[].text 覆盖为评审文本，故初始答案早已单独存档在 session.initialAnswers（stage1 onDone）。
      // 注意：**只重置参与者**，失败成员保持其 'failed' 状态不动 —— 既不重发也不在卡片上「复活」。
      for (const adapter of participants) {
         if (session.legs[adapter.id]) {
           session.legs[adapter.id]!.status = 'pending';
           session.legs[adapter.id]!.text = undefined;
         }
      }
      await saveSession(session);

      const results = await runStageParallel(session, council!, participants, reviewPrompt, hooks || {});
      return results;
    }),
    runStage3: fromPromise<LegResult, { context: CouncilContext }>(async ({ input }) => {
      const { session, adapters, council, hooks } = input.context;
      
      // Phase 3: 主席综合 —— 主席须是阶段一**成功作答**的成员；若用户选定的主席在阶段一失败
      // （如发送失败的 Kimi），回退到第一个成功成员，避免向已失败的 AI 重发综合 prompt。
      const participants = activeAdapters(session, adapters);
      const chairpersonAdapter =
        participants.find(a => a.id === session.chairpersonId) || participants[0];
      if (!chairpersonAdapter) throw new Error("No chairperson available");
      
      const chairPrompt = buildChairpersonPrompt(session);
      
      // Only drive the chairperson leg
      if (session.legs[chairpersonAdapter.id]) {
        session.legs[chairpersonAdapter.id]!.status = 'pending';
        session.legs[chairpersonAdapter.id]!.text = undefined;
      }
      await saveSession(session);
      
      // 第一轮：主席综合（专心产出内容）。
      const resA = await driveLegResilient(session, council!, chairpersonAdapter, chairPrompt, hooks || {});

      // 第二轮：格式化（解耦排版）。仅当第一轮成功且**尚未排版良好**时才追加，
      // 避免对已经合规的输出做无谓的二次往返。整轮 onLegResult 只在最终态发一次，
      // 这样卡片在两轮之间保持「进行中」，不会先闪「已完成」再回退。
      let finalRes = resA;
      if (resA.ok && resA.text && !looksWellFormatted(resA.text)) {
        if (session.legs[chairpersonAdapter.id]) {
          session.legs[chairpersonAdapter.id]!.status = 'pending';
          session.legs[chairpersonAdapter.id]!.text = undefined;
        }
        await saveSession(session);
        const resB = await driveLegResilient(session, council!, chairpersonAdapter, buildFormattingPrompt(), hooks || {});
        // 仅当格式化轮确实产出齐全区块时才采用；否则回退到第一轮原文（解析端仍会兜底脱壳）。
        if (resB.ok && resB.text && hasChairBlocks(resB.text)) finalRes = resB;
      }

      if (hooks && hooks.onLegResult) {
        hooks.onLegResult(finalRes);
      }
      return finalRes;
    }),
    // Phase 8: 多轮辩论（ADR-0014）。主席对匿名成员定向追问 → 中枢路由 → 成员作答 → 回填累积，≤3 轮收敛。
    runDebate: fromPromise<DebateState, { context: CouncilContext }>(async ({ input }) => {
      const { session, adapters, council, hooks } = input.context;
      const h = hooks || {};
      // 主席须是阶段一成功成员；选定主席若失败则回退到第一个成功成员（追问目标本就取自 anonMap，已自带过滤）。
      const participants = activeAdapters(session, adapters);
      const chair = participants.find((a) => a.id === session.chairpersonId) || participants[0];
      const byId = new Map(adapters.map((a) => [a.id, a] as const));
      // 可追问目标：所有有匿名编号的成员，但**排除主席自身**（主席不自我追问）。
      const validLabels = Object.entries(session.anonMap ?? {})
        .filter(([_, id]) => id !== chair?.id)
        .map(([label]) => label);

      const debate: DebateState = session.debate ?? { rounds: [], converged: false };
      session.debate = debate;

      while (!debate.converged && debate.rounds.length < MAX_DEBATE_ROUNDS && validLabels.length > 0) {
        // 恢复场景：若最后一轮仍有未完成目标，先补完它，否则发起新一轮。
        let round: DebateRound | undefined = debate.rounds[debate.rounds.length - 1];
        const resumingRound = !!round && round.targets.some((t) => t.status === 'pending');

        if (!resumingRound) {
          // —— 主席发问 ——
          if (!chair) { debate.converged = true; break; }
          const qPrompt = buildDebateQuestionPrompt(session);
          const qRes = await driveLegResilient(session, council!, chair, qPrompt, h);
          h.onLegResult?.(qRes);
          // 主席这一轮失败/无输出 → 优雅收敛（辩论是增强，不阻断综合）。
          if (!qRes.ok || !qRes.text) { debate.converged = true; break; }
          const qs = parseDebateQuestions(qRes.text, validLabels);
          if (qs.length === 0) { debate.converged = true; await saveSession(session); break; }
          round = {
            round: debate.rounds.length + 1,
            targets: qs.map((q) => ({
              anonLabel: q.label,
              adapterId: session.anonMap![q.label]!,
              question: q.question,
              status: 'pending' as const,
            })),
          };
          debate.rounds.push(round);
          await saveSession(session);
          h.onDebateUpdate?.(debate);
        }

        // —— 被点名成员并行作答 ——（仅驱动 pending 目标，已完成的不重发）
        const pending = round!.targets.filter((t) => t.status === 'pending');
        await Promise.allSettled(
          pending.map(async (t) => {
            const ad = byId.get(t.adapterId);
            if (!ad) { t.status = 'failed'; return; }
            const r = await driveLegResilient(session, council!, ad, buildMemberFollowupPrompt(t.question), h);
            h.onLegResult?.(r);
            if (r.ok && r.text) { t.answer = r.text; t.status = 'done'; }
            else { t.status = 'failed'; }
            await saveSession(session);
            h.onDebateUpdate?.(debate);
          }),
        );
        await saveSession(session);
      }

      debate.converged = debate.converged || debate.rounds.length >= MAX_DEBATE_ROUNDS || validLabels.length === 0;
      await saveSession(session);
      h.onDebateUpdate?.(debate);
      return debate;
    })
  }
}).createMachine({
  id: 'council',
  initial: 'idle',
  context: ({ input }) => ({
    session: (input as any).session,
    adapters: (input as any).adapters || [],
    council: (input as any).council,
    hooks: (input as any).hooks,
  }),
  on: {
    START: {
      target: '.stage1',
      actions: assign({
        adapters: ({ event }) => event.adapters,
        // ② 清掉上一轮的 council 句柄：否则 runStage1 会误判「已有窗口」而跳过 openCouncilTabs，
        //    导致第二轮不再按网格平铺、各家窗口层叠在默认位置。
        council: () => undefined,
        // ③ 全新构造 session，不再 spread 旧 session：避免把上一轮的 summary / reviews 带进新一轮
        //    （否则旧的主席综合结论会残留在页面上）。
        session: ({ event }) => {
          const legs = Object.fromEntries(event.adapters.map(a => [a.id, { adapterId: a.id, displayName: a.displayName, status: 'pending' as const }]));
          return {
            id: `s_${Date.now()}`,
            prompt: event.prompt,
            enableThinking: event.enableThinking,
            enableDebate: event.enableDebate,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            adapterIds: event.adapters.map(a => a.id),
            legs,
            chairpersonId: event.chairpersonId,
            initialAnswers: undefined,
            anonMap: undefined,
            reviews: undefined,
            debate: undefined,
            summary: undefined,
            status: 'stage1' as const,
          };
        }
      })
    },
    // ① 中止议事：任意阶段都可中途停止。退出当前 stage 会停掉正在 invoke 的 actor
    //    （在途的 sendMessage 不再推进状态机）；窗口的关闭由 App 侧 closeAllTabs 负责。
    //    把 session 标记为 finished 并落盘：避免在途腿的延迟回写把它又变回「可恢复」。
    ABORT: {
      target: '.idle',
      actions: assign({
        council: () => undefined,
        session: ({ context }) => {
          if (!context.session) return context.session;
          const aborted = { ...context.session, status: 'finished' as const };
          saveSession(aborted);
          return aborted;
        },
      }),
    }
  },
  states: {
    idle: {
      on: {
        RESUME: [
          { guard: ({ event }) => event.session.status === 'stage1', target: 'stage1', actions: assign({ session: ({ event }) => event.session, adapters: ({ event }) => event.adapters }) },
          { guard: ({ event }) => event.session.status === 'stage2', target: 'stage2', actions: assign({ session: ({ event }) => event.session, adapters: ({ event }) => event.adapters }) },
          { guard: ({ event }) => event.session.status === 'debate', target: 'debate', actions: assign({ session: ({ event }) => event.session, adapters: ({ event }) => event.adapters }) },
          { guard: ({ event }) => event.session.status === 'stage3', target: 'stage3', actions: assign({ session: ({ event }) => event.session, adapters: ({ event }) => event.adapters }) },
          { guard: ({ event }) => event.session.status === 'finished', target: 'finished', actions: assign({ session: ({ event }) => event.session, adapters: ({ event }) => event.adapters }) }
        ]
      }
    },
    stage1: {
      entry: ({ context }) => { context.session.status = 'stage1'; saveSession(context.session); },
      invoke: {
        src: 'runStage1',
        input: ({ context }) => ({ context }),
        onDone: {
          target: 'stage2',
          actions: assign({
            council: ({ event }) => event.output.council,
            // 存档 stage1 各家初始答案 + 一次性确定稳定匿名映射（ADR-0014）。
            // 必须在 stage2 覆盖 legs[].text 之前固化，否则初始答案丢失、辩论无从路由。
            session: ({ context, event }) => {
              const initialAnswers: Record<string, string> = {};
              event.output.results.forEach((r) => {
                if (r.ok && r.text) initialAnswers[r.adapterId] = r.text;
              });
              const s = { ...context.session, initialAnswers };
              s.anonMap = buildAnonMap(s);
              saveSession(s);
              return s;
            },
          })
        },
        onError: {
          target: 'error',
          actions: ({ event }) => console.error("Stage 1 Error:", event.error)
        }
      }
    },
    stage2: {
      entry: ({ context }) => { context.session.status = 'stage2'; saveSession(context.session); },
      invoke: {
        src: 'runStage2',
        input: ({ context }) => ({ context }),
        // 评审结果落 reviews 后：启用辩论 → debate，否则直接 → stage3（老流程零回归，ADR-0014）。
        onDone: [
          {
            guard: ({ context }) => !!context.session.enableDebate,
            target: 'debate',
            actions: assign({ session: ({ context, event }) => collectReviews(context.session, event.output) }),
          },
          {
            target: 'stage3',
            actions: assign({ session: ({ context, event }) => collectReviews(context.session, event.output) }),
          },
        ],
        onError: {
          target: 'error',
          actions: ({ event }) => console.error("Stage 2 Error:", event.error)
        }
      }
    },
    debate: {
      entry: ({ context }) => { context.session.status = 'debate'; saveSession(context.session); },
      invoke: {
        src: 'runDebate',
        input: ({ context }) => ({ context }),
        onDone: {
          target: 'stage3',
          actions: assign({
            session: ({ context, event }) => {
              const newSession = { ...context.session, debate: event.output };
              saveSession(newSession);
              return newSession;
            }
          })
        },
        // 辩论是增强而非关键路径：失败也照常进 stage3 综合（用已有的初始答案 + 评审）。
        onError: {
          target: 'stage3',
          actions: ({ event }) => console.error("Debate Error:", event.error)
        }
      }
    },
    stage3: {
      entry: ({ context }) => { context.session.status = 'stage3'; saveSession(context.session); },
      invoke: {
        src: 'runStage3',
        input: ({ context }) => ({ context }),
        onDone: {
          target: 'finished',
          actions: assign({
            session: ({ context, event }) => {
              const res = event.output;
              if (res.ok && res.text) {
                context.session.summary = parseChairpersonSummary(res.text);
              }
              const newSession = { ...context.session, status: 'finished' as const };
              saveSession(newSession);
              return newSession;
            }
          })
        },
        onError: {
          target: 'error',
          actions: ({ event }) => console.error("Stage 3 Error:", event.error)
        }
      }
    },
    finished: {
      // removed type: 'final' to allow restarting
    },
    error: {}
  }
});
