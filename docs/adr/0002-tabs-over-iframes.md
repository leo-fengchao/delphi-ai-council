# ADR-0002: 采用受控真实标签页而非 iframe 嵌入

- **日期:** 2026-06-02
- **状态:** Accepted

## 上下文 (Context)
要在一个插件内同时驱动多家 AI 原生网页，有两种容器方案：
- **iframe 嵌入**：把各家页面嵌进一个聚合页。
- **真实标签页**：各家在独立标签页打开，content script 驱动。

iframe 方案的问题：ChatGPT、Gemini 等用 `X-Frame-Options` / CSP `frame-ancestors` 禁止被嵌套，必须用 `declarativeNetRequest` 改写响应头去除限制——这既是商店审核红旗，部分站点检测到被 frame 后还会直接坏掉，登录态也易出问题。

iframe 的唯一优势：生命周期简单（父页面在，iframe 就在，不会被单独丢弃）。

## 决策 (Decision)
采用**受控真实标签页**：
- 各 AI 站点在**扩展管理的一个独立窗口**内以真实标签页打开。
- 每个标签页注入对应 content script 适配器。
- Council Page 通过 `chrome.tabs` + 长连接 port 驱动各标签页。
- **不**改写任何站点响应头，不去除 CSP/X-Frame-Options。

## 后果 (Consequences)
**好处：**
- 登录态、原生联网搜索、原生 system prompt 全部天然生效（契合 ADR-0001 核心价值）。
- 避开改 header 的审核红旗与站点反 frame 检测。

**代价 / 妥协：**
- 标签页会被 Chrome 内存节省器丢弃、被用户误关或手动清理 → 生命周期必须专门处理，见 **ADR-0004**。
- 多窗口/多标签页的 UX 比单页 iframe 略重，需用独立窗口 + 清晰标注降低误触。
