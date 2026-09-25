#!/usr/bin/env node
/** 看两个折叠模板里 $1 的位置与类名 */
import fs from 'node:fs';

const K = JSON.parse(fs.readFileSync('Kemini_Dramatron_v3.1.json', 'utf8'));
const I = JSON.parse(fs.readFileSync('Izumi_0914.json', 'utf8'));

const k = K.extensions.regex_scripts.find((r) => r.scriptName === '思维链折叠');
const i = I.extensions.regex_scripts.find((r) => r.scriptName === '1美化最近2层思维链（流式）');

for (const [name, r] of [['Kemini 模板', k], ['Izumi 模板', i]]) {
  const rep = String(r.replaceString);
  console.log(`\n===== ${name}（${rep.length} 字）=====`);
  console.log('findRegex: ' + r.findRegex);
  let idx = -1;
  let n = 0;
  while ((idx = rep.indexOf('$1', idx + 1)) >= 0 && n < 5) {
    n++;
    console.log(`  $1 #${n} 上下文: …${rep.slice(Math.max(0, idx - 90), idx + 60).replace(/\n/g, ' ⏎ ')}…`);
  }
  console.log('  含类名 st_custom_reasoning: ' + rep.includes('st_custom_reasoning')
    + '　konata- 类名: ' + (rep.match(/konata-[a-z-]+/g) || []).slice(0, 6).join(','));
  console.log('  首 120 字: ' + rep.slice(0, 120).replace(/\n/g, ' ⏎ '));
  console.log('  末 160 字: ' + rep.slice(-160).replace(/\n/g, ' ⏎ '));
}
