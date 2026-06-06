# ADR-0015 · UI 精调：概览方块 + 状态标识 + 弹窗详情 + 一键追问 + 历史侧栏（Phase 9）

- 状态：已接受（2026-06-05）
- 相关：README「Phase 9」、[ADR-0010](0010-per-window-tiling-for-background-rendering.md)（后台渲染）、[ADR-0014](0014-multi-round-debate.md)（多轮辩论）、[ADR-0016](0016-default-deep-thinking.md)（深度思考）、开放问题 Q7（历史记录）

## 背景与动机

Phase 5～8 把三阶段议会 + 多轮辩论的**功能**打通了，但 UI 仍是把每家 AI 的回答**全量平铺**：信息过载、对普通用户无意义，也看不清「现在跑到哪一步」。Phase 9 的目标是把界面从「开发者调试视图」升级为「消费级产品」：

- 每个成员一张**概览方块**，标注当前阶段状态（初次作答 / 交叉评审 / 辩论第 N 轮 / 主席综合），默认不平铺原文；
- 点阶段**弹窗**看该成员该阶段的完整原文（按需呈现）；
- 每个成员一个**一键追问**，跳到该 AI 的原生网页继续沟通（插件内**不**做站内追问）；
- 左侧**历史议事侧栏**，可回看历史各家回答与主席结论（落地开放问题 Q7 + Backlog 同名项）。

设计稿来自 Claude Design 手稿（`集思 Delphi.html` 及配套组件），用户已确认视觉方向：**微拟物、中性灰背景、强调色 `#B5532F`、支持 系统/浅色/深色**。

## 决策

### 1. UI 框架：不引入组件库，沿用「React 轻量用法 + 内联样式 + CSS 设计令牌」

- 评估过 Hero UI 等组件库，**否决**。理由：议会页交互形态独特（拟物卡片、阶段步进器、置信度环），组件库收益小、却带来体积与样式耦合，违背技术栈表「保持组件极简，避免过度设计」。
- 设计令牌（颜色/阴影/圆角/动画/按钮类/tooltip）集中放在 `entrypoints/council/index.html` 的 `<style>`，用 CSS 变量驱动深浅主题；组件用内联 `style` 引用 `var(--*)`。强调色固定 `#B5532F`，背景固定**中性灰**（用户拍板，不保留设计稿里的强调色/背景色调切换等 Tweaks 调试项）。
- 主题（系统/浅色/深色）持久化到 `chrome.storage.local`（`theme.ts`），`system` 模式跟随 `prefers-color-scheme`。

### 2. 成员卡片：从「全局分阶段机器状态」**派生** per-leg 流水线（`leg-model.ts`）

关键张力：设计稿把每个模型画成 `初次作答 → 交叉评审 →（辩论）→ 主席综合` 的**逐成员流水线**，但真实状态机（`machine.ts`）是**全局分阶段**跑的（所有人先 stage1，再全员 stage2…）。

决策：**不改状态机**，而在 UI 侧用 `deriveLeg()` 把「全局机器状态 + 持久化 session（`initialAnswers`/`reviews`/`debate`/`summary`）+ 当前在途 `liveView`」折叠成每个成员的 per-stage 状态与内容。

- 已完成阶段的**权威来源是持久化 session**（`initialAnswers[id]`、`reviews[id]`、`debate.rounds[].targets`、`summary`）；
- 当前活动阶段的**在途信号取 `liveView`**（orchestrator hooks 推送的瞬时状态，提供「注入问题…/生成中…」子状态与 running 指示）；
- 阶段适用性：stage1/stage2 全员都有；`debate` 行仅在该成员**被主席点名过**时出现（随辩论推进动态出现，忠实反映「谁被追问」）；`stage3` 仅主席有；
- **降级一致**：stage1 拿不到初始回答 = 该成员未参会 → 卡片只显示 stage1（失败）一行、整卡置失败，与 ADR-0006 单点降级、设计稿失败态一致。

### 3. 历史归档：单活动会话 → 归档列表（`session-state.ts`）

- 既有 `delphi:session`（单活动会话）继续承担**崩溃恢复**（ADR-0004/0011），语义不变；
- 新增 `delphi:archive`（数组，最新在前，上限 `ARCHIVE_LIMIT=60`，FIFO 淘汰）承担**历史回看**：会话**完成或中止**且「至少有一家初始回答」时，把状态快照 `archiveSession()` 追加进归档（同 id 去重前插）；
- 归档是**只读快照**，回看时不再驱动状态机；侧栏按「今天 / 昨天 / M月D日」分组（`groupArchiveByDate`）。
- 三种展示模式（`mode`）：`idle`（介绍页）/ `live`（当前机器会话）/ `archive`（历史回看）。回看与实时跑互不干扰。

### 4. 一键追问：开原生页，不做站内追问

- 「追问」按钮直接 `chrome.tabs.create({ url: adapter.newChatUrl })` 打开该 AI 原生网页；追问主席同理（去主席原生页）。
- 不在插件内实现站内多轮对话：符合 README Phase 9 约定，避免把单条消息的上下文搬运/再注入复杂化（C1 无 API，站内续聊不可靠）。

## 影响

- 新增 `entrypoints/council/{theme.ts, leg-model.ts}`、`ui/{icons,marks,primitives}.tsx`、`components/{Sidebar,Composer,ProgressCard,DetailModal,DebateTimeline,ConclusionPanel,CalibrationPanel}.tsx`；`App.tsx` 重写为组合层。
- `index.html` 注入设计令牌与全局类；引入 Google Fonts（Inter / Noto Sans SC / JetBrains Mono），系统字体兜底，离线不致命。
- `session-state.ts` 增 `archiveSession/loadArchive/deleteArchived/clearArchive/groupArchiveByDate` 与 `ArchivedSession`，不改既有恢复逻辑。
- 状态机、orchestrator、适配器协议**零改动**——Phase 9 纯 UI/持久化层，对编排无回归。

## 备选与否决

- **引入组件库（Hero UI）**：否决，见决策 1。
- **改状态机为逐成员流水线以贴合设计**：否决。状态机的全局分阶段是 ADR-0006/0012 的核心，改动风险大且无功能收益；UI 侧派生即可还原视觉。
- **保留设计稿 Tweaks（强调色/背景色调/节奏/演示开关）**：否决（用户拍板），仅保留主题三态切换。

## 实机反馈微调（2026-06-05）

首轮实机后按用户反馈做的若干修正：

1. **辩论阶段主席有进度**：主席是辩论的发问方、无 `debateTurns`，旧逻辑下其卡片在 debate 阶段毫无动静。现给主席补一条 `debate` 步进行（「正在向匿名成员定向追问…」/「已完成定向追问」），详情可看主席各轮发出的全部追问。
2. **非主席成员开了辩论也始终有 `debate` 步**：避免「stage2 后显示已完成、之后被点名又进度回退」。未被点名则收尾为「本环节未被主席追问」（完成）；辩论进行中未被点名标「等待中」。
3. **新增 `waiting`（等待中）卡片状态**：议会在跑、但本成员当前能做的都做完了（在等其他成员/下一轮）时，右上角从「待开始」改为「等待中」，与「尚未开始」区分。
4. **所有卡片等高**：成员卡片网格 `grid-auto-rows: 1fr` + `align-items: stretch`，不同阶段数的卡片视觉统一。
5. **「直接输出文本，勿建文件」指令**：通义千问对长回答会自作主张生成 Word/附件导致抓不到正文。在 stage1 / 评审 / 辩论追问的注入 prompt 统一追加 `TEXT_ONLY_DIRECTIVE`（`machine.ts`）。
6. **主席综合以 Markdown 输出 + 富文本渲染**：`buildChairpersonPrompt` 要求 ANSWER/CONSENSUS/DISPUTED 区块用 Markdown；插件抓到纯文本后用**自带的零依赖 Markdown 渲染器**（`markdown.tsx`，不引入第三方库，先转义 HTML 再套标记）渲染成富文本展示在结论面板，排版更易读。前序各家原文仍按纯文本展示（按需点开，无需强制 Markdown）。
7. **追问优先切到已开标签页**：见 `App.tsx askNative`——实时议会内点「追问」优先 `tabs.update` 切到该站已打开且存活的标签页，仅在回看历史/标签页已关闭时才新建。
8. **辩论时间线「揭示真实身份」用品牌图标**：揭示后匿名方头像用模型品牌 SVG（`ModelMark`），不再是字母 monogram。
