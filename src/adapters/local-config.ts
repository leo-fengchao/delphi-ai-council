/**
 * 扩展内置的本地兜底适配器配置（ADR-0005、ADR-0008 三级回退的最后一级）。
 *
 * ⚠️ 选择器是基于各站点网页结构的「最佳推测起点」，**必须经实机联调对照真实 DOM 校准**
 *    后才算「打通」。这正是 ADR-0005 把适配器数据驱动化的意义：改选择器不必改运行时代码，
 *    且上线后可经 ConfigLoader（ADR-0008）远程热更新，无需发版。
 *
 * ⚠️ 海外站点（ChatGPT / Claude / Gemini）按 ADR-0001/0007 属 C3 高 ToS 风险面，
 *    其自动化检测更激进，是「上线后被投诉下架」风险的主要来源。
 */

import type { AdapterConfig, SiteAdapter } from '../shared/adapter-schema';

const deepseek: SiteAdapter = {
  id: 'deepseek',
  displayName: 'DeepSeek',
  version: 2,
  matches: ['https://chat.deepseek.com/*'],
  newChatUrl: 'https://chat.deepseek.com/',
  selectors: {
    inputBox: 'textarea#chat-input, textarea[placeholder], div[contenteditable="true"]',
    sendButton: 'div[role="button"].ds-button--circle.ds-button--primary, div[role="button"][aria-disabled], button[type="submit"], div[role="button"][aria-label*="发送"], div[role="button"][aria-label*="Send" i]',
    // DeepSeek 的「发送」与「停止」是输入框右下角同一个圆形按钮，类名/aria 完全相同，
    // 只有内部 SVG 图标不同。故 stopButton 指向该圆形按钮，再用 completion.stopButtonIconPrefix
    // 按图标形状区分「正在生成（停止方块）」与「已完成（发送箭头）」。2026-06-03 实测校准。
    stopButton: 'div[role="button"].ds-button--circle.ds-button--primary',
    // 必须用回答正文容器；不能用 [class*="ds-markdown"]（会过度匹配 ds-markdown-paragraph/ds-markdown-cite 子元素，取到末尾空引用角标）。
    assistantMessage: '.ds-assistant-message-main-content, .markdown-body',
  },
  input: { method: 'paste', submit: 'clickButton' },
  // 深度思考开关（2026-06-04 实测校准）：输入框上方「深度思考」切换按钮，aria-pressed 表示开/关。
  thinkingActivation: ['div > div > div:nth-of-type(2) > div:nth-of-type(1) > div.ds-toggle-button'],
  thinkingState: {
    selector: 'div > div > div:nth-of-type(2) > div:nth-of-type(1) > div.ds-toggle-button',
    on: { kind: 'attr', name: 'aria-pressed', value: 'true' },
  },
  // 停止方块图标 path 以 'M2 4.88' 开头；发送箭头以 'M8.3125' 开头。只要图标翻回箭头即判完成——
  // 即时、精确、不被深度思考的中途停顿截断。idleMutationMs 仅作选择器失效时的兜底（调回常规值）。
  completion: {
    primarySignal: 'stopButtonDisappears',
    idleMutationMs: 3000,
    maxWaitMs: 300000,
    stopButtonIconPrefix: 'M2 4.88',
  },
  extraction: { scope: 'lastAssistantMessage', format: 'text' },
  auth: { loggedOutSelector: 'a[href*="login"], a[href*="sign_in"]' },
};

// 选择器已据 2026-06-03 实测 DOM 校准。
const kimi: SiteAdapter = {
  id: 'kimi',
  displayName: 'Kimi',
  version: 3,
  matches: ['https://kimi.moonshot.cn/*', 'https://www.kimi.com/*'],
  newChatUrl: 'https://www.kimi.com/',
  selectors: {
    inputBox: '.chat-input-editor',
    sendButton: 'div[class*="send-button"], button[class*="send"]',
    stopButton: 'div[class*="stop"], button[aria-label*="停止"]',
    // 回答正文在 .markdown-container .markdown；不能用 *=segment-assistant（会命中底部工具栏 segment-assistant-actions → 抓到「引用」）。
    assistantMessage: '.chat-content-item-assistant .markdown-container .markdown',
  },
  // Kimi 是自定义富文本编辑器（类 Lexical），只认 paste 注入，execCommand/直写都会被清空。
  input: { method: 'paste', submit: 'clickButton' },
  // Kimi 的「深度思考」是切模型（2026-06-04 实测）：点当前模型 → 在弹层选「K2.6 思考」模型。
  // 判别按当前模型名文本含「K2.6 思考」。
  thinkingActivation: [
    'div.current-model',
    'div.v-binder-follower-content > div.n-popover > div.models-popover > div.models-container > div.model-item',
  ],
  thinkingState: {
    selector: 'div.current-model',
    on: { kind: 'text', contains: 'K2.6 思考' },
  },
  completion: { primarySignal: 'stopButtonDisappears', idleMutationMs: 3000, maxWaitMs: 120000 },
  extraction: { scope: 'lastAssistantMessage', format: 'text' },
  auth: { loggedOutSelector: 'button[class*="login"]' },
};

const qwen: SiteAdapter = {
  id: 'qwen',
  displayName: '通义千问',
  version: 3,
  // 实测真实域名是 www.qianwen.com（旧 tongyi 域名会重定向到此），必须匹配它内容脚本才注入。
  matches: ['https://www.qianwen.com/*', 'https://tongyi.aliyun.com/*', 'https://www.tongyi.com/*'],
  newChatUrl: 'https://www.qianwen.com/',
  selectors: {
    // 输入框是 contenteditable（类名是动态 Tailwind，用属性选择最稳）。
    inputBox: 'div[role="textbox"], div[contenteditable="true"]',
    // 优先 aria（2026-06 实测稳定），回退 <use xlink:href="#qwpcicon-sendChat"> 命名空间定位。
    sendButton: 'button[aria-label="发送消息"], button:has(use[*|href="#qwpcicon-sendChat"])',
    stopButton: 'button[aria-label="停止回答"], div[class*="stop"]',
    // 回答正文容器。
    assistantMessage: '.qk-markdown',
  },
  // 千问用 paste 注入（execCommand 不更新其框架状态、发送键保持灰色）；并改点按钮发送。
  input: { method: 'paste', submit: 'clickButton' },
  // 深度思考开关（2026-06-04 实测）：输入区的「深度思考」切换按钮，aria-pressed 表示开/关。
  thinkingActivation: ['div:nth-of-type(2) > div > div > span > button.outline-none'],
  thinkingState: {
    selector: 'div:nth-of-type(2) > div > div > span > button.outline-none',
    on: { kind: 'attr', name: 'aria-pressed', value: 'true' },
  },
  completion: { primarySignal: 'stopButtonDisappears', idleMutationMs: 3000, maxWaitMs: 120000 },
  extraction: { scope: 'lastAssistantMessage', format: 'text' },
  auth: { loggedOutSelector: 'a[href*="login"]' },
};

const doubao: SiteAdapter = {
  id: 'doubao',
  displayName: '豆包',
  version: 3,
  matches: ['https://www.doubao.com/*'],
  newChatUrl: 'https://www.doubao.com/chat/',
  selectors: {
    inputBox: 'textarea.semi-input-textarea, textarea[placeholder*="发消息"]',
    sendButton: '#flow-end-msg-send',
    stopButton: 'button[data-testid="chat_input_stop_button"], div[class*="stop"]',
    // 回答正文容器（含 markdown 渲染）。
    assistantMessage: '.flow-markdown-body',
  },
  // 豆包回车=换行，必须点发送按钮。
  input: { method: 'setNativeValue', submit: 'clickButton' },
  // 深度思考开关（2026-06-04 实测）：点输入区「深度思考」入口；data-checked 表示开/关。
  // 注：用户校准导出里首步误录了 'html'（误点），已剔除。
  thinkingActivation: ['div.custom-scrollbar-style > div:nth-of-type(2) > div'],
  thinkingState: {
    selector: 'button > div > button.outline-transparent',
    on: { kind: 'attr', name: 'data-checked', value: 'true' },
  },
  // 豆包流式中有搜索/图片/表格的停顿，静默阈值调大，避免抓到一半就误判完成。
  completion: { primarySignal: 'stopButtonDisappears', idleMutationMs: 4000, maxWaitMs: 120000 },
  extraction: { scope: 'lastAssistantMessage', format: 'text' },
  auth: {
    loggedOutSelector: 'button[class*="login"], a[href*="login"]',
    // 豆包会弹图形验证码；命中常见验证码 iframe 即提示用户手动通过（运行时还有通用兜底）。
    captchaSelector: 'iframe[src*="captcha"], iframe[src*="verify"]',
  },
};

const yuanbao: SiteAdapter = {
  id: 'yuanbao',
  displayName: '腾讯元宝',
  version: 3,
  matches: ['https://yuanbao.tencent.com/*'],
  newChatUrl: 'https://yuanbao.tencent.com/chat/',
  selectors: {
    // Quill 富文本编辑器。
    inputBox: '.ql-editor[contenteditable="true"], .ql-editor',
    // 优先 id（2026-06 实测稳定），回退类名匹配。
    sendButton: '#yuanbao-send-btn, a[class*="send"], button[class*="send"], div[class*="send-btn"]',
    stopButton: 'div[class*="stop"]',
    // 回答正文在 .hyc-common-markdown；不要用整个 bubble（含工具栏/相关视频/追问，innerText 很脏）。
    assistantMessage: '.agent-chat__bubble--ai .hyc-common-markdown',
  },
  // 腾讯元宝也是 Quill 富文本编辑器，使用 paste 能正确保留多行文本的换行符。
  input: { method: 'paste', submit: 'enterKey' },
  // 深度思考开关（2026-06-04 实测）：点输入区「深度思考」切换项。
  // ⚠️ 判别 class 'ThinkSelector_selected__YUTmh' 带 CSS-Module 哈希后缀，站点重新部署可能变，失效时重校准。
  thinkingActivation: ['div:nth-of-type(2) > div:nth-of-type(3) > div:nth-of-type(1) > div > div:nth-of-type(1)'],
  thinkingState: {
    selector: 'div:nth-of-type(2) > div:nth-of-type(3) > div:nth-of-type(1) > div > div:nth-of-type(1)',
    on: { kind: 'class', value: 'ThinkSelector_selected__YUTmh' },
  },
  completion: { primarySignal: 'stopButtonDisappears', idleMutationMs: 3000, maxWaitMs: 120000 },
  extraction: { scope: 'lastAssistantMessage', format: 'text' },
  auth: { loggedOutSelector: 'a[href*="login"]' },
};

// —— 海外站点（C3 高 ToS 风险，ADR-0001/0007）——

const chatgpt: SiteAdapter = {
  id: 'chatgpt',
  displayName: 'ChatGPT',
  version: 2,
  matches: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
  newChatUrl: 'https://chatgpt.com/',
  selectors: {
    // ProseMirror contenteditable。
    inputBox: 'div#prompt-textarea[contenteditable="true"], #prompt-textarea',
    // 优先 id（2026-06 实测），回退 data-testid / aria。注意 stop 不能用同一个 id——
    // 发送/停止是同一个 #composer-submit-button 在不同状态切换，stop 必须靠状态区分。
    sendButton: '#composer-submit-button, button[data-testid="send-button"], button[aria-label*="Send" i]',
    stopButton: 'button[data-testid="stop-button"], button[aria-label*="Stop" i]',
    assistantMessage: 'div[data-message-author-role="assistant"]',
  },
  input: { method: 'execCommandInsertText', submit: 'enterKey' },
  // 深度思考（2026-06-04 实测）：「+」菜单 → 选「Think longer / 深度思考」。
  // ⚠️ 关态无指示物、判别用通用类 div.contain-inline-size + data-tone=accent，定位可能抓错——
  //    这是最不稳的一个，实机验收重点核对；若误判则按需重校准（找仅开启态才有的更专属元素）。
  thinkingActivation: [
    '#composer-plus-btn',
    'div:nth-of-type(10) > div > div:nth-of-type(2) > div:nth-of-type(1) > div:nth-of-type(2)',
  ],
  thinkingState: {
    selector: 'div.contain-inline-size',
    on: { kind: 'attr', name: 'data-tone', value: 'accent' },
  },
  completion: { primarySignal: 'stopButtonDisappears', idleMutationMs: 3000, maxWaitMs: 180000 },
  extraction: { scope: 'lastAssistantMessage', format: 'text' },
  auth: { loggedOutSelector: 'a[href*="/auth/login"], button[data-testid="login-button"]' },
};

const claude: SiteAdapter = {
  id: 'claude',
  displayName: 'Claude',
  version: 1,
  matches: ['https://claude.ai/*'],
  newChatUrl: 'https://claude.ai/new',
  selectors: {
    inputBox: 'div[contenteditable="true"].ProseMirror, div[contenteditable="true"]',
    sendButton: 'button[aria-label*="Send" i]',
    stopButton: 'button[aria-label*="Stop" i]',
    // 回答正文容器（含 font-claude-response-body 段落）。
    assistantMessage: '.standard-markdown',
  },
  input: { method: 'execCommandInsertText', submit: 'enterKey' },
  // Claude 默认即开启 extended thinking，无需注入开关（不配 thinkingActivation/thinkingState，
  // 运行时遇「无步骤」直接跳过，保持其默认开启态）。
  completion: { primarySignal: 'stopButtonDisappears', idleMutationMs: 3000, maxWaitMs: 180000 },
  extraction: { scope: 'lastAssistantMessage', format: 'text' },
  // 不设 loggedOutSelector：claude.ai 登录态下也有各种链接，易误判；未登录时自身会跳转登录页。
  auth: {},
};

const gemini: SiteAdapter = {
  id: 'gemini',
  displayName: 'Gemini',
  version: 2,
  matches: ['https://gemini.google.com/*'],
  newChatUrl: 'https://gemini.google.com/app',
  selectors: {
    // Quill 富文本编辑器（注意排除 .ql-clipboard 这个隐藏剪贴板节点），回退到输入区容器。
    inputBox: '.ql-editor:not(.ql-clipboard), div.simplified-input-area',
    // 发送按钮 aria 兼容「Send / 发送」，回退到 gem-icon-button.send-button 内的 button（2026-06 实测）。
    sendButton: 'button[aria-label*="Send" i], button[aria-label*="发送"], gem-icon-button.send-button button, button.send-button',
    stopButton: 'button[aria-label*="Stop" i], button[aria-label*="停止"]',
    // 2026-06-03 实测回答区正文容器。
    assistantMessage: '.markdown-main-panel, message-content, div[class*="model-response-text"]',
  },
  // 与千问同理：Quill/Angular 用 paste 注入才会更新内部状态、点亮发送、让回车生效。
  input: { method: 'paste', submit: 'enterKey' },
  // Gemini 的「深度思考」即选模式/扩展（2026-06-04 实测校准）。三步：开模式菜单 → 选 Pro 模型 → 选「Pro 扩展」。
  // 目标是默认用「Pro 扩展」（而非 Flash 扩展），故先切到 Pro 模型再选思考等级。
  // 判别用模式按钮的 aria-label「当前模式为"Pro 扩展"」：非此模式才跑三步切换，已是则跳过。
  // ⚠️ 含 Angular 动态标记 .ng-star-inserted 与正位（nth）菜单项，较脆；失效时重校准。
  thinkingActivation: [
    'button[data-test-id="bard-mode-menu-button"]',
    'div.ng-star-inserted > div.popover-menu > gem-menu.ng-star-inserted > gem-menu-item.ng-star-inserted > gem-menu-item-content',
    'div.cdk-overlay-pane > div.ng-star-inserted > gem-menu > gem-menu-item.ng-star-inserted > gem-menu-item-content.checkmark-only',
  ],
  thinkingState: {
    selector: 'button[data-test-id="bard-mode-menu-button"]',
    on: { kind: 'attr', name: 'aria-label', value: '打开模式选择器，当前模式为“Pro 扩展”' },
  },
  completion: { primarySignal: 'stopButtonDisappears', idleMutationMs: 3000, maxWaitMs: 180000 },
  extraction: { scope: 'lastAssistantMessage', format: 'text' },
  // 不设 loggedOutSelector：登录态下 Gemini 页面本就有指向 accounts.google.com 的链接（账号菜单），会误判未登录。
  auth: {},
};

export const LOCAL_ADAPTER_CONFIG: AdapterConfig = {
  schemaVersion: 1,
  adapters: [deepseek, kimi, qwen, doubao, yuanbao, chatgpt, claude, gemini],
};

/** 所有站点的 match 模式合集，供 content script 静态声明与 host_permissions 复用。 */
export const ALL_MATCHES: string[] = LOCAL_ADAPTER_CONFIG.adapters.flatMap((a) => a.matches);
