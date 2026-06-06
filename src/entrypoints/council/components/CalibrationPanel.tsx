/* ============================================================
   集思 · Delphi — 适配校准浮窗（Phase 9 / ADR-0015）

   设计稿里的轻量浮窗：锚定在侧栏「适配校准」按钮上方、单列、每站 校准/贡献/重置。
   这里接真实通路（calibration.ts / contribution.ts / overrides.ts），并保留
   「跨浏览器导出/导入合并」的次级区。
   ============================================================ */
import { useEffect, useState } from 'react';
import { Ic } from '../ui/icons';
import { ModelMark } from '../ui/marks';
import type { SiteAdapter } from '../../../shared/adapter-schema';

export function CalibrationPanel({
  open,
  onClose,
  adapters,
  busyId,
  statusMsg,
  communityRepo,
  tagsFor,
  hasOverride,
  onCalibrate,
  onContribute,
  onReset,
  transferText,
  setTransferText,
  onExport,
  onImport,
}: {
  open: boolean;
  onClose: () => void;
  adapters: SiteAdapter[];
  busyId: string | null;
  statusMsg: string;
  communityRepo: boolean;
  tagsFor: (id: string) => string[];
  hasOverride: (id: string) => boolean;
  onCalibrate: (a: SiteAdapter) => void;
  onContribute: (a: SiteAdapter) => void;
  onReset: (a: SiteAdapter) => void;
  transferText: string;
  setTransferText: (v: string) => void;
  onExport: () => void;
  onImport: () => void;
}) {
  const [pos, setPos] = useState({ left: 20, bottom: 96, maxH: '70vh' as number | string });
  const [showTransfer, setShowTransfer] = useState(false);

  useEffect(() => {
    if (!open) return;
    const anchor = document.querySelector('[data-calib-anchor]');
    if (anchor) {
      const r = anchor.getBoundingClientRect();
      setPos({ left: Math.max(14, Math.round(r.left)), bottom: Math.round(window.innerHeight - r.top + 10), maxH: Math.max(240, Math.round(r.top - 24)) });
    }
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  if (!open) return null;

  const cbtn: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    flex: 1,
    fontSize: 11.5,
    fontWeight: 600,
    padding: '5px 8px',
    borderRadius: 8,
    cursor: 'pointer',
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--text-2)',
    fontFamily: 'var(--font-sans)',
    transition: 'all .15s',
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 70 }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          left: pos.left,
          bottom: pos.bottom,
          width: 360,
          maxHeight: pos.maxH,
          overflowY: 'auto',
          background: 'var(--surface)',
          borderRadius: 'var(--r-lg)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-pop)',
          padding: 18,
          animation: 'pop-in .2s var(--ease) both',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Ic.tune style={{ fontSize: 17, color: 'var(--text-2)' }} />
          <div style={{ flex: 1, fontSize: 14.5, fontWeight: 700 }}>站点适配校准</div>
          <button className="dx-icon-btn" onClick={onClose}>
            <Ic.x style={{ fontSize: 15 }} />
          </button>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginBottom: 13, lineHeight: 1.6 }}>
          站点改版导致抓取失败时，在此重新校准选择器。校准操作在打开的站点窗口顶部工具条上完成；优先级：你的校准 &gt; 远程 &gt; 内置。
        </div>
        {statusMsg && (
          <div style={{ fontSize: 12, color: 'var(--accent)', background: 'var(--accent-soft)', padding: '8px 11px', borderRadius: 8, marginBottom: 12, lineHeight: 1.6, wordBreak: 'break-word' }}>
            {statusMsg}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {adapters.map((a) => {
            const tags = tagsFor(a.id);
            const any = hasOverride(a.id);
            const active = busyId === a.id;
            return (
              <div key={a.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <ModelMark id={a.id} size={28} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>{a.displayName}</span>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>{tags.length ? `已校准：${tags.join('、')}` : '未校准'}</div>
                  </div>
                  {active && <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--running)' }}>校准中…</span>}
                </div>
                <div style={{ display: 'flex', gap: 7 }}>
                  <button style={cbtn} disabled={!!busyId} onClick={() => onCalibrate(a)}>
                    <Ic.tune style={{ fontSize: 13 }} /> 校准
                  </button>
                  {communityRepo && any && (
                    <button style={cbtn} disabled={!!busyId} onClick={() => onContribute(a)} title="把此校准提交到社区，审核后所有用户受益">
                      <Ic.upload style={{ fontSize: 13 }} /> 贡献
                    </button>
                  )}
                  {any && (
                    <button
                      style={cbtn}
                      disabled={!!busyId}
                      onClick={() => onReset(a)}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--fail-bg)';
                        e.currentTarget.style.color = 'var(--fail)';
                        e.currentTarget.style.borderColor = 'var(--fail-bd)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'var(--surface)';
                        e.currentTarget.style.color = 'var(--text-2)';
                        e.currentTarget.style.borderColor = 'var(--border)';
                      }}
                    >
                      <Ic.reset style={{ fontSize: 13 }} /> 重置
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* 跨浏览器对齐校准（次级区，默认收起） */}
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <button
            onClick={() => setShowTransfer((s) => !s)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-2)', fontSize: 12.5, fontWeight: 600, fontFamily: 'var(--font-sans)', padding: 0 }}
          >
            <Ic.chevron style={{ fontSize: 13, transform: showTransfer ? 'rotate(0)' : 'rotate(-90deg)', transition: 'transform .15s' }} />
            跨浏览器对齐校准（导出 / 导入合并）
          </button>
          {showTransfer && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <textarea
                value={transferText}
                onChange={(e) => setTransferText(e.target.value)}
                placeholder="点「导出」把本浏览器校准填到这里；或粘贴其它浏览器导出的 JSON 后点「导入合并」。"
                style={{
                  width: '100%',
                  minHeight: 80,
                  padding: 10,
                  fontSize: 11.5,
                  fontFamily: 'var(--font-mono)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  resize: 'vertical',
                  boxSizing: 'border-box',
                  background: 'var(--surface-2)',
                  color: 'var(--text)',
                }}
              />
              <div style={{ display: 'flex', gap: 7 }}>
                <button style={cbtn} onClick={onExport}>
                  <Ic.download style={{ fontSize: 13 }} /> 导出
                </button>
                <button style={cbtn} onClick={onImport}>
                  <Ic.upload style={{ fontSize: 13 }} /> 导入合并
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
