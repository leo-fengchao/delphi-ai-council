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

### Phase 8 · 多轮辩论 Debate（≤3 轮，待立 ADR-0014）
> 动机：当前评审后主席仅凭「一轮输出」综合，对部分要点可能仍不确定。引入主席对匿名成员的**定向追问**与多轮往返，能显著提升结论完成度。
- [ ] 交叉评审完成后、主席综合前，插入「辩论」阶段（最多 3 轮，可提前收敛/跳过）
- [ ] 主席依据各匿名回复，对**指定匿名编号**（Response A/B/C…）提出追问；中枢持有匿名↔真实映射，负责把问题路由到对应真实模型的标签页
- [ ] 被问模型在自己标签页内作答 → 抽取 → 回填给主席；逐轮累积上下文
- [ ] 轮数上限与收敛条件（主席表示「无需追问」即提前结束）
- [ ] 状态机扩展：在 XState 编排（ADR-0012）中新增 `debate` 子状态，沿用幂等重发/单点降级；持久化辩论轮次以支持崩溃恢复
- [ ] UI 呈现辩论轮次（与 Phase 9 状态方块联动）

### Phase 9 · UI 精调与体验（待立 ADR-0015）
> 动机：当前所有 AI 回复全量平铺，信息过载且对普通用户无意义。改为「概览方块 + 按需详情」，并补齐历史与追问体验。
- [ ] **UI 框架选型**：评估是否引入组件库（候选 **Hero UI**，待讨论）；保持轻量、避免过度设计（呼应技术栈表「React 轻量用法」原则）
- [ ] **成员状态方块**：每个模型显示一个小方块（含部分回复摘要），方块上标注当前阶段状态：初次作答 / 交叉验证 / 辩论第 N 轮 / 总结陈词。默认**不全量平铺**原始回复
- [ ] **弹窗看详情**：点击方块/阶段，弹窗查看该成员该阶段的完整原始内容（非默认呈现）
- [ ] **一键追问**：每个成员方块提供「追问」按钮，跳转到对应 AI 的原生页面继续沟通（插件页面**不**实现站内追问，含追问主席——直接去主席原生页沟通即可）
- [ ] **历史议事列表**：左侧历史记录侧栏（对标主流 AI 产品），点开可加载回看历史各家回答与主席结论。落地 Backlog 同名项 + 开放问题 Q7；需把 `session-state.ts` 单会话扩展为「会话归档列表」

### Phase 10 · 上架准备
- [ ] 风险缓解形态定稿（半自动确认？见 ADR-0007 反向决策预案）
- [ ] 权限最小化、隐私说明、商店素材
- [ ] 多站点适配器扩充至首批名单全量
- [ ] **⚠️ 重新启用云端配置分发（开发期临时关闭项，务必恢复）**：
  1. 把 `src/council-page/config-loader.ts` 的 `REMOTE_CONFIG_URL` 填回社区仓 raw 地址（注释里有备忘：`leo-fengchao/delphi-config`）；
  2. **先 push** 最新 `config-repo/adapter-config.json` 到该仓（否则旧云端会盖掉内置——见 ADR-0008 优先级 校准>云端>内置）；
  3. 确认 `wxt.config.ts` 的 `host_permissions` 仍含 `raw.githubusercontent.com` / `github.com`（开发期未移除，正常应仍在）。
  > 背景：开发自用期为避免「旧云端+6h 缓存」盖掉刚改的内置，已把 `REMOTE_CONFIG_URL` 置空、内置作唯一真源（commit `d73d3b3`）。上架面向真实用户时必须恢复云端，否则站点改版无法热更新、众包回流也到不了用户。

**后台渲染问题（关键，已定方案 ADR-0010）：** 后台/非激活标签页里浏览器会暂停 `requestAnimationFrame`、拒绝 `focus()`、不渲染虚拟列表 → 注入/点击/抽取全部失败（切到前台才正常）。`visibility.content.ts` 的可见性伪装只能骗过站点自身的 `document.hidden` 暂停，盖不住内核层限制。**采用方案：每站一窗、并排平铺**（`council-tabs.ts`），让每个站点的标签页都「激活且可见」从而真正渲染。代价是占屏；更省屏的渲染保活为优化项（见 roadmap）。

**Current Focus：** Phase 7 深度思考默认开启已完成代码（构建/类型检查通过，待实机联调）。要点（ADR-0016）：①开关默认开；②新增 `thinkingState`（定位选择器 + 判别式），由校准时「关→开」两态 diff 自动推导，覆盖 属性/class/文本/背景色 四类区别——根治"同一按钮只变色/变字、单选择器分不清两态、再点反而误关"；运行时 `ensureThinkingOn` 先判定已开则跳过点击；③主席 per-leg **全程强制开**，总开关仅影响其他成员；④校准工具条新增「思考状态(两态)」录制。**下一步：逐站录「深度思考(多步)」+「思考状态(两态)」并复测**（已开跳过 / 未开开启 / 不误关）；随后 Phase 8 多轮辩论 Debate（待立 ADR-0014）。另：Phase 6 配置仓已接线 `leo-fengchao/delphi-config`，但**开发自用期已临时关闭云端拉取**（`REMOTE_CONFIG_URL` 置空，内置为唯一真源，避免旧云端+缓存盖掉刚改的内置；commit `d73d3b3`）——**上架前务必恢复，已记入 Phase 10 清单**。海外 3 家加载方式见下「海外站点」。

### 海外站点（ChatGPT / Claude / Gemini）的实测方式

`pnpm dev` 会用 web-ext 启动一个**带自动化标记**的 Chrome，Cloudflare 会拦、Google 会以「此浏览器或应用可能不安全」拒绝登录——这是反自动化机制，无法靠改选择器绕过。两种应对：

1. **推荐：用你日常的 Chrome 加载扩展**。`pnpm build` 后，打开 `chrome://extensions` → 开启「开发者模式」→「加载已解压的扩展程序」→ 选 `.output/chrome-mv3`。你的 Chrome 没有自动化标记、且已登录各站，Cloudflare/Google 都能正常通过。代价：改代码后需手动重新构建并在扩展页点「刷新」。
2. `pnpm dev` 已加 `--disable-blink-features=AutomationControlled` 缓解 Cloudflare，但对 Google 登录基本无效。国内站点用 `pnpm dev` 迭代、海外站点用方式 1 验收，是当前最顺的组合。

### Backlog（非阻塞，择期实现）
- [ ] **历史议事列表**（→ 已纳入 Phase 9）：当前持久化层（`session-state.ts`）只存单个活动会话，议会结束/重跑即被覆盖。需扩展为「会话归档列表」（完成时追加、设数量上限淘汰）+ 列表/详情 UI，用于回看历史的各家回答与主席结论。属独立新特性、重 UI，与 Phase 9 UI 精调一并做。
- [ ] **后台 AI 窗口默认最大化（鲁棒性）**：当前每站一窗、并排平铺（ADR-0010），但小屏（13"/14" 笔记本）上平铺窗口过小，会触发站点的移动端 UI，导致 DOM 结构变化、抓取/交互失败。改为后台打开即最大化，保证以桌面端正确形态渲染，提升自动化交互成功率。属 ADR-0010 承载方式的小幅强化，可较快落地。
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
- [ADR-0010](docs/adr/0010-per-window-tiling-for-background-rendering.md) · 每站一窗、并排平铺，解决后台标签页不渲染（修订 ADR-0004 承载方式）
- [ADR-0011](docs/adr/0011-resilience-lightweight-persisted-orchestration.md) · 韧性层先用轻量持久化编排，XState 推迟到 Phase 5
- [ADR-0012](docs/adr/0012-xstate-orchestration.md) · 引入 XState 把议会编排重构为声明式状态机（Phase 5 迁移落地）
- [ADR-0013](docs/adr/0013-crowdsourced-selector-sharing.md) · 众包共创：GitHub Issue 提交 + 维护者人工审核 + 远程回流分发（Phase 6）
- ADR-0014 ·（计划）多轮辩论 Debate：主席对匿名成员定向追问、中枢路由映射、≤3 轮收敛（Phase 8，待立）
- ADR-0015 ·（计划）UI 精调：概览方块 + 状态标识 + 弹窗详情 + 一键追问 + 历史侧栏（Phase 9，待立）
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
