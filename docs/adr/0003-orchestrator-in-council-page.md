# ADR-0003: 编排器运行于常驻扩展页，规避 MV3 service worker 生命周期

- **日期:** 2026-06-02
- **状态:** Accepted

## 上下文 (Context)
Manifest V3 的 background service worker 在空闲约 30 秒后被浏览器终止。而议会编排是"三阶段 × 等待多个流式响应"的长时任务，单阶段就可能超过几十秒，放在 service worker 里必然被中途杀死、状态丢失。

可选的保活手段（offscreen document、alarms、长连接 port）能延命，但 offscreen document 无法以用户登录态加载第三方站点并驱动，并不适合承载本场景的主编排；alarms 心跳保活属于 hack，脆弱且不优雅。

## 决策 (Decision)
**把议会编排逻辑放在 Council Page（一个用户打开的常驻扩展页）里运行，而非 service worker：**
- 编排状态机（XState）、Watchdog、ConfigLoader、UI 均运行于 Council Page 上下文。
- 只要该页面开着，编排进程就持续存活，天然绕开 service worker 30s 限制。
- background service worker 只承担**轻量、非常驻**职责：打开/管理独立窗口、注册 port、转发无需常驻的事件。

## 后果 (Consequences)
**好处：** 长时编排稳定运行，不被 MV3 生命周期打断；架构清晰（重逻辑集中在一个可观测的页面上下文）。

**代价 / 妥协：**
- 议会运行依赖 Council Page 保持打开。若用户关闭该页面，议会中断 → 须配合 ADR-0004 的状态持久化，使其重新打开后可恢复。
- 需向用户明确：Council Page 是"运行中"的主控页，关闭等于暂停/中断。
