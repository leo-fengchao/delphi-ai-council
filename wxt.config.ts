import { defineConfig } from 'wxt';
import { resolve } from 'node:path';

// WXT 配置。架构见 README + docs/adr/。
// 注意：编排逻辑运行于 Council Page（常驻扩展页），background 仅做轻量协调（ADR-0003）。
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  // 开发期使用项目内持久化 Chrome profile：各 AI 站点登录态/Cookie 跨 `pnpm dev` 保留，
  // 无需每次重新登录；也让 profile「养熟」后更不易触发 Cloudflare 机器人验证。
  // 想复用你自己的 Chrome 登录，可把 chromiumProfile 改为你的 Chrome 用户数据目录（需先关闭 Chrome）。
  runner: {
    chromiumProfile: resolve('.dev-chrome-profile'),
    keepProfileChanges: true,
    // 去掉「受自动化控制」特征，缓解 Cloudflare 等机器人检测（对 Google 登录无效，详见 README）。
    chromiumArgs: ['--disable-blink-features=AutomationControlled'],
  },
  manifest: {
    name: '集思 · Delphi',
    description: '多 AI 议会评议 —— 在浏览器内驱动各 AI 原生网页作答、互评、综合，汇聚众智。',
    // Phase 2：8 站点广播。host_permissions 须覆盖全部参会站点。
    // tabGroups：把 AI 标签页归入「集思议会」标签组，便于用户看到（ADR-0004 修订）。
    permissions: ['tabs', 'storage', 'scripting', 'tabGroups'],
    host_permissions: [
      'https://chat.deepseek.com/*',
      'https://kimi.moonshot.cn/*',
      'https://www.kimi.com/*',
      'https://www.qianwen.com/*',
      'https://tongyi.aliyun.com/*',
      'https://www.tongyi.com/*',
      'https://www.doubao.com/*',
      'https://yuanbao.tencent.com/*',
      'https://chatgpt.com/*',
      'https://chat.openai.com/*',
      'https://claude.ai/*',
      'https://gemini.google.com/*',
    ],
    // 声明 action 才能让工具栏图标可点、触发 background 的 onClicked（打开 Council Page）。
    action: {},
  },
});
