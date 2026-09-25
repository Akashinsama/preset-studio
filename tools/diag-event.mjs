#!/usr/bin/env node
/** 找 Izumi 里处理 <current_event> / <progress> 的正则 */
import fs from 'node:fs';

const I = JSON.parse(fs.readFileSync('Izumi_0914.json', 'utf8'));
const NEEDLES = ['current_event', 'progress', 'PG\\.', 'MQ\\.', 'SQ\\.'];

console.log('=== Izumi 中 findRegex 命中 current_event / progress 的正则 ===');
for (const r of I.extensions.regex_scripts ?? []) {
  const find = String(r.findRegex);
  if (!/current_event|progress/i.test(find)) continue;
  console.log(`\n--- ${r.scriptName}　disabled=${r.disabled} markdownOnly=${r.markdownOnly} promptOnly=${r.promptOnly} placement=${JSON.stringify(r.placement)} runOnEdit=${r.runOnEdit}`);
  console.log('    findRegex: ' + find);
  console.log('    replace:   ' + String(r.replaceString).slice(0, 260).replace(/\n/g, ' ⏎ '));
}

console.log('\n\n=== 所有正则名一览（带开关状态）===');
for (const r of I.extensions.regex_scripts ?? []) {
  console.log(`  [${r.disabled ? '关' : '开'}] ${r.scriptName.padEnd(40)} md=${r.markdownOnly ? 'Y' : 'N'} po=${r.promptOnly ? 'Y' : 'N'} pl=${JSON.stringify(r.placement)}`);
}
