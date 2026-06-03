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
 * 注：深度思考开启可能需要多步点击，单独用 `thinkingActivation`（有序数组）表达，不在此列。
 */
export type PickRole = 'inputBox' | 'sendButton' | 'stopButton' | 'assistantMessage';

/** 各可点选角色的中文名（用于校准 UI 引导文案）。 */
export const PICK_ROLE_LABELS: Record<PickRole, string> = {
  inputBox: '输入框',
  sendButton: '发送按钮',
  assistantMessage: '回答区',
  stopButton: '停止按钮',
};

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
