# ADR-0016: 深度思考默认开启 + 状态检测避免误关 + 主席强制（Phase 7）

- **日期:** 2026-06-04
- **状态:** Accepted（Phase 7 · 议事质量基线主线）

> 编号说明：ADR-0014（多轮辩论 Debate）、ADR-0015（UI 精调）已在 README 索引中预留给 Phase 8/9，故本 Phase 7 决策取下一个未占用编号 ADR-0016（ADR 编号按创建顺序分配，与 Phase 顺序不强绑定）。

## 上下文 (Context)
ADR-0009 把「深度思考开启」建模为可校准的有序点击步骤 `thinkingActivation: string[]`，运行时在发送前按序点击。但这套机制有两个问题，使「默认开启深度思考」不可靠（README Backlog「深度思考开关优化」已记录）：

1. **盲点击会误关**：`thinkingActivation` 是无状态的点击序列。若站点**记住了上次的开启状态**（再次进入仍是「开」），发送前再点一次反而把它**关掉**（误关）。
2. **无 per-leg 控制**：`enableThinking` 是会话级单一开关，无法表达「主席强制开、其他成员可选」。

而产品定位要求：既然动用「集思」多 AI 议会，就应让每个模型拿出最深思熟虑的回答，深度思考是**议事质量的基线**，应**默认开启**；尤其主席要综合全局，必须强制开。

## 决策 (Decision)

### 1. 深度思考默认开启
- Council Page 的「深度思考」开关初值为**开**。议事默认让全员开启深度思考。

### 2. 状态检测避免误关（核心可靠性修复）

**问题**：很多站点的思考开/关是**同一个按钮、同一条 DOM 路径**，区别只在「背景色变了 / class 变了 / `aria-pressed` 变了 / 按钮文字变了」。单凭一个「选择器能否命中」无法区分两态——按钮一直在，会永远判「已开」→ 永远跳过点击 → 思考实际从未打开。**单个 selector 拿不到「前后区别」**。

**方案**：把「思考已开」从"一个选择器"升级为 `thinkingState = { 定位选择器, 判别式 }`，判别式由校准时「关→开」两态快照**自动 diff** 得出，覆盖四类信号：

```ts
type ThinkingDiscriminator =
  | { kind: 'attr';  name: string; value: string }   // 属性变值，如 aria-pressed="true"
  | { kind: 'class'; value: string }                 // 开启时多出的 class，如 active
  | { kind: 'text';  contains: string }              // 文本含某子串，如「已开启」
  | { kind: 'style'; prop: string; value: string };  // 计算样式变化，如 background-color（专治「只有背景色变」）
interface ThinkingStateCheck { selector: string; on: ThinkingDiscriminator }
```

- **校准（两步）**：在 `selectors.thinkingActive` 单选择器的旧法之外，工具条新增「思考状态(两态)」按钮——①思考为【关】时点选开关按钮 → 记快照 A（class/属性/文本/关键计算样式）；②切到【开】再点选同一按钮 → 记快照 B；`computeThinkingDiscriminator(A,B)` 按 `状态属性 > 其它 aria-*/data-* > 新增 class > 文本 > 计算样式` 的优先级取出**真正变化的那一项**。定位选择器取自「关」态（两态都能命中）。
- **运行时** `ensureThinkingOn`（`runtime.ts`）：发送前定位元素并按判别式核验——已开 → **跳过点击**（杜绝误关）；未开 → 按 `thinkingActivation` 逐步点击，每步后若判定已开则**提前结束**。
- `thinkingState` 未配置时退化为「每次都点」（与改动前一致，尽力而为，不阻断主流程）。
- 数据通路：`thinkingState` 进入本地覆盖（`overrides.ts`，`writeThinkingState`）、`applyOverride` 合并、贡献 payload（`contribution.ts`），与既有选择器一样可校准 / 可远程热更新 / 可众包。判别式只是结构化的字符串，仍无可执行代码（延续 ADR-0005 安全约束）。

### 3. 主席全程强制开启（per-leg 控制）
- 单腿驱动按 `session.enableThinking || adapterId === session.chairpersonId` 计算该腿是否开启思考（`orchestrator.driveLegResilient`）。
- 即：**主席在阶段一（初答）与阶段三（综合）都强制开**；用户的「深度思考」总开关**仅影响非主席成员**。
- （低优先级，可后置）面向产品方自用，初版默认全员开；「关闭深度思考」开关只对非主席生效，主席恒开。

## 后果 (Consequences)
**好处：**
- 直接根治「再次点击导致误关」的不稳定，使「默认开启」真正可靠。
- per-leg 思考让主席强制开成为干净的编排级语义，不污染各站适配器配置。
- `thinkingActive` 是纯选择器数据：可远程热更新（ADR-0008）、可用户校准（ADR-0009）、可众包共创（ADR-0013），与既有体系一致。

**代价 / 妥协：**
- `thinkingState`（两态判别）与多步 `thinkingActivation` 都需**各站实机校准**才稳；未校准的站点退化为旧行为（每次都点，可能误关）。这是 Phase 7「实机联调」遗留项。
- 判别式取自计算样式时（背景色等）相对脆弱：站点换肤/主题变量变更可能使其失效，需重校准；属性/class/文本类判别更稳，故 diff 时已按此优先级排序。
- 默认开启会增加各家单次作答耗时（深度思考更慢）——属议事质量与速度的有意取舍，符合产品定位。
- 全自动点击思考开关仍属 DOM 自动化，延续 ADR-0001/0007 的 ToS 风险面，不额外放大（仅多一两次点击）。
