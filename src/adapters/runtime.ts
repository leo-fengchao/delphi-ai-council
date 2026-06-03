/**
 * 通用的、由配置数据驱动的适配器运行时（ADR-0005）。
 * 同一份运行时跑所有站点；差异全部来自 SiteAdapter 配置。
 *
 * 一条腿的自动序列（ADR-0007，全自动、无人工确认节点）：
 *   inject → submit → awaitCompletion → extract
 */

import type { SiteAdapter } from '../shared/adapter-schema';

export class AdapterError extends Error {
  constructor(
    message: string,
    readonly code: 'not_logged_in' | 'captcha' | 'input_not_found' | 'timeout' | 'extraction_empty',
  ) {
    super(message);
    this.name = 'AdapterError';
  }
}

export interface RunHooks {
  onStage?: (stage: 'injecting' | 'submitted' | 'awaiting' | 'extracting') => void;
}

export interface RunOptions {
  /** 发送前点击「深度思考」开关（需 adapter.selectors.thinkingToggle，ADR-0009） */
  enableThinking?: boolean;
}

/** 在当前页面（content script 上下文）就一个 prompt 走完单腿。返回抽取到的文本。 */
export async function runAdapter(
  adapter: SiteAdapter,
  prompt: string,
  hooks: RunHooks = {},
  options: RunOptions = {},
): Promise<string> {
  // 进站即检测人机验证（验证码/滑块）：命中就让用户去手动通过，别白跑。
  if (detectCaptcha(adapter)) {
    throw new AdapterError('检测到人机验证，请在该标签页手动通过后点「重试」', 'captcha');
  }
  // 进站即用「强信号」快速判一次登录墙（密码框 / 登录链接），避免白等 10 秒。
  // 强信号不会在已登录的聊天页误命中。
  if (detectLoginWallStrong(adapter)) {
    throw new AdapterError('站点需要登录，请在已打开的标签页登录后点「重试」', 'not_logged_in');
  }

  hooks.onStage?.('injecting');

  // 发送前按需开启「深度思考」（ADR-0009）：按序逐步点击。
  // 多步站点（豆包/Kimi）后一步的元素往往要等前一步点击后才出现，故每步都「等待→点击→略等」。
  // 未校准或某步失败都不阻断主流程。
  if (options.enableThinking && adapter.thinkingActivation?.length) {
    for (const selector of adapter.thinkingActivation) {
      const step = await waitForElement(selector, 4000);
      if (!step) break; // 某步元素没出现：放弃后续步骤，但仍继续发送。
      robustClick(step as HTMLElement);
      await delay(jitter(350, 250));
    }
  }

  const input = await waitForElement(adapter.selectors.inputBox, 10000);
  if (!input) {
    // 找不到输入框：先看是不是被验证码挡住，再叠加登录墙启发式（此时已无输入框，误判风险低）。
    if (detectCaptcha(adapter)) {
      throw new AdapterError('检测到人机验证，请在该标签页手动通过后点「重试」', 'captcha');
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
  await awaitCompletion(adapter);

  hooks.onStage?.('extracting');
  const text = extract(adapter);
  if (!text.trim()) {
    throw new AdapterError('抽取到的回答为空（抽取选择器可能已失效）', 'extraction_empty');
  }
  return text;
}

/**
 * 人机验证（验证码/滑块）检测：
 * 1) 配置了 captchaSelector 且命中；2) 常见验证码 iframe / 通用文案兜底。
 * 仅用强信号，避免误命中正常页面。
 */
function detectCaptcha(adapter: SiteAdapter): boolean {
  const sel = adapter.auth?.captchaSelector;
  if (sel && document.querySelector(sel)) return true;
  // 常见验证码服务的 iframe（极验 / 腾讯防水墙 / Cloudflare Turnstile / hCaptcha / reCAPTCHA）。
  const captchaIframe =
    'iframe[src*="geetest"], iframe[src*="captcha"], iframe[src*="turnstile"],' +
    'iframe[src*="hcaptcha"], iframe[src*="recaptcha"], iframe[title*="验证"]';
  if (document.querySelector(captchaIframe)) return true;
  return false;
}

/**
 * 强信号登录墙判定（不会在已登录页误命中）：
 * 1) 配置的 loggedOutSelector 命中；2) 页面存在密码输入框。
 */
function detectLoginWallStrong(adapter: SiteAdapter): boolean {
  const sel = adapter.auth?.loggedOutSelector;
  if (sel && document.querySelector(sel)) return true;
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
    await injectContentEditable(editable, prompt, adapter.input.method === 'paste');
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
 * 关键：每次尝试前**先清空**编辑器、尝试后**异步等一拍再判定**。
 * 编辑器对 paste/exec 的写入常是异步生效，若同步判定会误以为失败而继续下一种方法，
 * 导致同一段文本被注入多次（如 Kimi 输入 3 次）。清空 + 异步校验可确保命中即停、只注入一次。
 */
async function injectContentEditable(el: HTMLElement, text: string, preferPaste: boolean): Promise<void> {
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
  const trySetText = () => {
    el.textContent = text;
    el.dispatchEvent(
      new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }),
    );
  };

  const attempts = preferPaste ? [tryPaste, tryExec, trySetText] : [tryExec, tryPaste, trySetText];
  for (const attempt of attempts) {
    clearEditor();
    attempt();
    await delay(200); // 等异步写入生效再判定，避免重复注入
    if ((el.textContent ?? '').trim() !== '') return;
  }
}

async function submit(input: Element, adapter: SiteAdapter): Promise<void> {
  // 全自动发送前加入随机化的人类节奏延迟（ADR-0007 缓解措施）。
  await delay(jitter(400, 250));

  if (adapter.input.submit === 'clickButton') {
    const btn = document.querySelector<HTMLElement>(adapter.selectors.sendButton);
    if (btn && !isDisabled(btn)) {
      robustClick(btn);
      return;
    }
    // 找不到/不可用按钮时退化为回车，避免整腿卡死。
  }
  pressEnter(input);
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
async function awaitCompletion(adapter: SiteAdapter): Promise<void> {
  const { stopButton } = adapter.selectors;
  const { idleMutationMs, maxWaitMs } = adapter.completion;
  const deadline = Date.now() + maxWaitMs;

  // 1) 若有 stopButton：先等它出现（确认已开始生成），再等它消失。
  if (stopButton) {
    const appeared = await waitFor(() => !!document.querySelector(stopButton), 8000);
    if (appeared) {
      const gone = await waitFor(() => !document.querySelector(stopButton), maxWaitMs);
      if (!gone) throw new AdapterError('生成超时（stop 按钮未消失）', 'timeout');
      return;
    }
    // stopButton 没等到——可能选择器失效或生成极快，落到静默兜底。
  }

  // 2) 静默兜底：assistantMessage 子树连续 idleMutationMs 无变更即视为完成。
  const target = document.querySelector(adapter.selectors.assistantMessage)?.parentElement ?? document.body;
  await waitForIdle(target, idleMutationMs, deadline);
}

function extract(adapter: SiteAdapter): string {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>(adapter.selectors.assistantMessage));
  // 从后往前取「可见且非空」的节点，跳过隐藏模板 / 文件拖放占位等脏节点（如豆包的上传区）。
  for (let i = nodes.length - 1; i >= 0; i--) {
    const el = nodes[i]!;
    if (!isVisible(el)) continue;
    const text = (el.innerText ?? el.textContent ?? '').trim();
    if (text) return text;
  }
  return '';
}

/** 元素是否可见（有布局盒）。隐藏/display:none 的模板节点会被排除。 */
function isVisible(el: HTMLElement): boolean {
  return el.offsetParent !== null || el.getClientRects().length > 0;
}

// ---- 通用等待原语 ----

async function waitForElement(selector: string, timeoutMs: number): Promise<Element | null> {
  const found = document.querySelector(selector);
  if (found) return found;
  const ok = await waitFor(() => !!document.querySelector(selector), timeoutMs);
  return ok ? document.querySelector(selector) : null;
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
