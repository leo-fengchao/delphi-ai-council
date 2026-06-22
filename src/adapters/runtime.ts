/**
 * 通用的、由配置数据驱动的适配器运行时（ADR-0005）。
 * 同一份运行时跑所有站点；差异全部来自 SiteAdapter 配置。
 *
 * 一条腿的自动序列（ADR-0007，全自动、无人工确认节点）：
 *   inject → submit → awaitCompletion → extract
 */

import type { SiteAdapter, ThinkingStateCheck } from '../shared/adapter-schema';
import type { ThinkingDecision } from '../shared/messaging';

export class AdapterError extends Error {
  constructor(
    message: string,
    readonly code: 'not_logged_in' | 'captcha' | 'thinking_setup_failed' | 'input_not_found' | 'timeout' | 'extraction_empty',
  ) {
    super(message);
    this.name = 'AdapterError';
  }
}

export interface RunHooks {
  onStage?: (stage: 'thinking' | 'injecting' | 'submitted' | 'awaiting' | 'extracting' | 'captcha') => void;
  onThinkingSetupFailed?: (message: string) => Promise<ThinkingDecision>;
}

export interface RunOptions {
  /** 发送前确保「深度思考」为开启态（按 adapter.thinkingActivation 步骤，ADR-0009 / Phase 7） */
  enableThinking?: boolean;
  /** 用户已在前台手动调整到深度思考时，跳过自动调整步骤。 */
  skipThinkingSetup?: boolean;
}

/** 在当前页面（content script 上下文）就一个 prompt 走完单腿。返回抽取到的文本。 */
export async function runAdapter(
  adapter: SiteAdapter,
  prompt: string,
  hooks: RunHooks = {},
  options: RunOptions = {},
): Promise<string> {
  // 进站即检测人机验证（验证码/滑块）：命中则**提醒前台并原地等待用户手动通过**，通过后自动继续
  //（豆包等「验证码自动等待」）。不再直接报错让用户手点「重试」。
  await waitForCaptchaResolved(adapter, hooks);
  // 进站即用「强信号」快速判一次登录墙（密码框 / 登录链接），避免白等 10 秒。
  // 强信号不会在已登录的聊天页误命中。
  if (detectLoginWallStrong(adapter)) {
    throw new AdapterError('站点需要登录，请在已打开的标签页登录后点「重试」', 'not_logged_in');
  }

  hooks.onStage?.('injecting');

  // 发送前按需开启「深度思考」（ADR-0009 / Phase 7 ADR-0016）。
  if (options.enableThinking && !options.skipThinkingSetup) {
    hooks.onStage?.('thinking');
    await ensureThinkingOn(adapter, hooks);
  }

  // 注入→发送→等生成：整段可重试。豆包实测：**发送后才弹验证码、生成不启动**——此时等用户手动
  // 通过后必须重注入重发（验证码拦住的那次发送已作废）。重试有限次，避免病态死循环。
  const MAX_CAPTCHA_RETRY = 3;
  for (let attempt = 0; ; attempt++) {
    const input = await waitForElement(adapter.selectors.inputBox, 10000);
    if (!input) {
      // 找不到输入框：先看是不是被验证码挡住——是则提醒并等其解除后重试整段；
      // 否则叠加登录墙启发式（此时已无输入框，误判风险低）。
      if (detectCaptcha(adapter) && attempt < MAX_CAPTCHA_RETRY) {
        await waitForCaptchaResolved(adapter, hooks);
        hooks.onStage?.('injecting');
        continue;
      }
      if (detectLoginWallStrong(adapter) || detectLoginWallByText()) {
        throw new AdapterError('站点需要登录，请在已打开的标签页登录后点「重试」', 'not_logged_in');
      }
      throw new AdapterError('未找到输入框（选择器可能已失效）', 'input_not_found');
    }
    await injectPrompt(input, prompt, adapter);

    hooks.onStage?.('submitted');
    await submit(input, adapter);

    hooks.onStage?.('awaiting');
    try {
      await awaitCompletion(adapter, hooks);
      break; // 生成完成，跳出重试循环。
    } catch (err) {
      // 仅「发送后弹验证码导致生成未启动」（awaitCompletion 据实抛 captcha）才重试：等用户手动通过后重发。
      if (err instanceof AdapterError && err.code === 'captcha' && attempt < MAX_CAPTCHA_RETRY) {
        await waitForCaptchaResolved(adapter, hooks);
        hooks.onStage?.('injecting');
        continue;
      }
      throw err; // 其它失败（超时/登录等）照常上抛。
    }
  }

  hooks.onStage?.('extracting');
  const text = extract(adapter);
  if (!text.trim()) {
    throw new AdapterError('抽取到的回答为空（抽取选择器可能已失效）', 'extraction_empty');
  }
  return text;
}

/**
 * 确保「深度思考」处于开启态（Phase 7 / ADR-0016）。
 * 关键：先用 thinkingActive 检测当前是否已开——已开则**跳过点击**，避免站点记忆上次状态时被点关（误关）。
 * 未开（或未配置检测选择器）才按 thinkingActivation 序列逐步点击。
 * 多步站点（豆包/Kimi）后一步元素常要等前一步点击后才出现，故每步「等待→点击→略等」。
 * 未校准或某步失败都不阻断主流程（尽力而为，仍继续发送）。
 */
async function ensureThinkingOn(adapter: SiteAdapter, hooks: RunHooks): Promise<void> {
  const state = adapter.thinkingState;
  if (state && isThinkingOn(state)) return; // 已开，避免误关

  const steps = adapter.thinkingActivation;
  if (!steps?.length) {
    if (state) {
      await resolveThinkingSetupFailure(hooks, '深度思考已开启，但该站点缺少自动开启步骤。请手动调整后继续，或改用非深度思考。');
    }
    return;
  }
  for (const selector of steps) {
    const step = await waitForElement(selector, 4000);
    if (!step) {
      if (state) {
        await resolveThinkingSetupFailure(hooks, '未找到深度思考开关。请在该 AI 网页手动调整到深度思考后继续，或改用非深度思考。');
        return;
      }
      break; // 无状态判别时仍沿用尽力而为，避免旧配置误阻断。
    }
    robustClick(step as HTMLElement);
    await delay(jitter(350, 250));
    // 若每步点击后即可判定「已开」，提前结束剩余步骤，进一步降低误操作概率。
    if (state && isThinkingOn(state)) return;
  }
  if (state && !isThinkingOn(state)) {
    await resolveThinkingSetupFailure(hooks, '自动设置深度思考后仍未检测到开启状态。请手动调整后继续，或改用非深度思考。');
  }
}

async function resolveThinkingSetupFailure(hooks: RunHooks, message: string): Promise<void> {
  if (!hooks.onThinkingSetupFailed) {
    throw new AdapterError(message, 'thinking_setup_failed');
  }
  await hooks.onThinkingSetupFailed(message);
}

/**
 * 判定「深度思考已开」：定位开关元素，再按判别式（属性/class/文本/计算样式）核验当前态。
 * 判别式来自校准时「关→开」两态差异，能区分同一按钮的开/关（ADR-0016）。
 */
function isThinkingOn(state: ThinkingStateCheck): boolean {
  try {
    // 扫描**所有**命中元素：任一「可见且满足判别式」即判已开。
    // 不只看首个——否则当匹配元素不是首个、或关态根本没有该元素时会误判。
    for (const el of queryElements(state.selector)) {
      if (isVisible(el) && matchesDiscriminator(el, state.on)) return true;
    }
    return false;
  } catch {
    return false; // 选择器非法等：按未开处理（继续点击，尽力而为）
  }
}

function matchesDiscriminator(el: HTMLElement, on: ThinkingStateCheck['on']): boolean {
  switch (on.kind) {
    case 'attr':
      return (el.getAttribute(on.name) ?? '') === on.value;
    case 'attrContains': {
      const v = el.getAttribute(on.name) ?? '';
      return on.values.some((s) => v.includes(s));
    }
    case 'class':
      return el.classList.contains(on.value);
    case 'text':
      return ((el.innerText ?? el.textContent ?? '').trim()).includes(on.contains);
    case 'style':
      return getComputedStyle(el).getPropertyValue(on.prop).trim() === on.value;
    case 'present':
      return true; // 元素已存在且可见（由调用处保证）即视为已开
    default:
      return false;
  }
}

/**
 * 人机验证（验证码/滑块）检测：
 * 1) 配置了 captchaSelector 且命中；2) 常见验证码 iframe / 通用文案兜底。
 * 仅用强信号，避免误命中正常页面。
 */
function detectCaptcha(adapter: SiteAdapter): boolean {
  // 必须要求命中元素**可见**：验证码通过后站点常把容器留在 DOM 里仅置 display:none，
  // 若不判可见会一直误命中 → waitForCaptchaResolved 永不返回（卡死自动继续）。验证码激活时一定是全屏可见浮层。
  const sel = adapter.auth?.captchaSelector;
  if (sel && queryElements(sel).some(isVisible)) return true;
  // 常见验证码服务的 iframe（极验 / 腾讯防水墙 / Cloudflare Turnstile / hCaptcha / reCAPTCHA）。
  const captchaIframe =
    'iframe[src*="geetest"], iframe[src*="captcha"], iframe[src*="turnstile"],' +
    'iframe[src*="hcaptcha"], iframe[src*="recaptcha"], iframe[src*="rmc.bytedance.com"], iframe[title*="验证"]';
  if (queryElements(captchaIframe).some(isVisible)) return true;
  const textRe = /(验证码|人机验证|安全验证|拖动滑块|完成验证|verify you are human|verification)/i;
  for (const el of document.querySelectorAll<HTMLElement>('[role="dialog"], [aria-modal="true"], div, section')) {
    if (!isVisible(el)) continue;
    const text = (el.innerText ?? el.textContent ?? '').trim();
    if (text && text.length < 300 && textRe.test(text)) return true;
  }
  return false;
}

/**
 * 人机验证「提醒前台 + 等待手动通过 + 自动继续」（豆包等）。
 * - 未命中验证码：立即返回（无副作用），不影响正常流程。
 * - 命中：经 onStage('captcha') 在前台显眼提醒「出现验证码，请在该窗口手动处理」，随后原地轮询，
 *   直至验证码消失（用户已手动通过）即自动继续；超过 maxWaitMs 仍未通过则抛 captcha，退回「手动重试」兜底。
 */
async function waitForCaptchaResolved(adapter: SiteAdapter, hooks: RunHooks): Promise<void> {
  if (!detectCaptcha(adapter)) return;
  hooks.onStage?.('captcha'); // 前台显眼提醒：出现验证码，请手动处理。
  const MAX_WAIT_MS = 5 * 60 * 1000; // 给用户充足时间手动通过。
  const resolved = await waitFor(() => !detectCaptcha(adapter), MAX_WAIT_MS);
  if (!resolved) {
    throw new AdapterError('验证码超时未处理，请在该标签页手动通过后点「重试」', 'captcha');
  }
  // 通过后略等，让站点状态稳定（验证码 iframe 卸载、页面恢复可交互）后再继续。
  await delay(jitter(800, 400));
}

/**
 * 强信号登录墙判定（不会在已登录页误命中）：
 * 1) 配置的 loggedOutSelector 命中；2) 页面存在密码输入框。
 */
function detectLoginWallStrong(adapter: SiteAdapter): boolean {
  const sel = adapter.auth?.loggedOutSelector;
  if (sel && queryFirst(sel)) return true;
  if (document.querySelector('input[type="password"]')) return true;
  return false;
}

/**
 * 文本启发式：存在文案为「登录 / 登入 / Sign in / Log in」的短按钮/链接。
 * 仅在已确认无输入框时调用，并排除「退出登录 / 登出 / log out」等登出文案，降低误判。
 */
function detectLoginWallByText(): boolean {
  const loginRe = /(登录|登入|sign\s?in|log\s?in)/i;
  const logoutRe = /(退出|登出|注销|sign\s?out|log\s?out)/i;
  const candidates = document.querySelectorAll('button, a, [role="button"]');
  for (const el of candidates) {
    const text = (el.textContent ?? '').trim();
    if (text.length === 0 || text.length > 8) continue; // 限短文本，避免命中长段落
    if (logoutRe.test(text)) continue; // 排除登出类
    if (loginRe.test(text)) return true;
  }
  return false;
}

/**
 * 解析出真正可编辑的元素：匹配到的可能是容器（如 Kimi 的 .chat-input-editor 外壳），
 * 真正的 textarea / contenteditable 在其内部。
 */
function resolveEditable(el: Element): HTMLElement {
  const h = el as HTMLElement;
  if (h instanceof HTMLTextAreaElement || h instanceof HTMLInputElement) return h;
  if (h.isContentEditable) return h;
  const inner = h.querySelector<HTMLElement>(
    'textarea, input:not([type="hidden"]), [contenteditable="true"], [contenteditable=""]',
  );
  return inner ?? h;
}

async function injectPrompt(input: Element, prompt: string, adapter: SiteAdapter): Promise<void> {
  const editable = resolveEditable(input);
  editable.scrollIntoView({ block: 'center' });
  editable.focus();

  if (editable instanceof HTMLTextAreaElement || editable instanceof HTMLInputElement) {
    // 表单控件：绕过受控组件写值。
    setNativeValue(editable, prompt);
  } else {
    // contenteditable（ProseMirror / Quill / Lexical / Slate 等）。
    await injectContentEditable(editable, prompt, adapter);
  }
  // 给框架（React/Vue）一拍时间消化 input 事件。
  await delay(jitter(120, 80));
}

/** 绕过 React 受控组件：用原型 setter 写值再派发 input 事件。 */
function setNativeValue(el: HTMLTextAreaElement | HTMLInputElement, value: string): void {
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  desc?.set?.call(el, value);
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
}

/**
 * 向 contenteditable 写入文本，按多重兜底依次尝试，命中即停：
 *   execCommand insertText → paste 事件 → 直接写 textContent。
 * 自定义编辑器差异很大（Quill 吃 execCommand；Lexical/Slate 只认 paste），故用兜底链覆盖。
 * preferPaste=true 时把 paste 提到最前（如 Kimi）。
 *
 * 关键 1：每次尝试前**先清空**编辑器、尝试后**异步校验**。编辑器对 paste/exec 的写入常是异步生效。
 * 关键 2：校验「内容是否注入到**接近完整**」而非仅「非空」。长多行文本（如交叉评审 prompt）+ 多标签
 *   并行争用时，编辑器可能只先插入了第一行；若此时就判成功并发送，会只发出第一行（Gemini 阶段二实测）。
 *   故按「非空白字符数 ≥ 目标 90%」轮询等待，直到接近完整或超时，再返回；既避免发半句，也避免重复注入。
 */
async function injectContentEditable(el: HTMLElement, text: string, adapter: SiteAdapter): Promise<void> {
  const preferPaste = adapter.input.method === 'paste';
  // 粘贴可能转附件的站点（Kimi）：内容进附件后输入框为空，得靠「发送键点亮」判已接收。
  const pasteMayBecomeFile = adapter.input.pasteMayBecomeFile === true;
  const sendEnabled = (): boolean => {
    if (!adapter.selectors.sendButton) return false;
    return queryElements(adapter.selectors.sendButton).some((b) => isVisible(b) && !isDisabled(b));
  };
  const clearEditor = () => {
    el.focus();
    try {
      document.execCommand('selectAll', false);
      document.execCommand('delete', false);
    } catch {
      /* 忽略不支持的实现 */
    }
    if ((el.textContent ?? '') !== '') el.textContent = '';
  };
  const tryExec = () => {
    el.focus();
    document.execCommand('insertText', false, text);
  };
  const tryPaste = () => {
    el.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    el.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }),
    );
  };
  // 逐行注入：execCommand insertText 遇 \n 会停在第一行（实测 Gemini 只进首行 → 只发首句）。
  // 故按行 insertText、行间 insertParagraph，逐行喂入，规避「整段含换行只进第一行」。
  // 必须 async 且**行间留拍**：密集同步 execCommand 会让 Gemini（Quill/Angular）渲染卡死；
  // 加 40ms 间隔后实测注入完整、发送键点亮（2026-06-04 Claude-in-Chrome 验证）。
  //
  // ⚠️ 仅作兜底，不能当首选：在 ProseMirror 类聊天框（ChatGPT / Claude）里，insertParagraph 被键位映射
  //    当成 Enter = **发送**。逐行注入的第一个 insertParagraph 会把「仅第一行」提前发出去、其余行残留在
  //    输入框（2026-06-04 实测 ChatGPT 复现：只发「请根据…交叉评审。」一行）。故 ProseMirror 站点必须先走
  //    tryExec（整段 insertText 一次注入；实测含换行也能完整进框、且不触发发送），不要先碰逐行注入。
  const tryExecLines = async () => {
    el.focus();
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) document.execCommand('insertParagraph', false);
      if (lines[i]) document.execCommand('insertText', false, lines[i]!);
      await delay(40);
    }
  };
  const trySetText = () => {
    el.textContent = text;
    el.dispatchEvent(
      new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }),
    );
  };

  // 注入顺序（命中即停）：
  //   - preferPaste 站点（Gemini/Kimi 等只认 paste）：paste 优先；Quill 这类「整段 insertText 停在首行」的
  //     才退到逐行注入。
  //   - 其余（ChatGPT/Claude = ProseMirror）：**先整段 tryExec**（实测含换行可完整注入且不误触发送），
  //     逐行注入退为兜底——因为 ProseMirror 把逐行的 insertParagraph 当 Enter 会把首行提前发出去（见上）。
  const attempts = preferPaste
    ? [tryPaste, tryExecLines, tryExec, trySetText]
    : [tryExec, tryExecLines, tryPaste, trySetText];
  for (const attempt of attempts) {
    clearEditor();
    await attempt(); // tryExecLines 为 async（行间留拍）；其余同步，await 无副作用
    // 转附件站点：文本进框算成功，发送键点亮（内容进了附件）也算成功——后者命中即停，
    // 避免再走逐行/直写兜底把同一份内容又灌进输入框（与附件重复发两遍）。转附件需几秒，放宽超时。
    if (pasteMayBecomeFile) {
      if (await waitForInjectedOrAttachment(el, text, sendEnabled, 8000)) return;
    } else if (await waitForInjected(el, text, 4000)) {
      return; // 等注入到接近完整再返回（命中即停）
    }
  }
}

/**
 * 转附件站点的注入成功判定：输入框文本达 ~90%（普通短文本直接进框），或发送键被点亮
 * （超长文本被站点转成附件，输入框为空但内容已被接收）。两者任一命中即返回 true。
 */
async function waitForInjectedOrAttachment(
  el: HTMLElement,
  text: string,
  sendEnabled: () => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const nonWs = (s: string) => s.replace(/\s+/g, '');
  const need = Math.max(1, Math.floor(nonWs(text).length * 0.9));
  const cur = () => nonWs(el.innerText ?? el.textContent ?? '').length;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cur() >= need || sendEnabled()) return true;
    await delay(100);
  }
  return cur() >= need || sendEnabled();
}

/** 编辑器当前文本的非空白字符数是否达到目标的 ~90%（容忍换行/空白被编辑器归一）。轮询至达标或超时。 */
async function waitForInjected(el: HTMLElement, text: string, timeoutMs: number): Promise<boolean> {
  const nonWs = (s: string) => s.replace(/\s+/g, '');
  const need = Math.max(1, Math.floor(nonWs(text).length * 0.9));
  const cur = () => nonWs(el.innerText ?? el.textContent ?? '').length;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cur() >= need) return true;
    await delay(100);
  }
  return cur() >= need;
}

async function submit(input: Element, adapter: SiteAdapter): Promise<void> {
  // 全自动发送前加入随机化的人类节奏延迟（ADR-0007 缓解措施）。
  await delay(jitter(400, 250));

  // 无论配置是 clickButton 还是 enterKey，只要配置了 sendButton 且存在，
  // 都等它变为可用状态再发。应对 Kimi 这种粘入超长文本转附件时，异步处理需几秒钟的问题。
  const getBtn = () => {
    if (!adapter.selectors.sendButton) return null;
    const btns = queryElements(adapter.selectors.sendButton);
    for (let i = btns.length - 1; i >= 0; i--) {
      const b = btns[i]!;
      if (isVisible(b) && !isDisabled(b)) return b;
    }
    return null;
  };

  let btn = getBtn();
  if (!btn && adapter.selectors.sendButton) {
    await waitFor(() => !!getBtn(), 15000);
    btn = getBtn();
  }

  const clickOnce = () => {
    if (adapter.input.submit === 'clickButton') {
      const b = getBtn();
      if (b) {
        robustClick(b);
        return;
      }
      // 找不到/不可用按钮时退化为回车，避免整腿卡死。
    }
    pressEnter(input);
  };

  // 转附件站点（Kimi）：paste 出来的 .txt 附件需异步上传/解析，发送键往往在上传完成**之前**就已点亮。
  // 此时点一次发送会被站点静默忽略——附件滞留输入框、消息没发出（实测 Kimi 交叉评审整段转附件场景）。
  // 故这里不能「点一次就完事」：点击后校验「确实发出」（生成开始＝停止键出现，或输入框已清空＝发送键不再可用），
  // 没发出就略等重试，直到发出或重试用尽。重试落到空输入框只会 no-op，不会重复发送。
  if (adapter.input.pasteMayBecomeFile === true) {
    const sent = () => isStopVisibleFor(adapter) || !getBtn();
    for (let i = 0; i < 5; i++) {
      clickOnce();
      if (await waitFor(sent, 4000)) return;
    }
    return;
  }

  clickOnce();
}

/** 模块级「生成中（停止键可见）」判定，供 submit 校验发送是否真正触发；与 awaitCompletion 内同名逻辑一致。 */
function isStopVisibleFor(adapter: SiteAdapter): boolean {
  const { stopButton } = adapter.selectors;
  const { stopButtonIconPrefix } = adapter.completion;
  if (!stopButton) return false;
  for (const el of queryElements(stopButton)) {
    if (el.offsetWidth <= 0 || el.offsetHeight <= 0) continue;
    // 收/停共用同一按钮的站点：仅当内部 SVG 图标是「停止」形状才算生成中。
    if (stopButtonIconPrefix && !hasIconPrefix(el, stopButtonIconPrefix)) continue;
    return true;
  }
  return false;
}

/** 派发完整的指针+鼠标事件序列，兼容监听 pointerdown/mousedown 而非 click 的实现。 */
function robustClick(el: HTMLElement): void {
  const opts = { bubbles: true, cancelable: true, view: window };
  el.dispatchEvent(new PointerEvent('pointerdown', opts));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new PointerEvent('pointerup', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.click();
}

function isDisabled(el: HTMLElement): boolean {
  return (
    el.hasAttribute('disabled') ||
    el.getAttribute('aria-disabled') === 'true' ||
    el.getAttribute('data-disabled') === 'true'
  );
}

/** 在可编辑元素上派发一套尽量完整的回车事件（keydown→keypress→keyup），兼容只认 key 或只认 keyCode 的实现。 */
function pressEnter(input: Element): void {
  const editable = resolveEditable(input);
  editable.focus();
  for (const type of ['keydown', 'keypress', 'keyup'] as const) {
    const e = new KeyboardEvent(type, { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter' });
    // KeyboardEvent 构造器会忽略 keyCode/which，这里补回，兼容老式处理器。
    Object.defineProperty(e, 'keyCode', { get: () => 13 });
    Object.defineProperty(e, 'which', { get: () => 13 });
    editable.dispatchEvent(e);
  }
}

/**
 * 等待生成完成。主依据 stopButton 出现→消失；辅以 DOM 静默兜底。
 * 任一达成即判完成；超过 maxWaitMs 抛超时。
 */
/**
 * 等待生成完成。主依据停止键「出现→消失」，但**会跨过「深度思考→作答」之间停止键短暂消失、
 * 回答尚未出现的空档**（ChatGPT 深度思考实测：思考结束停止键消失 ~5s 后回答才出现）——
 * 旧逻辑「停止键一消失即判完成」会在此空档误判完成→提前截止/抽空。
 *
 * 判完成的条件：停止键已消失，且在宽限窗口内**既不重新出现、回答也不再有任何活动**。
 * 「回答活动」用两路信号并取（任一仍在变动即视为仍在输出，体现「内容还在流逝就没结束」）：
 *   ① 回答文本长度仍在**增长**；② 回答元素子树有 DOM 变更（MutationObserver，覆盖长度不变的重渲染/分段停顿）。
 * 为什么不能只看停止键：
 *   - 通义千问实测（2026-06-04 Claude-in-Chrome）：停止键在仅输出 18 字时就转回「发送」键（stop 消失），
 *     而正文随后继续从 18 字流式增长到 712 字——只看停止键会在第 18 字就误判完成、拦腰截断。
 *   - DeepSeek/Kimi 等收发共用按钮的站点，作答中按钮也会因重渲染短暂变形 → 停止键瞬时消失，同理。
 *   - ChatGPT 深度思考的「思考→作答空档」里回答仍为空（无活动），待作答开始（长度 0→N 或停止键重现）才算恢复。
 * 因此：停止键消失后，只有当它持续不再出现、且回答两路活动信号都静默满 GAP_GRACE_MS，才判完成。
 */
async function awaitCompletion(adapter: SiteAdapter, hooks: RunHooks): Promise<void> {
  const { stopButton, assistantMessage } = adapter.selectors;
  const { idleMutationMs, maxWaitMs, stopButtonIconPrefix } = adapter.completion;
  const deadline = Date.now() + maxWaitMs;
  /** 停止键消失后，要求「停止键不再出现 + 回答两路活动信号都静默」持续这么久才判完成。 */
  const GAP_GRACE_MS = 6000;
  /** 宽限窗口内的轮询间隔。 */
  const GRACE_POLL_MS = 400;

  const isStopVisible = () => {
    for (const el of queryElements(stopButton ?? '')) {
      if (el.offsetWidth <= 0 || el.offsetHeight <= 0) continue;
      // 收/停共用同一按钮的站点（如 DeepSeek）：仅当内部 SVG 图标是「停止」形状才算生成中。
      if (stopButtonIconPrefix && !hasIconPrefix(el, stopButtonIconPrefix)) continue;
      return true;
    }
    return false;
  };
  const lastAnswerEl = (): HTMLElement | null => {
    const els = queryElements(assistantMessage).filter(isVisible);
    return els[els.length - 1] ?? null;
  };
  const answerLen = () => {
    let best = 0;
    for (const el of queryElements(assistantMessage)) {
      if (!isVisible(el)) continue;
      const n = (el.innerText ?? el.textContent ?? '').trim().length;
      if (n > best) best = n;
    }
    return best;
  };

  // 回答子树活动观察器：任意 DOM 变更都刷新 lastActivity（仅观察「回答元素」本身，避免侧栏/全页噪声干扰）。
  // 流式输出的元素可能被整段替换，故每轮 ensureObserver() 重新挂到最新的回答元素上。
  let lastActivity = Date.now();
  const obs: { observed: HTMLElement | null; mo: MutationObserver | null } = { observed: null, mo: null };
  const ensureObserver = () => {
    const el = lastAnswerEl();
    if (el && el !== obs.observed) {
      obs.mo?.disconnect();
      obs.observed = el;
      obs.mo = new MutationObserver(() => { lastActivity = Date.now(); });
      obs.mo.observe(el, { childList: true, subtree: true, characterData: true });
    }
  };

  // 1) 若有 stopButton：先等生成真正开始（停止键出现，或回答开始有内容）。
  if (stopButton) {
    // 基线：进入时页面上「上一轮答案」的快照。多轮复用同一标签页（stage2 交叉评审 / stage3 主席）时，
    // 上一轮答案仍在 DOM 中，若用「answerLen()>0」判已开始，会在本轮停止键尚未出现时瞬间为真 → 立刻进入
    // 完成判定 → 把上一轮答案误当本轮结果抽走。故以基线区分：必须**出现停止键**，或出现**新的**答案活动
    //（出现新的答案元素 / 文本长度超过基线），才算本轮生成已开始。
    const baselineEl = lastAnswerEl();
    const baselineLen = answerLen();
    const startDeadline = Date.now() + 25000;
    let started = false;
    while (Date.now() < startDeadline) {
      if (detectCaptcha(adapter)) {
        await waitForCaptchaResolved(adapter, hooks);
        throw new AdapterError('验证码已处理，需要重新发送本轮问题', 'captcha');
      }
      if (isStopVisible() || lastAnswerEl() !== baselineEl || answerLen() > baselineLen) {
        started = true;
        break;
      }
      await delay(300);
    }
    if (started) {
     try {
      while (Date.now() < deadline) {
        if (detectCaptcha(adapter)) {
          await waitForCaptchaResolved(adapter, hooks);
          throw new AdapterError('验证码已处理，需要重新发送本轮问题', 'captcha');
        }
        // 等停止键消失。
        const gone = await waitFor(() => detectCaptcha(adapter) || !isStopVisible(), deadline - Date.now());
        if (detectCaptcha(adapter)) {
          await waitForCaptchaResolved(adapter, hooks);
          throw new AdapterError('验证码已处理，需要重新发送本轮问题', 'captcha');
        }
        if (!gone) throw new AdapterError('生成超时（stop 按钮未消失）', 'timeout');
        // 停止键消失 ≠ 一定完成：可能是「思考→作答」空档，或作答中按钮重渲染的短暂消失，或停止键提前转回发送键（千问）。
        // 真完成判据：停止键持续不再出现，且「回答活动」静默满 GAP_GRACE_MS。
        // 「回答活动」= 文本长度增长 ‖ 回答子树 DOM 变更，二者任一发生都刷新 lastActivity（即「内容还在流逝就没结束」）。
        let lastLen = answerLen();
        ensureObserver();
        lastActivity = Date.now();
        let resumed = false;
        for (;;) {
          if (Date.now() > deadline) throw new AdapterError('生成超时', 'timeout');
          await delay(GRACE_POLL_MS);
          if (detectCaptcha(adapter)) {
            await waitForCaptchaResolved(adapter, hooks);
            throw new AdapterError('验证码已处理，需要重新发送本轮问题', 'captcha');
          }
          if (isStopVisible()) { resumed = true; break; } // 停止键回来了 → 作答阶段/闪烁恢复，回外层重等
          ensureObserver();
          const len = answerLen();
          if (len !== lastLen) { lastLen = len; lastActivity = Date.now(); } // 文本还在长 → 视为有活动
          if (Date.now() - lastActivity >= GAP_GRACE_MS) break; // 两路活动都静默够久 → 完成
        }
        if (resumed) continue;
        // 停止键持续消失且回答两路活动都静默满 GAP_GRACE_MS → 真完成（回答仍空则交给抽取报空）。
        return;
      }
     } finally {
       obs.mo?.disconnect();
     }
      throw new AdapterError('生成超时', 'timeout');
    }
    // 生成始终未开始（停止键没出现、也没有新答案活动）。对配置了 stopButton 的站点，这通常意味着发送被
    // **发送后弹出的验证码/登录态失效**拦住了（豆包实测：发送后弹验证码，生成不启动）。此时**绝不能**落到
    // 静默兜底——那会把 DOM 里残留的「上一轮答案」当本轮结果抽走（基线只防误判完成，挡不住兜底抽取）。
    // 故在此重检验证码/登录，命中则据实报错；否则报超时。统一让 UI 显示失败 + 「重试」，而非呈现陈旧答案。
    obs.mo?.disconnect();
    if (detectCaptcha(adapter)) {
      throw new AdapterError('检测到人机验证，请在该标签页手动通过后点「重试」', 'captcha');
    }
    if (detectLoginWallStrong(adapter) || detectLoginWallByText()) {
      throw new AdapterError('站点需要登录，请在已打开的标签页登录后点「重试」', 'not_logged_in');
    }
    throw new AdapterError('生成始终未开始（可能被验证码/登录拦截或选择器失效），未采用页面残留的旧回答', 'timeout');
  }

  // 2) 静默兜底（仅无 stopButton 的适配器）：assistantMessage 子树连续 idleMutationMs 无变更即视为完成。
  const target = queryFirst(assistantMessage)?.parentElement ?? document.body;
  await waitForIdle(target, idleMutationMs, deadline);
}

function extract(adapter: SiteAdapter): string {
  const nodes = queryElements(adapter.selectors.assistantMessage);
  // 从后往前取「可见且非空」的节点，跳过隐藏模板 / 文件拖放占位等脏节点（如豆包的上传区）。
  for (let i = nodes.length - 1; i >= 0; i--) {
    const el = nodes[i]!;
    if (!isVisible(el)) continue;
    const text = (el.innerText ?? el.textContent ?? '').trim();
    if (text) return text;
  }
  return '';
}

/** 按钮内是否存在 `d` 以 prefix 开头的 `<svg><path>`（用于按图标形状判定收发/停止共用按钮的状态）。 */
function hasIconPrefix(el: HTMLElement, prefix: string): boolean {
  for (const p of el.querySelectorAll<SVGPathElement>('svg path')) {
    if ((p.getAttribute('d') ?? '').startsWith(prefix)) return true;
  }
  return false;
}

/** 元素是否可见（有布局盒）。隐藏/display:none 的模板节点会被排除。 */
function isVisible(el: HTMLElement): boolean {
  return el.offsetParent !== null || el.getClientRects().length > 0;
}

// ---- 选择器解析：同时支持 CSS 与 XPath ----
// 配置里的任一选择器字段都可写 XPath（以 `//`、`(//`、`./`、`(.//` 开头，或 `xpath:` 前缀）。
// 文本匹配（text()='思考'）、按序取第 N 个（(//...)[1]）等 CSS 表达不了的场景，用 XPath 最直接。

/** 判断一个选择器字符串是否为 XPath。 */
function isXPath(selector: string): boolean {
  const s = selector.trimStart();
  return s.startsWith('//') || s.startsWith('(//') || s.startsWith('./') || s.startsWith('(.//') || s.startsWith('xpath:');
}

/** 解析选择器（CSS 或 XPath）为元素数组。XPath 命中文本节点时回退到其父元素。出错返回空数组。 */
function queryElements(selector: string): HTMLElement[] {
  if (isXPath(selector)) {
    const expr = selector.trimStart().replace(/^xpath:/, '');
    try {
      const snap = document.evaluate(expr, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      const out: HTMLElement[] = [];
      for (let i = 0; i < snap.snapshotLength; i++) {
        const node = snap.snapshotItem(i);
        if (node instanceof HTMLElement) out.push(node);
        else if (node?.parentElement) out.push(node.parentElement); // text()/属性节点 → 取其元素
      }
      return out;
    } catch {
      return [];
    }
  }
  try {
    return Array.from(document.querySelectorAll<HTMLElement>(selector));
  } catch {
    return [];
  }
}

/** 解析选择器并返回第一个命中元素（CSS/XPath 通用）。 */
function queryFirst(selector: string): HTMLElement | null {
  return queryElements(selector)[0] ?? null;
}

// ---- 通用等待原语 ----

async function waitForElement(selector: string, timeoutMs: number): Promise<Element | null> {
  const getEl = () => {
    const els = queryElements(selector);
    for (let i = els.length - 1; i >= 0; i--) {
      const e = els[i]!;
      if (isVisible(e)) return e;
    }
    return els.length > 0 ? els[els.length - 1]! : null;
  };

  const found = getEl();
  if (found) return found;
  const ok = await waitFor(() => !!getEl(), timeoutMs);
  return ok ? getEl() : null;
}

/** 轮询条件直到为真或超时。 */
function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (predicate()) return resolve(true);
    const deadline = Date.now() + timeoutMs;
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve(true);
      } else if (Date.now() > deadline) {
        clearInterval(timer);
        resolve(false);
      }
    }, 200);
  });
}

/** 等待目标子树连续静默 idleMs；整体不超过 deadline。 */
function waitForIdle(target: Node, idleMs: number, deadline: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let idleTimer: ReturnType<typeof setTimeout>;
    const observer = new MutationObserver(resetIdle);
    observer.observe(target, { childList: true, subtree: true, characterData: true });

    const hardStop = setInterval(() => {
      if (Date.now() > deadline) {
        cleanup();
        reject(new AdapterError('生成超时（DOM 静默兜底未达成）', 'timeout'));
      }
    }, 500);

    function resetIdle() {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        cleanup();
        resolve();
      }, idleMs);
    }
    function cleanup() {
      observer.disconnect();
      clearTimeout(idleTimer);
      clearInterval(hardStop);
    }
    resetIdle();
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** base ± rand 的随机延迟，制造人类节奏（ADR-0007）。 */
function jitter(base: number, spread: number): number {
  return base + Math.floor(Math.random() * spread);
}
