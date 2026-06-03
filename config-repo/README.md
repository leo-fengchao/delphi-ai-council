# 集思 · Delphi —— 社区适配器配置仓（模板）

本目录是「集思 · Delphi」浏览器扩展的**社区配置仓模板**。把它的内容拷进一个 **GitHub 公开仓库**，即可作为扩展的远程配置源 + 众包贡献的承接处（ADR-0008、ADR-0013）。

> 这是「我（开发）搭模板、你（产品方）建仓」分工的产物。下面是你需要做的全部步骤。

## 这个仓库是干什么的

- **分发**：`adapter-config.json` 是各 AI 站点的选择器/策略配置。扩展通过 `raw.githubusercontent.com` 拉取它来热更新选择器——**站点改版时改这个 JSON 即可，无需发新版扩展**（ADR-0005/0008）。
- **众包承接**：用户在扩展里校准好某站点后，可一键打开一个**预填好的 GitHub Issue** 把校准提交过来；维护者审核后合并进 `adapter-config.json`，所有用户下次自动获益（ADR-0013）。

## 目录内容

| 文件 | 用途 |
|------|------|
| `adapter-config.json` | 远程适配器配置（扩展拉取的目标）。由扩展仓 `scripts/gen-remote-config.mjs` 从内置兜底生成，**勿手抄**。 |
| `CONTRIBUTING.md` | 维护者审核/合并选择器贡献的信任清单与流程。 |
| `.github/ISSUE_TEMPLATE/selector-contribution.md` | 选择器贡献的 Issue 模板（供手动提交者；扩展一键提交会自动预填）。 |

## 建仓步骤（产品方）

1. 在 GitHub 新建一个**公开**仓库，例如 `your-org/delphi-config`。
2. 把本 `config-repo/` 目录下全部文件拷到该仓根目录并推送。
3. 在该仓 **Issues → Labels** 新建标签 `selector-contribution`（扩展提交时会带上它）。
4. 拿到 `adapter-config.json` 的 raw 链接，形如：
   `https://raw.githubusercontent.com/your-org/delphi-config/main/adapter-config.json`
5. 回到扩展仓接线两处常量并补权限：
   - `src/council-page/config-loader.ts` → `REMOTE_CONFIG_URL = '<上面的 raw 链接>'`
   - `src/shared/contribution.ts` → `COMMUNITY_REPO = 'your-org/delphi-config'`
   - `wxt.config.ts` 的 `host_permissions` 增补：
     `https://raw.githubusercontent.com/*` 和 `https://github.com/*`
6. `pnpm build` 重新打包。完成后扩展即会：远程拉取配置（三级回退保底）、并在校准列表显示「贡献」按钮。

> 两个常量留空时，扩展自动**跳过远程**、**隐藏贡献入口**，只用内置兜底——即使不建仓也能正常本地使用（优雅降级）。

## 同步配置（当内置兜底变化时）

扩展内置兜底（`src/adapters/local-config.ts`）更新后，在扩展仓跑：

```bash
pnpm gen:config      # 重新生成 config-repo/adapter-config.json
```

再把生成的 `adapter-config.json` 推到配置仓。`adapter-config.json` 是**生成产物**，以扩展内置兜底为单一真源，避免两处手抄漂移。

## 安全须知

- 配置**只描述选择器与策略字符串，绝不含可执行代码**（ADR-0005）。合并任何贡献前务必照 `CONTRIBUTING.md` 核验。
- 公开仓意味着选择器对外可见——这些是非敏感信息，可接受（ADR-0008）。
