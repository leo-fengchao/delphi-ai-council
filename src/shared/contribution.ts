/**
 * 众包共创：把本地校准提交到社区（ADR-0013）。
 *
 * 机制（零后端、零授权，严守 C1 / ADR-0001）：
 *   本地覆盖（ADR-0009） → 序列化为「贡献 payload」 → 构造预填好的 GitHub「New Issue」URL
 *   → 用户在 GitHub 上亲自点提交 → 维护者人工审核（信任闸）→ 合并进配置仓 adapter-config.json
 *   → 经 ADR-0008 远程源回流分发给所有用户。
 *
 * 安全边界（延续 ADR-0005/0009）：payload 只含选择器与策略字符串，绝不含可执行代码、不含 PII。
 * 注意：此处的 sanitize 仅为降噪，**真正的安全闸是维护者人工审核**（客户端代码可被绕过）。
 */

import { PICK_ROLE_LABELS, type InputMethod, type PickRole, type SiteAdapter, type SubmitMethod } from './adapter-schema';
import type { SiteOverride } from './overrides';

/**
 * 社区配置仓（ADR-0013，分发侧）。形如 `owner/repo`。
 * 留空则隐藏「贡献」入口（优雅降级，不影响本地使用）。
 * 用户建好公开仓后填此处，并把 config-loader.ts 的 REMOTE_CONFIG_URL 指向该仓的 raw adapter-config.json。
 */
export const COMMUNITY_REPO = 'leo-fengchao/delphi-config';

/** 贡献 payload 当前结构版本，便于维护者侧解析与未来演进。 */
export const CONTRIBUTION_VERSION = 1;

/** 与 adapter-config schemaVersion 对齐（ADR-0005/0008）。 */
const ADAPTER_SCHEMA_VERSION = 1;

/** 提交到 Issue 的结构化贡献载荷（仅选择器/策略，无 PII）。 */
export interface ContributionPayload {
  /** 固定标记，便于维护者侧/未来自动校验识别。 */
  kind: 'delphi-selector-contribution';
  contributionVersion: number;
  schemaVersion: number;
  adapterId: string;
  displayName: string;
  /** 被校准过的选择器与策略（已清洗）。 */
  override: CleanOverride;
  meta: {
    /** 扩展版本号（chrome.runtime manifest），便于回溯。无 PII。 */
    extVersion: string;
    createdAt: number;
  };
}

/** 清洗后的覆盖：只保留字符串型选择器与既定枚举策略（不含 updatedAt 等本地簿记字段）。 */
export interface CleanOverride {
  selectors?: Partial<Record<PickRole, string>>;
  thinkingActivation?: string[];
  inputMethod?: InputMethod;
  submit?: SubmitMethod;
}

/** 该站点覆盖是否「有内容可贡献」（至少一项被校准过）。 */
export function hasContributableOverride(override?: SiteOverride): boolean {
  if (!override) return false;
  return Boolean(
    (override.selectors && Object.keys(override.selectors).length > 0) ||
      (override.thinkingActivation && override.thinkingActivation.length > 0) ||
      override.inputMethod ||
      override.submit,
  );
}

/** 把本地 SiteOverride 清洗为仅含字符串选择器/策略的可贡献结构。 */
export function sanitizeForContribution(override: SiteOverride): CleanOverride {
  const out: CleanOverride = {};
  if (override.selectors) {
    const sel: Partial<Record<PickRole, string>> = {};
    for (const [role, s] of Object.entries(override.selectors)) {
      if (typeof s === 'string' && s.trim()) sel[role as PickRole] = s.trim();
    }
    if (Object.keys(sel).length) out.selectors = sel;
  }
  if (Array.isArray(override.thinkingActivation)) {
    const steps = override.thinkingActivation.filter(
      (s): s is string => typeof s === 'string' && !!s.trim(),
    );
    if (steps.length) out.thinkingActivation = steps;
  }
  if (override.inputMethod) out.inputMethod = override.inputMethod;
  if (override.submit) out.submit = override.submit;
  return out;
}

/** 取扩展版本号（用于 payload.meta，无 PII）。在非扩展上下文兜底为 'unknown'。 */
function extVersion(): string {
  try {
    return chrome.runtime.getManifest().version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** 由适配器 + 本地覆盖构建贡献 payload。 */
export function buildContributionPayload(
  adapter: SiteAdapter,
  override: CleanOverride,
): ContributionPayload {
  return {
    kind: 'delphi-selector-contribution',
    contributionVersion: CONTRIBUTION_VERSION,
    schemaVersion: ADAPTER_SCHEMA_VERSION,
    adapterId: adapter.id,
    displayName: adapter.displayName,
    override,
    meta: { extVersion: extVersion(), createdAt: Date.now() },
  };
}

/**
 * 构造预填好的 GitHub「New Issue」URL（标题/正文/标签）。
 * 直接走 /issues/new?... 会跳过模板选择器、打开预填的空白 Issue 编辑器。
 */
export function buildContributionIssueUrl(repo: string, payload: ContributionPayload): string {
  const title = `[选择器贡献] ${payload.displayName} (${payload.adapterId})`;
  const json = JSON.stringify(payload, null, 2);
  const body = [
    '感谢贡献！以下是「集思 · Delphi」扩展自动生成的站点选择器校准，供维护者审核后合并进 `adapter-config.json`。',
    '',
    `- 站点：**${payload.displayName}** (\`${payload.adapterId}\`)`,
    `- 扩展版本：${payload.meta.extVersion}`,
    `- schemaVersion：${payload.schemaVersion}`,
    '',
    '> ⚠️ 维护者请按 CONTRIBUTING.md 核验：仅含选择器/策略字符串、无可执行代码、选择器稳健（非动态哈希类名）、adapterId 合法。',
    '',
    '```json',
    json,
    '```',
    '',
    '<!-- delphi:contribution -->',
  ].join('\n');

  const params = new URLSearchParams({
    title,
    body,
    labels: 'selector-contribution',
  });
  return `https://github.com/${repo}/issues/new?${params.toString()}`;
}

export interface ContributionResult {
  ok: boolean;
  identicalKeys?: string[];
  noDiff?: boolean;
}

export function diffOverride(adapter: SiteAdapter, override: SiteOverride): { diff: CleanOverride, identicalKeys: string[] } {
  const diff: CleanOverride = {};
  const identicalKeys: string[] = [];
  const clean = sanitizeForContribution(override);

  if (clean.selectors) {
    const newSelectors: Partial<Record<PickRole, string>> = {};
    for (const [role, s] of Object.entries(clean.selectors) as [PickRole, string][]) {
      if (s === adapter.selectors[role]) {
        identicalKeys.push(PICK_ROLE_LABELS[role] || role);
      } else {
        newSelectors[role] = s;
      }
    }
    if (Object.keys(newSelectors).length > 0) {
      diff.selectors = newSelectors;
    }
  }

  if (clean.thinkingActivation) {
    const current = adapter.thinkingActivation || [];
    if (JSON.stringify(clean.thinkingActivation) === JSON.stringify(current)) {
      identicalKeys.push('深度思考');
    } else {
      diff.thinkingActivation = clean.thinkingActivation;
    }
  }

  if (clean.inputMethod) {
    if (clean.inputMethod === adapter.input.method) {
      identicalKeys.push('输入法');
    } else {
      diff.inputMethod = clean.inputMethod;
    }
  }

  if (clean.submit) {
    if (clean.submit === adapter.input.submit) {
      identicalKeys.push('提交方式');
    } else {
      diff.submit = clean.submit;
    }
  }

  return { diff, identicalKeys };
}

/**
 * 一站式：在新标签页打开某站点校准的预填贡献 Issue。
 * 返回 { ok: false } 表示未配置 COMMUNITY_REPO 或该站点无可贡献内容。
 * 如果包含与内置相同的配置，会自动剔除；如果全相同则返回 { ok: false, noDiff: true, identicalKeys }。
 */
export async function openContributionIssue(
  adapter: SiteAdapter,
  override: SiteOverride | undefined,
): Promise<ContributionResult> {
  if (!COMMUNITY_REPO) return { ok: false };
  if (!hasContributableOverride(override)) return { ok: false };

  const { diff, identicalKeys } = diffOverride(adapter, override!);
  
  if (Object.keys(diff).length === 0) {
    return { ok: false, noDiff: true, identicalKeys };
  }

  const payload = buildContributionPayload(adapter, diff);
  const url = buildContributionIssueUrl(COMMUNITY_REPO, payload);
  await chrome.tabs.create({ url });
  
  return { ok: true, identicalKeys };
}
