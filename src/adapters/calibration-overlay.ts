/**
 * 页内校准工具条（ADR-0009）——运行于 content script 上下文。
 *
 * 在被校准站点页面的**顶部**注入一条工具条，把「输入框 / 发送按钮 / 回答区 / 停止按钮 /
 * 深度思考(多步)」的校准按钮直接放在该页面里。用户无需在 Council Page 与站点页之间来回切换，
 * 在站点页内即可完成全部校准。校准结果直接写入本地覆盖（chrome.storage.local）。
 */

import { PICK_ROLE_LABELS, type PickRole } from '../shared/adapter-schema';
import {
  pickElement,
  pickElementSnapshot,
  pickSequence,
  computeThinkingDiscriminator,
  describeThinkingDiscriminator,
  type PickKind,
  type SnapshotOutcome,
} from './picker';
import {
  writeRoleSelector,
  writeThinkingActivation,
  writeThinkingState,
  readSiteOverride,
} from '../shared/overrides';

const ROLES: PickRole[] = ['inputBox', 'sendButton', 'assistantMessage', 'stopButton'];

/** 角色 → 拾取种类（决定元素归一化与选择器策略）。 */
const ROLE_KIND: Record<PickRole, PickKind> = {
  inputBox: 'editable',
  sendButton: 'clickable',
  stopButton: 'clickable',
  assistantMessage: 'content',
};

/** 注入工具条；用户点「完成校准」时 resolve。 */
export async function runCalibrationToolbar(adapterId: string, displayName: string): Promise<void> {
  const existing = await readSiteOverride(adapterId);
  const doneRoles = new Set<PickRole>(
    existing?.selectors ? (Object.keys(existing.selectors) as PickRole[]) : [],
  );
  let thinkingCount = existing?.thinkingActivation?.length ?? 0;
  let hasState = !!existing?.thinkingState;
  /** 「思考状态(两态)」录制：第一步记录的「关」态快照（待第二步「开」态点选后 diff）。 */
  let pendingOff: SnapshotOutcome | null = null;
  let busy = false;

  const bar = document.createElement('div');
  Object.assign(bar.style, {
    position: 'fixed',
    zIndex: '2147483647',
    left: '50%',
    top: '20px',
    transform: 'translateX(-50%)',
    background: '#13151a',
    color: '#fff',
    padding: '8px 14px',
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '8px',
    fontSize: '13px',
    fontFamily: 'system-ui, -apple-system, "PingFang SC", sans-serif',
    boxShadow: '0 2px 12px rgba(0,0,0,0.35)',
    borderRadius: '8px',
    cursor: 'move',
    userSelect: 'none',
    width: 'max-content',
    maxWidth: '90vw',
  } satisfies Partial<CSSStyleDeclaration>);

  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let initialLeft = 0;
  let initialTop = 0;

  bar.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).tagName.toLowerCase() === 'button') {
      return;
    }
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    
    const rect = bar.getBoundingClientRect();
    bar.style.transform = 'none';
    bar.style.left = `${rect.left}px`;
    bar.style.top = `${rect.top}px`;
    initialLeft = rect.left;
    initialTop = rect.top;
    
    e.preventDefault();
  });

  const onMouseMove = (e: MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    bar.style.left = `${initialLeft + dx}px`;
    bar.style.top = `${initialTop + dy}px`;
  };

  const onMouseUp = () => {
    isDragging = false;
  };

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);

  const title = document.createElement('strong');
  title.textContent = `校准 ${displayName}`;
  title.style.marginRight = '4px';

  const status = document.createElement('span');
  Object.assign(status.style, { marginLeft: '6px', color: '#9fb4ff', flex: '1 1 100%', fontSize: '12px' });
  status.textContent = '点角色按钮 → 在页面上点选对应元素；回答区请点某条 AI 回复的正文。';

  function setStatus(t: string) {
    status.textContent = t;
  }

  bar.appendChild(title);

  for (const role of ROLES) {
    const btn = mkBtn(roleLabel(role, doneRoles));
    btn.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      bar.style.display = 'none'; // 校准期间隐藏工具条，避免被误选
      const res = await pickElement({ label: PICK_ROLE_LABELS[role], kind: ROLE_KIND[role] });
      bar.style.display = 'flex';
      if (res.ok && res.selector) {
        await writeRoleSelector(adapterId, role, res.selector);
        doneRoles.add(role);
        btn.textContent = roleLabel(role, doneRoles);
        setStatus(`✅ ${PICK_ROLE_LABELS[role]}：${res.selector}`);
      } else {
        setStatus(`未完成：${res.error ?? '未知错误'}`);
      }
      busy = false;
    });
    bar.appendChild(btn);
  }

  const thinkBtn = mkBtn(thinkLabel(thinkingCount));
  thinkBtn.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    setStatus('录制深度思考：依次点击开启的每一步（入口→菜单选项…），完成后点页内浮层「完成」。');
    bar.style.display = 'none';
    const res = await pickSequence('深度思考开关');
    bar.style.display = 'flex';
    if (res.ok && res.selectors) {
      await writeThinkingActivation(adapterId, res.selectors);
      thinkingCount = res.selectors.length;
      thinkBtn.textContent = thinkLabel(thinkingCount);
      setStatus(`✅ 深度思考：已录 ${thinkingCount} 步`);
    } else {
      setStatus(`未完成：${res.error ?? '未知错误'}`);
    }
    busy = false;
  });
  bar.appendChild(thinkBtn);

  // 「思考状态(两态)」：录「关」态 → 录「开」态 → 自动 diff 出判别式（Phase 7 / ADR-0016）。
  const stateBtn = mkBtn(stateLabel(hasState, pendingOff));
  stateBtn.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    if (!pendingOff) {
      setStatus('①先把该站「深度思考」切到【关】，再点选那个「思考开关」按钮（点选不会真的触发它）。');
      bar.style.display = 'none';
      const off = await pickElementSnapshot({ label: '思考开关·关闭态', kind: 'clickable' });
      bar.style.display = 'flex';
      if (off.ok && off.signature) {
        pendingOff = off;
        setStatus('已记录【关】态。②现在到页面把「深度思考」切到【开】，然后再点本按钮录「开」态。');
      } else {
        setStatus(`未完成：${off.error ?? '未取到状态签名'}`);
      }
    } else {
      setStatus('②点选同一个「思考开关」按钮（此刻应为开启态）。');
      bar.style.display = 'none';
      const on = await pickElementSnapshot({ label: '思考开关·开启态', kind: 'clickable' });
      bar.style.display = 'flex';
      if (on.ok && on.signature && pendingOff.signature && pendingOff.selector) {
        const disc = computeThinkingDiscriminator(pendingOff.signature, on.signature);
        if (disc) {
          await writeThinkingState(adapterId, { selector: pendingOff.selector, on: disc });
          hasState = true;
          setStatus(`✅ 思考状态判别：${describeThinkingDiscriminator(disc)}`);
        } else {
          setStatus('未检测到两态差异：请确认两次点的是同一按钮、且①确为关、②确为开，再重录。');
        }
      } else {
        setStatus(`未完成：${on.error ?? '未取到状态签名'}`);
      }
      pendingOff = null;
    }
    stateBtn.textContent = stateLabel(hasState, pendingOff);
    busy = false;
  });
  bar.appendChild(stateBtn);

  bar.appendChild(status);

  return new Promise<void>((resolve) => {
    const doneBtn = mkBtn('完成校准', '#2b6cff');
    doneBtn.addEventListener('click', () => {
      if (busy) return;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      bar.remove();
      resolve();
    });
    bar.appendChild(doneBtn);
    document.body.appendChild(bar);
  });
}

function roleLabel(role: PickRole, done: Set<PickRole>): string {
  return `${PICK_ROLE_LABELS[role]}${done.has(role) ? ' ✓' : ''}`;
}

function thinkLabel(count: number): string {
  return `深度思考(多步)${count ? ` ✓${count}` : ''}`;
}

function stateLabel(hasState: boolean, pendingOff: SnapshotOutcome | null): string {
  if (pendingOff) return '思考状态：②录【开】态';
  if (hasState) return '思考状态 ✓（重录）';
  return '思考状态：①录【关】态';
}

function mkBtn(text: string, bg = '#2a2e38'): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = text;
  Object.assign(b.style, {
    background: bg,
    color: '#fff',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '6px',
    padding: '5px 12px',
    fontSize: '13px',
    cursor: 'pointer',
  } satisfies Partial<CSSStyleDeclaration>);
  return b;
}
