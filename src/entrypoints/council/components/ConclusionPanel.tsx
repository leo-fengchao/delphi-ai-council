/* ============================================================
   集思 · Delphi — 主席综合结论面板（Phase 9 / ADR-0015）
   ============================================================ */
import { Ic } from '../ui/icons';
import { ModelMark } from '../ui/marks';
import { ConfidenceRing } from '../ui/primitives';
import { Markdown } from '../markdown';

export interface SummaryView {
  finalAnswer: string;
  consensus: string;
  disputes: string;
  confidence: string;
  rawText?: string;
}

export function ConclusionPanel({
  summary,
  chairId,
  chairName,
  participated,
  failed,
  onAsk,
}: {
  summary: SummaryView;
  chairId: string;
  chairName: string;
  participated: number;
  failed: number;
  onAsk: (id: string) => void;
}) {
  const score = Math.max(0, Math.min(100, parseInt(summary.confidence, 10) || 0));
  // 主席未按固定格式输出时（finalAnswer/consensus 均空），退化展示原始文本。
  const matched = !!(summary.finalAnswer || summary.consensus || summary.disputes);
  const finalText = matched ? summary.finalAnswer : summary.rawText || '';

  return (
    <div
      style={{
        borderRadius: 'var(--r-xl)',
        border: '1px solid var(--chair-bd)',
        position: 'relative',
        overflow: 'hidden',
        background: 'linear-gradient(180deg, var(--chair-bg), var(--surface) 22%)',
        boxShadow: 'var(--shadow-card), 0 0 0 4px var(--glow)',
        animation: 'pop-in .5s var(--ease) both',
      }}
    >
      <div style={{ padding: '22px 26px 26px' }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <ModelMark id={chairId} size={44} chair />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-.01em', display: 'flex', alignItems: 'center', gap: 8 }}>
              主席综合结论
              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--chair)', background: 'var(--chair-bg)', border: '1px solid var(--chair-bd)', borderRadius: 7, padding: '2px 9px' }}>
                {chairName}
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 2 }}>汇聚众智，收敛共识 · 这是本场议会的最终产出</div>
          </div>
          <button className="dx-btn dx-btn-ghost" onClick={() => onAsk(chairId)} title="去主席的原生网页继续追问">
            <Ic.ext style={{ fontSize: 13 }} /> 追问主席
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 168px', gap: 24, alignItems: 'start' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
              {matched ? '最终回答' : '主席原始输出（未匹配到固定格式）'}
            </div>
            <Markdown text={finalText} style={{ marginBottom: 20 }} />
          </div>
          {/* confidence */}
          <div
            style={{
              background: 'var(--surface-2)',
              borderRadius: 'var(--r-md)',
              border: '1px solid var(--border)',
              padding: '18px 14px',
              display: 'grid',
              placeItems: 'center',
              position: 'sticky',
              top: 0,
            }}
          >
            <ConfidenceRing score={score} participated={participated} failed={failed} />
          </div>
        </div>

        {/* consensus / disputes */}
        {matched && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 4 }}>
            <div style={{ background: 'var(--done-bg)', border: '1px solid var(--done-bd)', borderRadius: 'var(--r-md)', padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, fontWeight: 700, color: 'var(--done)', marginBottom: 7 }}>
                <span style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--done)', color: '#fff', display: 'grid', placeItems: 'center' }}>
                  <Ic.check style={{ fontSize: 10 }} />
                </span>
                共识点
              </div>
              <Markdown text={summary.consensus || '（无）'} style={{ fontSize: 13.5, lineHeight: 1.75 }} />
            </div>
            <div style={{ background: 'var(--warn-bg)', border: '1px solid var(--warn-bd)', borderRadius: 'var(--r-md)', padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, fontWeight: 700, color: 'var(--warn)', marginBottom: 7 }}>
                <Ic.warn style={{ fontSize: 16 }} /> 争议区
              </div>
              <Markdown text={summary.disputes || '（无）'} style={{ fontSize: 13.5, lineHeight: 1.75 }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
