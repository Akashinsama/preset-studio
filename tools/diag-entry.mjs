#!/usr/bin/env node
/** 诊断：看看某条条目到底设了哪些变量（凭什么被当成"选一"的候选） */
import fs from 'node:fs';
const load = (rel) => new Function('globalThis', fs.readFileSync(rel, 'utf8'))(globalThis);
load('tools/gui/lib/parse.js');

const file = process.argv[2] || 'preset/芳乃预设.json';
const needle = process.argv[3] || '🔗';
const raw = fs.readFileSync(file, 'utf8');
const m = globalThis.PresetParse.parsePreset(JSON.parse(raw), file, Buffer.byteLength(raw));

for (const e of m.entries.filter((x) => x.name.includes(needle))) {
  console.log(`── ${e.name}  #${e.idx}  listed=${e.listed} enabled=${e.enabled} role=${e.role} 标识=${e.identifier || '(无)'}`);
  console.log(`   正文 ${e.chars} 字｜sets ${e.sets.length}｜adds ${e.adds.length}｜gets ${e.gets.length}`);
  console.log('   sets: ' + e.sets.join('、'));
  console.log('   前 400 字: ' + JSON.stringify((e.content || '').slice(0, 400)));
  console.log('');
}
