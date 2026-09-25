#!/usr/bin/env node
/** 诊断：MQ./SQ. 这段进度文本是谁产生的、原本谁负责隐藏它 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const P = (...a) => path.join(ROOT, ...a);
const NEEDLES = ['当前主线任务', '当前支线事件', '最新使用支线事件编号', 'MQ.', 'SQ.'];

const SRC = ['Izumi_0914.json', 'Kemini_Dramatron_v3.1.json', '梦鲸思客V4-0915.json'];
const files = fs.readdirSync(P('preset')).filter((f) => f.startsWith('芳乃预设-') && f.endsWith('.json')).sort();
const built = 'preset/' + files[files.length - 1];

console.log('===== 一、三份源预设里谁提到这些字样 =====');
for (const file of SRC) {
  const json = JSON.parse(fs.readFileSync(P(file), 'utf8'));
  const hits = { prompts: [], regex: [], scripts: [] };
  for (const p of json.prompts ?? []) {
    const c = p.content ?? '';
    const n = p.name ?? '';
    if (NEEDLES.some((x) => c.includes(x) || n.includes(x))) hits.prompts.push({ name: n, id: p.identifier, len: c.length, hits: NEEDLES.filter((x) => c.includes(x)) });
  }
  for (const r of json.extensions?.regex_scripts ?? []) {
    const blob = `${r.scriptName}\n${r.findRegex}\n${r.replaceString}`;
    if (NEEDLES.some((x) => blob.includes(x))) hits.regex.push({ name: r.scriptName, disabled: r.disabled, markdownOnly: r.markdownOnly, promptOnly: r.promptOnly, placement: JSON.stringify(r.placement) });
  }
  for (const s of json.extensions?.tavern_helper?.scripts ?? []) {
    if (NEEDLES.some((x) => (s.content ?? '').includes(x))) hits.scripts.push(s.name);
  }
  if (hits.prompts.length || hits.regex.length || hits.scripts.length) {
    console.log(`\n--- ${file}`);
    for (const h of hits.prompts) console.log(`  [条目] ${h.name}　${h.len} 字　命中: ${h.hits.join(',')}`);
    for (const h of hits.regex) console.log(`  [正则] ${h.name}　disabled=${h.disabled} markdownOnly=${h.markdownOnly} promptOnly=${h.promptOnly} placement=${h.placement}`);
    for (const h of hits.scripts) console.log(`  [脚本] ${h}`);
  } else {
    console.log(`\n--- ${file}　（没有）`);
  }
}

console.log('\n\n===== 二、成品里这些字样出现在哪、开着还是关着 =====');
const p2 = JSON.parse(fs.readFileSync(P('preset', files[files.length - 1]), 'utf8'));
const order = new Map(p2.prompt_order[0].order.map((o) => [o.identifier, !!o.enabled]));
for (const p of p2.prompts) {
  const c = p.content ?? '';
  const n = p.name ?? '';
  if (NEEDLES.some((x) => c.includes(x) || n.includes(x))) {
    console.log(`  [${order.get(p.identifier) ? '开' : '关'}] ${n || '(无名)'}　${c.length} 字　命中: ${NEEDLES.filter((x) => c.includes(x)).join(',')}`);
  }
}
console.log('\n成品内嵌正则：');
for (const r of p2.extensions.regex_scripts ?? []) {
  const blob = `${r.scriptName}\n${r.findRegex}\n${r.replaceString}`;
  console.log(`  ${NEEDLES.some((x) => blob.includes(x)) ? '★命中' : '      '} ${r.scriptName}`);
}

console.log('\n\n===== 三、Izumi 里 Progress 相关的正则全文（看它是怎么藏的）=====');
const I = JSON.parse(fs.readFileSync(P('Izumi_0914.json'), 'utf8'));
for (const r of I.extensions.regex_scripts ?? []) {
  if (!/Progress|进度|摘要/i.test(r.scriptName)) continue;
  console.log(`\n--- ${r.scriptName}　disabled=${r.disabled} markdownOnly=${r.markdownOnly} promptOnly=${r.promptOnly} placement=${JSON.stringify(r.placement)}`);
  console.log('    findRegex: ' + String(r.findRegex).slice(0, 260));
  console.log('    replaceString: ' + String(r.replaceString).slice(0, 200).replace(/\n/g, ' ⏎ '));
}
