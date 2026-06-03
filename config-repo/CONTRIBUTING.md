# 维护者审核指南 —— 选择器贡献

社区用户经「集思 · Delphi」扩展提交的站点校准，会以带 `selector-contribution` 标签的 **Issue** 形式到达本仓。**人工审核是唯一的信任闸**（ADR-0013）：在你把选择器合并进 `adapter-config.json` 之前，它不会分发给任何用户。请逐项核验后再合并。

## 贡献长什么样

每个贡献 Issue 正文含一段 ` ```json ` 代码块，结构如下：

```json
{
  "kind": "delphi-selector-contribution",
  "contributionVersion": 1,
  "schemaVersion": 1,
  "adapterId": "deepseek",
  "displayName": "DeepSeek",
  "override": {
    "selectors": { "inputBox": "…", "sendButton": "…", "assistantMessage": "…" },
    "thinkingActivation": ["…"],
    "inputMethod": "paste",
    "submit": "clickButton"
  },
  "meta": { "extVersion": "0.0.1", "createdAt": 1717400000000 }
}
```

## 审核清单（逐条过）

- [ ] **无可执行代码**：`override` 内全是选择器/策略**字符串**。出现 `<script>`、`javascript:`、内联事件（`onerror=` 等）、HTML 标签、模板字符串注入迹象 → **拒绝**。
- [ ] **选择器稳健**：偏好语义化（`#id`、`[data-*]`、`[role=...]`、`[aria-label*=...]`、稳定 class、短结构路径）。**警惕动态哈希类名**（Tailwind 原子类堆叠、CSS Modules 哈希后缀如 `_x9f3a`、`css-1ab2cd`）——这类选择器下次改版即失效，价值低。
- [ ] **字段合法**：`adapterId` 是本仓已有站点；`schemaVersion` == 当前（1）；`inputMethod` ∈ {`paste`,`execCommandInsertText`,`setNativeValue`}；`submit` ∈ {`clickButton`,`enterKey`}；`selectors` 的 key ∈ {`inputBox`,`sendButton`,`stopButton`,`assistantMessage`}。
- [ ] **作用范围克制**：`assistantMessage` 应命中回答正文容器，而非过宽（避免抓到页脚/占位/引用角标）。`inputBox`/`sendButton` 应唯一且稳定。
- [ ] **实测优先**：如有条件，加载扩展、把该选择器临时填入对应站点验证「注入 → 发送 → 抽取」跑通后再合并。

## 合并流程

1. 复制 Issue 里的 JSON。
2. 打开 `adapter-config.json`，定位 `adapters[]` 中 `id === adapterId` 的站点。
3. 把 `override` 里的字段并入该站点（通常是更新 `selectors.*`、必要时 `input.method/submit`、`thinkingActivation`）。**给该站点 `version` +1**，便于灰度/回滚。
4. 不改 `schemaVersion`（除非确有 schema 变更，那需要同步扩展端 `adapter-schema.ts` 并另立 ADR）。
5. 提交 PR / 直接推 `main`。合并后用户下次回源（缓存 TTL 6h 内为缓存命中）即生效。
6. 在 Issue 致谢并关闭。

## 拒绝/退回

不符合上面任一条时，礼貌说明原因并 `close`（或打 `needs-changes` 标签请贡献者重新校准）。**宁缺毋滥**：一个坏选择器会让所有用户的该站点注入失效。

## 未来（非本期）

贡献量大后可加一道 **CI 自动结构校验**（JSON schema + 禁用模式正则扫描）做初筛，人工只复核通过项——仍不需要后端。届时另立 ADR。
