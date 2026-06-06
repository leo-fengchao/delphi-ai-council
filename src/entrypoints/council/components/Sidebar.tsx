/* ============================================================
   集思 · Delphi — 左侧栏（历史议事 + 主题切换）（Phase 9 / ADR-0015）
   ============================================================ */
import { useMemo, useState } from 'react';
import { Ic } from '../ui/icons';
import type { ThemePref } from '../theme';
import type { ArchivedSession } from '../../../shared/session-state';
import { groupArchiveByDate } from '../../../shared/session-state';

function ThemeSeg({ theme, onChange }: { theme: ThemePref; onChange: (t: ThemePref) => void }) {
  const opts: { k: ThemePref; label: string; icon: typeof Ic.sun }[] = [
    { k: 'system', label: '系统', icon: Ic.monitor },
    { k: 'light', label: '浅色', icon: Ic.sun },
    { k: 'dark', label: '深色', icon: Ic.moon },
  ];
  return (
    <div style={{ display: 'flex', background: 'var(--surface-inset)', borderRadius: 12, padding: 3, boxShadow: 'var(--shadow-inset)', gap: 2 }}>
      {opts.map((o) => {
        const on = theme === o.k;
        const I = o.icon;
        return (
          <button
            key={o.k}
            onClick={() => onChange(o.k)}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
              fontSize: 12,
              fontWeight: 600,
              padding: '7px 4px',
              borderRadius: 9,
              cursor: 'pointer',
              border: 'none',
              background: on ? 'var(--surface)' : 'transparent',
              color: on ? 'var(--accent)' : 'var(--text-3)',
              boxShadow: on ? 'var(--shadow-raised)' : 'none',
              transition: 'all .18s var(--ease)',
            }}
          >
            <I style={{ fontSize: 14 }} /> {o.label}
          </button>
        );
      })}
    </div>
  );
}

function timeOf(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function Sidebar({
  collapsed,
  onToggle,
  theme,
  onTheme,
  archive,
  activeId,
  onSelect,
  onNew,
  onCalib,
}: {
  collapsed: boolean;
  onToggle: () => void;
  theme: ThemePref;
  onTheme: (t: ThemePref) => void;
  archive: ArchivedSession[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onCalib: () => void;
}) {
  const [query, setQuery] = useState('');
  const groups = useMemo(() => {
    const q = query.trim();
    const filtered = q ? archive.filter((s) => s.prompt.includes(q)) : archive;
    return groupArchiveByDate(filtered);
  }, [archive, query]);

  return (
    <aside
      style={{
        width: collapsed ? 0 : 272,
        flexShrink: 0,
        background: 'var(--sidebar)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: 'width .28s var(--ease)',
      }}
    >
      <div style={{ width: 272, display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 18px 14px' }}>
          <span
            style={{
              width: 34,
              height: 34,
              borderRadius: 11,
              background: 'linear-gradient(155deg, var(--accent-2), var(--accent))',
              display: 'grid',
              placeItems: 'center',
              color: '#fff',
              fontWeight: 900,
              fontSize: 17,
              fontFamily: 'var(--font-sans)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,.4), 0 3px 8px var(--glow)',
            }}
          >
            集
          </span>
          <div style={{ flex: 1, lineHeight: 1.1 }}>
            <div style={{ fontSize: 15.5, fontWeight: 800, letterSpacing: '-.01em' }}>集思 · Delphi</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>汇聚众智，收敛共识</div>
          </div>
          <button className="dx-icon-btn" onClick={onToggle} title="收起侧栏">
            <Ic.panel style={{ fontSize: 17 }} />
          </button>
        </div>

        {/* new */}
        <div style={{ padding: '0 14px 12px' }}>
          <button onClick={onNew} className="dx-btn-raised" style={{ width: '100%', fontWeight: 700 }}>
            <Ic.plus style={{ fontSize: 16 }} /> 新议事
          </button>
        </div>

        {/* search */}
        <div style={{ padding: '0 14px 8px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'var(--surface-inset)',
              borderRadius: 10,
              padding: '8px 11px',
              boxShadow: 'var(--shadow-inset)',
              color: 'var(--text-3)',
            }}
          >
            <Ic.search style={{ fontSize: 15 }} />
            <input
              placeholder="搜索历史议事…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: 13, color: 'var(--text)', flex: 1, fontFamily: 'inherit' }}
            />
          </div>
        </div>

        {/* history */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 10px 10px' }}>
          {groups.length === 0 && (
            <div style={{ fontSize: 12.5, color: 'var(--text-3)', textAlign: 'center', padding: '24px 12px', lineHeight: 1.7 }}>
              {query ? '没有匹配的历史议事' : '还没有历史议事。\n发起一场议会，完成后会自动归档到这里。'}
            </div>
          )}
          {groups.map((g) => (
            <div key={g.group} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', padding: '6px 8px 4px', letterSpacing: '.02em' }}>{g.group}</div>
              {g.items.map((it) => {
                const on = it.id === activeId;
                return (
                  <button
                    key={it.id}
                    onClick={() => onSelect(it.id)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                      padding: '8px 10px',
                      borderRadius: 10,
                      cursor: 'pointer',
                      border: '1px solid ' + (on ? 'var(--border-strong)' : 'transparent'),
                      background: on ? 'var(--surface)' : 'transparent',
                      boxShadow: on ? 'var(--shadow-raised)' : 'none',
                      transition: 'background .15s',
                      marginBottom: 1,
                    }}
                    onMouseEnter={(e) => !on && (e.currentTarget.style.background = 'var(--surface-2)')}
                    onMouseLeave={(e) => !on && (e.currentTarget.style.background = 'transparent')}
                  >
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: on ? 600 : 500,
                        color: on ? 'var(--text)' : 'var(--text-2)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: '100%',
                      }}
                    >
                      {it.prompt || '（无标题）'}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-3)', display: 'flex', gap: 7 }}>
                      <span>{timeOf(it.createdAt)}</span>
                      <span>·</span>
                      <span>{it.adapterIds.length} 家参会</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* footer */}
        <div style={{ padding: '10px 14px 14px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button onClick={onCalib} className="dx-row-btn" data-calib-anchor="true">
            <Ic.tune style={{ fontSize: 16, color: 'var(--text-2)' }} />
            <span style={{ flex: 1, textAlign: 'left', fontSize: 13, fontWeight: 600 }}>适配校准</span>
            <Ic.chevron style={{ fontSize: 13, color: 'var(--text-3)', transform: 'rotate(-90deg)' }} />
          </button>
          <ThemeSeg theme={theme} onChange={onTheme} />
        </div>
      </div>
    </aside>
  );
}
