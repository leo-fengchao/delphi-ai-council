/* ============================================================
   集思 · Delphi — 模型/主席选择 + 输入区 + 恢复条（Phase 9 / ADR-0015）
   ============================================================ */
import { Ic } from '../ui/icons';
import { ModelMark } from '../ui/marks';
import { Toggle } from '../ui/primitives';

export interface PickItem {
  id: string;
  displayName: string;
}

export function ModelPicker({
  models,
  selected,
  chair,
  onToggle,
  onChair,
  disabled,
}: {
  models: PickItem[];
  selected: Set<string>;
  chair: string;
  onToggle: (id: string) => void;
  onChair: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, marginBottom: 11 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>选择参会模型</span>
        <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
          已选 {selected.size} 家 · 点击 <Ic.crown style={{ fontSize: 12, color: 'var(--chair)', verticalAlign: '-1px' }} /> 指定主席
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(158px, 1fr))', gap: 10 }}>
        {models.map((m) => {
          const on = selected.has(m.id);
          const isChair = chair === m.id;
          return (
            <div
              key={m.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '7px 8px 7px 9px',
                borderRadius: 13,
                border: '1px solid ' + (isChair ? 'var(--chair-bd)' : on ? 'var(--border-strong)' : 'var(--border)'),
                background: isChair ? 'var(--chair-bg)' : on ? 'var(--surface)' : 'var(--surface-2)',
                boxShadow: on ? 'var(--shadow-raised)' : 'none',
                opacity: disabled ? 0.6 : 1,
                transition: 'all .16s var(--ease)',
                cursor: disabled ? 'default' : 'pointer',
              }}
            >
              <div onClick={() => !disabled && onToggle(m.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                <span style={{ position: 'relative', display: 'inline-flex' }}>
                  <ModelMark id={m.id} size={26} dim={!on} />
                  {on && (
                    <span
                      style={{
                        position: 'absolute',
                        bottom: -3,
                        right: -3,
                        width: 13,
                        height: 13,
                        borderRadius: '50%',
                        background: 'var(--done)',
                        border: '2px solid var(--surface)',
                        display: 'grid',
                        placeItems: 'center',
                        color: '#fff',
                      }}
                    >
                      <Ic.check style={{ fontSize: 7 }} />
                    </span>
                  )}
                </span>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: on ? 'var(--text)' : 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {m.displayName}
                </span>
              </div>
              {on && (
                <button
                  onClick={() => !disabled && onChair(m.id)}
                  title={isChair ? '当前主席' : '设为主席'}
                  style={{
                    display: 'grid',
                    placeItems: 'center',
                    width: 24,
                    height: 24,
                    padding: 0,
                    lineHeight: 0,
                    borderRadius: 8,
                    cursor: 'pointer',
                    flexShrink: 0,
                    border: '1px solid ' + (isChair ? 'var(--chair-bd)' : 'transparent'),
                    background: isChair ? 'linear-gradient(150deg,#FFD66B,#E0A22E)' : 'var(--surface-inset)',
                    color: isChair ? '#7a4d05' : 'var(--text-3)',
                    transition: 'all .15s',
                  }}
                >
                  <Ic.crown style={{ fontSize: 13, display: 'block' }} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Composer({
  value,
  onChange,
  deep,
  setDeep,
  debate,
  setDebate,
  running,
  finished,
  onStart,
  onAbort,
  onCloseTabs,
  count,
}: {
  value: string;
  onChange: (v: string) => void;
  deep: boolean;
  setDeep: (v: boolean) => void;
  debate: boolean;
  setDebate: (v: boolean) => void;
  running: boolean;
  finished: boolean;
  onStart: () => void;
  onAbort: () => void;
  onCloseTabs: () => void;
  count: number;
}) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        borderRadius: 'var(--r-xl)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-card)',
        padding: 16,
        transition: 'box-shadow .2s',
      }}
    >
      <textarea
        className="dx-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="向议会提出一个值得多方权衡的问题，例如：未来五年远程办公会成为主流吗？"
        rows={3}
        disabled={running}
        style={{ width: '100%', border: 'none', outline: 'none', resize: 'none', background: 'transparent', fontSize: 16, lineHeight: 1.6, color: 'var(--text)', minHeight: 72, padding: '4px 2px' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 8, flexWrap: 'wrap' }}>
        <Toggle
          on={deep}
          onClick={() => setDeep(!deep)}
          icon={Ic.brain}
          label="深度思考"
          tip="默认开启；主席强制开，此开关仅影响其他成员。需先在校准里录「深度思考(多步)」与「思考状态(两态)」"
          disabled={running}
        />
        <Toggle
          on={debate}
          onClick={() => setDebate(!debate)}
          icon={Ic.debate}
          label="多轮辩论"
          tip="默认关闭；评审后由主席对匿名成员定向追问、最多 3 轮再综合。更慢更耗额度，高价值问题再开。"
          disabled={running}
        />
        <div style={{ flex: 1 }} />
        {running ? (
          <button className="dx-stop" onClick={onAbort}>
            <Ic.stop style={{ fontSize: 14 }} /> 中止议事
          </button>
        ) : finished && !value.trim() ? (
          // 议事已结束且未输入新内容：把「发起议事」换成「关闭所有打开的标签页」，
          // 让用户无需开新议会即可一键收尾。一旦输入新问题，下面分支会切回发起议事。
          <button className="dx-btn-raised" onClick={onCloseTabs}>
            <Ic.broom style={{ fontSize: 15 }} /> 关闭所有打开的标签页
          </button>
        ) : (
          <button className="dx-btn-raised" disabled={!value.trim() || count < 2} onClick={onStart}>
            <Ic.send style={{ fontSize: 16, transform: 'rotate(45deg)' }} /> 发起议事（{count} 家）
          </button>
        )}
      </div>
    </div>
  );
}

export function RecoveryBar({ prompt, onResume, onDiscard }: { prompt: string; onResume: () => void; onDiscard: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '11px 16px',
        borderRadius: 'var(--r-md)',
        background: 'var(--warn-bg)',
        border: '1px solid var(--warn-bd)',
        marginBottom: 16,
        animation: 'rise .3s ease both',
      }}
    >
      <Ic.warn style={{ fontSize: 18, color: 'var(--warn)' }} />
      <div style={{ flex: 1, fontSize: 13.5, color: 'var(--text)' }}>
        <b>检测到未完成的议会</b> · 「{prompt.slice(0, 22)}
        {prompt.length > 22 ? '…' : ''}」上次中断，是否续跑？
        <span style={{ color: 'var(--text-3)', marginLeft: 4 }}>（已完成的站点沿用存档，不重复消耗额度）</span>
      </div>
      <button className="dx-btn-raised" style={{ fontSize: 13, padding: '7px 13px' }} onClick={onResume}>
        恢复
      </button>
      <button className="dx-btn dx-btn-ghost" onClick={onDiscard}>
        丢弃
      </button>
    </div>
  );
}
