/**
 * 通用的、由配置数据驱动的适配器运行时（ADR-0005）。
 * 同一份运行时跑所有站点；差异全部来自 SiteAdapter 配置。
 *
 * 一条腿的自动序列（ADR-0007，全自动、无人工确认节点）：
 *   inject → submit → awaitCompletion → extract
 */

import type { SiteAdapter, ThinkingStateCheck } from '../shared/adapter-schema';

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
  /** 发送前确保「深度思考」为开启态（按 adapter.thinkingActivation 步骤，ADR-0009 / Phase 7） */
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

  // 发送前按需开启「深度思考」（ADR-0009 / Phase 7 ADR-0016）。
  if (options.enableThinking) {
    await ensureThinkingOn(adapter);
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
 * 确保「深度思考」处于开启态（Phase 7 / ADR-0016）。
 * 关键：先用 thinkingActive 检测当前是否已开——已开则**跳过点击**，避免站点记忆上次状态时被点关（误关）。
 * 未开（或未配置检测选择器）才按 thinkingActivation 序列逐步点击。
 * 多步站点（豆包/Kimi）后一步元素常要等前一步点击后才出现，故每步「等待→点击→略等」。
 * 未校准或某步失败都不阻断主流程（尽力而为，仍继续发送）。
 */
async function ensureThinkingOn(adapter: SiteAdapter): Promise<void> {
  const state = adapter.thinkingState;
  if (state && isThinkingOn(state)) return; // 已开，避免误关

  const steps = adapter.thinkingActivation;
  if (!steps?.length) return;
  for (const selector of steps) {
    const step = await waitForElement(selector, 4000);
    if (!step) break; // 某步元素没出现：放弃后续步骤，但仍继续发送。
    robustClick(step as HTMLElement);
    await delay(jitter(350, 250));
    // 若每步点击后即可判定「已开」，提前结束剩余步骤，进一步降低误操作概率。
    if (state && isThinkingOn(state)) return;
  }
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
  const sel = adapter.auth?.captchaSelector;
  if (sel && queryFirst(sel)) return true;
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
 * 关键 1：每次尝试前**先清空**编辑器、尝试后**异步校验**。编辑器对 paste/exec 的写入常是异步生效。
 * 关键 2：校验「内容是否注入到**接近完整**」而非仅「非空」。长多行文本（如交叉评审 prompt）+ 多标签
 *   并行争用时，编辑器可能只先插入了第一行；若此时就判成功并发送，会只发出第一行（Gemini 阶段二实测）。
 *   故按「非空白字符数 ≥ 目标 90%」轮询等待，直到接近完整或超时，再返回；既避免发半句，也避免重复注入。
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
  // 逐行注入：execCommand insertText 遇 \n 会停在第一行（实测 Gemini 只进首行 → 只发首句）。
  // 故按行 insertText、行间 insertParagraph，逐行喂入，规避「整段含换行只进第一行」。
  // 必须 async 且**行间留拍**：密集同步 execCommand 会让 Gemini（Quill/Angular）渲染卡死；
  // 加 40ms 间隔后实测注入完整、发送键点亮（2026-06-04 Claude-in-Chrome 验证）。
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

  // 含换行的长文本优先走逐行注入；preferPaste 站点仍先试 paste（Kimi 等只认 paste）。
  const attempts = preferPaste
    ? [tryPaste, tryExecLines, tryExec, trySetText]
    : [tryExecLines, tryExec, tryPaste, trySetText];
  for (const attempt of attempts) {
    clearEditor();
    await attempt(); // tryExecLines 为 async（行间留拍）；其余同步，await 无副作用
    if (await waitForInjected(el, text, 4000)) return; // 等注入到接近完整再返回（命中即停）
  }
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

  if (adapter.input.submit === 'clickButton') {
    if (btn) {
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
  const { idleMutationMs, maxWaitMs, stopButtonIconPrefix } = adapter.completion;
  const deadline = Date.now() + maxWaitMs;

  // 1) 若有 stopButton：先等它出现（确认已开始生成），再等它消失。
  if (stopButton) {
    const getVisibleStopBtn = () => {
      for (const el of queryElements(stopButton)) {
        // 过滤掉 display: none 或隐藏的无关按钮
        if (el.offsetWidth <= 0 || el.offsetHeight <= 0) continue;
        // 发送/停止共用同一按钮的站点（如 DeepSeek）：仅当内部 SVG 图标是「停止」形状才算生成中。
        // 否则该圆形按钮在「发送箭头」态也会命中，导致刚提交就误判完成→截断。
        if (stopButtonIconPrefix && !hasIconPrefix(el, stopButtonIconPrefix)) continue;
        return el;
      }
      return null;
    };

    const appeared = await waitFor(() => !!getVisibleStopBtn(), 25000);
    if (appeared) {
      const gone = await waitFor(() => !getVisibleStopBtn(), maxWaitMs);
      if (!gone) throw new AdapterError('生成超时（stop 按钮未消失）', 'timeout');
      return;
    }
    // stopButton 没等到——可能选择器失效或生成极快，落到静默兜底。
  }

  // 2) 静默兜底：assistantMessage 子树连续 idleMutationMs 无变更即视为完成。
  const target = queryFirst(adapter.selectors.assistantMessage)?.parentElement ?? document.body;
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
