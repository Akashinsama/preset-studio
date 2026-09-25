#!/usr/bin/env node
/**
 * 诊断：按一份预设推断出来的面板分组长什么样
 *
 *   node tools/diag-groups.mjs                     # 成品预设
 *   node tools/diag-groups.mjs Izumi_0914.json     # 任意预设
 *
 * 用途：肉眼看推断的东西像不像人话（不是断言，是审查）。
 */
import fs from 'node:fs';
const load = (rel) => new Function('globalThis', fs.readFileSync(rel, 'utf8'))(globalThis);
load('tools/gui/lib/parse.js');
load('tools/gui/lib/assemble.js');
load('tools/gui/lib/invariants.js');
load('tools/gui/lib/groupinfer.js');

const PP = globalThis.PresetParse, PA = globalThis.PresetAssemble;
const PI = globalThis.PresetInvariants, GI = globalThis.PresetGroupInfer;

for (const file of process.argv.slice(2).length ? process.argv.slice(2) : ['preset/芳乃预设.json', 'Izumi_0914.json']) {
  if (!fs.existsSync(file)) { console.log(`（跳过 ${file}）\n`); continue; }
  const raw = fs.readFileSync(file, 'utf8');
  const json = JSON.parse(raw);
  const model = PP.parsePreset(json, file, Buffer.byteLength(raw));
  const inf = GI.inferGroups(model, json);
  const rep = GI.validateGroups(inf, model);

  console.log('════════════════════════════════════════════════════');
  console.log(`${file}　条目 ${model.counts.prompts} / 在列表 ${model.counts.listed}`);
  console.log(`推断：${inf.groups.length} 个模块（只读 ${inf.groups.filter((g) => g.mode === 'fixed').length}），`
    + `管理 ${inf.stats.managed} 条，跳过重名 ${inf.stats.skippedDuplicates} 条`);
  console.log(`校验：错误 ${rep.errors.length}，提醒 ${rep.warnings.length}`);
  for (const s of inf.sections) {
    console.log(`\n【${s.title}】`);
    for (const id of s.groups) {
      const g = inf.groups.find((x) => x.id === id);
      if (!g) continue;
      console.log(`  · [${g.mode}] ${g.label}　${(g.members || []).length} 条：${(g.members || []).slice(0, 5).join('、')}${(g.members || []).length > 5 ? ' …' : ''}`);
    }
  }
  console.log('\n说明与警告：');
  for (const n of inf.notes) console.log(`  [${n.level}] ${n.text}`);
  for (const e of rep.errors.slice(0, 6)) console.log(`  [err] ${e.kind}：${e.text}`);
  for (const w of rep.warnings.slice(0, 6)) console.log(`  [warn] ${w.kind}：${w.text}`);
  console.log('');
}
