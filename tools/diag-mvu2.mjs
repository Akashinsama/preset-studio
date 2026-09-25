#!/usr/bin/env node
/** 读 MVU 条目与格式示例全文 + 开关状态 */
import fs from 'node:fs';

const files = fs.readdirSync('preset').filter((f) => f.startsWith('芳乃预设-') && f.endsWith('.json')).sort();
const p = JSON.parse(fs.readFileSync('preset/' + files[files.length - 1], 'utf8'));
const order = new Map(p.prompt_order[0].order.map((o) => [o.identifier, !!o.enabled]));
const g = JSON.parse(fs.readFileSync('spec/groups.json', 'utf8'));

const show = (n) => {
  const e = p.prompts.find((x) => x.name === n);
  if (!e) { console.log(`\n--- ${n}：（成品里没有）`); return; }
  console.log(`\n--- [${order.get(e.identifier) ? '开' : '关'}] ${n}　(${(e.content ?? '').length} 字)`);
  console.log(e.content);
};

console.log('===== 适配开关模块的成员 =====');
const ad = g.groups.find((x) => x.id === 'adapter');
for (const m of ad.members) {
  const e = p.prompts.find((x) => x.name === m);
  console.log(`  [${e && order.get(e.identifier) ? '开' : '关'}] ${m}`);
}

console.log('\n===== 格式示例模块的成员 =====');
const fm = g.groups.find((x) => x.id === 'format');
for (const m of fm.members) {
  const e = p.prompts.find((x) => x.name === m);
  console.log(`  [${e && order.get(e.identifier) ? '开' : '关'}] ${m}`);
}

for (const n of ['✅MVU Zod兼容', '✅MVU兼容（用再开）', '🔵吐槽版格式示例', '🔴其它格式示例', '🥚克劳德格式示例']) show(n);
