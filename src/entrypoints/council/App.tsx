import { useEffect, useMemo, useState } from 'react';
import type { AdapterConfig, PickRole, SiteAdapter } from '../../shared/adapter-schema';
import { PICK_ROLE_LABELS } from '../../shared/adapter-schema';
import type { ProgressMessage } from '../../shared/messaging';
import { loadAdapterConfig, type ConfigSource } from '../../council-page/config-loader';
import { broadcastStageOne, driveLeg, resumeCouncil, type LegResult, type CouncilTabs } from '../../council-page/orchestrator';
import { openCalibration, startInPageCalibration, closeCalibration } from '../../council-page/calibration';
import { clearSiteOverride, exportOverrides, importOverrides, type UserOverrides } from '../../shared/overrides';
import { loadSession, clearSession, hasRecoverableLegs, type SessionState } from '../../shared/session-state';

const STAGE_LABEL: Record<ProgressMessage['stage'], string> = {
  injecting: '注入问题…',
  submitted: '已发送，生成中…',
  awaiting: '生成中…',
  extracting: '抽取回答…',
};

type LegView =
  | { kind: 'pending' }
  | { kind: 'running'; stage?: ProgressMessage['stage'] }
  | { kind: 'done'; text: string }
  | { kind: 'error'; message: string };

export function App() {
  const [config, setConfig] = useState<AdapterConfig | null>(null);
  const [source, setSource] = useState<ConfigSource | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [prompt, setPrompt] = useState('');
  const [running, setRunning] = useState(false);
  const [legs, setLegs] = useState<Record<string, LegView>>({});
  // 本次议会开出的标签页与提交的问题，供「重试」复用（登录后重发）。
  const [council, setCouncil] = useState<CouncilTabs | null>(null);
  const [askedPrompt, setAskedPrompt] = useState('');
  // Phase 3（ADR-0009）：深度思考开关 + 用户覆盖层 + 校准会话。
  const [enableThinking, setEnableThinking] = useState(false);
  const [overrides, setOverrides] = useState<UserOverrides>({});
  // 正在校准的站点 id（在站点页内进行）；null 表示无校准进行中。
  const [calibratingId, setCalibratingId] = useState<string | null>(null);
  const [calibMsg, setCalibMsg] = useState('');
  // 跨浏览器对齐：导出/导入校准的文本框内容。
  const [transferText, setTransferText] = useState('');
  // Phase 4（ADR-0004/0011）：检测到的可恢复会话（刷新/崩溃后续跑）。
  const [resumable, setResumable] = useState<SessionState | null>(null);

  useEffect(() => {
    loadAdapterConfig().then(({ config, source, overrides }) => {
      setConfig(config);
      setSource(source);
      setOverrides(overrides);
      // 默认全选中文站点（ToS 风险更低），海外站点默认不选。
      const cn = new Set(['deepseek', 'kimi', 'qwen', 'doubao', 'yuanbao']);
      setSelected(new Set(config.adapters.filter((a) => cn.has(a.id)).map((a) => a.id)));
    });
    // 检测上次未完成的议会，提示恢复。
    loadSession().then((s) => {
      if (s && hasRecoverableLegs(s)) setResumable(s);
    });
  }, []);

  // 覆盖变化后，重载有效配置（让校准结果即时反映到展示与广播）。
  async function refreshConfig() {
    const { config, overrides } = await loadAdapterConfig();
    setConfig(config);
    setOverrides(overrides);
  }

  // —— 校准（ADR-0009）：打开站点窗口 → 在站点页内的工具条上完成全部校准 → 关窗刷新 ——
  async function startCalibrate(adapter: SiteAdapter) {
    if (calibratingId) return;
    setCalibratingId(adapter.id);
    setCalibMsg(`正在打开 ${adapter.displayName} 校准窗口…`);
    try {
      const session = await openCalibration(adapter);
      setCalibMsg(`已打开 ${adapter.displayName}：在该页面**顶部工具条**上点角色按钮，再到页面点选元素；完成后点工具条「完成校准」。`);
      await startInPageCalibration(session); // 等用户点页内「完成校准」或关闭窗口
      await closeCalibration(session);
      await refreshConfig();
      setCalibMsg(`${adapter.displayName} 校准完成。`);
    } catch (err) {
      setCalibMsg(`校准失败：${String(err)}`);
    } finally {
      setCalibratingId(null);
    }
  }

  async function resetSite(adapter: SiteAdapter) {
    await clearSiteOverride(adapter.id);
    await refreshConfig();
    setCalibMsg(`已清除 ${adapter.displayName} 的全部本地校准。`);
  }

  function overriddenRoles(adapterId: string): PickRole[] {
    const sel = overrides[adapterId]?.selectors;
    return sel ? (Object.keys(sel) as PickRole[]) : [];
  }

  // —— 跨浏览器对齐：导出 / 导入校准（ADR-0009）——
  async function doExport() {
    const data = await exportOverrides();
    const json = JSON.stringify(data, null, 2);
    setTransferText(json);
    try {
      await navigator.clipboard.writeText(json);
      setCalibMsg(`已导出 ${Object.keys(data).length} 个站点的校准到下方文本框，并复制到剪贴板。`);
    } catch {
      setCalibMsg(`已导出到下方文本框（剪贴板不可用，请手动复制）。`);
    }
  }

  async function doImport() {
    const text = transferText.trim();
    if (!text) {
      setCalibMsg('请先把另一个浏览器导出的 JSON 粘贴到下方文本框，再点导入。');
      return;
    }
    let parsed: UserOverrides;
    try {
      parsed = JSON.parse(text) as UserOverrides;
    } catch {
      setCalibMsg('导入失败：文本框内容不是合法 JSON。');
      return;
    }
    const n = await importOverrides(parsed, 'merge');
    await refreshConfig();
    setCalibMsg(`已合并导入 ${n} 个站点的校准（同名项以导入为准）。`);
  }

  const chosen: SiteAdapter[] = useMemo(
    () => (config ? config.adapters.filter((a) => selected.has(a.id)) : []),
    [config, selected],
  );

  function toggle(id: string) {
    if (running) return;
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function start() {
    const q = prompt.trim();
    if (!q || running || chosen.length === 0) return;
    setRunning(true);
    setAskedPrompt(q);
    setLegs(Object.fromEntries(chosen.map((a) => [a.id, { kind: 'pending' } as LegView])));

    const { council, results } = await broadcastStageOne(
      chosen,
      q,
      {
        onLegStage: (id, stage) => setLegs((prev) => ({ ...prev, [id]: { kind: 'running', stage } })),
        onLegResult: (r) => setLegs((prev) => ({ ...prev, [r.adapterId]: toView(r) })),
      },
      { enableThinking },
    );
    setCouncil(council);
    setLegs(Object.fromEntries(results.map((r) => [r.adapterId, toView(r)])));
    setRunning(false);
  }

  // —— 崩溃恢复（ADR-0004/0011）：续跑上次未完成的议会 ——
  async function resume() {
    if (!config || !resumable || running) return;
    const session = resumable;
    setResumable(null);
    setRunning(true);
    setPrompt(session.prompt);
    setAskedPrompt(session.prompt);
    setEnableThinking(session.enableThinking);
    // 按会话保序取回参会站点（有效配置含用户覆盖）。
    const byId = new Map(config.adapters.map((a) => [a.id, a] as const));
    const adapters = session.adapterIds.map((id) => byId.get(id)).filter((a): a is SiteAdapter => !!a);
    setSelected(new Set(adapters.map((a) => a.id)));
    // 用存档初始化各腿展示：已完成的直接显示，其余标记进行中。
    setLegs(
      Object.fromEntries(
        adapters.map((a) => {
          const leg = session.legs[a.id];
          return [a.id, leg?.status === 'done' && leg.text ? { kind: 'done', text: leg.text } as LegView : { kind: 'running' } as LegView];
        }),
      ),
    );
    const { council, results } = await resumeCouncil(session, adapters, {
      onLegStage: (id, stage) => setLegs((prev) => ({ ...prev, [id]: { kind: 'running', stage } })),
      onLegResult: (r) => setLegs((prev) => ({ ...prev, [r.adapterId]: toView(r) })),
    });
    setCouncil(council);
    setLegs(Object.fromEntries(results.map((r) => [r.adapterId, toView(r)])));
    setRunning(false);
  }

  async function dismissResume() {
    await clearSession();
    setResumable(null);
  }

  // 对单家重试：复用已打开的标签页（登录后重发）。
  async function retry(adapter: SiteAdapter) {
    const tabId = council?.tabs.get(adapter.id);
    if (tabId == null || !askedPrompt) return;
    setLegs((prev) => ({ ...prev, [adapter.id]: { kind: 'running' } }));
    const r = await driveLeg(
      adapter,
      tabId,
      askedPrompt,
      { onLegStage: (id, stage) => setLegs((prev) => ({ ...prev, [id]: { kind: 'running', stage } })) },
      { enableThinking },
    );
    setLegs((prev) => ({ ...prev, [adapter.id]: toView(r) }));
  }

  if (!config) return <main style={styles.page}>正在加载适配器配置…</main>;

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.title}>集思 · Delphi</h1>
        <p style={styles.subtitle}>
          Phase 2 · 多站点并行广播（阶段一）—— 配置来源：{sourceLabel(source)}
        </p>
      </header>

      {resumable && !running && (
        <div style={styles.resumeBar}>
          <span>
            检测到上次未完成的议会（{new Date(resumable.createdAt).toLocaleString()}）：
            「{resumable.prompt.slice(0, 30)}{resumable.prompt.length > 30 ? '…' : ''}」。是否续跑？
            <span style={styles.resumeNote}>（已完成的站点直接沿用存档，不重复消耗额度）</span>
          </span>
          <span style={styles.resumeBtns}>
            <button style={styles.smallBtn} onClick={resume}>恢复</button>
            <button style={styles.resetBtn} onClick={dismissResume}>丢弃</button>
          </span>
        </div>
      )}

      <section style={styles.sites}>
        {config.adapters.map((a) => (
          <label key={a.id} style={{ ...styles.chip, ...(selected.has(a.id) ? styles.chipOn : {}) }}>
            <input
              type="checkbox"
              checked={selected.has(a.id)}
              disabled={running}
              onChange={() => toggle(a.id)}
              style={{ marginRight: 6 }}
            />
            {a.displayName}
          </label>
        ))}
      </section>

      <textarea
        style={styles.textarea}
        placeholder="输入要请教 AI 议会的问题…"
        value={prompt}
        disabled={running}
        onChange={(e) => setPrompt(e.target.value)}
      />

      <div style={styles.actionRow}>
        <button
          style={{ ...styles.button, ...(running || !prompt.trim() || chosen.length === 0 ? styles.buttonOff : {}) }}
          onClick={start}
          disabled={running || !prompt.trim() || chosen.length === 0}
        >
          {running ? `议事中…（${chosen.length} 家）` : `发起议事（${chosen.length} 家）`}
        </button>
        <label style={styles.thinkLabel}>
          <input
            type="checkbox"
            checked={enableThinking}
            disabled={running}
            onChange={(e) => setEnableThinking(e.target.checked)}
            style={{ marginRight: 6 }}
          />
          深度思考（需先校准各站「深度思考开关」）
        </label>
      </div>

      <details style={styles.calibBox}>
        <summary style={styles.calibSummary}>适配校准（站点改版时自助修复选择器）</summary>
        <p style={styles.calibHint}>
          选择器随站点改版会失效。点「校准」打开该站点窗口，**校准操作全部在那个页面的顶部工具条上完成**
          （点角色按钮 → 到页面点选元素；回答区点某条 AI 回复正文；深度思考多步在页内连续点选）。完成后点工具条「完成校准」即可。优先级：你的校准 &gt; 远程 &gt; 内置。
        </p>
        {calibMsg && <p style={styles.calibStatus}>{calibMsg}</p>}
        <div style={styles.calibList}>
          {config.adapters.map((a) => {
            const roles = overriddenRoles(a.id);
            const thinkSteps = overrides[a.id]?.thinkingActivation?.length ?? 0;
            const active = calibratingId === a.id;
            const tags = [
              ...roles.map((r) => PICK_ROLE_LABELS[r]),
              ...(thinkSteps ? [`深度思考(${thinkSteps}步)`] : []),
            ];
            return (
              <div key={a.id} style={styles.calibRow}>
                <div style={styles.calibSite}>
                  <strong>{a.displayName}</strong>
                  <span style={styles.calibTag}>{tags.length ? `已校准：${tags.join('、')}` : '未校准'}</span>
                </div>
                <div style={styles.calibBtns}>
                  {active ? (
                    <span style={styles.recTag}>校准窗口已打开，请到该页面顶部工具条操作…</span>
                  ) : (
                    <button style={styles.smallBtn} disabled={!!calibratingId} onClick={() => startCalibrate(a)}>
                      校准
                    </button>
                  )}
                  {(roles.length > 0 || thinkSteps > 0) && !active && (
                    <button style={styles.resetBtn} onClick={() => resetSite(a)}>
                      重置
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div style={styles.transferBox}>
          <div style={styles.transferHead}>
            <strong style={{ fontSize: 13 }}>跨浏览器对齐校准</strong>
            <span style={styles.calibTag}>
              在每个浏览器导出 → 汇总粘贴到一处 → 导入合并；用于把不同浏览器分别校准的站点拼到一起。
            </span>
          </div>
          <textarea
            style={styles.transferText}
            placeholder="点「导出」把本浏览器校准填到这里；或粘贴其它浏览器导出的 JSON 后点「导入合并」。"
            value={transferText}
            onChange={(e) => setTransferText(e.target.value)}
          />
          <div style={styles.calibBtns}>
            <button style={styles.smallBtn} onClick={doExport}>
              导出本浏览器校准
            </button>
            <button style={styles.smallBtn} onClick={doImport}>
              导入合并
            </button>
          </div>
        </div>
      </details>

      <section style={styles.results}>
        {chosen.map((a) => {
          const view = legs[a.id] ?? { kind: 'pending' as const };
          return (
            <article key={a.id} style={styles.card}>
              <h2 style={styles.cardTitle}>
                {a.displayName} <span style={styles.cardStatus}>{statusText(view)}</span>
              </h2>
              {view.kind === 'done' && <pre style={styles.answer}>{view.text}</pre>}
              {view.kind === 'error' && (
                <div>
                  <p style={styles.error}>⚠️ {view.message}</p>
                  {council?.tabs.has(a.id) && !running && (
                    <button style={styles.retry} onClick={() => retry(a)}>
                      重试（登录后点此重发）
                    </button>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </section>
    </main>
  );
}

const CODE_LABEL: Partial<Record<NonNullable<LegResult['code']>, string>> = {
  not_logged_in: '需要登录：请切到该站点的标签页登录后点「重试」',
  captcha: '出现人机验证：请切到该站点的标签页手动通过后点「重试」',
  input_not_found: '没找到输入框（页面结构可能变了）',
  extraction_empty: '没抓到回答内容（页面结构可能变了）',
  timeout: '等待生成超时',
};

function toView(r: LegResult): LegView {
  if (r.ok && r.text) return { kind: 'done', text: r.text };
  const friendly = r.code ? CODE_LABEL[r.code] : undefined;
  return { kind: 'error', message: friendly ?? r.error ?? '未知错误' };
}

function statusText(v: LegView): string {
  switch (v.kind) {
    case 'pending':
      return '待开始';
    case 'running':
      return v.stage ? STAGE_LABEL[v.stage] : '打开中…';
    case 'done':
      return '✅ 已完成';
    case 'error':
      return '❌ 失败';
  }
}

function sourceLabel(s: ConfigSource | null): string {
  if (s === 'remote') return '远程';
  if (s === 'cache') return '缓存';
  return '内置兜底';
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: 820,
    margin: '0 auto',
    padding: '32px 24px',
    fontFamily: 'system-ui, -apple-system, "PingFang SC", sans-serif',
    color: '#1a1a1a',
  },
  header: { marginBottom: 20 },
  title: { fontSize: 28, fontWeight: 700, margin: 0 },
  subtitle: { color: '#666', marginTop: 6, fontSize: 14 },
  sites: { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '6px 12px',
    border: '1px solid #d0d0d0',
    borderRadius: 999,
    fontSize: 14,
    cursor: 'pointer',
    userSelect: 'none',
  },
  chipOn: { borderColor: '#2b6cff', background: '#eef3ff', color: '#1a47b8' },
  textarea: {
    width: '100%',
    minHeight: 110,
    padding: 12,
    fontSize: 15,
    border: '1px solid #d0d0d0',
    borderRadius: 8,
    resize: 'vertical',
    boxSizing: 'border-box',
  },
  button: {
    marginTop: 12,
    padding: '10px 20px',
    fontSize: 15,
    fontWeight: 600,
    color: '#fff',
    background: '#2b6cff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
  },
  buttonOff: { background: '#b9c4d6', cursor: 'not-allowed' },
  results: { marginTop: 24, display: 'grid', gap: 12 },
  card: { border: '1px solid #ececf0', borderRadius: 10, padding: 16 },
  cardTitle: { fontSize: 16, fontWeight: 600, margin: '0 0 8px' },
  cardStatus: { fontSize: 13, fontWeight: 400, color: '#888', marginLeft: 8 },
  answer: {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    background: '#f7f7f8',
    padding: 14,
    borderRadius: 8,
    fontSize: 14,
    lineHeight: 1.6,
    fontFamily: 'inherit',
    margin: 0,
  },
  error: { color: '#c0392b', fontSize: 14, margin: '0 0 8px' },
  retry: {
    padding: '6px 14px',
    fontSize: 13,
    fontWeight: 600,
    color: '#2b6cff',
    background: '#fff',
    border: '1px solid #2b6cff',
    borderRadius: 6,
    cursor: 'pointer',
  },
  actionRow: { display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' },
  thinkLabel: { fontSize: 13, color: '#555', display: 'inline-flex', alignItems: 'center', cursor: 'pointer' },
  calibBox: { marginTop: 20, border: '1px solid #ececf0', borderRadius: 10, padding: '8px 16px' },
  calibSummary: { fontSize: 14, fontWeight: 600, cursor: 'pointer', padding: '6px 0' },
  calibHint: { fontSize: 12, color: '#888', lineHeight: 1.6, margin: '4px 0 8px' },
  calibStatus: { fontSize: 13, color: '#1a47b8', background: '#eef3ff', padding: '8px 12px', borderRadius: 6, margin: '0 0 10px', wordBreak: 'break-all' },
  calibList: { display: 'grid', gap: 8 },
  calibRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '6px 0', borderTop: '1px solid #f3f3f5' },
  calibSite: { display: 'flex', flexDirection: 'column', gap: 2 },
  calibTag: { fontSize: 12, color: '#888' },
  calibBtns: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  smallBtn: { padding: '5px 12px', fontSize: 13, fontWeight: 600, color: '#2b6cff', background: '#fff', border: '1px solid #2b6cff', borderRadius: 6, cursor: 'pointer' },
  roleBtn: { padding: '5px 10px', fontSize: 12, color: '#333', background: '#f3f6ff', border: '1px solid #c9d8ff', borderRadius: 6, cursor: 'pointer' },
  resetBtn: { padding: '5px 12px', fontSize: 13, color: '#c0392b', background: '#fff', border: '1px solid #e0b4b0', borderRadius: 6, cursor: 'pointer' },
  recTag: { fontSize: 12, color: '#b8860b', alignSelf: 'center' },
  transferBox: { marginTop: 14, paddingTop: 12, borderTop: '1px solid #ececf0', display: 'grid', gap: 8 },
  transferHead: { display: 'flex', flexDirection: 'column', gap: 2 },
  transferText: {
    width: '100%',
    minHeight: 96,
    padding: 10,
    fontSize: 12,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    border: '1px solid #d0d0d0',
    borderRadius: 8,
    resize: 'vertical',
    boxSizing: 'border-box',
  },
  resumeBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
    background: '#fff8e6',
    border: '1px solid #f0d68a',
    borderRadius: 8,
    padding: '10px 14px',
    fontSize: 13,
    color: '#6b5310',
    marginBottom: 16,
  },
  resumeNote: { color: '#9a8030', marginLeft: 4 },
  resumeBtns: { display: 'flex', gap: 8, flexShrink: 0 },
};
