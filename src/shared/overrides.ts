/**
 * 本地用户覆盖层（ADR-0009）。
 *
 * 用户经页面内拾取器校准出的「站点 → 角色 → 选择器/策略」，存入 chrome.storage.local。
 * 合并优先级：**用户覆盖 > 远程 > 内置兜底**（远程/内置的取舍由 ConfigLoader 的三级回退完成，
 * 本层只负责在其结果之上再叠加用户覆盖）。
 *
 * 安全边界（延续 ADR-0005）：只存选择器与策略字符串，绝不存可执行代码。
 * content script 与 Council Page 两侧都可读写（均可访问 chrome.storage.local），故放在 shared。
 */

import type {
  InputMethod,
  PickRole,
  SiteAdapter,
  SubmitMethod,
} from './adapter-schema';

/** 单站点的覆盖项：被校准过的角色选择器 + 可选的注入/发送策略。 */
export interface SiteOverride {
  /** 角色 → 用户校准出的选择器（仅含被校准过的角色） */
  selectors?: Partial<Record<PickRole, string>>;
  /** 用户录制的「深度思考」开启步骤（有序，多步），ADR-0009 */
  thinkingActivation?: string[];
  /** 可选：覆盖注入方式 / 发送方式 */
  inputMethod?: InputMethod;
  submit?: SubmitMethod;
  /** 最后更新时间戳 */
  updatedAt: number;
}

/** adapterId → 该站点的覆盖项。 */
export type UserOverrides = Record<string, SiteOverride>;

const OVERRIDES_KEY = 'delphi:overrides';

export async function readAllOverrides(): Promise<UserOverrides> {
  try {
    const got = await chrome.storage.local.get(OVERRIDES_KEY);
    const raw = got[OVERRIDES_KEY];
    return raw && typeof raw === 'object' ? (raw as UserOverrides) : {};
  } catch {
    return {};
  }
}

export async function readSiteOverride(adapterId: string): Promise<SiteOverride | undefined> {
  const all = await readAllOverrides();
  return all[adapterId];
}

/** 导出当前全部覆盖为可序列化对象（用于跨浏览器搬运 / 备份）。 */
export async function exportOverrides(): Promise<UserOverrides> {
  return readAllOverrides();
}

/**
 * 导入覆盖（跨浏览器对齐用）。
 * - 'merge'（默认）：按站点、按角色逐项合并；同名项以导入值为准；不同站点叠加。
 * - 'replace'：整体替换为导入内容。
 * 返回导入后影响的站点数。会做基本结构校验，跳过非法项。
 */
export async function importOverrides(
  incoming: UserOverrides,
  mode: 'merge' | 'replace' = 'merge',
): Promise<number> {
  const clean = sanitizeOverrides(incoming);
  const base = mode === 'replace' ? {} : await readAllOverrides();
  for (const [id, site] of Object.entries(clean)) {
    const prev = base[id];
    base[id] = {
      ...prev,
      ...site,
      selectors: { ...prev?.selectors, ...site.selectors },
      thinkingActivation: site.thinkingActivation ?? prev?.thinkingActivation,
      updatedAt: Date.now(),
    };
  }
  await chrome.storage.local.set({ [OVERRIDES_KEY]: base });
  return Object.keys(clean).length;
}

/** 只保留结构合法的覆盖项（选择器/步骤必须是字符串），防止导入脏数据。 */
function sanitizeOverrides(raw: unknown): UserOverrides {
  if (!raw || typeof raw !== 'object') return {};
  const out: UserOverrides = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const site = v as Partial<SiteOverride>;
    const o: SiteOverride = { updatedAt: Date.now() };
    if (site.selectors && typeof site.selectors === 'object') {
      const sel: Partial<Record<PickRole, string>> = {};
      for (const [role, s] of Object.entries(site.selectors)) {
        if (typeof s === 'string' && s) sel[role as PickRole] = s;
      }
      if (Object.keys(sel).length) o.selectors = sel;
    }
    if (Array.isArray(site.thinkingActivation)) {
      const steps = site.thinkingActivation.filter((s): s is string => typeof s === 'string' && !!s);
      if (steps.length) o.thinkingActivation = steps;
    }
    if (site.inputMethod) o.inputMethod = site.inputMethod;
    if (site.submit) o.submit = site.submit;
    if (o.selectors || o.thinkingActivation || o.inputMethod || o.submit) out[id] = o;
  }
  return out;
}

/** 写入某站点某角色的选择器（合并进既有覆盖项）。 */
export async function writeRoleSelector(
  adapterId: string,
  role: PickRole,
  selector: string,
): Promise<void> {
  const all = await readAllOverrides();
  const prev = all[adapterId];
  all[adapterId] = {
    ...prev,
    selectors: { ...prev?.selectors, [role]: selector },
    updatedAt: Date.now(),
  };
  await chrome.storage.local.set({ [OVERRIDES_KEY]: all });
}

/** 写入某站点的「深度思考」开启步骤（整组覆盖）。空数组等同清除该项。 */
export async function writeThinkingActivation(adapterId: string, steps: string[]): Promise<void> {
  const all = await readAllOverrides();
  const prev = all[adapterId];
  if (steps.length === 0) {
    if (prev) {
      delete prev.thinkingActivation;
      prev.updatedAt = Date.now();
      if (!hasAnyOverride(prev)) delete all[adapterId];
    }
  } else {
    all[adapterId] = { ...prev, thinkingActivation: steps, updatedAt: Date.now() };
  }
  await chrome.storage.local.set({ [OVERRIDES_KEY]: all });
}

/** 该覆盖项是否还含任何有效内容。 */
function hasAnyOverride(o: SiteOverride): boolean {
  return (
    (o.selectors != null && Object.keys(o.selectors).length > 0) ||
    (o.thinkingActivation != null && o.thinkingActivation.length > 0) ||
    o.inputMethod != null ||
    o.submit != null
  );
}

/** 清除某站点某角色的覆盖（其余角色保留）。 */
export async function clearRoleSelector(adapterId: string, role: PickRole): Promise<void> {
  const all = await readAllOverrides();
  const site = all[adapterId];
  if (!site?.selectors) return;
  delete site.selectors[role];
  site.updatedAt = Date.now();
  if (!hasAnyOverride(site)) delete all[adapterId];
  await chrome.storage.local.set({ [OVERRIDES_KEY]: all });
}

/** 清除某站点的全部覆盖。 */
export async function clearSiteOverride(adapterId: string): Promise<void> {
  const all = await readAllOverrides();
  delete all[adapterId];
  await chrome.storage.local.set({ [OVERRIDES_KEY]: all });
}

/** 清除所有站点的全部覆盖。 */
export async function clearAllOverrides(): Promise<void> {
  await chrome.storage.local.remove(OVERRIDES_KEY);
}

/**
 * 把用户覆盖叠加到一个适配器上，返回新的适配器（纯函数，不改原对象）。
 * 仅覆盖被校准过的字段，其余沿用原配置。
 */
export function applyOverride(adapter: SiteAdapter, override?: SiteOverride): SiteAdapter {
  if (!override) return adapter;
  const sel = override.selectors ?? {};
  return {
    ...adapter,
    selectors: {
      ...adapter.selectors,
      ...stripUndefined(sel),
    },
    thinkingActivation:
      override.thinkingActivation && override.thinkingActivation.length > 0
        ? override.thinkingActivation
        : adapter.thinkingActivation,
    input: {
      method: override.inputMethod ?? adapter.input.method,
      submit: override.submit ?? adapter.input.submit,
    },
  };
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v != null && v !== '') (out as Record<string, unknown>)[k] = v;
  }
  return out;
}
