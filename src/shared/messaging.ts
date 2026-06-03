/**
 * Council Page ⇄ Content Script 的消息协议。
 *
 * Phase 1 使用 chrome.tabs.sendMessage / chrome.runtime.sendMessage 的请求-响应模型，
 * 足以打通单站点闭环。长连接 port + 流式进度是后续阶段（配合 XState 编排，Phase 3）的事。
 */

import type { ExtractionFormat } from './adapter-schema';

/** content script 注入完成、监听器就绪后，向扩展广播。 */
export interface ReadyMessage {
  type: 'DELPHI_READY';
  adapterId: string;
}

/** Council Page → content script：让该站点就一个 prompt 作答。 */
export interface AskMessage {
  type: 'DELPHI_ASK';
  prompt: string;
  /** 可选：发送前点击「深度思考」开关（需该站点已校准 thinkingToggle，ADR-0009） */
  enableThinking?: boolean;
}

/** content script → Council Page：阶段性进度（可选，用于流式状态 UI）。 */
export interface ProgressMessage {
  type: 'DELPHI_PROGRESS';
  adapterId: string;
  stage: 'injecting' | 'submitted' | 'awaiting' | 'extracting';
}

/** 失败分类码，便于前台精准分支（如未登录走专门的登录提示）。 */
export type FailureCode =
  | 'not_logged_in'
  | 'captcha'
  | 'input_not_found'
  | 'timeout'
  | 'extraction_empty'
  | 'unknown';

/** content script → Council Page：本腿最终结果。 */
export interface ResultMessage {
  type: 'DELPHI_RESULT';
  adapterId: string;
  ok: boolean;
  /** ok 时为抽取到的回答文本 */
  text?: string;
  format?: ExtractionFormat;
  /** !ok 时的失败原因（未登录 / 超时 / 选择器未命中等） */
  error?: string;
  /** !ok 时的分类码 */
  code?: FailureCode;
}

/**
 * Council Page → content script：就绪探测。
 * content script 一挂载即可应答，故用「轮询 ping」判就绪，避免 DELPHI_READY 单次广播
 * 早于监听器到达而错过（导致误判超时，尤其是恢复/重开的标签页）。
 */
export interface PingMessage {
  type: 'DELPHI_PING';
}

export interface PingResponse {
  ready: boolean;
}

/** Council Page → content script：在该站点页注入页内校准工具条（ADR-0009）。 */
export interface CalibrateMessage {
  type: 'DELPHI_CALIBRATE';
}

/** content script → Council Page：用户在页内点了「完成校准」。 */
export interface CalibrateDoneMessage {
  type: 'DELPHI_CALIBRATE_DONE';
  adapterId: string;
}

export type DelphiMessage =
  | ReadyMessage
  | AskMessage
  | ProgressMessage
  | ResultMessage
  | PingMessage
  | CalibrateMessage
  | CalibrateDoneMessage;

export type AskResponse = Pick<ResultMessage, 'ok' | 'text' | 'format' | 'error' | 'code'>;
