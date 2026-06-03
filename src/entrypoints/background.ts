/**
 * Background service worker —— 仅做轻量、非常驻协调（ADR-0003）。
 * 重编排逻辑一律放在 Council Page，绝不放这里（MV3 30s 生命周期）。
 *
 * Phase 1 职责：点击扩展图标时打开 Council Page。
 */

export default defineBackground(() => {
  chrome.action.onClicked.addListener(async () => {
    const url = chrome.runtime.getURL('/council.html');
    const existing = await chrome.tabs.query({ url });
    if (existing[0]?.id != null) {
      await chrome.tabs.update(existing[0].id, { active: true });
    } else {
      await chrome.tabs.create({ url });
    }
  });
});
