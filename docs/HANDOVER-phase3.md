# 交接总结 · Phase 3 测试续作（Handover Checklist）

> 给下一个接手的 AI。**先读 `README.md` 与 `docs/adr/`（尤其 ADR-0009、ADR-0010），它们是唯一真理源。** 严禁引入未记录的库或偏离既定架构。

## 0. 一句话现状
Phase 3（用户可视化校准 + 本地覆盖层，ADR-0009）**代码已全部完成、`pnpm compile` 与 `pnpm build` 均通过**，含「深度思考多步开启」。现在处于**实机联调测试阶段**，尚未全部验证通过。

## 1. 本轮更新了什么
- **ADR-0009** 已补记「深度思考用有序步骤数组 `thinkingActivation: string[]`、校准用 `clickThrough`」。
- 新增/改动代码（全部已 build 进 `.output/chrome-mv3`）：
  - `src/shared/adapter-schema.ts`：`PickRole` 收敛为 4 个单元素角色；`SiteAdapter.thinkingActivation?: string[]`。
  - `src/shared/overrides.ts`：本地覆盖层（`chrome.storage.local`，key=`delphi:overrides`）；`applyOverride` 合并；`writeThinkingActivation`。
  - `src/adapters/picker.ts`：页面拾取器 + `buildRobustSelector`（id→属性→结构化路径；回答区 `generalize` 走语义类）；新增 `clickThrough`（拾取后真点击，弹出下一级菜单）。
  - `src/adapters/runtime.ts`：发送前按序点击 `thinkingActivation` 各步（等待→点击→略等）。
  - `src/council-page/config-loader.ts`：三级回退之上叠加用户覆盖，`LoadResult.overrides`。
  - `src/council-page/calibration.ts`：`openCalibration` / `pickRole` / `pickThinkingStep` / `closeCalibration`。
  - `src/entrypoints/site.content.ts`：处理 `DELPHI_PICK`；ASK 时即时合并覆盖。
  - `src/entrypoints/council/App.tsx`：「适配校准」面板（4 角色 + 深度思考多步录制 + 查看/重置/清除）+ 深度思考勾选框。
  - `src/shared/messaging.ts`：`PickMessage{label,generalize?,clickThrough?}` / `PickResponse`；`AskMessage.enableThinking?`。

## 2. 两个必须盯住的结论（已与产品方确认）

### (A) 回答区选择器不能带 nth —— 否则追问拿不到最新回复
抽取逻辑 `runtime.ts › extract()` 取 `querySelectorAll(assistantMessage)` 的**最后一个**。
- 因此回答区选择器**必须是能匹配所有回答的泛化选择器（类名/属性）**，绝不能是 `:nth-of-type(n)` 或 `#唯一id`，否则后续「追问」只会永远拿第一条回答。
- 内置 `local-config.ts` 的 8 家回答区**已确认全是泛化选择器、无 nth**（见 README/上轮对话表格）。
- **风险**：用户用拾取器校准产生的覆盖（存 storage）**会覆盖内置值**。拾取器对回答区正常生成类名，但当无合适语义类时会回退到含 `nth` 的结构化路径。**测试时务必核对每个站点回答区的生成选择器文本，含 `nth`/`#id` 即判不合格、要求重选。**
- 自检命令（Council Page 控制台）：
  ```js
  chrome.storage.local.get('delphi:overrides').then(o => console.log(JSON.stringify(o['delphi:overrides'], null, 2)))
  ```

### (B) 校准配置不跨浏览器共享
`chrome.storage.local` 每个浏览器/扩展实例独立，**不跨浏览器、不跨 profile、不自动同步**。
- 用户在 `pnpm dev` 窗口校准大陆站点、在自有 Chrome 校准 ChatGPT/Gemini/Claude，**两套覆盖不会自动合并**。
- 临时搬运办法（控制台导出/导入 `delphi:overrides` JSON，schema 跨实例一致可直接拼接）：
  ```js
  // 导出
  chrome.storage.local.get('delphi:overrides').then(o => console.log(JSON.stringify(o['delphi:overrides'])))
  // 导入（粘贴 JSON 替换 <PASTE>）
  chrome.storage.local.set({ 'delphi:overrides': <PASTE> }).then(() => console.log('done, 刷新 Council Page'))
  ```

## 3. 测试方式（重要环境约束）
- **测真实 AI 站点（要登录）必须用 `.output/chrome-mv3` 手动加载到日常 Chrome**（`chrome://extensions` → 开发者模式 → 加载已解压；改代码后 `pnpm build` 再点扩展刷新）。**这种模式没有热重载 server。**
- `pnpm dev` 启动的是带自动化标记的独立 Chrome（未登录、Google 拒登、Cloudflare 拦），仅适合迭代大陆站点。
- 用户当前分工：dev 窗口测大陆站点；自有 Chrome 测 ChatGPT/Gemini/Claude（用户接下来手动完成 ChatGPT、Gemini 校准）。

## 4. 下一个 AI 的 First Action Items（按优先级）
1. **陪用户跑完 Phase 3 实机校验**：逐站点验证「校准→点选→选择器生成→覆盖生效→广播跑通」，**重点核对回答区无 nth（见 2A）**、富文本编辑器拾取、深度思考多步录制（豆包/Kimi 实测 `clickThrough` 是否真能弹出下一级菜单）。
2. **实现「导出/导入校准」按钮**（解决 2B 的跨浏览器痛点）：Council Page 加导出当前 `delphi:overrides` 为 JSON、粘贴导入。小改动、高价值。
3. **（可选）把验证通过的覆盖固化回 `local-config.ts` 内置默认**——内置随代码走、所有浏览器共享，是选择器的「黄金副本」。
4. 完成 Phase 3 验收后，更新 README 勾选 Phase 3 末项，进入 **Phase 4 韧性层**（XState + Watchdog，见 README）。

## 5. 设计备忘：未来「追问」功能（用户已提示）
- 追问需在**同一会话标签页**注入第 2、3… 个问题（当前 `orchestrator` 每次广播开新 chat、只问一次）。
- 抽取「取最后一条」的设计已兼容追问；但要补：① 发送追问后等待**新**回答完成（而非读到旧回答）；② 复用已开标签页而非新开。
- 这属于 Phase 4 之后；先不动，但校准回答区时按 2A 保证泛化，给追问留好地基。

## 6. 代码停在哪
全部已落盘并 build 通过，无半成品函数。当前没有未完成的编辑；下一步是**测试 + 按测试结果修选择器/逻辑**，不是继续写新模块（除非做第 4 节第 2 项导出导入）。
