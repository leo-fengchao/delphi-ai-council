/**
 * 页面内拾取器（ADR-0009）——运行于 content script 上下文。
 *
 * 开启后高亮鼠标悬停的元素，用户点选目标后：
 *   1) 拦截这次点击（不让站点本身响应）；
 *   2) 为选中元素生成「稳健选择器」并返回。
 * 按 Esc 取消。
 *
 * 稳健选择器策略：优先 id（排除动态哈希）→ data-* 等稳定属性 → 结构化短路径（tag + 语义类 /
 * nth-of-type）。回答区（generalize=true）走「语义类」优先，使其能匹配未来每一条回答而非锁死一条。
 */

const HIGHLIGHT_ID = 'delphi-pick-highlight';
const BANNER_ID = 'delphi-pick-banner';

export interface PickOutcome {
  ok: boolean;
  selector?: string;
  error?: string;
}

/**
 * 拾取目标的「种类」，决定如何把用户点中的元素归一化、以及生成何种选择器：
 * - 'clickable'：发送/停止/思考开关等——上溯到真正可点击的元素（按钮/链接/菜单项），
 *   避免锁死到内层图标/焦点层/触摸层这类点了没用的覆盖元素。
 * - 'editable'：输入框——归一化到真正的 textarea / contenteditable / role=textbox。
 * - 'content'：回答区——上溯到带语义类的回复容器，生成可匹配未来每条回答的泛化选择器。
 */
export type PickKind = 'clickable' | 'editable' | 'content';

export interface PickOptions {
  /** 引导文案里的角色名 */
  label: string;
  /** 拾取目标种类（决定归一化与选择器策略） */
  kind: PickKind;
}

/** 进入拾取模式，等待用户点选一个元素；返回稳健选择器。Esc 取消。 */
export function pickElement(opts: PickOptions): Promise<PickOutcome> {
  const { label, kind } = opts;
  return new Promise((resolve) => {
    const highlight = createHighlight();
    const banner = createBanner(`请点击该站点的「${label}」　（Esc 取消）`);
    document.body.appendChild(highlight);
    document.body.appendChild(banner);

    let current: Element | null = null;

    const onMove = (e: MouseEvent) => {
      const el = elementUnder(e, highlight, banner);
      current = el;
      if (el) positionHighlight(highlight, el);
    };

    const onClick = (e: MouseEvent) => {
      const el = elementUnder(e, highlight, banner) ?? current;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!el) return;
      cleanup();
      const selector = buildRobustSelector(el, kind);
      resolve(selector ? { ok: true, selector } : { ok: false, error: '无法为该元素生成选择器，请换一个更具体的元素' });
    };

    const swallow = (e: Event) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        cleanup();
        resolve({ ok: false, error: '已取消校准' });
      }
    };

    function cleanup() {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('mousedown', swallow, true);
      document.removeEventListener('pointerdown', swallow, true);
      document.removeEventListener('keydown', onKey, true);
      highlight.remove();
      banner.remove();
    }

    // 全程 capture 阶段，抢在站点自身处理之前拦截。
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('mousedown', swallow, true);
    document.addEventListener('pointerdown', swallow, true);
    document.addEventListener('keydown', onKey, true);
  });
}

export interface SequenceOutcome {
  ok: boolean;
  selectors?: string[];
  error?: string;
}

/**
 * 序列录制（多步深度思考开启）。
 * 在站点页内连续点选多步：每点一步即生成选择器并**真点击**该元素（弹出下一级菜单），
 * 焦点全程不离开页面 —— 这样像 Gemini「失焦即关闭」的弹窗也不会消失。
 * 页内浮层提供「完成 / 取消」按钮；点「完成」返回有序 selectors 数组。
 */
export function pickSequence(label: string): Promise<SequenceOutcome> {
  return new Promise((resolve) => {
    const highlight = createHighlight();
    const panel = createSeqPanel(label);
    document.body.appendChild(highlight);
    document.body.appendChild(panel.root);

    const selectors: string[] = [];
    let current: Element | null = null;

    const onMove = (e: MouseEvent) => {
      const el = elementUnder(e, highlight, panel.root);
      current = el;
      if (el) positionHighlight(highlight, el);
    };

    // 关键：序列模式**不拦截**普通点击——让你的真实 trusted 点击照常作用于站点，
    // 站点据此弹出下一级菜单（合成点击会被部分框架当不可信而忽略）。只拦浮层控制按钮。
    const onClick = (e: MouseEvent) => {
      const path = e.composedPath();
      if (path.includes(panel.doneBtn)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return finish(true);
      }
      if (path.includes(panel.cancelBtn)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return finish(false);
      }
      // 浮层/高亮自身的点击忽略，不记录。
      const el = (e.target as Element | null) ?? current;
      if (!el || el === highlight || panel.root.contains(el)) return;
      const sel = buildRobustSelector(el, 'clickable');
      if (sel) {
        selectors.push(sel);
        panel.update(selectors.length, sel);
      }
      // 不 preventDefault：真实点击继续传播，站点弹出下一级菜单。
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        finish(selectors.length > 0); // Esc 也保存已录的步骤
      }
    };

    function finish(ok: boolean) {
      cleanup();
      resolve(ok ? { ok: true, selectors } : { ok: false, error: '已取消录制' });
    }
    function cleanup() {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      highlight.remove();
      panel.root.remove();
    }

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
  });
}

/** 取当前光标下、且不是拾取器自身覆盖层的元素。 */
function elementUnder(e: MouseEvent, ...ignore: Element[]): Element | null {
  const stack = document.elementsFromPoint(e.clientX, e.clientY);
  for (const el of stack) {
    if (!ignore.includes(el) && el !== document.documentElement && el !== document.body) return el;
  }
  return null;
}

function createHighlight(): HTMLElement {
  const el = document.createElement('div');
  el.id = HIGHLIGHT_ID;
  Object.assign(el.style, {
    position: 'fixed',
    zIndex: '2147483647',
    pointerEvents: 'none',
    border: '2px solid #2b6cff',
    background: 'rgba(43,108,255,0.12)',
    borderRadius: '4px',
    transition: 'all 40ms ease-out',
  } satisfies Partial<CSSStyleDeclaration>);
  return el;
}

function createBanner(text: string): HTMLElement {
  const el = document.createElement('div');
  el.id = BANNER_ID;
  el.textContent = text;
  Object.assign(el.style, {
    position: 'fixed',
    zIndex: '2147483647',
    left: '50%',
    top: '16px',
    transform: 'translateX(-50%)',
    pointerEvents: 'none',
    background: '#1a1a1a',
    color: '#fff',
    padding: '8px 16px',
    borderRadius: '999px',
    fontSize: '14px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
  } satisfies Partial<CSSStyleDeclaration>);
  return el;
}

interface SeqPanel {
  root: HTMLElement;
  doneBtn: HTMLElement;
  cancelBtn: HTMLElement;
  update: (count: number, lastSel: string) => void;
}

/** 序列录制的页内浮层：提示 + 已录步数 + 完成/取消按钮（按钮可点击）。 */
function createSeqPanel(label: string): SeqPanel {
  const root = document.createElement('div');
  Object.assign(root.style, {
    position: 'fixed',
    zIndex: '2147483647',
    left: '50%',
    top: '16px',
    transform: 'translateX(-50%)',
    background: '#1a1a1a',
    color: '#fff',
    padding: '10px 14px',
    borderRadius: '10px',
    fontSize: '13px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
    maxWidth: '90vw',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  } satisfies Partial<CSSStyleDeclaration>);

  const info = document.createElement('span');
  info.textContent = `录制「${label}」：依次点击各步（已录 0 步）`;

  const doneBtn = mkBtn('完成', '#2b6cff');
  const cancelBtn = mkBtn('取消', '#555');
  root.append(info, doneBtn, cancelBtn);

  return {
    root,
    doneBtn,
    cancelBtn,
    update: (count, lastSel) => {
      info.textContent = `录制「${label}」：已录 ${count} 步（最近：${truncate(lastSel, 40)}）`;
    },
  };
}

function mkBtn(text: string, bg: string): HTMLElement {
  const b = document.createElement('button');
  b.textContent = text;
  Object.assign(b.style, {
    pointerEvents: 'auto',
    background: bg,
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    padding: '5px 12px',
    fontSize: '13px',
    cursor: 'pointer',
  } satisfies Partial<CSSStyleDeclaration>);
  return b;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function positionHighlight(box: HTMLElement, el: Element): void {
  const r = el.getBoundingClientRect();
  Object.assign(box.style, {
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
  });
}

// ---- 稳健选择器生成 ----

// 不同种类的属性优先级（越靠前越稳）。
const ATTRS_CLICKABLE = ['data-testid', 'data-test-id', 'data-test', 'data-qa', 'aria-label', 'name', 'type', 'role'];
const ATTRS_EDITABLE = ['data-testid', 'name', 'aria-label', 'placeholder', 'role'];
const ATTRS_CONTENT = ['data-testid', 'data-message-author-role', 'data-role'];

/**
 * 为用户点中的元素生成稳健选择器。
 * 第一步先按 kind **归一化目标**（这是鲁棒性的关键）：把点到的内层图标/焦点层/触摸层
 * 归一到真正可点击/可编辑/有语义的元素，再生成选择器。
 */
export function buildRobustSelector(el: Element, kind: PickKind): string | null {
  const target = normalizeTarget(el, kind);

  // 回答区：优先「语义类」以匹配未来每条回答（向上爬找带语义类的容器），而非锁死当前这条。
  if (kind === 'content') {
    let node: Element | null = target;
    for (let depth = 0; node && depth < 7; depth++, node = node.parentElement) {
      const cls = bestSemanticClass(node);
      if (cls) {
        const s = `.${cssEscape(cls)}`;
        if (document.querySelector(s)) return s;
      }
    }
  }

  return idSelector(target) ?? attrSelector(target, kind) ?? pathSelector(target);
}

/** 把用户点中的元素归一化到「真正有意义」的元素（鲁棒性关键）。 */
function normalizeTarget(el: Element, kind: PickKind): Element {
  if (kind === 'clickable') return nearestActionable(el) ?? el;
  if (kind === 'editable') return nearestEditable(el) ?? el;
  return el;
}

/** 上溯最近的「真正可点击」元素：按钮 / 链接 / 菜单项 / web component 按钮。 */
function nearestActionable(el: Element): Element | null {
  let node: Element | null = el;
  for (let i = 0; node && i < 6; i++, node = node.parentElement) {
    if (isActionable(node)) return node;
  }
  return null;
}

function isActionable(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === 'button' || tag === 'a' || tag === 'summary') return true;
  const role = el.getAttribute('role');
  if (role && ['button', 'menuitem', 'option', 'tab', 'link', 'switch', 'checkbox'].includes(role)) return true;
  if (el.hasAttribute('onclick')) return true;
  // 自定义元素充当按钮（含连字符的标签 + 语义类/标签名暗示可点）。
  if (tag.includes('-') && /(button|btn|menu-?item|option|switch|toggle|chip|tab)/.test(`${tag} ${el.className}`)) {
    return true;
  }
  return false;
}

/** 归一化到真正可编辑的元素：上溯或下钻到 textarea / contenteditable / role=textbox。 */
function nearestEditable(el: Element): Element | null {
  let node: Element | null = el;
  for (let i = 0; node && i < 5; i++, node = node.parentElement) {
    if (isEditable(node)) return node;
  }
  // 用户点到的是输入框外壳：在其内部找真正可编辑节点。
  return el.querySelector?.('textarea, input:not([type="hidden"]), [contenteditable="true"], [contenteditable=""], [role="textbox"]') ?? null;
}

function isEditable(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'input') return true;
  const ce = el.getAttribute('contenteditable');
  if (ce === 'true' || ce === '') return true;
  return el.getAttribute('role') === 'textbox';
}

function idSelector(el: Element): string | null {
  if (el.id && isStableToken(el.id)) {
    const sel = `#${cssEscape(el.id)}`;
    if (isUnique(sel, el)) return sel;
  }
  return null;
}

function attrSelector(el: Element, kind: PickKind): string | null {
  const attrs = kind === 'editable' ? ATTRS_EDITABLE : kind === 'content' ? ATTRS_CONTENT : ATTRS_CLICKABLE;
  const tag = el.tagName.toLowerCase();
  for (const attr of attrs) {
    const v = el.getAttribute(attr);
    if (v && v.length <= 50) {
      const sel = `${tag}[${attr}="${escapeAttrValue(v)}"]`;
      // clickable/editable 要求唯一；content 允许匹配多个（同类回答）。
      if (kind === 'content' ? document.querySelector(sel) != null : isUnique(sel, el)) return sel;
    }
  }
  return null;
}

/** 结构化短路径：自下而上拼 tag + 语义类 / nth-of-type，直到唯一或到达上限。 */
function pathSelector(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node.nodeType === 1 && node !== document.body && parts.length < 5) {
    let part = node.tagName.toLowerCase();
    const cls = bestSemanticClass(node);
    if (cls) {
      part += `.${cssEscape(cls)}`;
    } else {
      const idx = nthOfType(node);
      if (idx > 0) part += `:nth-of-type(${idx})`;
    }
    parts.unshift(part);
    const sel = parts.join(' > ');
    if (isUnique(sel, el)) return sel;
    node = node.parentElement;
  }
  return parts.join(' > ');
}

// Tailwind / 原子化工具类的常见首段前缀（如 w-full、flex-col、items-center、overflow-hidden）。
// 这些类不具语义、跨元素大量重复，绝不能用作回答区选择器。
const UTILITY_PREFIXES = new Set([
  'w', 'h', 'min', 'max', 'p', 'px', 'py', 'pt', 'pb', 'pl', 'pr', 'm', 'mx', 'my', 'mt', 'mb',
  'ml', 'mr', 'gap', 'space', 'text', 'bg', 'border', 'rounded', 'flex', 'grid', 'col', 'row',
  'items', 'justify', 'self', 'place', 'order', 'z', 'top', 'left', 'right', 'bottom', 'inset',
  'opacity', 'shadow', 'font', 'leading', 'tracking', 'overflow', 'cursor', 'select', 'transition',
  'duration', 'ease', 'delay', 'animate', 'translate', 'scale', 'rotate', 'skew', 'origin', 'object',
  'aspect', 'basis', 'grow', 'shrink', 'whitespace', 'break', 'truncate', 'sr', 'pointer', 'inline',
  'block', 'align', 'vertical', 'float', 'clear', 'table', 'list', 'divide', 'ring', 'from', 'to',
  'via', 'fill', 'stroke', 'backdrop', 'blur', 'brightness', 'contrast', 'saturate', 'will', 'box',
  'hidden', 'relative', 'absolute', 'fixed', 'sticky', 'static', 'visible', 'invisible', 'container',
]);

/** 在元素的 class 里挑一个「语义化、非动态、非工具类」的类名。 */
function bestSemanticClass(el: Element): string | null {
  const classes = Array.from(el.classList);
  // 语义类：纯小写字母 + 连字符，长度 3~30，且首段不是工具类前缀。
  const semantic = classes.filter((c) => {
    if (!/^[a-z][a-z-]{2,29}$/.test(c) || !c.includes('-')) return false;
    const first = c.split('-')[0]!;
    return !UTILITY_PREFIXES.has(first);
  });
  // 偏好含 message/markdown/answer 等语义词的类。
  const keywords = /(message|markdown|answer|reply|response|bubble|content|segment|chat|input|send|editor|prompt|stop)/;
  semantic.sort((a, b) => Number(keywords.test(b)) - Number(keywords.test(a)));
  return semantic[0] ?? null;
}

function nthOfType(el: Element): number {
  const parent = el.parentElement;
  if (!parent) return 0;
  const same = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
  return same.length > 1 ? same.indexOf(el) + 1 : 0;
}

/** id / token 是否「稳定」：排除明显的随机哈希、长数字串、Emotion/React 动态前缀。 */
function isStableToken(token: string): boolean {
  if (token.length > 40) return false;
  if (/\d{4,}/.test(token)) return false; // 长数字串多为运行时生成
  if (/[0-9a-f]{12,}/i.test(token)) return false; // 十六进制哈希
  if (token.includes(':')) return false; // Emotion 等
  return /^[A-Za-z][\w-]*$/.test(token);
}

function isUnique(selector: string, el: Element): boolean {
  try {
    const nodes = document.querySelectorAll(selector);
    return nodes.length === 1 && nodes[0] === el;
  } catch {
    return false;
  }
}

function cssEscape(s: string): string {
  const cssApi = (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS;
  return cssApi?.escape ? cssApi.escape(s) : s.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
}

function escapeAttrValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
