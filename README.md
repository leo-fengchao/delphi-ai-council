# 集思 · Delphi

> **AI Council Extension（浏览器插件版 AI 议会）**

> 文档驱动开发项目。本 `README.md` 与 `docs/adr/` 下的 ADR 是**唯一真理源 (Single Source of Truth)**。任何编码前必须先读本文件与相关 ADR；严禁引入未在此记录的第三方库或偏离既定架构。

### 品牌命名

| | 名称 | 释义 |
|---|------|------|
| **中文名** | **集思** | 出自"集思广益"，温暖正向，意为汇聚众智。气质亲和、贴近消费级产品。 |
| **英文名** | **Delphi** | 德尔斐为阿波罗神谕之地。现代的 **"Delphi method"（德尔斐法）**——让多位专家多轮独立给意见、再逐轮收敛成共识的预测方法——几乎就是本产品机制的学术原型，可作定位话术或 slogan 之源。 |

---

## 1. 项目简介

一个 Chrome 浏览器插件，把「**多 AI 议会评议**」的工作流，建立在「**直接驱动各 AI 的原生网页**」之上。

灵感来源：
- **AIChatIndex**：提供"在浏览器内统一驱动多个 AI 原生网页、批量发送"的机制范式（无需 API key，复用用户登录态、原生联网搜索、原生 system prompt）。
- **AI Council (Techniciti)**：提供"三阶段评议"的产品逻辑——并行作答 → 匿名交叉评审 → 主席综合 + 置信度评分。但其本体走 API key / 本地模型，**与本项目路线不同**。

本项目的本质 = 把 AI Council 的编排逻辑，嫁接到"驱动原生网页"的机制上。目前市面无现成产品做此组合。

### 核心用户价值
用户输入一个问题 → 插件自动让多家 AI 在各自原生网页里作答 → 互相匿名评审打分 → 由一个主席 AI 综合输出最终答案，并展示共识点、争议区、置信度。全程零 API key、零额外费用、保留各家最完整的原生联网与系统提示。

---

## 2. 硬约束（不可妥协，已与产品方确认）

| # | 约束 | 影响 |
|---|------|------|
| C1 | **全程驱动原生网页，绝不调用任何 API** | 所有 I/O 靠 DOM 自动化；编排无 API 兜底。见 ADR-0001 |
| C2 | **目标为上架 Chrome 商店的正式产品** | 受商店政策 + 各家 ToS 双重约束。见 ADR-0001 风险段 |
| C3 | **中外平台混合接入**（ChatGPT/Gemini/Claude + 豆包/Kimi/千问/DeepSeek 等） | 适配器面积最大；海外站点 ToS 执法更激进 |

> ⚠️ **必须让产品方知晓的存在性风险**：C1 + C2 + 海外站点的组合，最大不确定性不在能否实现，而在**上线后可能被某 provider 投诉下架**。此风险无法用工程手段消除，已在 ADR-0001 记录并定价。

---

## 3. 技术栈选型（带理由）

> 具体版本号由 Code 在 `init` 时锁定到 lockfile；本表只定方向与理由。新增任何库前须更新本表或新建 ADR。

| 层 | 选型 | 理由 |
|----|------|------|
| 扩展框架 | **Manifest V3** + **WXT**（首选）或 Vite + @crxjs/vite-plugin | MV3 为商店强制要求；WXT 对 MV3 多入口（background / content scripts / 扩展页）开箱即用，TS 友好 |
| 语言 | **TypeScript** | 适配器协议、状态机有大量类型契约，强类型必需 |
| 编排状态机 | **XState**（推荐） | 议会是天然的有限状态机；XState 支持状态持久化/恢复，契合 ADR-0004 的"可恢复"要求 |
| 议会页 UI | **React**（轻量用法） | 需渲染流式状态、共识卡片、置信度等动态 UI；保持组件极简，避免过度设计 |
| 持久化 | `chrome.storage.local` | 持久化议会状态供崩溃恢复；无云端上传，符合隐私定位 |
| 远程适配器配置 | 托管 JSON（GitHub raw / 自有 CDN，待 Q5 确认） | 站点改版时热更新选择器，不发新版本。见 ADR-0005 |

---

## 4. 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│  Council Page（常驻扩展页，用户打开的 tab）                    │
│  ├─ Orchestrator（XState 状态机，议会编排核心）                │
│  ├─ Watchdog（看门狗：监控每个 AI 标签页存活/进度）            │
│  ├─ UI（输入、各家流式状态、共识卡片、置信度）                  │
│  └─ ConfigLoader（拉取 + 缓存远程适配器配置）                  │
└───────────────┬─────────────────────────────────────────────┘
                │ chrome.tabs + 长连接 port 消息
    ┌───────────┼───────────┬───────────────┐
    ▼           ▼           ▼               ▼
┌────────┐ ┌────────┐ ┌────────┐      ┌──────────────┐
│ChatGPT │ │Gemini  │ │ 豆包   │ ···  │ 主席 tab     │
│ tab    │ │ tab    │ │ tab    │      │ (其中一家)   │
│+CS适配器│ │+CS适配器│ │+CS适配器│      │              │
└────────┘ └────────┘ └────────┘      └──────────────┘
   （全部置于扩展管理的独立窗口；autoDiscardable=false）

Background Service Worker：仅做轻量协调（打开窗口、注册 port、
转发不要求常驻的事件）。重编排逻辑一律不放这里。见 ADR-0003
```

### 组件职责
- **Council Page**：编排与 UI 的宿主。只要它开着，编排就活——绕开 MV3 service worker 30s 被杀的问题（ADR-0003）。
- **Content Script 适配器**：每个 AI 站点一份，由远程配置数据驱动。负责：注入 prompt、点发送、检测完成、抽取干净文本（ADR-0005、ADR-0006）。
- **Orchestrator**：跑三阶段议会状态机，每条腿幂等可重发（ADR-0004、ADR-0006）。
- **Watchdog**：持续比对"应有状态 vs 实际标签页状态"，标签页被丢弃/关闭/卡住时触发恢复（ADR-0004）。

---

## 5. 三阶段议会流程（映射到 DOM 操作）

详见 **ADR-0006**。摘要：

1. **阶段一 · 并行作答**：向 N 个 AI 标签页注入原始问题 → 等全部完成 → 抽取各家干净回答。各家互不可见。
2. **阶段二 · 匿名交叉评审**：编排器在本端把各家回答重标为 `Response A/B/C`（匿名化在插件侧完成）→ 注入评审 prompt 到评审员标签页 → 抽取排序/打分。
3. **阶段三 · 主席综合**：选定主席标签页 → 注入全部回答 + 评审结果，要求其**以固定分隔格式**输出综合答案、共识点、争议区、置信度 → 抽取并解析 → 渲染。

**降级原则（C1 无 API 兜底，尤其重要）**：任一站点失败/限流/超时，议会用剩余成员继续，绝不整盘崩溃；置信度据实际参与成员数下调并提示用户。

---

## 6. 目录结构（建议）

```
ai-council-extension/
├─ README.md                  # 本文件（真理源）
├─ docs/
│  └─ adr/                    # 架构决策记录
│     ├─ 0001-native-web-no-api.md
│     ├─ 0002-tabs-over-iframes.md
│     ├─ 0003-orchestrator-in-council-page.md
│     ├─ 0004-tab-lifecycle-resilience.md
│     ├─ 0005-remote-adapter-config.md
│     └─ 0006-three-stage-council-dom-flow.md
├─ src/
│  ├─ background/             # service worker（极简）
│  ├─ council-page/           # 常驻扩展页：编排 + UI
│  │  ├─ orchestrator/        # XState 状态机
│  │  ├─ watchdog/
│  │  ├─ config-loader/
│  │  └─ ui/
│  ├─ content/                # content script 运行时（数据驱动）
│  ├─ adapters/               # 适配器配置 schema 与本地兜底配置
│  └─ shared/                 # 类型、消息协议、常量
└─ ...
```

---

## 7. 分阶段开发计划（Milestones）

### Phase 0 · 文档与契约 ✅
- [x] 完成 README + 全部基础 ADR
- [x] 确定驱动方式：全自动注入发送（ADR-0007）
- [x] 锁定首发站点：**DeepSeek**（中文站点，ToS 执法更松，便于打通）
- [ ] 定稿适配器配置 schema（ADR-0005 内已有草案，待评审）

### Phase 1 · 单站点打通（最小可行）· 进行中
- [x] 扩展骨架（WXT + TS + MV3 manifest，`pnpm build` 通过）
- [x] 实现 DeepSeek 站点适配器（数据驱动：注入 → 发送 → 检测完成 → 抽取）
- [x] Council Page MVP 能驱动单标签页并展示结果（代码闭环 + 类型/构建校验通过）
- [x] **实机联调跑通**：DeepSeek 可成功注入问题并返回回复
- [x] 未登录处理：识别登录墙 → 前台提示「需要登录」+ 重试（复用标签页保留登录态）
- [x] AI 站点后台打开，不抢占前台；仅需登录时自动切前台引导

### Phase 2 · 多站点广播（阶段一）✅
- [x] 适配器配置数据驱动化 + 远程拉取 + 本地兜底（ConfigLoader 三级回退，ADR-0008）
- [x] 每站一窗、并排平铺，解决后台标签页不渲染（`council-tabs.ts`，ADR-0010；修订 ADR-0004 承载方式）+ `autoDiscardable=false`
- [x] 并行向 N 家广播、等待全部完成、汇总展示（`orchestrator.ts`，allSettled 单点降级）
- [x] 首批名单接入 8 家：DeepSeek / Kimi / 通义千问 / 豆包 / 腾讯元宝 / ChatGPT / Claude / Gemini
- [x] **8 家选择器实机校准全部跑通**（注入 + 发送 + 抓取），含人机验证检测、富文本编辑器多重注入兜底、完整鼠标事件点击

### Phase 3 · 用户可视化校准 + 本地覆盖层（优先，ADR-0009）· 进行中
> 动机：手写选择器随站点改版频繁失效、不可持续。把「适配能力」交给用户——任何人都能在页面上点选元素自救，不依赖开发者手调。
- [x] 页面内「拾取模式」：高亮悬停 + 点选捕获，校准 输入框 / 发送按钮 / 回答区 / 停止按钮 / 深度思考开关（`picker.ts`）
- [x] 由点选元素生成稳健选择器（id → data-*/稳定属性 → 结构化短路径；回答区走语义类泛化；排除动态哈希类名）
- [x] 本地用户覆盖配置存 `chrome.storage.local`（`shared/overrides.ts`），ConfigLoader 合并优先级：**用户覆盖 > 远程 > 内置**；content script 在 ASK 时即时合并，校准后无需刷新
- [x] Council Page 提供「校准此站点」入口（前台校准窗口 `calibration.ts`）+ 覆盖项的查看/重置/清除
- [x] 适配器 schema 扩展：可选 `thinkingToggle` 可点选项 + 发送前按需点击（深度思考开关，运行时已接线）
- [ ] **实机联调**：逐站点验证拾取 → 选择器生成 → 覆盖生效 → 广播跑通（尤其富文本编辑器与回答区泛化）

### Phase 4 · 韧性层（轻量持久化编排，ADR-0011）· 进行中
- [x] 会话状态持久化到 `chrome.storage.local`（`shared/session-state.ts`，单活动会话）
- [x] Watchdog：`tabs.onRemoved` / `onUpdated(discarded)` / `windows.onRemoved` 监控（`watchdog.ts`）
- [x] 每条腿幂等重发：标签页**确实丢失**时自动重开重发（上限 2 次）；内容级失败（未登录/验证码等）不自动重发，保留手动「重试」（额度友好，ADR-0004）
- [x] 整盘崩溃恢复：Council Page 载入检测未完成会话 → 提示「恢复/丢弃」→ 已完成腿用存档、未完成腿重开重发
- [ ] **实机联调**：验证关标签页/丢弃→自动重开重发、刷新 Council Page→续跑
- [~] XState 编排状态机：按 [ADR-0011](docs/adr/0011-resilience-lightweight-persisted-orchestration.md) **推迟到 Phase 5**（阶段增多时再引入）

### Phase 5 · 完整议会（阶段二 + 三）✅
- [x] 引入 XState 重构编排为声明式状态机（阶段增多，ADR-0011 约定的迁移时机；届时另立 ADR）
- [x] 匿名化 + 评审 prompt 注入与抽取
- [x] 主席综合 + 固定格式输出解析
- [x] 共识卡片 / 争议区 / 置信度 UI
- [x] 单点降级策略
- [x] **中止议事**：任意阶段可中途停止（状态机 `ABORT` → 停掉在途 actor + 关闭 AI 窗口 + 回到空闲）
- [x] **重跑正确性修复**：新一轮 `START` 重置 `council`（窗口重新按网格平铺，不再层叠）+ 清空旧 `summary`/`reviews`（旧主席结论不再残留）
- [x] **DeepSeek 完成检测校准**：收/停共用按钮按 SVG 图标形状判定（`completion.stopButtonIconPrefix`）——输出完即时收尾、不被深度思考停顿截断（取代原 8s 静默兜底）

### Phase 6 · 众包共创（选择器社区共享，ADR-0013）✅
> 把 Phase 3 的本地校准升级为社区资产：一人校准、众人受益。机制零后端、零授权（严守 C1）。
- [x] 用户把本地覆盖**一键提交**：扩展序列化为贡献 payload → 打开**预填好的 GitHub Issue** → 用户亲自点提交（`shared/contribution.ts` + 校准列表「贡献」按钮）
- [x] 信任机制：**维护者人工审核**做信任闸（贡献先落地为带 `selector-contribution` 标签的 Issue，不自动分发）；客户端先 `sanitize` 降噪（仅放行字符串选择器/策略，非安全边界）
- [x] **贡献前自动比对**：构造 payload 前自动比对本地校准与内置配置，剔除完全一致的项；若全部一致则阻断请求并在前台提示，避免无意义的重复提交
- [x] 合并进远程配置（ADR-0008 远程源即分发通道），所有用户回源自动获益；优先级仍为 用户本地覆盖 > 远程 > 内置
- [x] **配置仓模板** `config-repo/`：`adapter-config.json`（由 `pnpm gen:config` 从内置兜底生成，单一真源）+ Issue 模板 + `CONTRIBUTING.md` 审核清单 + 建仓/接线 README
- [ ] **接线启用**（产品方操作）：建公开配置仓 → 填 `REMOTE_CONFIG_URL`（config-loader）与 `COMMUNITY_REPO`（contribution）→ 补 `host_permissions`（见 `config-repo/README.md`）。两常量留空时贡献入口隐藏、远程跳过（优雅降级）

### Phase 7 · 深度思考默认开启（议事质量基线，ADR-0016）· 进行中
> 动机：既然已动用「集思」，就应让每个模型拿出最深思熟虑的回答，再进入完善的评审/辩论，最终结论才有意义。深度思考是议事质量的基线，故**默认开启**。
- [x] 全员默认开启深度思考：Council Page「深度思考」开关初值为开；发送前按 `thinkingActivation` 步骤置为「开」
- [x] 依赖前置·稳定性修复：新增 `thinkingState`（定位选择器 + 判别式），由校准时「关→开」两态 diff 自动推导，覆盖 属性/class/文本/背景色 四类区别（解决"同一按钮只变色/变字、单选择器分不清两态"）；运行时 `ensureThinkingOn` **先判定已开则跳过点击**（杜绝误关），未开才逐步点击、命中即提前结束（`runtime.ts`）
- [x] 主席模型深度思考**强制开启**：per-leg 控制 `enableThinking || adapterId===chairpersonId`，主席阶段一/三恒开，总开关仅影响其他成员（`orchestrator.ts`）
- [x] 校准接入：工具条新增「思考状态(两态)」录制（`pickElementSnapshot` 两态快照 + `computeThinkingDiscriminator` 自动 diff）；`thinkingState` 接入覆盖层/贡献/合并通路
- [ ] **实机联调**：逐站录「深度思考(多步)」+「思考状态(两态)」→ 验证已开跳过、未开开启、不再误关
- [ ] （低优先级）用户级「关闭深度思考」开关仅作用于非主席成员；主席仍强制开。初版默认全开，此项可后置

### Phase 8 · 多轮辩论 Debate（≤3 轮，ADR-0014）✅
> 动机：当前评审后主席仅凭「一轮输出」综合，对部分要点可能仍不确定。引入主席对匿名成员的**定向追问**与多轮往返，能显著提升结论完成度。**用户开关默认关**（额度友好，高价值问题再开）。
- [x] 交叉评审完成后、主席综合前，插入 `debate` 顶层态（最多 3 轮，可提前收敛/跳过；关则 stage2 直接进 stage3，老流程零回归）
- [x] 主席依据各匿名回复，对**指定匿名编号**（Response A/B/C…）提出追问（固定 `===DEBATE===` 格式 + `NONE` 收敛）；中枢持有**稳定匿名映射** `anonMap`（stage1 一次性确定），负责把问题路由到对应真实模型的标签页；剔除指向主席自身的目标
- [x] 被问模型在自己标签页内作答 → 抽取 → 回填给主席；逐轮累积上下文（`buildDebateQuestionPrompt`/`buildMemberFollowupPrompt`，`machine.ts`）
- [x] 轮数上限（`MAX_DEBATE_ROUNDS=3`）与收敛条件（主席 `NONE`/无合法目标/达上限）
- [x] 状态机扩展：XState 新增 `debate` 子状态，沿用 `driveLegResilient` 幂等重发/单点降级；辩论按**轮粒度**持久化与恢复（`status:'debate'` + `RESUME` 守卫；轮内仅重发 pending 目标）
- [x] **存档初始答案 `initialAnswers` + 修正既有隐患**：stage2 会把 `legs[].text` 覆盖为评审文本，原 `buildChairpersonPrompt` 的「初始回答」实际取到评审文本——改为统一从 `initialAnswers` 取（ADR-0014）
- [x] UI 最小过程展示：辩论轮次时间线（主席→Response X 追问 / X 回复）+「多轮辩论」开关（默认关）。概览方块/弹窗详情留 Phase 9
- [x] **实机联调**：开关开 → 主席按格式发问、路由到正确真实模型、≤3 轮收敛、多轮同标签页不串味均验证通过（2026-06-04 用户实测）

### Phase 9 · UI 精调与体验（ADR-0015）· 代码完成（待实机联调）
> 动机：当前所有 AI 回复全量平铺，信息过载且对普通用户无意义。改为「概览方块 + 按需详情」，并补齐历史与追问体验。按设计稿（Claude Design `集思 Delphi.html`）落地：微拟物、中性灰背景、强调色 `#B5532F`、支持 系统/浅色/深色。
- [x] **UI 框架选型**：**否决组件库（Hero UI）**，沿用「React 轻量 + 内联样式 + CSS 设计令牌」。令牌集中于 `entrypoints/council/index.html`，CSS 变量驱动深浅主题；主题持久化（`theme.ts`，`system` 跟随系统）。设计稿的 Tweaks 调试项（强调色/背景色调/节奏/演示开关）不保留，仅留主题三态切换（用户拍板）
- [x] **成员状态方块**：每个模型一张概览方块 + 阶段步进器（初次作答 / 交叉评审 / 辩论第 N 轮 / 主席综合），标注当前状态与摘要，默认**不全量平铺**原文。核心：`leg-model.ts` 把「全局分阶段机器状态 + 持久化 session + 在途 liveView」**派生**为 per-leg 流水线（不改状态机）
- [x] **弹窗看详情**：点击阶段/方块弹窗（`DetailModal`）按阶段页签查看该成员完整原文；失败态给出原因
- [x] **一键追问**：每个成员/主席方块「追问」按钮 `chrome.tabs.create(newChatUrl)` 跳原生页，插件内**不**做站内追问
- [x] **历史议事列表**：左侧侧栏（`Sidebar`）按日期分组回看历史；`session-state.ts` 扩展「会话归档列表」（`delphi:archive`，完成/中止时追加、上限 60 FIFO、按日期分组），与崩溃恢复的单活动会话解耦。落地开放问题 Q7 + Backlog 同名项
- [ ] **实机联调**：逐站验证 概览卡片状态流转 / 弹窗原文 / 追问开原生页 / 历史归档与回看（含深浅主题）

### Phase 10 · 上架准备
- [ ] 风险缓解形态定稿（半自动确认？见 ADR-0007 反向决策预案）
- [ ] 权限最小化、隐私说明、商店素材
- [ ] 多站点适配器扩充至首批名单全量
- [ ] **🤖 全自动·全站回归测试（由 Claude 全权接管，待其余功能 Phase 全部开发完成后再做）**：
  约定——等 Phase 8（多轮辩论）/ Phase 9（UI 精调）等剩余功能都开发完毕后，由 Claude 用浏览器插件
  （Claude-in-Chrome）**全权接管**端到端测试：自己跑、自己取结果、自己迭代修复，多跑几遍。覆盖**所有站点**
  （DeepSeek / Kimi / 通义千问 / 豆包 / 腾讯元宝 / ChatGPT / Claude / Gemini）× **过程中遇到过的所有问题**，逐项复测：
  1. **登录墙 / 人机验证**：未登录、验证码命中时是否准确报 `not_logged_in` / `captcha` 并保留手动「重试」；
  2. **回答提前截断**：停止键提前消失/转回发送键（如千问实测仅 18 字就转发送）、思考→作答空档（ChatGPT），
     是否都能靠「停止键 + 文本增长 + 子树 DOM 变更」三路信号等到真正写完再抽取；
  3. **注入未完成即发送 / 部分发送**：ProseMirror（ChatGPT/Claude）逐行注入被当 Enter 误发首行、长文本注入未达
     完整就提交导致残留——是否整段注入完整后才发、输入框不残留；
  4. **多轮复用同标签页的串味**：stage2 交叉评审 / stage3 主席（尤其 DeepSeek 当主席）是否用「基线」正确区分
     上一轮残留答案与本轮新生成，不把上一轮结论误当本轮结果抽走；
  5. **深度思考开关**：已开跳过 / 未开开启 / 不误关（接 ADR-0016）。
  > 形式：每个站点对每类问题各跑多遍，结果（截断长度、注入完整度、误判与否）由 Claude 自行采集比对，
  > 发现问题就改 `runtime.ts` / 适配器配置再复测，直到全部稳定。**此项排在所有功能开发之后**，避免边开发边返工。
- [ ] **⚠️ 重新启用云端配置分发（开发期临时关闭项，务必恢复）**：
  1. 把 `src/council-page/config-loader.ts` 的 `REMOTE_CONFIG_URL` 填回社区仓 raw 地址（注释里有备忘：`leo-fengchao/delphi-config`）；
  2. **先 push** 最新 `config-repo/adapter-config.json` 到该仓（否则旧云端会盖掉内置——见 ADR-0008 优先级 校准>云端>内置）；
  3. 确认 `wxt.config.ts` 的 `host_permissions` 仍含 `raw.githubusercontent.com` / `github.com`（开发期未移除，正常应仍在）。
  > 背景：开发自用期为避免「旧云端+6h 缓存」盖掉刚改的内置，已把 `REMOTE_CONFIG_URL` 置空、内置作唯一真源（commit `d73d3b3`）。上架面向真实用户时必须恢复云端，否则站点改版无法热更新、众包回流也到不了用户。

**后台渲染问题（关键，已定方案 ADR-0010）：** 后台/非激活标签页里浏览器会暂停 `requestAnimationFrame`、拒绝 `focus()`、不渲染虚拟列表 → 注入/点击/抽取全部失败（切到前台才正常）。`visibility.content.ts` 的可见性伪装只能骗过站点自身的 `document.hidden` 暂停，盖不住内核层限制。**采用方案：每站一窗、后台最大化**（`council-tabs.ts`），让每个站点的标签页都「激活且可见」从而真正渲染，并避免小屏幕平铺导致触发移动端 UI。代价是全屏遮盖；更省屏的渲染保活为优化项（见 roadmap）。

**Current Focus：** Phase 8 多轮辩论 Debate 已**完成并实机验证通过**（2026-06-04 用户实测：主席按格式发问 / 路由正确 / ≤3 轮收敛 / 多轮同标签页不串味），见 [ADR-0014](docs/adr/0014-multi-round-debate.md)。要点：①`debate` 顶层态插在 stage2 与 stage3 之间，**用户开关默认关**（关则 stage2 直接进 stage3，老流程零回归）；②stage1 完成即存档 `initialAnswers` 并一次性确定稳定匿名映射 `anonMap`（顺带修正「主席综合误把评审文本当初始回答」的既有隐患）；③主席用固定 `===DEBATE===` 格式对匿名编号发问、`NONE`/无合法目标即收敛，中枢经 `anonMap` 反查路由到真实模型标签页、剔除主席自身；④`MAX_DEBATE_ROUNDS=3`，沿用 `driveLegResilient` 幂等/降级，按**轮粒度**持久化与恢复（`status:'debate'`）；⑤UI 最小辩论时间线 + 开关。
>
> **Phase 9 · UI 精调代码已完成**（2026-06-05，按 Claude Design 设计稿落地，见 [ADR-0015](docs/adr/0015-ui-refinement-overview-cards.md)）：左侧历史侧栏 + 主题（系统/浅色/深色，强调色 `#B5532F`、中性灰背景）；中央 介绍 → 模型/主席选择 → 输入区（深度思考/多轮辩论开关）→ 主席结论（含置信度环）→ 成员概览卡片（阶段步进器）→ 辩论时间线（可揭示匿名身份）；成员卡点阶段弹窗看完整原文、一键「追问」开原生页。要点：①**不引入组件库**，CSS 设计令牌 + 内联样式；②`leg-model.ts` 把全局分阶段机器状态**派生**为 per-leg 流水线，**状态机零改动**；③`session-state.ts` 新增归档列表（`delphi:archive`）承载历史回看，与崩溃恢复的单活动会话解耦。`pnpm compile` / `pnpm build` 均通过。**下一步：逐站实机联调**（卡片状态流转、弹窗原文、追问跳转、归档回看、深浅主题）。
> Phase 7（深度思考默认开，ADR-0016）代码已完成，剩「逐站录两态并复测」的实机联调项未勾。
> 另：Phase 6 配置仓已接线 `leo-fengchao/delphi-config`，但**开发自用期已临时关闭云端拉取**（`REMOTE_CONFIG_URL` 置空，内置为唯一真源；commit `d73d3b3`）——**上架前务必恢复，已记入 Phase 10 清单**。海外 3 家加载方式见下「海外站点」。

**运行时健壮性修复（2026-06-04，Claude-in-Chrome 实机定位 + 验证，见 `src/adapters/runtime.ts`）：**
1. **完成检测不再被「停止键提前消失」骗到**：千问实测停止键在仅输出 18 字时就转回「发送」键，正文随后才从
   18→712 字流式写完。改判据为「停止键持续消失 **且** 回答活动静默满 6s」，回答活动取两路信号并集——
   文本长度增长 ‖ 回答元素子树 DOM 变更（`MutationObserver`）。覆盖千问早转发送键、DeepSeek/Kimi 作答中按钮
   重渲染闪烁、以及 ChatGPT 思考→作答空档。
2. **多轮复用同标签页加「基线」**：进入 `awaitCompletion` 时快照上一轮答案（元素 + 长度）；「本轮已开始」必须是
   出现停止键或出现**新的**答案活动，杜绝 stage2/stage3（尤其 DeepSeek 当主席）把上一轮残留答案瞬间误判完成、
   当本轮结果抽走。
3. **ChatGPT/Claude(ProseMirror) 注入顺序修正**：`insertParagraph` 在这类聊天框被当 Enter=发送，逐行注入会把
   「仅第一行」提前发出、其余残留输入框。改为非 paste 站点**先整段 `insertText`**（实测含换行可完整注入且不触发
   发送），逐行注入退为兜底（Gemini/Quill 仍走 paste 优先，不受影响）。

**注入/输出体量优化（2026-06-05）：**
4. **Kimi「附件 + 文字」重复发送修复**：Kimi 粘入超长文本（如整段交叉评审）会自动转成 `.txt` 附件，此时输入框
   为空。旧逻辑按「输入框文本达 90%」判 paste 失败 → 退到逐行/直写兜底，把同一份内容又灌进输入框，导致附件一份、
   文字再一份发两遍。新增适配器字段 `input.pasteMayBecomeFile`（仅 Kimi 置 `true`），注入成功判据改为「文本达标
   **或** 发送键点亮」（内容进附件后发送键会亮），命中即停、不再走兜底；转附件需几秒，超时放宽至 8s。其余站点
   不带此标志，行为不变（`runtime.ts` / `adapter-schema.ts` / `local-config.ts`）。
5. **各家初始回答「简明作答」**：交叉验证需把各家阶段一回答全量拼进同一条消息再下发，体量直接决定可行性。阶段一
   注入时在原题后追加「简明扼要、先结论后要点」指令（`buildStageOnePrompt`，仅注入用，`session.prompt` 仍存干净
   原题供 stage2/3 引用）；交叉评审 prompt 也补「每条只列要点、避免长篇」（`machine.ts`）。
6. **发送后弹验证码不再抽走「上一轮残留答案」（豆包实测，2026-06-05）**：豆包会在发送后才弹人机验证，生成不启动。
   旧逻辑在「生成始终未开始」时落到静默兜底，把 DOM 里上一轮的旧回答当本轮结果抽走。修复：对配置了 `stopButton`
   的站点，若 25s 内生成始终未开始（停止键没出现、也无新答案活动），**不再走兜底抽取**，而是重检验证码/登录并据实
   报 `captcha`/`not_logged_in`/`timeout`，让 UI 显示失败 + 「重试」（`runtime.ts awaitCompletion`）。
   > 注：豆包**验证码本身的选择器**（`auth.captchaSelector`）仍可能与实际 DOM 不符，需实机校准；但即便没识别为
   > captcha，本次修复也已杜绝「呈现陈旧答案」——最差只会报超时失败，不会再给出错的回答。
7. **Gemini 改版「深度思考」重校准（2026-06-05 实测，中/英双语）**：Gemini 把模型与思考等级在菜单里**拆成两条
   独立项**，且选模型会**关闭菜单**。`thinkingActivation` 改为开两次菜单（开→选 Pro 模型→重开→展开「思考等级」
   →选「扩展/Extended」），菜单项改用**文本 XPath**（弃 `ng-star`/`nth` 脆性，亦抗版本号 3.1→3.2 变动）；判别式新增
   `attrContains`（一条同时匹配英文 `Extended`/中文 `扩展`，单条覆盖双语）（`local-config.ts` / `adapter-schema.ts` /
   `picker.ts` / `runtime.ts`）。

### 海外站点（ChatGPT / Claude / Gemini）的实测方式

`pnpm dev` 会用 web-ext 启动一个**带自动化标记**的 Chrome，Cloudflare 会拦、Google 会以「此浏览器或应用可能不安全」拒绝登录——这是反自动化机制，无法靠改选择器绕过。两种应对：

1. **推荐：用你日常的 Chrome 加载扩展**。`pnpm build` 后，打开 `chrome://extensions` → 开启「开发者模式」→「加载已解压的扩展程序」→ 选 `.output/chrome-mv3`。你的 Chrome 没有自动化标记、且已登录各站，Cloudflare/Google 都能正常通过。代价：改代码后需手动重新构建并在扩展页点「刷新」。
2. `pnpm dev` 已加 `--disable-blink-features=AutomationControlled` 缓解 Cloudflare，但对 Google 登录基本无效。国内站点用 `pnpm dev` 迭代、海外站点用方式 1 验收，是当前最顺的组合。

### Backlog（非阻塞，择期实现）
- [ ] **历史议事列表**（→ 已纳入 Phase 9）：当前持久化层（`session-state.ts`）只存单个活动会话，议会结束/重跑即被覆盖。需扩展为「会话归档列表」（完成时追加、设数量上限淘汰）+ 列表/详情 UI，用于回看历史的各家回答与主席结论。属独立新特性、重 UI，与 Phase 9 UI 精调一并做。
- [x] **后台 AI 窗口默认最大化（鲁棒性）**：已于 2026-06-04 落地。采用 `state: 'maximized'` 替代了此前的网格平铺，彻底解决了小屏幕触发移动端 UI 的问题，提升了桌面端交互鲁棒性（见修订后的 ADR-0010）。
- [ ] **逐 token 中断**（中止功能的增强）：当前 `ABORT` 停在阶段边界——在途的 `chrome.tabs.sendMessage` 仍会跑完才丢弃。若要真正即时打断，需把 `AbortSignal` 串入 `orchestrator`/`driveLeg`，并在各站点击其「停止生成」按钮。
- [ ] **更优雅的后台窗口承载**（优化 ADR-0010）：当前「每站一窗（独立窗口）」可靠但占屏，且在主力 Chrome 里开 5–8 个独立窗口会污染 `Command+\`` 应用内窗口切换，体验割裂。已否决的折中：打开后自动最小化（macOS 上多窗口同时最小化动画侵入性过强，不可接受）。探索更优方案：最小化但保持渲染 / 离屏渲染 / 「后台生成 + 仅在抽取瞬间短暂激活」的混合策略，在可靠性、占屏与窗口管理侵入性之间取得更好平衡。低优先级，择期再议。
- [ ] **深度思考开关优化（低优先级）**：(1) 部分站点会记住上次的深度思考开启状态，下次无需重复点击——可检测当前状态、已开启则跳过点击，避免误关；(2) 当前「发送前点击 thinkingToggle / 多步录制」逻辑仍不稳定，需结合各站实际交互重做。

---

## 8. Architecture & Decisions（ADR 索引）

- [ADR-0001](docs/adr/0001-native-web-no-api.md) · 全程驱动原生网页、零 API 的核心路线与其风险
- [ADR-0002](docs/adr/0002-tabs-over-iframes.md) · 采用受控真实标签页而非 iframe 嵌入
- [ADR-0003](docs/adr/0003-orchestrator-in-council-page.md) · 编排器运行于常驻扩展页，规避 MV3 service worker 生命周期
- [ADR-0004](docs/adr/0004-tab-lifecycle-resilience.md) · 标签页生命周期韧性：autoDiscardable + 独立窗口 + 可恢复状态机 + 看门狗
- [ADR-0005](docs/adr/0005-remote-adapter-config.md) · 站点适配器采用远程热更新配置
- [ADR-0006](docs/adr/0006-three-stage-council-dom-flow.md) · 三阶段议会编排的 DOM 实现与单点降级
- [ADR-0007](docs/adr/0007-fully-automated-injection.md) · 评审/总结阶段采用全自动注入发送（定稿 Q1）
- [ADR-0008](docs/adr/0008-config-loader-github-raw.md) · ConfigLoader 远程源采用 GitHub raw + 三级回退（定稿 Q5）
- [ADR-0009](docs/adr/0009-user-visual-selector-override.md) · 用户可视化校准 + 本地选择器覆盖层（Phase 3，优先于韧性层）
- [ADR-0010](docs/adr/0010-per-window-tiling-for-background-rendering.md) · 每站一窗、后台最大化，解决后台标签页不渲染 + 小屏触发移动端 UI（修订 ADR-0004 承载方式）
- [ADR-0011](docs/adr/0011-resilience-lightweight-persisted-orchestration.md) · 韧性层先用轻量持久化编排，XState 推迟到 Phase 5
- [ADR-0012](docs/adr/0012-xstate-orchestration.md) · 引入 XState 把议会编排重构为声明式状态机（Phase 5 迁移落地）
- [ADR-0013](docs/adr/0013-crowdsourced-selector-sharing.md) · 众包共创：GitHub Issue 提交 + 维护者人工审核 + 远程回流分发（Phase 6）
- [ADR-0014](docs/adr/0014-multi-round-debate.md) · 多轮辩论 Debate：主席对匿名成员定向追问、稳定匿名映射 + 中枢路由、≤3 轮收敛、用户开关默认关（Phase 8）
- [ADR-0015](docs/adr/0015-ui-refinement-overview-cards.md) · UI 精调：概览方块 + 状态标识 + 弹窗详情 + 一键追问 + 历史侧栏；不引入组件库、UI 侧派生 per-leg 流水线、归档列表（Phase 9）
- [ADR-0016](docs/adr/0016-default-deep-thinking.md) · 深度思考默认开启 + `thinkingActive` 状态检测避免误关 + 主席全程强制（Phase 7）

---

## 9. 待产品方确认的开放问题（阻塞决策）

| # | 问题 | 为何阻塞 |
|---|------|---------|
| ~~Q1~~ | ✅ **已定稿（2026-06-02）：全自动注入发送。** 见 [ADR-0007](docs/adr/0007-fully-automated-injection.md)。 | — |
| ~~Q2~~ | ✅ **已定稿（2026-06-02）：首发 DeepSeek**；首批名单已扩至 8 家（DeepSeek/Kimi/通义千问/豆包/元宝/ChatGPT/Claude/Gemini）。 | — |
| ~~Q3~~ | ✅ **已定稿（2026-06-03）：主席模型用户可选。**（UI 需提供主席选择功能，状态机需记录主席节点） | — |
| ~~Q4~~ | ✅ **已定稿（2026-06-03）：全员互评。**（所有人评价所有人，最大化碰撞，牺牲部分速度） | — |
| ~~Q5~~ | ✅ **已定稿（2026-06-02）：GitHub raw + 三级回退**，可配置。见 [ADR-0008](docs/adr/0008-config-loader-github-raw.md)。 | — |
| ~~Q6~~ | ✅ **已定稿（2026-06-03）：纯靠主席模型自评输出置信度和共识区。**（无插件侧相似度算法，降低工程复杂度，依赖解析主席输出格式） | — |
| Q7 | 是否需要历史记录 / 导出 / 跨设备同步（v1 暂建议不做）？ | 影响存储设计与范围 |
