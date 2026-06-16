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
  version: 3,
  matches: ['https://chat.deepseek.com/*'],
  newChatUrl: 'https://chat.deepseek.com/',
  selectors: {
    // 输入框已无 #chat-input，靠 textarea[placeholder]（“给 DeepSeek 发送消息”）命中。2026-06-16 实测校准。
    inputBox: 'textarea[placeholder], textarea#chat-input, div[contenteditable="true"]',
    // 2026-06-16 实测：DeepSeek 发送/停止按钮改版，类名由 .ds-button--circle 变为
    // .ds-button--primary.ds-button--filled.ds-button--capsule（圆形→胶囊）。旧选择器全部失效 →
    // 发送退化为「等 15s 超时再合成回车」（不稳，后续轮次常发不出去）。禁用态用 class .ds-button--disabled
    //（非 aria/attr，runtime isDisabled 抓不到），故发送键须 :not(.ds-button--disabled) 排除禁用态。
    sendButton: 'div[role="button"].ds-button--primary.ds-button--filled:not(.ds-button--disabled)',
    // 发送与停止仍是同一个胶囊按钮，类名相同、只有内部 SVG 图标不同：发送箭头 'M8.3125'、停止方块 'M2 4.88'。
    // stopButton 指向该按钮，再用 completion.stopButtonIconPrefix 'M2 4.88' 按图标区分生成中/已完成。2026-06-16 实测校准。
    stopButton: 'div[role="button"].ds-button--primary.ds-button--filled',
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
  // 粘入超长文本（如交叉评审整段）时 Kimi 会自动转成 .txt 附件：此时输入框文本为空，故必须
  // 以「发送键点亮」判定已接收，否则会退到逐行/直写兜底，导致附件 + 输入框文字重复发两遍。
  input: { method: 'paste', submit: 'clickButton', pasteMayBecomeFile: true },
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
  version: 5,
  // 实测真实域名是 www.qianwen.com（旧 tongyi 域名会重定向到此），必须匹配它内容脚本才注入。
  matches: ['https://www.qianwen.com/*', 'https://tongyi.aliyun.com/*', 'https://www.tongyi.com/*'],
  newChatUrl: 'https://www.qianwen.com/',
  selectors: {
    // 输入框是 contenteditable（类名是动态 Tailwind，用属性选择最稳）。
    inputBox: 'div[role="textbox"], div[contenteditable="true"]',
    // 优先 aria（2026-06 实测稳定），回退 <use xlink:href="#qwpcicon-sendChat"> 命名空间定位。
    sendButton: 'button[aria-label="发送消息"], button:has(use[*|href="#qwpcicon-sendChat"])',
    // 2026-06-04 Claude-in-Chrome 实测：生成中出现 button[aria-label="停止回答"]，生成完即消失（准确）。
    // 去掉原宽泛的 div[class*="stop"]（易误匹配/噪声）。
    stopButton: 'button[aria-label="停止回答"]',
    // 回答正文容器。
    assistantMessage: '.qk-markdown',
  },
  // 千问用 paste 注入（execCommand 不更新其框架状态、发送键保持灰色）；并改点按钮发送。
  input: { method: 'paste', submit: 'clickButton' },
  // 深度思考开关（2026-06-04 用户 XPath 校准）：aria-label="思考" 的按钮（页面有两个，取第一个），
  // aria-pressed 表示开/关。原正位选择器会误点到「直播」入口（导致开不了思考、还弹 /live/ 页）。
  thinkingActivation: ["(//button[@aria-label='思考'])[1]"],
  thinkingState: {
    selector: "(//button[@aria-label='思考'])[1]",
    on: { kind: 'attr', name: 'aria-pressed', value: 'true' },
  },
  completion: { primarySignal: 'stopButtonDisappears', idleMutationMs: 3000, maxWaitMs: 120000 },
  extraction: { scope: 'lastAssistantMessage', format: 'text' },
  auth: { loggedOutSelector: 'a[href*="login"]' },
};

const doubao: SiteAdapter = {
  id: 'doubao',
  displayName: '豆包',
  version: 5,
  matches: ['https://www.doubao.com/*'],
  newChatUrl: 'https://www.doubao.com/chat/',
  selectors: {
    inputBox: 'textarea.semi-input-textarea, textarea[placeholder*="发消息"]',
    sendButton: '#flow-end-msg-send',
    // 停止按钮（2026-06-04 用户 XPath 校准）：用 XPath 精确定位，取代原宽泛的 div[class*="stop"]
    // （后者易误匹配导致刚发就误判完成/提前截止）。2026-06-16 实测：生成中此 XPath 命中 0（豆包把整个
    // 发送容器 .send-btn-wrapper 移除、停止键另置），故 isStopVisible 恒假、无害降级到「回答活动静默」判完成。
    stopButton: "//div[contains(@class,'items-center')]//div[@data-state='closed']",
    // 回答正文容器：2026-06-16 实测改版，.flow-markdown-body 已不存在，正文容器改为 .md-box-root
    //（container-XXX 为哈希动态类，md-box-root 稳定）。旧选择器失效会让 awaitCompletion 的「已开始」判定
    // 永远不触发 → 25s 后抛「生成始终未开始」（即用户看到的「初次作答失败」），哪怕回答其实已生成。
    assistantMessage: '.md-box-root',
  },
  // 豆包回车=换行，必须点发送按钮。
  input: { method: 'setNativeValue', submit: 'clickButton' },
  // 深度思考=模式选择（2026-06-16 实测重校准）：①点模式选择按钮 ②在弹出菜单选「专家」。
  // 改版后「深度思考」并入「专家」模式（菜单项文案＝「专家 / 深度思考 / 研究级智能模型」），
  // 已无纯文本「思考」节点，故旧的 text()='思考' 失效。改按 contains(.,'专家') 命中专家菜单项。
  // 模式选择是单选式、重复选同一项幂等，故不配 thinkingState：每轮直接确保选到「专家」即可，无误关风险。
  thinkingActivation: [
    'div[data-valid-btn="mode-select-action-btn"]',
    "//*[@role='menu']//*[@role='menuitem'][contains(.,'专家')]",
  ],
  // 豆包流式中有搜索/图片/表格的停顿，静默阈值调大，避免抓到一半就误判完成。
  completion: { primarySignal: 'stopButtonDisappears', idleMutationMs: 4000, maxWaitMs: 120000 },
  extraction: { scope: 'lastAssistantMessage', format: 'text' },
  auth: {
    loggedOutSelector: 'button[class*="login"], a[href*="login"]',
    // 豆包会弹图形验证码（字节 rmc.bytedance.com 语义验证）。#captcha_container 是常见浮层根节点；
    // 叠加字节验证 iframe / 通用 id/class 兜底。命中即提醒用户手动通过、通过后自动继续。
    captchaSelector:
      '#captcha_container, iframe[src*="rmc.bytedance.com"], iframe[src*="captcha"], iframe[src*="verify"], [id*="captcha" i], [class*="captcha" i], [id*="verify" i], [class*="verify" i]',
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
  version: 4,
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
  // 关态输入框下方无任何指示物，开态才出现思考 chip → 用 presence 判别：
  // 选择器只匹配「开启态才出现的 accent chip」，存在即已开、不存在即未开（scan-all，不怕首个不是它）。
  // ⚠️ 选择器较通用，是最不稳的一个，实机验收重点核对；若误判改用更专属的 chip 选择器。
  // ①点「+」菜单按钮；②选「思考一下」。第二步必须点 menuitemradio 元素本身（点其内部文本 div 不触发选择）。
  // 2026-06-04 经 Claude-in-Chrome 实机验证：aria-checked false→true、思考 chip 出现。
  thinkingActivation: [
    '#composer-plus-btn',
    "//div[@role='menuitemradio'][.//*[normalize-space(text())='思考一下']]",
  ],
  // 思考开启后输入框下方出现文本含「思考」的 composer-pill；关态无此 pill。present 判别（实测开=1 关=0）。
  thinkingState: {
    selector: "//button[contains(@class,'__composer-pill') and contains(normalize-space(.),'思考')]",
    on: { kind: 'present' },
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
  version: 3,
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
  // Gemini「深度思考」=「3.1 Pro 模型 + Extended 思考等级」（2026-06-05 改版后实测重校准，中/英双语）。
  // 改版后模型与思考等级在同一菜单里**拆成两条独立项**，且选模型会**关闭菜单**，故需开两次菜单：
  //   ①开菜单 → ②选 Pro 模型(菜单随即关闭) → ③重开菜单 → ④展开「思考等级」子菜单 → ⑤选「扩展」。
  // 菜单项无稳定 data-test-id/aria，改用文本 XPath（runtime 已支持），比旧版 nth/ng-star 稳。
  // 双语兼容：模型名「3.1 Pro」中英一致(用 'Pro')；子菜单/档位用 `or` 同时匹配英文与中文文案。
  // 用文本而非完整版本号匹配，亦抗模型版本号变动（如 3.1→3.2）。失效时重校准。
  thinkingActivation: [
    'button[data-test-id="bard-mode-menu-button"]',
    "//gem-menu-item[contains(., 'Pro')]",
    'button[data-test-id="bard-mode-menu-button"]',
    "//gem-menu-item[contains(., 'Thinking level') or contains(., '思考等级')]",
    "//gem-menu-item[contains(., 'Extended') or contains(., '扩展')]",
  ],
  // 开启后模式按钮 aria-label 含思考档位：英文「…currently Pro Extended」/ 中文「…当前模式为“Pro 扩展”」。
  // 用 attrContains 双语判别：含 'Extended' 或 '扩展' 即视为已开，跳过重跑整套菜单。
  // 仅作跳过优化：不命中只会多跑一次激活补齐（假阴性安全），不会误判已开而误关。
  thinkingState: {
    selector: 'button[data-test-id="bard-mode-menu-button"]',
    on: { kind: 'attrContains', name: 'aria-label', values: ['Extended', '扩展'] },
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
