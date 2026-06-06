/* ============================================================
   集思 · Delphi — 主题（系统/浅色/深色）持久化与应用（Phase 9 / ADR-0015）
   ============================================================ */
import { useEffect, useState } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';

const THEME_KEY = 'delphi:theme';

function resolve(pref: ThemePref): 'light' | 'dark' {
  if (pref === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return pref;
}

function applyTheme(pref: ThemePref) {
  document.documentElement.setAttribute('data-theme', resolve(pref));
}

/** 读取持久化的主题偏好（默认 system），并保持 <html data-theme> 与系统切换同步。 */
export function useTheme(): [ThemePref, (t: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>('system');

  // 初次加载：从 storage 取偏好。
  useEffect(() => {
    let alive = true;
    chrome.storage.local
      .get(THEME_KEY)
      .then((got) => {
        const v = got[THEME_KEY];
        if (alive && (v === 'system' || v === 'light' || v === 'dark')) setPref(v);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // 应用 + 跟随系统变化（仅 system 模式下监听）。
  useEffect(() => {
    applyTheme(pref);
    if (pref !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [pref]);

  const set = (t: ThemePref) => {
    setPref(t);
    chrome.storage.local.set({ [THEME_KEY]: t }).catch(() => {});
  };

  return [pref, set];
}
