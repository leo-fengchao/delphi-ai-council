/* ============================================================
   集思 · Delphi — 成员运行进度卡片 + 阶段步进器（Phase 9 / ADR-0015）
   ============================================================ */
import { Ic } from '../ui/icons';
import { Spinner } from '../ui/icons';
import { ModelMark } from '../ui/marks';
import { StatusPill } from '../ui/primitives';
import type { CardStatus } from '../ui/primitives';
import { stageLabel, type LegModel, type StageKey } from '../leg-model';
import type { ThinkingDecision } from '../../../shared/messaging';

function StepRow({ leg, sKey, last, onOpen }: { leg: LegModel; sKey: StageKey; last: boolean; onOpen: (id: string, s: StageKey) => void }) {
  const st: CardStatus = leg.stageStates[sKey] ?? 'pending';
  const clickable = st === 'done' || st === 'running' || st === 'failed';
  const idle = st === 'pending' || st === 'waiting';
  const dotColor: Record<CardStatus, string> = { done: 'var(--done)', running: 'var(--running)', failed: 'var(--fail)', pending: 'var(--text-3)', waiting: 'var(--text-3)' };
  const summary = leg.summaries[sKey];
  return (
    <div
      onClick={() => clickable && onOpen(leg.id, sKey)}
      style={{
        display: 'flex',
        gap: 11,
        cursor: clickable ? 'pointer' : 'default',
        borderRadius: 10,
        padding: '5px 8px',
        margin: '0 -8px',
        transition: 'background .15s',
      }}
      onMouseEnter={(e) => clickable && (e.currentTarget.style.background = 'var(--surface-2)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {/* rail + dot */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 2 }}>
        <div
          style={{
            width: 19,
            height: 19,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
            background: st === 'done' ? 'var(--done)' : st === 'failed' ? 'var(--fail)' : 'var(--surface)',
            border: st === 'running' ? `2px solid var(--running)` : idle ? `2px solid var(--border-strong)` : 'none',
            boxShadow: st === 'done' || st === 'failed' ? `0 1px 3px color-mix(in srgb, ${dotColor[st]} 45%, transparent)` : 'none',
            color: '#fff',
          }}
        >
          {st === 'done' && <Ic.check style={{ fontSize: 10 }} />}
          {st === 'failed' && <Ic.x style={{ fontSize: 9, color: '#fff' }} />}
          {st === 'running' && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--running)', animation: 'pulse-dot 1.1s infinite' }} />}
        </div>
        {!last && (
          <div
            style={{
              width: 2,
              flex: 1,
              minHeight: 14,
              marginTop: 2,
              background: st === 'done' ? 'var(--done)' : 'var(--border)',
              borderRadius: 2,
              opacity: st === 'done' ? 0.5 : 1,
            }}
          />
        )}
      </div>
      {/* label + sub */}
      <div style={{ flex: 1, minWidth: 0, paddingBottom: last ? 0 : 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: 13, fontWeight: idle ? 500 : 600, color: idle ? 'var(--text-3)' : 'var(--text)' }}>
            {stageLabel(sKey, leg.debateRound)}
          </span>
          {st === 'running' && <Spinner size={13} />}
          {clickable && <Ic.chevron style={{ fontSize: 11, color: 'var(--text-3)', transform: 'rotate(-90deg)', marginLeft: 'auto' }} />}
        </div>
        {st === 'running' && leg.subtext && (
          <div style={{ fontSize: 12, color: 'var(--running)', marginTop: 2, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{leg.subtext}</div>
        )}
        {st === 'waiting' && summary && (
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{summary}</div>
        )}
        {st === 'done' && summary && (
          <div
            style={{
              fontSize: 12,
              color: 'var(--text-2)',
              marginTop: 2,
              lineHeight: 1.5,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {summary}
          </div>
        )}
      </div>
    </div>
  );
}

export function ProgressCard({
  leg,
  onOpen,
  onRetry,
  onRetryManualThinking,
  onRetryWithoutThinking,
  onThinkingDecision,
  onAsk,
}: {
  leg: LegModel;
  onOpen: (id: string, s: StageKey) => void;
  onRetry: (id: string) => void;
  onRetryManualThinking: (id: string) => void;
  onRetryWithoutThinking: (id: string) => void;
  onThinkingDecision: (id: string, decision: ThinkingDecision) => void;
  onAsk: (id: string) => void;
}) {
  const stages = leg.stages;
  const doneN = stages.filter((s) => leg.stageStates[s] === 'done').length;
  const frac =
    leg.status === 'done'
      ? 1
      : leg.status === 'failed'
        ? doneN / stages.length
        : doneN / stages.length + (leg.status === 'running' ? 0.5 / stages.length : 0);
  const barColor = leg.status === 'failed' ? 'var(--fail)' : leg.status === 'done' ? 'var(--done)' : 'var(--running)';

  // ⚠️ 卡片副标题：固定单行显示（见下方渲染处 whiteSpace:nowrap + ellipsis）。
  // 新增/修改任何文案都必须保证在一行内完整显示，否则会被截断成省略号且影响进度条对齐。
  const subline =
    leg.awaitingThinkingDecision
      ? '等待选择深度思考处理方式'
      : leg.awaitingCaptcha
      ? '⚠️ 出现验证码，等待手动处理'
      : leg.status === 'pending'
        ? '等待开始'
        : leg.status === 'waiting'
          ? '等待其他成员完成作答'
          : leg.status === 'done'
            ? '全部阶段完成'
            : leg.status === 'failed'
              ? leg.failReason || '执行失败'
              : `${stageLabel(leg.current, leg.debateRound)} · 进行中`;

  return (
    <div
      style={{
        background: leg.isChair ? 'linear-gradient(180deg, var(--chair-bg), var(--surface) 30%)' : 'var(--surface)',
        borderRadius: 'var(--r-lg)',
        border: '1px solid ' + (leg.isChair ? 'var(--chair-bd)' : 'var(--border)'),
        boxShadow: leg.isChair
          ? `var(--shadow-card), 0 0 0 1px var(--chair-bd), 0 0 0 4px var(--glow)`
          : leg.status === 'running'
            ? `var(--shadow-card), 0 0 0 1px var(--running-bd)`
            : 'var(--shadow-card)',
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        animation: 'rise .4s var(--ease) both',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        <ModelMark id={leg.id} size={36} chair={leg.isChair} dim={leg.status === 'failed'} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{leg.displayName}</span>
            {leg.isChair && (
              <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--chair)', background: 'var(--chair-bg)', border: '1px solid var(--chair-bd)', borderRadius: 6, padding: '1px 6px' }}>
                主席
              </span>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{subline}</div>
        </div>
        <StatusPill status={leg.status} />
      </div>

      {/* 验证码提醒横幅：出现人机验证时显眼提示用户去对应窗口手动处理，处理后自动继续。 */}
      {leg.awaitingCaptcha && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '9px 12px',
            borderRadius: 10,
            background: 'var(--warn-bg)',
            border: '1px solid var(--warn-bd)',
            color: 'var(--warn)',
            fontSize: 12.5,
            fontWeight: 600,
            lineHeight: 1.4,
          }}
        >
          <span style={{ fontSize: 15, animation: 'pulse-dot 1.4s infinite' }}>⚠️</span>
          <span>{leg.displayName} 出现验证码，请到该窗口手动通过，完成后将自动继续。</span>
        </div>
      )}

      {leg.needsThinkingDecision && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: '10px 12px',
            borderRadius: 10,
            background: 'var(--warn-bg)',
            border: '1px solid var(--warn-bd)',
            color: 'var(--warn)',
            fontSize: 12.5,
            fontWeight: 600,
            lineHeight: 1.45,
          }}
        >
          <span>{leg.displayName} 未能自动切到深度思考。请到该窗口手动调整后继续，或改用非深度思考。</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button className="dx-btn dx-btn-ghost" onClick={() => onRetryManualThinking(leg.id)}>
              <Ic.check style={{ fontSize: 13 }} /> 已手动开启
            </button>
            <button className="dx-btn dx-btn-ghost" onClick={() => onRetryWithoutThinking(leg.id)}>
              非深度继续
            </button>
          </div>
        </div>
      )}

      {leg.awaitingThinkingDecision && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: '10px 12px',
            borderRadius: 10,
            background: 'var(--warn-bg)',
            border: '1px solid var(--warn-bd)',
            color: 'var(--warn)',
            fontSize: 12.5,
            fontWeight: 600,
            lineHeight: 1.45,
          }}
        >
          <span>{leg.displayName} 未能自动切到深度思考。请到该窗口手动调整后继续，或改用非深度思考。</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button className="dx-btn dx-btn-ghost" onClick={() => onThinkingDecision(leg.id, 'manual')}>
              <Ic.check style={{ fontSize: 13 }} /> 已手动开启
            </button>
            <button className="dx-btn dx-btn-ghost" onClick={() => onThinkingDecision(leg.id, 'skip')}>
              非深度继续
            </button>
          </div>
        </div>
      )}

      {/* progress bar */}
      <div style={{ height: 6, borderRadius: 6, background: 'var(--surface-inset)', boxShadow: 'var(--shadow-inset)', overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: `${Math.max(3, frac * 100)}%`,
            borderRadius: 6,
            backgroundImage:
              leg.status === 'running'
                ? `repeating-linear-gradient(115deg, var(--running), var(--running) 8px, color-mix(in srgb, var(--running) 78%, #fff) 8px, color-mix(in srgb, var(--running) 78%, #fff) 16px)`
                : 'none',
            backgroundColor: leg.status === 'running' ? 'transparent' : barColor,
            backgroundSize: '28px 28px',
            animation: leg.status === 'running' ? 'barflow 1s linear infinite' : 'none',
            transition: 'width .5s var(--ease)',
          }}
        />
      </div>

      {/* steps */}
      <div>
        {stages.map((s, i) => (
          <StepRow key={s} leg={leg} sKey={s} last={i === stages.length - 1} onOpen={onOpen} />
        ))}
      </div>

      {/* footer actions */}
      <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 4 }}>
        {leg.status === 'failed' && !leg.needsThinkingDecision ? (
          <button className="dx-btn dx-btn-fail" onClick={() => onRetry(leg.id)}>
            <Ic.retry style={{ fontSize: 14 }} /> 重试
          </button>
        ) : (
          <button
            className="dx-btn dx-btn-ghost"
            disabled={leg.status === 'pending'}
            onClick={() => onOpen(leg.id, leg.current)}
          >
            查看详情
          </button>
        )}
        <button className="dx-btn dx-btn-ghost" onClick={() => onAsk(leg.id)} title="跳转到该 AI 的原生网页继续追问">
          <Ic.ext style={{ fontSize: 13 }} /> 追问
        </button>
      </div>
    </div>
  );
}
