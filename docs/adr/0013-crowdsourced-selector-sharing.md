# ADR-0013: 众包共创 —— GitHub Issue 提交 + 人工审核 + 远程回流分发（Phase 6）

- **日期:** 2026-06-03
- **状态:** Accepted（Phase 6 主线）

## 上下文 (Context)
ADR-0009 把「适配能力」下放给用户：任何人都能在页面内点选元素、生成稳健选择器、存为**本地覆盖**自救。但这份能力止步于单台浏览器——一人辛苦校准的成果，其他用户享受不到；站点改版后每个用户都得各自重新校准，整体仍是 O(用户数 × 站点数 × 版本数) 的重复劳动。

ADR-0008 已确立**远程配置源（GitHub raw 公开 JSON）就是分发通道**：维护者改仓库里的 `adapter-config.json`，所有用户下次回源即自动获益。Phase 6 要做的，就是把「本地覆盖」接上「远程分发」，形成闭环：**一人校准 → 提交 → 审核 → 合并 → 众人受益**。

### 约束回顾
- **C1（ADR-0001）**：零 API、零自有后端。任何「社区接口/投票/信任分服务器」都意味着新建并运维基建，违背本约束。
- **隐私（ADR-0008）**：配置只描述选择器与策略字符串，**不含用户数据、不下发可执行代码**（ADR-0005 安全约束）。提交流程同样不得携带 PII。
- **信任**：覆盖配置是会被注入并据以操作页面 DOM 的选择器；一旦把「别人的选择器」合并进所有用户的远程配置，就有了**供应链风险**——恶意/低质选择器可能让注入打到错误元素。必须有一道信任闸。

## 决策 (Decision)

### 1. 提交机制：预填 GitHub Issue（零后端）
- 用户在 Council Page 校准列表里，对**已校准**的站点点「贡献此校准」。
- 扩展把该站点的本地覆盖序列化成一份结构化 **贡献 payload**（`src/shared/contribution.ts`），构造一个**预填好标题/正文/标签的 GitHub「New Issue」URL**，在新标签页打开；用户确认后点 GitHub 的「提交」即可。
- 正文里含一段 ` ```json ` 代码块（payload 全文）+ 人类可读的站点信息与审核提示。维护者可直接从 Issue 复制该 JSON 进 `adapter-config.json`。
- **为何不是自动建 PR / OAuth**：自动 PR 需用户用 GitHub token/OAuth 授权、在扩展内实现授权流，明显更重，且把一次外部写 API 引入客户端；预填 Issue **零授权、零后端、零写权限**，最贴合 C1，且「用户必须在 GitHub 上亲自点提交」这一步本身就是一道防滥用闸。

### 2. 信任机制：维护者人工审核（人当信任闸）
- 所有贡献先落地为 GitHub Issue（带 `selector-contribution` 标签），**不自动进入分发**。
- 维护者按 `CONTRIBUTING.md` 的核验清单人工审核后，才把选择器合并进 `adapter-config.json`：
  - 仅含选择器/策略字符串，**无任何可执行代码 / 内联事件 / `javascript:` 等**；
  - 选择器稳健（语义化属性/角色/短结构路径），**非动态哈希类名**（Tailwind 原子类、CSS Modules 哈希后缀）；
  - 与现有配置不冲突、`adapterId` 合法、`schemaVersion` 匹配。
- 客户端在生成 payload 前先 `sanitize`（复用 `overrides.ts` 的清洗思路），只放行字符串型选择器与既定策略枚举，降低噪声。**但客户端清洗不是安全边界——真正的闸是人工审核**（客户端代码可被绕过）。

### 3. 分发：复用 ADR-0008 远程源（闭环）
- 合并进配置仓的 `adapter-config.json`，正是 ConfigLoader 的 `REMOTE_CONFIG_URL` 指向的文件。用户下次回源（或缓存过期）即自动获得社区校准。
- 合并优先级仍为 **用户本地覆盖 > 远程 > 内置兜底**（ADR-0009）：社区配置不会盖掉用户自己的本地校准。

### 4. 配置仓模板（本仓 `config-repo/`）
按「我搭模板、你建仓」分工，本仓 `config-repo/` 目录产出可直接拷进 GitHub 公开仓的骨架：
- `adapter-config.json`：初始远程配置，由 `scripts/gen-remote-config.mjs` 从扩展内置 `local-config.ts` 生成（单一真源，避免手抄漂移）；
- `.github/ISSUE_TEMPLATE/selector-contribution.md`：选择器贡献的 Issue 模板（供手动提交者）；
- `CONTRIBUTING.md`：维护者审核/信任清单 + 合并流程；
- `README.md`：仓库用途 + 如何把 raw URL 填回扩展 `REMOTE_CONFIG_URL`、补 `host_permissions`。

用户建好公开仓后：填 `src/council-page/config-loader.ts` 的 `REMOTE_CONFIG_URL`（raw `adapter-config.json`）与 `src/shared/contribution.ts` 的 `COMMUNITY_REPO`（`owner/repo`），并在 `wxt.config.ts` 补 `raw.githubusercontent.com` 与 `github.com` 的权限即可启用。两常量为空时，扩展自动隐藏贡献入口、跳过远程（优雅降级，不影响本地使用）。

## 后果 (Consequences)
**好处：**
- 真正形成「一人校准、众人受益」的闭环，把 ADR-0009 的自救能力升级为社区资产，从根上摊薄选择器维护成本。
- 零后端、零授权、零运维：提交走 GitHub Issue、分发走 GitHub raw，全部复用既有免费基建，严守 C1。
- 人工审核作为信任闸，规避了「自动合并第三方选择器」的供应链风险；客户端 `sanitize` 降噪但不越权充当安全边界。

**代价 / 妥协：**
- 审核是人工瓶颈：贡献量大时维护者吞吐有限（可后续引入「自动结构校验 CI + 人工复核」缓解，届时另立 ADR；仍不需后端）。
- 依赖 GitHub 可达性与账号：无 GitHub 账号或访问受限的用户无法贡献（但**不影响**其本地校准与议事，贡献是纯增量能力）。
- 公开仓意味着社区选择器对外可见（同 ADR-0008，非敏感信息，可接受）。
- 配置仓需用户实际创建并接线后整条链路才生效；在此之前贡献入口与远程拉取自动隐藏/跳过。
