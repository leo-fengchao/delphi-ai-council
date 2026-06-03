# ADR-0008: ConfigLoader 远程配置源采用 GitHub raw（定稿 Q5）

- **日期:** 2026-06-02
- **状态:** Accepted（定稿 README Q5）

## 上下文 (Context)
ADR-0005 决定把站点适配器数据驱动化、由远程托管 JSON 热更新，但把「托管在哪」留作 Q5 待确认（自有服务器 / GitHub raw / CDN）。Phase 2 要落地 ConfigLoader，必须先定源。

约束回顾：
- 本项目零后端、零 API（ADR-0001）；引入自有服务器会增加运维与成本。
- 配置只描述选择器与策略，**不含任何用户数据、不下发可执行代码**（ADR-0005 安全约束），因此远程源是「读取一个公开 JSON」，无隐私上传。

## 决策 (Decision)
**默认远程源采用 GitHub raw（`raw.githubusercontent.com` 上的公开仓库文件）**，并满足：

1. **可配置**：远程 URL 收敛为单一常量 `REMOTE_CONFIG_URL`（`src/council-page/config-loader.ts`）。后续若迁 CDN，只改此常量。未配置（空串）时跳过远程，直接用本地兜底。
2. **三级回退**：远程拉取（带超时）→ 本地缓存（`chrome.storage.local`）→ 扩展内置兜底（`src/adapters/local-config.ts`）。任一级可用即返回，绝不因远程不可达而瘫痪。
3. **缓存**：成功拉取的配置连同时间戳写入 `chrome.storage.local`；TTL 内直接用缓存，过期才回源。
4. **校验**：仅接受 `schemaVersion` 匹配的配置；解析失败按「远程不可用」处理，回退下一级。
5. **隐私说明**：ConfigLoader 仅发起一个对公开 JSON 的 GET 请求，不携带、不上报任何用户数据；写进商店隐私说明。

## 后果 (Consequences)
**好处：**
- 零基建即可热更新选择器：站点改版 → 改仓库 JSON → 用户端下次回源即生效，无需发版审核（ADR-0005 的核心收益落地）。
- 三级回退使远程源不可用（GitHub 被墙/限流）时产品仍可运行（用缓存或内置兜底）。

**代价 / 妥协：**
- GitHub raw 在部分网络（如中国大陆）可达性不稳定 → 这正是「本地兜底 + 缓存」的存在理由；若实测可达性差，按本 ADR 第 1 条改 `REMOTE_CONFIG_URL` 迁至国内可达 CDN，无需改架构。
- 公开仓库意味着适配器选择器对外可见（非敏感信息，可接受）。
