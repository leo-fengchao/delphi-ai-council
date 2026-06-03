/**
 * 通用站点 content script。运行时逻辑全部来自配置（ADR-0005）。
 *
 * MV3 要求 content script 的 matches 在构建期静态声明，故这里取内置配置里所有站点的
 * match 合集（ALL_MATCHES）。运行时再按当前 URL 在配置里匹配具体适配器，保持数据驱动。
 *
 * 注入前会叠加**用户本地覆盖**（ADR-0009）：用户经拾取器校准过的选择器/策略优先于内置。
 * 同时处理 DELPHI_CALIBRATE 消息（在本页注入页内校准工具条）。
 */

import { matchAdapter } from '../shared/adapter-schema';
import { LOCAL_ADAPTER_CONFIG, ALL_MATCHES } from '../adapters/local-config';
import type { AskMessage, DelphiMessage, AskResponse } from '../shared/messaging';
import { runAdapter, AdapterError } from '../adapters/runtime';
import { applyOverride, readSiteOverride } from '../shared/overrides';
import { runCalibrationToolbar } from '../adapters/calibration-overlay';

export default defineContentScript({
  matches: ALL_MATCHES,
  runAt: 'document_idle',
  main() {
    const baseAdapter = matchAdapter(LOCAL_ADAPTER_CONFIG, location.href);
    if (!baseAdapter) return; // 非已知站点，不挂载。

    chrome.runtime.onMessage.addListener((msg: DelphiMessage, _sender, sendResponse) => {
      if (msg.type === 'DELPHI_PING') {
        sendResponse({ ready: true }); // 监听器已挂载即视为就绪。
        return undefined;
      }
      if (msg.type === 'DELPHI_ASK') {
        handleAsk(msg).then(sendResponse);
        return true; // 异步响应。
      }
      if (msg.type === 'DELPHI_CALIBRATE') {
        // 注入页内校准工具条；用户点「完成校准」后广播 DONE 给 Council Page。
        runCalibrationToolbar(baseAdapter.id, baseAdapter.displayName).then(() => {
          chrome.runtime.sendMessage({ type: 'DELPHI_CALIBRATE_DONE', adapterId: baseAdapter.id });
        });
        sendResponse({ ok: true });
        return undefined;
      }
      return undefined;
    });

    chrome.runtime.sendMessage({ type: 'DELPHI_READY', adapterId: baseAdapter.id });

    /** 取「内置 + 用户覆盖」的有效适配器（每次现取，校准后无需刷新页面即生效）。 */
    async function effectiveAdapter() {
      const override = await readSiteOverride(baseAdapter!.id);
      return applyOverride(baseAdapter!, override);
    }

    async function handleAsk(msg: AskMessage): Promise<AskResponse> {
      const adapter = await effectiveAdapter();
      try {
        const text = await runAdapter(
          adapter,
          msg.prompt,
          { onStage: (stage) => chrome.runtime.sendMessage({ type: 'DELPHI_PROGRESS', adapterId: adapter.id, stage }) },
          { enableThinking: msg.enableThinking },
        );
        return { ok: true, text, format: adapter.extraction.format };
      } catch (err) {
        if (err instanceof AdapterError) return { ok: false, error: err.message, code: err.code };
        return { ok: false, error: String(err), code: 'unknown' };
      }
    }
  },
});
