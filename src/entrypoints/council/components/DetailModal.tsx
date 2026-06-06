/* ============================================================
   集思 · Delphi — 成员详情弹窗（按阶段查看完整原文）（Phase 9 / ADR-0015）
   ============================================================ */
import { useEffect } from 'react';
import { Ic } from '../ui/icons';
import { ModelMark } from '../ui/marks';
import { STAGE_TAB_LABELS, type LegModel, type StageKey } from '../leg-model';

export function DetailModal({
  leg,
  stageKey,
  onClose,
  onStage,
  onAsk,
}: {
  leg: LegModel;
  stageKey: StageKey;
  onClose: () => void;
  onStage: (s: StageKey) => void;
  onAsk: (id: string) => void;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  // 只展示「非待开始」的阶段页签。
  const tabs = leg.stages.filter((s) => (leg.stageStates[s] ?? 'pending') !== 'pending');
  const active: StageKey = tabs.includes(stageKey) ? stageKey : tabs[tabs.length - 1] ?? leg.current;
  const st = leg.stageStates[active] ?? 'pending';
  const body = leg.texts[active];

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        background: 'rgba(20,16,8,.42)',
        backdropFilter: 'blur(4px)',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        animation: 'rise .2s ease both',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(680px, 100%)',
          height: '86vh',
          background: 'var(--surface)',
          borderRadius: 'var(--r-xl)',
          boxShadow: 'var(--shadow-pop)',
          border: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          animation: 'pop-in .26s var(--ease) both',
          overflow: 'hidden',
        }}
      >
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 20px 14px', borderBottom: '1px solid var(--border)' }}>
          <ModelMark id={leg.id} size={40} chair={leg.isChair} />
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ fontSize: 17, fontWeight: 700 }}>{leg.displayName}</span>
              {leg.isChair && (
                <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--chair)', background: 'var(--chair-bg)', border: '1px solid var(--chair-bd)', borderRadius: 6, padding: '1px 6px' }}>
                  主席
                </span>
              )}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 1 }}>该成员在各阶段的完整原文</div>
          </div>
          <button className="dx-icon-btn" onClick={onClose}>
            <Ic.x style={{ fontSize: 16 }} />
          </button>
        </div>
        {/* stage tabs */}
        <div style={{ display: 'flex', gap: 6, padding: '12px 20px 0', flexWrap: 'wrap' }}>
          {tabs.map((s) => (
            <button
              key={s}
              onClick={() => onStage(s)}
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                padding: '6px 12px',
                borderRadius: 9,
                cursor: 'pointer',
                border: '1px solid ' + (s === active ? 'var(--accent)' : 'var(--border)'),
                background: s === active ? 'var(--accent-soft)' : 'var(--surface-2)',
                color: s === active ? 'var(--accent)' : 'var(--text-2)',
                transition: 'all .15s',
              }}
            >
              {STAGE_TAB_LABELS[s]}
            </button>
          ))}
        </div>
        {/* body */}
        <div style={{ padding: '16px 20px 4px', overflowY: 'auto', flex: 1 }}>
          {st === 'failed' ? (
            <div style={{ padding: '28px 0', textAlign: 'center', color: 'var(--fail)' }}>
              <Ic.warn style={{ fontSize: 28 }} />
              <div style={{ marginTop: 8, fontWeight: 600 }}>{leg.failReason || '该阶段未能完成'}</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 4 }}>该成员未能完成此阶段，议会已用剩余成员继续。</div>
            </div>
          ) : (
            <div style={{ fontSize: 14.5, lineHeight: 1.85, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{body || '（暂无内容）'}</div>
          )}
        </div>
        {/* footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9, padding: '14px 20px', borderTop: '1px solid var(--border)' }}>
          <button className="dx-btn dx-btn-ghost" onClick={() => onAsk(leg.id)}>
            <Ic.ext style={{ fontSize: 13 }} /> 去 {leg.displayName} 原生页追问
          </button>
        </div>
      </div>
    </div>
  );
}
