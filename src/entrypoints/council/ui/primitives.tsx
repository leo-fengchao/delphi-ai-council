/* ============================================================
   集思 · Delphi — StatusPill / ConfidenceRing / Toggle（Phase 9 / ADR-0015）
   ============================================================ */
import { useEffect, useState } from 'react';
import type { ComponentType, SVGProps } from 'react';
import { Ic } from './icons';

// waiting = 该成员已完成当前能做的阶段，正等其他成员/下一轮（与「待开始」区分）。
export type CardStatus = 'pending' | 'waiting' | 'running' | 'done' | 'failed';

const STATUS_META: Record<CardStatus, { label: string; bg: string; bd: string; fg: string }> = {
  pending: { label: '待开始', bg: 'var(--surface-inset)', bd: 'var(--border)', fg: 'var(--text-3)' },
  waiting: { label: '等待中', bg: 'var(--surface-inset)', bd: 'var(--border-strong)', fg: 'var(--text-2)' },
  running: { label: '进行中', bg: 'var(--running-bg)', bd: 'var(--running-bd)', fg: 'var(--running)' },
  done: { label: '已完成', bg: 'var(--done-bg)', bd: 'var(--done-bd)', fg: 'var(--done)' },
  failed: { label: '失败', bg: 'var(--fail-bg)', bd: 'var(--fail-bd)', fg: 'var(--fail)' },
};

export function StatusPill({ status, text }: { status: CardStatus; text?: string }) {
  const m = STATUS_META[status] || STATUS_META.pending;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '3px 9px 3px 7px',
        borderRadius: 20,
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1.2,
        background: m.bg,
        color: m.fg,
        border: `1px solid ${m.bd}`,
      }}
    >
      {status === 'running' ? (
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: m.fg, animation: 'pulse-dot 1.1s infinite' }} />
      ) : status === 'done' ? (
        <Ic.check style={{ fontSize: 11 }} />
      ) : status === 'failed' ? (
        <Ic.warn style={{ fontSize: 11 }} />
      ) : (
        <span style={{ width: 7, height: 7, borderRadius: '50%', border: `1.5px solid ${m.fg}` }} />
      )}
      {text || m.label}
    </span>
  );
}

export function ConfidenceRing({
  score = 0,
  size = 132,
  participated,
  failed,
}: {
  score?: number;
  size?: number;
  participated: number;
  failed: number;
}) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    let raf = 0;
    let t0 = 0;
    const dur = 1100;
    const tick = (t: number) => {
      if (!t0) t0 = t;
      const p = Math.min(1, (t - t0) / dur);
      setShown(Math.round(score * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [score]);
  const r = size / 2 - 11;
  const c = 2 * Math.PI * r;
  const hue = score >= 75 ? 'var(--done)' : score >= 50 ? 'var(--warn)' : 'var(--fail)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-inset)" strokeWidth="11" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={hue}
            strokeWidth="11"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - shown / 100)}
            style={{
              transition: 'stroke-dashoffset .1s linear',
              filter: `drop-shadow(0 0 6px color-mix(in srgb, ${hue} 40%, transparent))`,
            }}
          />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
          <div style={{ textAlign: 'center', lineHeight: 1 }}>
            <div style={{ fontSize: size * 0.3, fontWeight: 800, color: 'var(--text)', letterSpacing: '-.02em' }}>{shown}</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, marginTop: 3 }}>置信度</div>
          </div>
        </div>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--text-2)', fontWeight: 500 }}>
        基于 <b style={{ color: 'var(--done)' }}>{participated}</b> 家参与
        {failed > 0 && (
          <>
            {' '}· <b style={{ color: 'var(--fail)' }}>{failed}</b> 家失败
          </>
        )}
      </div>
    </div>
  );
}

/** 输入框下方的拟物开关（深度思考 / 多轮辩论）。 */
export function Toggle({
  on,
  onClick,
  icon: Icon,
  label,
  tip,
  disabled,
}: {
  on: boolean;
  onClick: () => void;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  tip: string;
  disabled?: boolean;
}) {
  return (
    <span className="dx-tip">
      <button
        onClick={onClick}
        disabled={disabled}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 11px',
          borderRadius: 22,
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.55 : 1,
          fontSize: 12.5,
          fontWeight: 600,
          fontFamily: 'var(--font-sans)',
          border: '1px solid ' + (on ? 'color-mix(in srgb, var(--running) 45%, var(--border-strong))' : 'var(--border-strong)'),
          background: on
            ? 'linear-gradient(180deg, color-mix(in srgb, var(--running) 14%, var(--surface)) 0%, color-mix(in srgb, var(--running) 22%, var(--surface)) 100%)'
            : 'linear-gradient(180deg, var(--surface) 0%, var(--surface-inset) 100%)',
          color: on ? 'var(--running)' : 'var(--text-2)',
          boxShadow: on
            ? 'inset 0 1px 0 rgba(255,255,255,.5), 0 1px 1.5px rgba(60,45,20,.10)'
            : 'inset 0 1px 0 rgba(255,255,255,.7), 0 1px 1.5px rgba(60,45,20,.10)',
          transition: 'all .18s var(--ease)',
        }}
      >
        <Icon style={{ fontSize: 15, opacity: on ? 1 : 0.68 }} />
        {label}
        <span
          style={{
            width: 28,
            height: 16,
            borderRadius: 20,
            position: 'relative',
            marginLeft: 2,
            background: on ? 'var(--running)' : 'var(--border-strong)',
            boxShadow: 'inset 0 1px 2px rgba(60,45,20,.18)',
            transition: 'background .18s',
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: 2.5,
              left: on ? 14 : 2.5,
              width: 11,
              height: 11,
              borderRadius: '50%',
              background: '#fff',
              transition: 'left .2s var(--ease)',
              boxShadow: '0 1px 2px rgba(0,0,0,.3), inset 0 1px 0 rgba(255,255,255,.8)',
            }}
          />
        </span>
      </button>
      <span className="dx-tip-bubble">{tip}</span>
    </span>
  );
}
