/**
 * 站点适配器配置 schema（TS 类型）。
 * 唯一真理源：docs/adr/0005-remote-adapter-config.md。
 *
 * 配置只描述「选择器与策略」，绝不下发任意可执行代码（ADR-0005 安全约束）。
 * Phase 1 仅使用扩展内置的本地兜底配置；远程拉取与热更新是 Phase 2。
 */

export type InputMethod = 'paste' | 'execCommandInsertText' | 'setNativeValue';
export type SubmitMethod = 'clickButton' | 'enterKey';
export type CompletionSignal = 'stopButtonDisappears' | 'streamingIndicatorGone';
export type ExtractionScope = 'lastAssistantMessage';
export type ExtractionFormat = 'markdown' | 'text' | 'html';

export interface AdapterSelectors {
  /** 输入框（注意多为 contenteditable / ProseMirror，也可能是 textarea） */
  inputBox: string;
  sendButton: string;
  /** 生成中出现、完成后消失——完成信号主依据 */
  stopButton?: string;
  /** 每条助手回答容器 */
  assistantMessage: string;
  /** 可选：流式光标 / 生成标记 */
  streamingIndicator?: string;
}

/**
 * 用户可视化校准（ADR-0009）里可被点选的「单元素角色」。
 * 与 AdapterSelectors 的单一选择器字段一一对应。
 * 注：深度思考开启可能需要多步点击，单独用 `thinkingActivation`（有序数组）表达，不在此列；
 *     「思考是否已开」的判定需区分同一按钮的两态差异，单独用 `thinkingState`（定位选择器 + 判别式），亦不在此列。
 */
export type PickRole = 'inputBox' | 'sendButton' | 'stopButton' | 'assistantMessage';

/** 各可点选角色的中文名（用于校准 UI 引导文案）。 */
export const PICK_ROLE_LABELS: Record<PickRole, string> = {
  inputBox: '输入框',
  sendButton: '发送按钮',
  assistantMessage: '回答区',
  stopButton: '停止按钮',
};

/**
 * 「深度思考已开」的判别式（Phase 7 / ADR-0016）。
 * 很多站点的思考开/关是**同一个按钮、同一条 DOM 路径**，区别只在 属性值 / class / 文本 / 背景色 等；
 * 单凭「选择器能否命中」无法区分两态。故由校准时「关→开」两态快照自动 diff 出**真正变化的那一项**作为判别式。
 */
export type ThinkingDiscriminator =
  /** 某属性变为该值（如 aria-pressed="true"、data-state="active"）——最稳 */
  | { kind: 'attr'; name: string; value: string }
  /** 开启时多出的 class（如 active / selected） */
  | { kind: 'class'; value: string }
  /** 文本包含该子串（如「已开启」） */
  | { kind: 'text'; contains: string }
  /** 计算样式某属性等于该值（如 background-color: rgb(...)）——专治「只有背景色变」 */
  | { kind: 'style'; prop: string; value: string }
  /**
   * 元素「存在且可见」即视为已开（presence）——专治「关态页面无任何指示物、开态才出现某元素」
   * 的站点（如 ChatGPT：思考关闭时输入框下方什么都没有，开启后才出现思考 chip）。
   * 此判别由两态 diff 推不出（关态无元素可点选），需在配置里直接指定一个仅开启态才命中的选择器。
   */
  | { kind: 'present' };

export interface ThinkingStateCheck {
  /** 定位「思考开关」元素的稳健选择器（取自校准的「关」态，两态都能命中） */
  selector: string;
  /** 判定「已开」的判别式（由两态差异自动推导） */
  on: ThinkingDiscriminator;
}

export interface AdapterInput {
  method: InputMethod;
  submit: SubmitMethod;
}

export interface AdapterCompletion {
  primarySignal: CompletionSignal;
  /** DOM 静默判完成的兜底阈值（毫秒） */
  idleMutationMs: number;
  /** 单腿超时（毫秒） */
  maxWaitMs: number;
  /**
   * 可选：部分站点的「发送」与「停止」共用同一个按钮（DeepSeek 输入框右下角的圆形按钮），
   * 类名/aria 在两种状态下完全相同，唯一区别是按钮内 SVG 图标的形状。
   * 此处填「生成中（停止图标）」时按钮内 `<svg><path>` 的 `d` 属性前缀；
   * 仅当 `stopButton` 命中的元素其图标 `d` 以此前缀开头，才算「正在生成」。
   * 留空则按常规逻辑（stopButton 命中即视为生成中）。纯数据，可远程热更新（ADR-0005）。
   */
  stopButtonIconPrefix?: string;
}

export interface AdapterExtraction {
  scope: ExtractionScope;
  format: ExtractionFormat;
}

export interface AdapterAuth {
  /** 命中则判定未登录，触发降级提示 */
  loggedOutSelector?: string;
  /** 命中则判定出现了人机验证（验证码/滑块），需把标签页切前台让用户手动通过 */
  captchaSelector?: string;
}

export interface SiteAdapter {
  id: string;
  displayName: string;
  /** 单站点配置版本，便于灰度与回滚 */
  version: number;
  matches: string[];
  newChatUrl: string;
  selectors: AdapterSelectors;
  input: AdapterInput;
  /**
   * 可选：开启「深度思考」所需的有序点击步骤（ADR-0009）。
   * 单步站点长度为 1（点一下即开）；多步站点按序点击，如：
   *   - 豆包：先点「深度思考」入口按钮，再点弹出的「思考」选项（2 步）；
   *   - Kimi：先点模型切换，再选「K2.6 思考」（2 步）。
   * 运行时按序「等待元素出现 → 点击 → 略等」，发送前执行（仅当用户勾选了深度思考）。
   */
  thinkingActivation?: string[];
  /**
   * 可选：「深度思考是否已开」的判定（Phase 7 / ADR-0016）。
   * 发送前据此检测：已开则跳过 thinkingActivation 点击（杜绝误关），未开才点。
   * 由校准时「关→开」两态差异自动推导，覆盖 属性/class/文本/背景色 四类区别。留空则退化为每次都点。
   */
  thinkingState?: ThinkingStateCheck;
  completion: AdapterCompletion;
  extraction: AdapterExtraction;
  auth?: AdapterAuth;
}

export interface AdapterConfig {
  schemaVersion: 1;
  adapters: SiteAdapter[];
}

/** 用当前页面 URL 在配置中匹配出对应站点适配器。 */
export function matchAdapter(config: AdapterConfig, url: string): SiteAdapter | undefined {
  return config.adapters.find((a) => a.matches.some((pattern) => matchesPattern(pattern, url)));
}

/** 极简的 chrome match-pattern 判断（仅支持 `*` 通配，足够 Phase 1）。 */
function matchesPattern(pattern: string, url: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(url);
}
