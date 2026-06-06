/* ============================================================
   集思 · Delphi — inline icon set + spinner（Phase 9 / ADR-0015）
   ============================================================ */
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;

export const Ic = {
  crown: (p: P) => <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" {...p}><path d="M3 7.5l4 3 5-6 5 6 4-3-1.8 10.2H4.8L3 7.5zm2.4 11.7h13.2v1.6H5.4v-1.6z" /></svg>,
  chevron: (p: P) => <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M6 9l6 6 6-6" /></svg>,
  search: (p: P) => <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...p}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>,
  plus: (p: P) => <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" {...p}><path d="M12 5v14M5 12h14" /></svg>,
  panel: (p: P) => <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.9" {...p}><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M9 4v16" /></svg>,
  sun: (p: P) => <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>,
  moon: (p: P) => <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M20 14.5A8 8 0 1 1 9.5 4a6.3 6.3 0 0 0 10.5 10.5z" /></svg>,
  monitor: (p: P) => <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>,
  brain: (p: P) => <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-1.5 5.5A2.8 2.8 0 0 0 6 18a3 3 0 0 0 3 1.5V4zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 1.5 5.5A2.8 2.8 0 0 1 18 18a3 3 0 0 1-3 1.5V4z" /></svg>,
  debate: (p: P) => <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M7 8h7M7 11h4" /><path d="M3 5.5A1.5 1.5 0 0 1 4.5 4h11A1.5 1.5 0 0 1 17 5.5v6A1.5 1.5 0 0 1 15.5 13H9l-4 3v-3H4.5A1.5 1.5 0 0 1 3 11.5z" /><path d="M19 9h.5A1.5 1.5 0 0 1 21 10.5v6a1.5 1.5 0 0 1-1.5 1.5H19v2l-2.5-2H12" /></svg>,
  send: (p: P) => <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 19V6M6 12l6-6 6 6" /></svg>,
  stop: (p: P) => <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" {...p}><rect x="6" y="6" width="12" height="12" rx="2.5" /></svg>,
  broom: (p: P) => <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M19 4l-7 7M9.5 13.5l1 1M5 21c-1-3 1-5 2.5-6.5l2 2C8 18 6 17 5 21zM10.5 13.5l3-3" /></svg>,
  retry: (p: P) => <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M20 11a8 8 0 1 0-2.3 5.6M20 5v5h-5" /></svg>,
  ext: (p: P) => <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M14 5h5v5M19 5l-8 8M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" /></svg>,
  check: (p: P) => <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M5 12.5l4.5 4.5L19 6.5" /></svg>,
  x: (p: P) => <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" {...p}><path d="M6 6l12 12M18 6L6 18" /></svg>,
  warn: (p: P) => <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>,
  spark: (p: P) => <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" {...p}><path d="M12 2l1.8 5.6L19.4 9l-4.4 3.3L16.7 18 12 14.7 7.3 18 9 12.3 4.6 9l5.6-1.4z" opacity=".55" /><path d="M19 13l.7 2.2L22 16l-2.3.8L19 19l-.7-2.2L16 16l2.3-.8z" /></svg>,
  tune: (p: P) => <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" {...p}><path d="M5 8h9M18 8h1M5 16h1M10 16h9" /><circle cx="16" cy="8" r="2" /><circle cx="8" cy="16" r="2" /></svg>,
  reset: (p: P) => <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 8a9 9 0 1 1-1.5 5" /><path d="M3 3v5h5" /></svg>,
  upload: (p: P) => <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" /></svg>,
  trash: (p: P) => <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M10 11v6M14 11v6" /></svg>,
  download: (p: P) => <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 4v12M7 11l5 5 5-5" /><path d="M4 18v.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V18" /></svg>,
} as const;

export function Spinner({ size = 16, color = 'var(--running)' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ animation: 'spin .8s linear infinite' }}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity=".18" strokeWidth="3" />
      <path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
