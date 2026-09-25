#!/usr/bin/env node
/**
 * 诊断：成品预设里"先读后设"的到底是什么形状
 *   node tools/diag-readorder.mjs [文件] [--init-off]
 */
import fs from 'node:fs';
const load = (rel) => new Function('globalThis', fs.readFileSync(rel, 'utf8'))(globalThis);
load('tools/gui/lib/parse.js');
load('tools/gui/lib/assemble.js');
load('tools/gui/lib/invariants.js');
load('tools/gui/lib/editor.js');

const PP = globalThis.PresetParse, PA = globalThis.PresetAssemble, PE = globalThis.PresetEditor;
const file = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'preset/芳乃预设.json';
const initOff = process.argv.includes('--init-off');

const json = JSON.parse(fs.readFileSync(file, 'utf8'));
const model = PP.parsePreset(json, file, Buffer.byteLength(fs.readFileSync(file, 'utf8')));
const edit = PE.emptyEdit(model, []);
if (initOff) {
  const init = model.entries.find((e) => e.clearer && e.listed);
  console.log(`（把初始化条目「${init?.name}」关掉）`);
  if (init) edit.enabled.set(init.idx, false);
}
const m = PP.parsePreset(JSON.parse(JSON.stringify(PE.applyEdit(json, edit, model))), file);
const r = PA.assemble(m, { user: 'Master', char: '角色卡' });

const order = new Map(m.entries.filter((e) => e.listed).map((e) => [e.idx, e.orderIndex]));
const at = new Map(m.entries.map((e) => [e.idx, e]));

console.log(`\n${file}　开启 ${m.counts.enabled} 条　事件 ${r.events.length} 条`);
const bad = r.events.map((e, i) => ({ e, i })).filter(({ e, i }) => e.op === 'get' && e.defined === false);
console.log(`"读时还没有值"的读 ${bad.length} 处。逐条看它后面有没有会给值的写入者：\n`);
for (const { e, i } of bad.slice(0, 12)) {
  const later = r.events.slice(i + 1).filter((x) => x.name === e.name && (x.op === 'set' || x.op === 'add'));
  const real = later.filter((x) => x.op === 'add' || (String(x.value ?? '').trim() !== '' && !at.get(x.idx)?.clearer));
  const reader = at.get(e.idx);
  const firstReal = real[0];
  console.log(`变量 ${e.name}`);
  console.log(`   读： 「${e.by}」 列表位置 ${order.get(e.idx) ?? '—'}`);
  console.log(`   后面所有写入者 ${later.length} 个，其中"会给值的" ${real.length} 个`);
  if (firstReal) {
    console.log(`   最近一个会给值的写入：「${firstReal.by}」 列表位置 ${order.get(firstReal.idx) ?? '—'}`
      + `　值=${JSON.stringify(String(firstReal.value ?? firstReal.after ?? '')).slice(0, 40)}`);
  }
  console.log('');
}
