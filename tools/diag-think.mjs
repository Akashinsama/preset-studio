#!/usr/bin/env node
/**
 * 诊断：思维链显示为什么混在一起 + ICOT/COT 规定了几段
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const P = (...a) => path.join(ROOT, ...a);

const files = fs.readdirSync(P('preset')).filter((f) => f.startsWith('芳乃预设-') && f.endsWith('.json')).sort();
const preset = JSON.parse(fs.readFileSync(P('preset', files[files.length - 1]), 'utf8'));
const order = new Map(preset.prompt_order[0].order.map((o) => [o.identifier, !!o.enabled]));
const byName = new Map(preset.prompts.map((p) => [p.name ?? '', p]));

const show = (title, names) => {
  console.log(`\n===== ${title} =====`);
  for (const n of names) {
    const p = byName.get(n);
    if (!p) { console.log(`  ${n}：成品里没有`); continue; }
    console.log(`  [${order.get(p.identifier) ? '开' : '关'}] ${n}　${(p.content ?? '').length} 字`);
    console.log('      ' + (p.content ?? '').replace(/\n/g, ' ⏎ ').slice(0, 320));
  }
};

/* 1. 谁在教模型怎么思考 */
const thinkNames = preset.prompts
  .filter((p) => /思维链|ICOT|COT|思考/.test(p.name ?? ''))
  .map((p) => p.name);
show('所有和思维链相关的条目（开/关）', thinkNames);

/* 2. 两条折叠正则 */
console.log('\n===== 内嵌的折叠正则 =====');
for (const r of preset.extensions.regex_scripts ?? []) {
  console.log(`\n--- ${r.scriptName}`);
  console.log('  disabled=' + r.disabled + '  markdownOnly=' + r.markdownOnly + '  promptOnly=' + r.promptOnly + '  placement=' + JSON.stringify(r.placement));
  console.log('  findRegex: ' + r.findRegex);
  const rep = String(r.replaceString);
  const marker = rep.match(/<(?:details|style|div)[^>]{0,60}/i);
  console.log('  输出首标签: ' + (marker ? marker[0] : '(纯文本)'));
  console.log('  含 $1 = ' + rep.includes('$1') + '　长度 ' + rep.length);
  const labels = [...rep.matchAll(/<summary\b[^>]*>([\s\S]*?)<\/summary>/gi)]
    .map((m) => m[1].replace(/<[^>]*>/g, '').trim());
  console.log('  可见文案: ' + JSON.stringify(labels));
}

/* 3. 模型被要求用哪个思维链标签 */
console.log('\n===== 提示词里出现的思维链标签（只统计启用条目）=====');
const tags = ['konatan_planning~', '<thinking>', '</thinking>', '<think>', '</think>', '<Interleaving>'];
for (const t of tags) {
  const rows = preset.prompts.filter((p) => order.get(p.identifier) && (p.content ?? '').includes(t));
  console.log(`  ${t.padEnd(20)} 出现在 ${rows.length} 条启用条目里：${rows.map((p) => p.name).slice(0, 6).join('、')}`);
}
