/**
 * 后台标签页「可见性伪装」（运行于页面 MAIN world，document_start）。
 *
 * 问题：议会的 AI 标签页都在后台/非激活状态，很多站点监听 Page Visibility API，
 *       在 document.hidden 时暂停流式渲染（DeepSeek/豆包还用虚拟列表，不可见就不渲染消息行），
 *       导致后台抓取为空——切到前台才出现内容。
 *
 * 方案：把 visibilityState 永远伪装为 'visible'、hidden 为 false，并拦截 visibilitychange 事件，
 *       让站点以为自己一直在前台，从而在后台也持续渲染。必须在站点脚本之前（document_start）、
 *       且在 MAIN world 执行才能影响站点自身的 JS。
 *
 * 注意：这缓解「基于 document.hidden 的渲染暂停」，但浏览器层面对完全隐藏标签页的
 *       requestAnimationFrame 暂停无法靠此消除（见 README「后台渲染」说明）。
 */

import { ALL_MATCHES } from '../adapters/local-config';

export default defineContentScript({
  matches: ALL_MATCHES,
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    try {
      const fake = (obj: object, prop: string, value: unknown) =>
        Object.defineProperty(obj, prop, { configurable: true, get: () => value });

      fake(document, 'hidden', false);
      fake(document, 'visibilityState', 'visible');
      fake(document, 'webkitHidden', false);
      fake(document, 'webkitVisibilityState', 'visible');
      (document as unknown as { hasFocus: () => boolean }).hasFocus = () => true;

      const block = (e: Event) => e.stopImmediatePropagation();
      for (const type of ['visibilitychange', 'webkitvisibilitychange']) {
        document.addEventListener(type, block, true);
        window.addEventListener(type, block, true);
      }
    } catch {
      /* 个别环境下 defineProperty 失败则放弃，不影响其余功能 */
    }
  },
});
