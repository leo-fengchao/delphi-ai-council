/**
 * 页内校准工具条（ADR-0009）——运行于 content script 上下文。
 *
 * 在被校准站点页面的**顶部**注入一条工具条，把「输入框 / 发送按钮 / 回答区 / 停止按钮 /
 * 深度思考(多步)」的校准按钮直接放在该页面里。用户无需在 Council Page 与站点页之间来回切换，
 * 在站点页内即可完成全部校准。校准结果直接写入本地覆盖（chrome.storage.local）。
 */

import { PICK_ROLE_LABELS, type PickRole } from '../shared/adapter-schema';
import { pickElement, pickSequence, type PickKind } from './picker';
import { writeRoleSelector, writeThinkingActivation, readSiteOverride } from '../shared/overrides';

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
  let busy = false;

  const bar = document.createElement('div');
  Object.assign(bar.style, {
    position: 'fixed',
    zIndex: '2147483647',
    left: '0',
    right: '0',
    top: '0',
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
  } satisfies Partial<CSSStyleDeclaration>);

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

  bar.appendChild(status);

  return new Promise<void>((resolve) => {
    const doneBtn = mkBtn('完成校准', '#2b6cff');
    doneBtn.addEventListener('click', () => {
      if (busy) return;
      bar.remove();
      resolve();
    });
    bar.appendChild(doneBtn);
    document.body.appendChild(bar);
    // 把页面整体下推，避免工具条遮住站点顶部（尽力而为）。
    document.documentElement.style.scrollPaddingTop = '48px';
  });
}

function roleLabel(role: PickRole, done: Set<PickRole>): string {
  return `${PICK_ROLE_LABELS[role]}${done.has(role) ? ' ✓' : ''}`;
}

function thinkLabel(count: number): string {
  return `深度思考(多步)${count ? ` ✓${count}` : ''}`;
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
