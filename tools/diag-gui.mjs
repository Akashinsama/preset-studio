#!/usr/bin/env node
/**
 * 诊断：Izumi 预设"拼装出来的正文为什么这么短"
 *   node tools/diag-gui.mjs
 */
import fs from 'node:fs';

const load = (rel) => new Function('globalThis', fs.readFileSync(rel, 'utf8'))(globalThis);
load('tools/gui/lib/parse.js');
load('tools/gui/lib/assemble.js');

const raw = fs.readFileSync('Izumi_0914.json', 'utf8');
const m = globalThis.PresetParse.parsePreset(JSON.parse(raw), 'Izumi_0914.json', Buffer.byteLength(raw));
const r = globalThis.PresetAssemble.assemble(m, { user: 'Master', char: '角色卡' });

const on = m.entries.filter((e) => e.listed && e.enabled);
console.log('开启条目', on.length, '｜原始字数合计', on.reduce((a, e) => a + e.chars, 0));
console.log('其中 injection_position=1（注入到深度）', on.filter((e) => e.injPos === 1).length);
console.log('其中 role 分布', JSON.stringify(on.reduce((a, e) => { a[e.role] = (a[e.role] || 0) + 1; return a; }, {})));
console.log('拼装分段', r.segments.length, '｜正文合计', r.totalChars, '｜token 估算', r.tokenEstimate);

const empt = r.segments.filter((s) => s.kind === 'prompt' && !s.text && !(s.note || '').includes('注入位'));
console.log('\n展开后变成空的条目', empt.length, '条：');
for (const s of empt.slice(0, 15)) console.log('   ·', s.name, '（原文 ' + (m.entries.find((e) => e.idx === s.idx)?.chars ?? '?') + ' 字）');

console.log('\n正文最长的 12 段：');
for (const s of [...r.segments].sort((a, b) => b.chars - a.chars).slice(0, 12)) {
  console.log('   ' + String(s.chars).padStart(6), s.name);
}
console.log('\n警告 ' + r.warnings.length + ' 条');
for (const w of r.warnings.slice(0, 20)) console.log('   [' + w.level + ']', w.kind, '—', w.text.slice(0, 70));
