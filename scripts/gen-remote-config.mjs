// 由扩展内置的 local-config.ts 生成配置仓的初始 adapter-config.json（ADR-0008/0013）。
// 单一真源：远程配置以内置兜底为起点，避免手抄漂移。站点选择器变更后重跑本脚本同步。
//
// 运行：node scripts/gen-remote-config.mjs
// 依赖 Node ≥ 22.6（原生剥离 TS 类型；local-config.ts 仅含可擦除的 import type）。

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const mod = await import(resolve(root, 'src/adapters/local-config.ts'));
const config = mod.LOCAL_ADAPTER_CONFIG;
if (!config || !Array.isArray(config.adapters)) {
  throw new Error('未能从 local-config.ts 读取 LOCAL_ADAPTER_CONFIG');
}

const outDir = resolve(root, 'config-repo');
const outFile = resolve(outDir, 'adapter-config.json');
mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, JSON.stringify(config, null, 2) + '\n', 'utf8');

console.log(`已生成 ${outFile}（${config.adapters.length} 个站点，schemaVersion=${config.schemaVersion}）`);
