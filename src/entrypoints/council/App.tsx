/* ============================================================
   集思 · Delphi — Council Page（Phase 9 UI 精调 / ADR-0015）

   设计稿落地：左侧历史侧栏 + 主题切换；中央 介绍 → 模型/主席选择 → 输入区 →
   主席结论 → 成员进度卡片 → 辩论时间线；成员卡片为「概览方块 + 阶段步进器」，
   点击阶段弹窗看完整原文；一键追问跳原生页。全部接真实 XState 机器与归档持久化。
   ============================================================ */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMachine } from '@xstate/react';
import { councilMachine } from '../../council-page/machine';
import type { AdapterConfig, PickRole, SiteAdapter } from '../../shared/adapter-schema';
import { PICK_ROLE_LABELS } from '../../shared/adapter-schema';
import type { ProgressMessage } from '../../shared/messaging';
import { loadAdapterConfig, type ConfigSource } from '../../council-page/config-loader';
import { driveLeg, type LegResult } from '../../council-page/orchestrator';
import { openCalibration, startInPageCalibration, closeCalibration } from '../../council-page/calibration';
import { clearSiteOverride, exportOverrides, importOverrides, type UserOverrides } from '../../shared/overrides';
import { COMMUNITY_REPO, openContributionIssue } from '../../shared/contribution';
import {
  loadSession,
  clearSession,
  loadArchive,
  archiveSession,
  type SessionState,
  type DebateState,
  type ArchivedSession,
} from '../../shared/session-state';

import { useTheme } from './theme';
import { deriveLeg, type LegView, type MachineValue, type StageKey } from './leg-model';
import { Ic } from './ui/icons';
import { Sidebar } from './components/Sidebar';
import { Composer, ModelPicker, RecoveryBar } from './components/Composer';
import { ProgressCard } from './components/ProgressCard';
import { DetailModal } from './components/DetailModal';
import { DebateTimeline } from './components/DebateTimeline';
import { ConclusionPanel } from './components/ConclusionPanel';
import { CalibrationPanel } from './components/CalibrationPanel';

const CODE_LABEL: Record<string, string> = {
  not_logged_in: '需要登录该站点（登录后点「重试」）',
  captcha: '出现人机验证（手动通过后点「重试」）',
  input_not_found: '没找到输入框（页面结构可能变了）',
  extraction_empty: '没抓到回答内容（页面结构可能变了）',
  timeout: '等待生成超时',
};

function toView(r: LegResult): LegView {
  if (r.ok && r.text) return { kind: 'done', text: r.text };
  const friendly = r.code ? CODE_LABEL[r.code] : undefined;
  return { kind: 'error', message: friendly ?? r.error ?? '未知错误' };
}

/** 默认勾选的国内站点（海外站点需用户日常浏览器加载，见 README）。 */
const DEFAULT_CN = new Set(['deepseek', 'kimi', 'qwen', 'doubao', 'yuanbao']);

type ViewMode = 'idle' | 'live' | 'archive';

export function App() {
  const [config, setConfig] = useState<AdapterConfig | null>(null);
  const [source, setSource] = useState<ConfigSource | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [chairpersonId, setChairpersonId] = useState<string>('');
  const [prompt, setPrompt] = useState('');
  const [enableThinking, setEnableThinking] = useState(true);
  const [enableDebate, setEnableDebate] = useState(false);

  const [legs, setLegs] = useState<Record<string, LegView>>({});
  const [askedPrompt, setAskedPrompt] = useState('');
  const [liveDebate, setLiveDebate] = useState<DebateState | null>(null);

  const [overrides, setOverrides] = useState<UserOverrides>({});
  const [calibratingId, setCalibratingId] = useState<string | null>(null);
  const [calibMsg, setCalibMsg] = useState('');
  const [calibOpen, setCalibOpen] = useState(false);
  const [transferText, setTransferText] = useState('');

  const [resumable, setResumable] = useState<SessionState | null>(null);

  // 主题、侧栏、历史回看、弹窗、辩论身份揭示
  const [theme, setTheme] = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [archive, setArchive] = useState<ArchivedSession[]>([]);
  const [mode, setMode] = useState<ViewMode>('idle');
  const [viewArchived, setViewArchived] = useState<ArchivedSession | null>(null);
  const [activeHist, setActiveHist] = useState<string | null>(null);
  const [modal, setModal] = useState<{ legId: string; stageKey: StageKey } | null>(null);
  const [reveal, setReveal] = useState(false);

  const chosen: SiteAdapter[] = useMemo(() => (config ? config.adapters.filter((a) => selected.has(a.id)) : []), [config, selected]);

  const [state, send] = useMachine(councilMachine, {
    input: {
      session: null,
      adapters: chosen,
      hooks: {
        onLegStage: (id: string, stage: ProgressMessage['stage']) => setLegs((prev) => ({ ...prev, [id]: { kind: 'running', stage } })),
        onLegResult: (r: LegResult) => setLegs((prev) => ({ ...prev, [r.adapterId]: toView(r) })),
        onDebateUpdate: (d: DebateState) => setLiveDebate({ converged: d.converged, rounds: d.rounds.map((r) => ({ ...r, targets: r.targets.map((t) => ({ ...t })) })) }),
      },
    },
  });

  const running = !state.matches('idle') && !state.matches('finished') && !state.matches('error');
  const machineValue = String(state.value) as MachineValue;

  // —— 初始化：配置 + 归档 + 可恢复会话 ——
  useEffect(() => {
    loadAdapterConfig().then(({ config, source, overrides }) => {
      setConfig(config);
      setSource(source);
      setOverrides(overrides);
      const ids = config.adapters.filter((a) => DEFAULT_CN.has(a.id)).map((a) => a.id);
      setSelected(new Set(ids));
      if (ids.length > 0) setChairpersonId(ids[0] ?? '');
    });
    loadArchive().then(setArchive);
    loadSession().then((s) => {
      if (s && s.status !== 'finished') setResumable(s);
    });
  }, []);

  // —— 议会完成即归档 ——（dedup 由 archiveSession 负责；用 ref 防重复触发）
  const archivedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!state.matches('finished')) return;
    const s = state.context.session;
    if (!s || archivedRef.current === s.id) return;
    archivedRef.current = s.id;
    archiveSession(s).then(() => loadArchive().then(setArchive));
    setActiveHist(s.id);
    // 议事完成后清空输入框：此时按钮切换为「关闭所有打开的标签页」，
    // 用户输入新问题即自动恢复为「发起议事」。
    setPrompt('');
  }, [state]);

  async function refreshConfig() {
    const { config, overrides } = await loadAdapterConfig();
    setConfig(config);
    setOverrides(overrides);
  }

  // —— 展示源：archive 回看 / live 机器 / idle 介绍 ——
  const liveSession = state.context.session;
  const displaySession: SessionState | null = mode === 'archive' ? viewArchived : mode === 'live' ? liveSession ?? null : null;
  const displayValue: MachineValue = mode === 'archive' ? 'finished' : machineValue;
  const showingArchive = mode === 'archive';

  const adapterById = useMemo(() => new Map((config?.adapters ?? []).map((a) => [a.id, a] as const)), [config]);
  const nameOf = (id: string) => adapterById.get(id)?.displayName ?? id;

  const displayChair = displaySession?.chairpersonId ?? chairpersonId;

  const legModels = useMemo(() => {
    if (!displaySession) return [];
    return displaySession.adapterIds
      .map((id) => adapterById.get(id))
      .filter((a): a is SiteAdapter => !!a)
      .map((a) =>
        deriveLeg(a, {
          session: displaySession,
          machineValue: displayValue,
          live: showingArchive ? undefined : legs[a.id],
          chairpersonId: displayChair,
        }),
      );
  }, [displaySession, displayValue, showingArchive, legs, adapterById, displayChair]);

  // idle（首页）不展示任何辩论时间线；否则按回看/实时取。
  const displayDebate: DebateState | null =
    mode === 'idle' ? null : showingArchive ? viewArchived?.debate ?? null : liveDebate ?? liveSession?.debate ?? null;
  const summary = displaySession?.summary;
  const finished = mode !== 'idle' && (showingArchive || state.matches('finished'));

  const participated = displaySession ? displaySession.adapterIds.filter((id) => displaySession.initialAnswers?.[id]).length : 0;
  const failedCount = displaySession ? displaySession.adapterIds.length - participated : 0;

  // —— 选择/主席 ——
  function toggle(id: string) {
    if (running) return;
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      if (!next.has(chairpersonId) && next.size > 0) setChairpersonId(Array.from(next)[0] ?? '');
      else if (next.size === 0) setChairpersonId('');
      return next;
    });
  }

  async function closeAllTabs() {
    if (!state.context.session) return;
    const tabIds: number[] = [];
    for (const leg of Object.values(state.context.session.legs)) {
      if (leg.tabId != null) tabIds.push(leg.tabId);
    }
    if (tabIds.length > 0) {
      try {
        await chrome.tabs.remove(tabIds);
      } catch (err) {
        console.warn('Failed to close some tabs:', err);
      }
    }
  }

  async function start() {
    const q = prompt.trim();
    if (!q || running || chosen.length < 2 || !chairpersonId) return;
    await closeAllTabs();
    archivedRef.current = null;
    setAskedPrompt(q);
    setLiveDebate(null);
    setViewArchived(null);
    setActiveHist(null);
    setMode('live');
    setLegs(Object.fromEntries(chosen.map((a) => [a.id, { kind: 'pending' } as LegView])));
    send({ type: 'START', prompt: q, enableThinking, enableDebate, chairpersonId, adapters: chosen });
  }

  async function abort() {
    if (!running) return;
    await closeAllTabs();
    // 中止前把当前（部分）会话归档，便于回看已产出的内容。
    const s = state.context.session;
    if (s) {
      archivedRef.current = s.id;
      await archiveSession({ ...s, status: 'finished' });
      await loadArchive().then(setArchive);
    }
    send({ type: 'ABORT' });
  }

  async function newCouncil() {
    if (running) return;
    // 回到首页前，关掉上一轮议会打开的全部 AI 窗口（按 session 记录的 tabId）。
    await closeAllTabs();
    setMode('idle');
    setViewArchived(null);
    setActiveHist(null);
    setPrompt('');
    setLegs({});
    setLiveDebate(null);
  }

  function selectHistory(id: string) {
    if (running) return;
    const item = archive.find((s) => s.id === id);
    if (!item) return;
    setViewArchived(item);
    setActiveHist(id);
    setMode('archive');
    setModal(null);
  }

  async function resume() {
    if (!config || !resumable || running) return;
    const session = resumable;
    setResumable(null);
    archivedRef.current = null;
    setPrompt(session.prompt);
    setAskedPrompt(session.prompt);
    setEnableThinking(session.enableThinking);
    setEnableDebate(session.enableDebate ?? false);
    setLiveDebate(session.debate ?? null);
    setChairpersonId(session.chairpersonId ?? session.adapterIds[0] ?? '');
    const adapters = session.adapterIds.map((id) => adapterById.get(id)).filter((a): a is SiteAdapter => !!a);
    setSelected(new Set(adapters.map((a) => a.id)));
    setMode('live');
    setViewArchived(null);
    setLegs(
      Object.fromEntries(
        adapters.map((a) => {
          const leg = session.legs[a.id];
          return [a.id, leg?.status === 'done' && leg.text ? ({ kind: 'done', text: leg.text } as LegView) : ({ kind: 'running' } as LegView)];
        }),
      ),
    );
    send({ type: 'RESUME', session, adapters });
  }

  async function dismissResume() {
    await clearSession();
    setResumable(null);
  }

  async function retry(id: string) {
    const adapter = adapterById.get(id);
    const tabId = state.context.council?.tabs.get(id);
    if (!adapter || tabId == null || !askedPrompt) return;
    setLegs((prev) => ({ ...prev, [id]: { kind: 'running' } }));
    const r = await driveLeg(adapter, tabId, askedPrompt, { onLegStage: (lid, stage) => setLegs((prev) => ({ ...prev, [lid]: { kind: 'running', stage } })) }, { enableThinking });
    setLegs((prev) => ({ ...prev, [id]: toView(r) }));
  }

  async function askNative(id: string) {
    const a = adapterById.get(id);
    if (!a) return;
    // 优先切到本场议会已打开、且仍存活的该站标签页（直接在原对话里追问）；
    // 仅当回看历史 / 标签页已被关闭 / 拿不到 tabId 时，才新建一个原生页。
    const liveTabId = !showingArchive ? state.context.session?.legs[id]?.tabId : undefined;
    if (liveTabId != null) {
      try {
        const tab = await chrome.tabs.get(liveTabId);
        await chrome.tabs.update(liveTabId, { active: true });
        if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
        return;
      } catch {
        /* 标签页已关闭 → 落到新建分支 */
      }
    }
    if (a.newChatUrl) {
      chrome.tabs.create({ url: a.newChatUrl, active: true }).catch((err) => console.warn('open native page failed', err));
    }
  }

  // —— 校准通路 ——
  async function startCalibrate(adapter: SiteAdapter) {
    if (calibratingId) return;
    setCalibratingId(adapter.id);
    setCalibMsg(`正在打开 ${adapter.displayName} 校准窗口…在该页面顶部工具条点角色按钮、再到页面点选元素，完成后点「完成校准」。`);
    try {
      const session = await openCalibration(adapter);
      await startInPageCalibration(session);
      await closeCalibration(session);
      await refreshConfig();
      setCalibMsg(`${adapter.displayName} 校准完成。`);
    } catch (err) {
      setCalibMsg(`校准失败：${String(err)}`);
    } finally {
      setCalibratingId(null);
    }
  }

  async function doContribute(adapter: SiteAdapter) {
    const result = await openContributionIssue(adapter, overrides[adapter.id]);
    if (result.ok) {
      const extra = result.identicalKeys && result.identicalKeys.length > 0 ? `（已自动排除与内置一致的项：${result.identicalKeys.join('、')}）` : '';
      setCalibMsg(`已为 ${adapter.displayName} 打开 GitHub 提交页：核对后点「Submit new issue」。审核合并后所有人自动获益。${extra}`);
    } else if (result.noDiff) {
      setCalibMsg(`${adapter.displayName} 当前校准与内置完全一致（涉及：${result.identicalKeys?.join('、')}），无需重复贡献。`);
    } else {
      setCalibMsg(`${adapter.displayName} 暂无可贡献的校准，或尚未配置社区配置仓。`);
    }
  }

  async function resetSite(adapter: SiteAdapter) {
    await clearSiteOverride(adapter.id);
    await refreshConfig();
    setCalibMsg(`已清除 ${adapter.displayName} 的全部本地校准。`);
  }

  async function doExport() {
    const data = await exportOverrides();
    const json = JSON.stringify(data, null, 2);
    setTransferText(json);
    try {
      await navigator.clipboard.writeText(json);
      setCalibMsg(`已导出 ${Object.keys(data).length} 个站点的校准到文本框，并复制到剪贴板。`);
    } catch {
      setCalibMsg(`已导出到文本框（剪贴板不可用，请手动复制）。`);
    }
  }

  async function doImport() {
    const text = transferText.trim();
    if (!text) {
      setCalibMsg('请先把另一个浏览器导出的 JSON 粘贴到文本框，再点导入。');
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

  function tagsFor(id: string): string[] {
    const ov = overrides[id];
    if (!ov) return [];
    const tags: string[] = [];
    if (ov.selectors) for (const r of Object.keys(ov.selectors) as PickRole[]) tags.push(PICK_ROLE_LABELS[r]);
    if (ov.thinkingActivation?.length) tags.push(`深度思考(${ov.thinkingActivation.length}步)`);
    if (ov.thinkingState) tags.push('思考状态判别');
    return tags;
  }
  const hasOverride = (id: string) => tagsFor(id).length > 0;

  if (!config) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh', color: 'var(--text-2)', fontFamily: 'var(--font-sans)' }}>正在加载适配器配置…</div>
    );
  }

  const phaseLabel = running ? '议事进行中' : finished ? '已完成' : '空闲';
  const phaseColor = running ? 'var(--running)' : finished ? 'var(--done)' : 'var(--text-3)';
  const topQuestion = mode === 'archive' ? viewArchived?.prompt : mode === 'live' ? askedPrompt || liveSession?.prompt : '';

  const allModels = config.adapters.map((a) => ({ id: a.id, displayName: a.displayName }));

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        theme={theme}
        onTheme={setTheme}
        archive={archive}
        activeId={activeHist}
        onSelect={selectHistory}
        onNew={newCouncil}
        onCalib={() => setCalibOpen((c) => !c)}
      />

      <main style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
        {/* top bar */}
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '13px 28px',
            background: 'color-mix(in srgb, var(--bg-solid) 82%, transparent)',
            backdropFilter: 'blur(10px)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          {collapsed && (
            <button className="dx-icon-btn" onClick={() => setCollapsed(false)}>
              <Ic.panel style={{ fontSize: 17 }} />
            </button>
          )}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              fontSize: 13,
              fontWeight: 600,
              color: phaseColor,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 20,
              padding: '5px 12px',
              boxShadow: 'var(--shadow-raised)',
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: phaseColor, animation: running ? 'pulse-dot 1.1s infinite' : 'none' }} />
            {phaseLabel}
          </div>
          <div style={{ flex: 1, fontSize: 13.5, color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {topQuestion}
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>配置：{sourceLabel(source)}</span>
        </div>

        <div style={{ maxWidth: 940, margin: '0 auto', padding: '26px 28px 120px' }}>
          {resumable && !running && (
            <RecoveryBar prompt={resumable.prompt} onResume={resume} onDiscard={dismissResume} />
          )}

          {/* intro */}
          {mode === 'idle' && !running && (
            <div style={{ textAlign: 'center', padding: '16px 0 30px', animation: 'rise .4s ease both' }}>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: 'var(--accent)',
                  background: 'var(--accent-soft)',
                  border: '1px solid var(--chair-bd)',
                  borderRadius: 20,
                  padding: '5px 13px',
                  marginBottom: 16,
                }}
              >
                <Ic.spark style={{ fontSize: 14 }} /> 多 AI 议会 · 德尔斐法
              </div>
              <h1 style={{ fontSize: 30, fontWeight: 800, margin: '0 0 10px', letterSpacing: '-.02em', lineHeight: 1.2 }}>
                让多家 AI 各抒己见，
                <br />
                再为你收敛出一个可信结论
              </h1>
              <p style={{ fontSize: 15, color: 'var(--text-2)', lineHeight: 1.7, maxWidth: 560, margin: '0 auto' }}>
                一个问题，交给多家 AI 独立作答、互相匿名评审、（可选）多轮辩论，最后由你指定的「主席」综合出共识点、争议区与置信度。零配置，复用你已登录的各家网页。
              </p>
            </div>
          )}

          {/* calibration popover */}
          <CalibrationPanel
            open={calibOpen}
            onClose={() => setCalibOpen(false)}
            adapters={config.adapters}
            busyId={calibratingId}
            statusMsg={calibMsg}
            communityRepo={!!COMMUNITY_REPO}
            tagsFor={tagsFor}
            hasOverride={hasOverride}
            onCalibrate={startCalibrate}
            onContribute={doContribute}
            onReset={resetSite}
            transferText={transferText}
            setTransferText={setTransferText}
            onExport={doExport}
            onImport={doImport}
          />

          {/* picker + composer（仅在非回看时展示发起入口） */}
          {!showingArchive && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginBottom: 26 }}>
              <ModelPicker models={allModels} selected={selected} chair={chairpersonId} onToggle={toggle} onChair={setChairpersonId} disabled={running} />
              <Composer
                value={prompt}
                onChange={setPrompt}
                deep={enableThinking}
                setDeep={setEnableThinking}
                debate={enableDebate}
                setDebate={setEnableDebate}
                running={running}
                finished={finished}
                onStart={start}
                onAbort={abort}
                onCloseTabs={closeAllTabs}
                count={selected.size}
              />
            </div>
          )}

          {/* conclusion */}
          {finished && summary && (
            <div style={{ marginBottom: 26 }}>
              <ConclusionPanel summary={summary} chairId={displayChair} chairName={nameOf(displayChair)} participated={participated} failed={failedCount} onAsk={askNative} />
            </div>
          )}

          {/* progress cards */}
          {legModels.length > 0 && (
            <div style={{ marginBottom: 26 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 13 }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>成员运行进度</span>
                <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>点击任一阶段查看该成员的完整原文</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gridAutoRows: '1fr', gap: 14, alignItems: 'stretch' }}>
                {legModels.map((leg) => (
                  <ProgressCard key={leg.id} leg={leg} onOpen={(legId, st) => setModal({ legId, stageKey: st })} onRetry={retry} onAsk={askNative} />
                ))}
              </div>
            </div>
          )}

          {/* debate timeline */}
          {displayDebate && displayDebate.rounds.length > 0 && (
            <DebateTimeline debate={displayDebate} chairId={displayChair} nameOf={nameOf} reveal={reveal} onToggleReveal={() => setReveal((r) => !r)} />
          )}
        </div>
      </main>

      {modal && (() => {
        const leg = legModels.find((l) => l.id === modal.legId);
        if (!leg) return null;
        return <DetailModal leg={leg} stageKey={modal.stageKey} onClose={() => setModal(null)} onStage={(s) => setModal((m) => (m ? { ...m, stageKey: s } : m))} onAsk={askNative} />;
      })()}
    </div>
  );
}

function sourceLabel(s: ConfigSource | null): string {
  if (s === 'remote') return '远程';
  if (s === 'cache') return '缓存';
  return '内置兜底';
}
