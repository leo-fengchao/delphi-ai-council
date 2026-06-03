/**
 * ConfigLoader —— 适配器配置加载（ADR-0005、ADR-0008）。
 * 三级回退：远程拉取（带超时） → 本地缓存（chrome.storage.local） → 扩展内置兜底。
 *
 * 运行于 Council Page 上下文（ADR-0003）。
 */

import type { AdapterConfig } from '../shared/adapter-schema';
import { LOCAL_ADAPTER_CONFIG } from '../adapters/local-config';
import { applyOverride, readAllOverrides, type UserOverrides } from '../shared/overrides';

/**
 * 远程配置源（ADR-0008，定稿 Q5 = GitHub raw）。
 * 留空则跳过远程、直接走本地兜底；接入时填公开仓库的 raw JSON URL，
 * 并在 wxt.config.ts 的 host_permissions 增补该域名。
 */
const REMOTE_CONFIG_URL = '';

const CACHE_KEY = 'delphi:adapterConfig';
const CACHE_TS_KEY = 'delphi:adapterConfig:ts';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 小时
const FETCH_TIMEOUT_MS = 8000;

export type ConfigSource = 'remote' | 'cache' | 'bundled';

export interface LoadResult {
  /** 已叠加用户覆盖（ADR-0009）的有效配置 */
  config: AdapterConfig;
  /** 基础配置来源（覆盖前） */
  source: ConfigSource;
  /** 当前用户覆盖（供 UI 展示「哪些站点已校准」） */
  overrides: UserOverrides;
}

/**
 * 加载有效适配器配置。
 * 先按三级回退取基础配置（远程 → 缓存 → 内置），再叠加用户覆盖层（ADR-0009）。
 * 永不抛错——最差也返回内置兜底。
 */
export async function loadAdapterConfig(): Promise<LoadResult> {
  const { config: base, source } = await loadBaseConfig();
  const overrides = await readAllOverrides();
  const config: AdapterConfig = {
    ...base,
    adapters: base.adapters.map((a) => applyOverride(a, overrides[a.id])),
  };
  return { config, source, overrides };
}

/** 三级回退取基础配置（覆盖前）。 */
async function loadBaseConfig(): Promise<{ config: AdapterConfig; source: ConfigSource }> {
  // 1) 缓存未过期则直接用。
  const cached = await readCache();
  if (cached && cached.fresh) return { config: cached.config, source: 'cache' };

  // 2) 尝试远程；成功则写缓存。
  const remote = await fetchRemote();
  if (remote) {
    await writeCache(remote);
    return { config: remote, source: 'remote' };
  }

  // 3) 远程失败：用过期缓存兜底，再不行用内置。
  if (cached) return { config: cached.config, source: 'cache' };
  return { config: LOCAL_ADAPTER_CONFIG, source: 'bundled' };
}

async function fetchRemote(): Promise<AdapterConfig | null> {
  if (!REMOTE_CONFIG_URL) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(REMOTE_CONFIG_URL, { signal: ctrl.signal, cache: 'no-cache' });
    clearTimeout(timer);
    if (!res.ok) return null;
    return validate(await res.json());
  } catch {
    return null; // 不可达/超时/解析失败 → 交给下一级回退。
  }
}

async function readCache(): Promise<{ config: AdapterConfig; fresh: boolean } | null> {
  try {
    const got = await chrome.storage.local.get([CACHE_KEY, CACHE_TS_KEY]);
    const config = validate(got[CACHE_KEY]);
    if (!config) return null;
    const ts = typeof got[CACHE_TS_KEY] === 'number' ? got[CACHE_TS_KEY] : 0;
    return { config, fresh: Date.now() - ts < CACHE_TTL_MS };
  } catch {
    return null;
  }
}

async function writeCache(config: AdapterConfig): Promise<void> {
  try {
    await chrome.storage.local.set({ [CACHE_KEY]: config, [CACHE_TS_KEY]: Date.now() });
  } catch {
    /* 缓存写失败不影响本次返回 */
  }
}

/** 仅接受 schemaVersion 匹配且结构合理的配置（ADR-0008 校验）。 */
function validate(raw: unknown): AdapterConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const cfg = raw as Partial<AdapterConfig>;
  if (cfg.schemaVersion !== 1 || !Array.isArray(cfg.adapters)) return null;
  return cfg as AdapterConfig;
}
