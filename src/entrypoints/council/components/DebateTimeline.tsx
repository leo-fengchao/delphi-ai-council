/* ============================================================
   集思 · Delphi — 多轮辩论时间线（Phase 9 / ADR-0015）
   ============================================================ */
import { Ic } from '../ui/icons';
import { ModelMark } from '../ui/marks';
import type { DebateState } from '../../../shared/session-state';

export function DebateTimeline({
  debate,
  chairId,
  nameOf,
  reveal,
  onToggleReveal,
}: {
  debate: DebateState;
  chairId: string;
  nameOf: (id: string) => string;
  reveal: boolean;
  onToggleReveal: () => void;
}) {
  return (
    <div style={{ background: 'var(--surface)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)', padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 16 }}>
        <span style={{ width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', background: 'var(--running-bg)', color: 'var(--running)' }}>
          <Ic.debate style={{ fontSize: 16 }} />
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15.5, fontWeight: 700 }}>多轮辩论时间线</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
            主席向匿名成员定向追问 · 共 {debate.rounds.length} 轮{debate.converged ? '·已收敛' : '·进行中'}
          </div>
        </div>
        <button className="dx-btn dx-btn-ghost" onClick={onToggleReveal} style={{ fontSize: 12 }}>
          {reveal ? '隐藏真实身份' : '揭示真实身份'}
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {debate.rounds.map((r) => (
          <div key={r.round}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--text-2)',
                background: 'var(--surface-inset)',
                padding: '3px 11px',
                borderRadius: 20,
                marginBottom: 11,
              }}
            >
              第 {r.round} 轮
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingLeft: 6, borderLeft: '2px dashed var(--border-strong)' }}>
              {r.targets.map((t, i) => {
                const name = nameOf(t.adapterId);
                return (
                  <div key={i} style={{ paddingLeft: 16, position: 'relative' }}>
                    {/* chair question */}
                    <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginBottom: 9 }}>
                      <ModelMark id={chairId} size={26} chair />
                      <div
                        style={{
                          background: 'var(--chair-bg)',
                          border: '1px solid var(--chair-bd)',
                          borderRadius: '12px 12px 12px 3px',
                          padding: '9px 13px',
                          fontSize: 13.5,
                          lineHeight: 1.6,
                          color: 'var(--text)',
                          maxWidth: 560,
                        }}
                      >
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--chair)', marginBottom: 3 }}>主席 → Response {t.anonLabel}</div>
                        {t.question}
                      </div>
                    </div>
                    {/* anon answer */}
                    <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginLeft: 24 }}>
                      {/* 揭示身份时用该模型的品牌图标；否则匿名编号占位块。 */}
                      {reveal ? (
                        <ModelMark id={t.adapterId} size={26} />
                      ) : (
                        <span
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: 8,
                            display: 'grid',
                            placeItems: 'center',
                            flexShrink: 0,
                            background: 'var(--surface-inset)',
                            color: 'var(--text-2)',
                            fontWeight: 700,
                            fontSize: 12,
                            border: '1px solid var(--border-strong)',
                          }}
                        >
                          {t.anonLabel}
                        </span>
                      )}
                      <div
                        style={{
                          background: 'var(--surface-2)',
                          border: '1px solid var(--border)',
                          borderRadius: '12px 12px 3px 12px',
                          padding: '9px 13px',
                          fontSize: 13.5,
                          lineHeight: 1.6,
                          color: 'var(--text)',
                          maxWidth: 560,
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', marginBottom: 3 }}>
                          Response {t.anonLabel} {reveal && <span style={{ color: 'var(--accent)' }}>· 实为 {name}</span>}
                        </div>
                        {t.status === 'done' && t.answer ? t.answer : t.status === 'failed' ? <span style={{ color: 'var(--fail)' }}>（未回应/失败）</span> : <span style={{ color: 'var(--text-3)' }}>追问中…</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
