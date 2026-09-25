#!/usr/bin/env node
/** 诊断：某条条目展开前后到底长什么样（正文 + 宏到底是什么形状） */
import fs from 'node:fs';
const load = (rel) => new Function('globalThis', fs.readFileSync(rel, 'utf8'))(globalThis);
load('tools/gui/lib/parse.js');
load('tools/gui/lib/assemble.js');

const file = process.argv[2] || 'preset/芳乃预设.json';
const needle = process.argv[3] || 'ICOT';
const raw = fs.readFileSync(file, 'utf8');
const m = globalThis.PresetParse.parsePreset(JSON.parse(raw), file, Buffer.byteLength(raw));
const r = globalThis.PresetAssemble.assemble(m, { user: 'Master', char: '角色卡' });

for (const e of m.entries.filter((x) => x.name.includes(needle))) {
  const seg = r.segments.find((s) => s.idx === e.idx);
  console.log(`── ${e.name}  #${e.idx}  listed=${e.listed} enabled=${e.enabled} 原文 ${e.chars} 字 → 展开后 ${seg ? seg.chars : '?'} 字`);
  console.log('   正文:\n' + (e.content || '').split('\n').map((l) => '     | ' + l).join('\n'));
  if (seg) console.log('   展开后:\n' + (seg.text || '(空)').split('\n').map((l) => '     > ' + l).join('\n'));
  console.log('');
}
