---
name: 选择器贡献 (Selector contribution)
about: 提交某个 AI 站点的选择器校准，审核后合并进社区配置，所有用户受益
title: "[选择器贡献] <站点名> (<adapterId>)"
labels: selector-contribution
---

> 多数情况下，请直接在「集思 · Delphi」扩展的「适配校准」里点该站点的 **「贡献」** 按钮——它会自动预填好下面的内容。仅在手动提交时才需要自己填写。

## 站点

- 站点名 / displayName：
- adapterId（如 `deepseek` / `kimi` / `qwen` / `doubao` / `yuanbao` / `chatgpt` / `claude` / `gemini`）：
- 扩展版本：

## 校准内容（JSON）

把扩展导出的贡献 JSON 粘贴到下面代码块中（**仅选择器/策略字符串，勿含任何代码**）：

```json
{
  "kind": "delphi-selector-contribution",
  "contributionVersion": 1,
  "schemaVersion": 1,
  "adapterId": "",
  "displayName": "",
  "override": {
    "selectors": {}
  },
  "meta": { "extVersion": "", "createdAt": 0 }
}
```

## 补充说明（可选）

- 是否已在该站点实测「注入 → 发送 → 抽取」跑通：
- 站点是否近期改版 / 其它备注：

<!-- 维护者将按 CONTRIBUTING.md 核验后合并。 -->
