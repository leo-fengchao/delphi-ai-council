# ADR-0005: 站点适配器采用远程热更新配置

- **日期:** 2026-06-02
- **状态:** Accepted（schema 草案待 Phase 0 评审定稿）

## 上下文 (Context)
ADR-0001 路线下，每个站点的输入框、回答容器、完成信号、抽取方式都不同，且站点一改版即失效。中外混合接入使适配器面积最大。若每次站点改版都要发新扩展版本走商店审核（审核常需数天），产品会被维护拖死、用户长期处于"坏掉"状态。

## 决策 (Decision)
将适配器逻辑**数据驱动化**：把每个站点的选择器、注入方式、完成检测、抽取规则抽象成**配置数据**，由 ConfigLoader 从**远程托管 JSON** 拉取并缓存；content script 运行时是通用的、由配置驱动。站点改版时只需推送配置更新，不发新版本。

- 扩展内置一份**本地兜底配置**，远程不可达时使用。
- 远程配置带 `version` 与按站点的 `version`，便于灰度与回滚。
- 托管位置见 README Q5（待确认）。

### 配置 schema 草案（待评审）
```jsonc
{
  "schemaVersion": 1,
  "adapters": [
    {
      "id": "chatgpt",
      "displayName": "ChatGPT",
      "version": 3,                          // 单站点配置版本
      "matches": ["https://chatgpt.com/*", "https://chat.openai.com/*"],
      "newChatUrl": "https://chatgpt.com/",
      "selectors": {
        "inputBox": "...",                   // 输入框（注意多为 contenteditable/ProseMirror）
        "sendButton": "...",
        "stopButton": "...",                 // 生成中出现、完成后消失——完成信号主依据
        "assistantMessage": "...",           // 每条助手回答容器
        "streamingIndicator": "..."          // 可选：流式光标/生成标记
      },
      "input": {
        "method": "paste | execCommandInsertText | setNativeValue",
        "submit": "clickButton | enterKey"
      },
      "completion": {
        "primarySignal": "stopButtonDisappears | streamingIndicatorGone",
        "idleMutationMs": 800,               // DOM 静默判完成的兜底阈值
        "maxWaitMs": 120000                  // 单腿超时
      },
      "extraction": {
        "scope": "lastAssistantMessage",
        "format": "markdown | text | html"
      },
      "auth": {
        "loggedOutSelector": "..."           // 命中则判定未登录，触发降级提示
      }
    }
  ]
}
```

## 后果 (Consequences)
**好处：** 站点改版的修复路径从"发版审核数天"缩短到"推送配置即时生效"；这是 ADR-0001 脆弱性约束下能长期存活的关键机制。

**代价 / 妥协：**
- 引入对远程配置源的运营依赖（可用性、信任）；用本地兜底 + 缓存降低单点风险。
- 完成检测/抽取本质仍脆弱，配置化只是让修复更快，并不能消除人工跟进站点改版的工作量。
- 远程下发可执行规则需注意安全：**配置只描述选择器与策略，不下发任意可执行代码**，避免远程代码执行类风险与审核问题。
