# 集思 Delphi

集思 Delphi 是一个 Chrome 浏览器扩展，用来把同一个问题交给多家 AI 原生网页独立作答，再进行匿名交叉评审、可选多轮追问，最后由你指定的主席模型综合出结论。

它不调用任何 AI API，不需要 API key。扩展会复用你已经登录的 AI 网页账号，在浏览器里自动打开各家网站、输入问题、等待回复并整理结果。

## 支持的 AI 网页

- DeepSeek
- Kimi
- 通义千问
- 豆包
- 腾讯元宝
- ChatGPT
- Claude
- Gemini

不同站点会频繁改版。如果某个站点突然无法输入、发送或抽取回答，可以在扩展内使用「适配校准」重新点选页面元素。校准结果只保存在本机；你也可以选择把校准提交到社区配置仓，维护者审核后再分发给其他用户。

## 功能

- 多家 AI 并行回答同一个问题
- 匿名交叉评审，降低单一模型偏差
- 可选多轮辩论，由主席模型定向追问匿名成员
- 主席综合输出结论、共识、争议点和置信度
- 默认开启深度思考；若自动开启失败，会提示你手动调整后继续或改用非深度思考
- 历史议事归档，可回看每一轮结果
- 本地适配校准和社区规则热更新

## 隐私

- 不调用 AI API，不上传你的问题或 AI 回复到本项目服务器
- 议事过程、历史记录和本地校准保存在 `chrome.storage.local`
- 远程配置只拉取公开的站点选择器 JSON，用于应对 AI 网站改版
- 如果你主动提交校准贡献，会打开 GitHub Issue 页面，由你自己确认提交

## 安装开发版

目前建议先以开发版方式试用。

```bash
pnpm install
pnpm build
```

然后在 Chrome 打开 `chrome://extensions`：

1. 开启「开发者模式」
2. 点击「加载已解压的扩展程序」
3. 选择 `.output/chrome-mv3`

你需要先在要使用的 AI 网站里登录账号。海外站点可能因为登录策略、验证码或自动化检测而需要额外手动处理。

## 本地开发

```bash
pnpm install
pnpm dev
```

常用命令：

```bash
pnpm compile
pnpm build
pnpm zip
pnpm gen:config
```

## 远程适配器配置

扩展内置了一份基础站点适配配置，同时会从公开配置仓拉取最新规则：

```text
https://raw.githubusercontent.com/leo-fengchao/delphi-config/refs/heads/main/adapter-config.json
```

优先级为：

1. 用户本地校准
2. 远程配置
3. 扩展内置配置

配置只包含选择器和策略字符串，不包含可执行代码。

## 贡献

欢迎提交 issue、bug 复现、站点适配修复和产品建议。

如果你要修改站点规则，请优先更新 `src/adapters/local-config.ts`，再运行：

```bash
pnpm gen:config
```

生成的 `config-repo/adapter-config.json` 可同步到远程配置仓。

## 风险提示

本项目通过浏览器自动化驱动各 AI 原生网页。不同 AI 服务商的网页结构、登录策略、验证码和服务条款可能变化，某些站点可能会限制自动化操作。请在遵守相关服务条款和当地法规的前提下使用。

## License

GPL-3.0-only
