#!/usr/bin/env node
/**
 * 诊断：看一眼 M4 生成的骨架到底长什么样（不写文件，只打印）
 *
 *   node tools/diag-skeleton.mjs                # 默认模块
 *   node tools/diag-skeleton.mjs breach,cot,mvu 2
 */
import fs from 'node:fs';
const load = (rel) => new Function('globalThis', fs.readFileSync(rel, 'utf8'))(globalThis);
load('tools/gui/lib/parse.js');
load('tools/gui/lib/assemble.js');
load('tools/gui/lib/invariants.js');
load('tools/gui/lib/editor.js');
load('tools/gui/lib/skeleton.js');

const PP = globalThis.PresetParse, PA = globalThis.PresetAssemble;
const PI = globalThis.PresetInvariants, PE = globalThis.PresetEditor, PS = globalThis.PresetSkeleton;

const modules = (process.argv[2] || 'breach,cot,style,guard,mvu,summary,prefill').split(',').filter(Boolean);
const custom = Number(process.argv[3] || 0);
const built = PS.buildSkeleton({ name: '我的预设', moduleIds: modules, customCount: custom });
const model = PP.parsePreset(built.json, '我的预设.json');

const slotOf = (id) => PS.MARKER_SLOT_IDS.includes(id) ? '位置标记' : id;
console.log(`骨架「${built.name}」　${built.counts.prompts} 条（开 ${built.counts.enabled}，位置标记 ${built.counts.markers}，待填 ${built.counts.pending}）\n`);
console.log('列表顺序：');
model.entries.forEach((e, i) => {
  const p = built.json.prompts.find((x) => x.identifier === e.identifier);
  console.log(`  ${String(i).padStart(2)}  ${e.enabled ? '开' : '关'}  ${e.name.padEnd(22)} ${slotOf(e.identifier).padEnd(12)} ${String(p.content.length).padStart(4)} 字  ${p.content.slice(0, 46)}`);
});

const r = PA.assemble(model, { user: 'Master', char: '角色卡' });
const rep = PI.check(model, r);
console.log(`\n拼装：正文 ${r.totalChars} 字 ≈ ${r.tokenEstimate} token　（位置标记会显示成占位块）`);
for (const s of r.segments) console.log(`  · ${s.name.padEnd(22)} ${s.note ? '[占位] ' + s.text.slice(0, 30) : JSON.stringify(s.text.slice(0, 40))}`);
console.log(`\n体检：必改 ${rep.counts.err} · 建议 ${rep.counts.warn} · 提示 ${rep.counts.info}`);
for (const it of rep.items) console.log(`  [${rep.levelLabel[it.level]}] ${it.title}`);
