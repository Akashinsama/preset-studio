#!/usr/bin/env node
/** 读摘要相关条目全文，以及 Izumi 里配套的摘要正则 */
import fs from 'node:fs';

const files = fs.readdirSync('preset').filter((f) => f.startsWith('芳乃预设-') && f.endsWith('.json')).sort();
const p = JSON.parse(fs.readFileSync('preset/' + files[files.length - 1], 'utf8'));
const order = new Map(p.prompt_order[0].order.map((o) => [o.identifier, !!o.enabled]));

console.log('=== 摘要模块的成员（成品里的开关状态）===');
const g = JSON.parse(fs.readFileSync('spec/groups.json', 'utf8')).groups.find((x) => x.id === 'summary');
for (const n of g.members) {
  const e = p.prompts.find((x) => x.name === n);
  console.log(`  [${e && order.get(e.identifier) ? '开' : '关'}] ${n}　${e ? (e.content ?? '').length : 0} 字`);
}

for (const n of g.members) {
  const e = p.prompts.find((x) => x.name === n);
  if (!e) continue;
  console.log(`\n########## ${n} ##########`);
  console.log(e.content);
}

console.log('\n\n=== Izumi 里所有和「摘要 / Progress」有关的正则 ===');
const I = JSON.parse(fs.readFileSync('Izumi_0914.json', 'utf8'));
for (const r of I.extensions.regex_scripts ?? []) {
  if (!/摘要|Progress|进度|总结/i.test(r.scriptName)) continue;
  console.log(`  [${r.disabled ? '关' : '开'}] ${r.scriptName.padEnd(34)} mdOnly=${r.markdownOnly ? 'Y' : 'N'} promptOnly=${r.promptOnly ? 'Y' : 'N'} placement=${JSON.stringify(r.placement)}`);
}
