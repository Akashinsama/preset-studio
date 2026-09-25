#!/usr/bin/env node
/** mvu 变量的生产者 / 消费者链路 */
import fs from 'node:fs';

const f = fs.readdirSync('preset').filter((x) => x.startsWith('芳乃预设-') && x.endsWith('.json')).sort();
const p = JSON.parse(fs.readFileSync('preset/' + f[f.length - 1], 'utf8'));
const order = new Map(p.prompt_order[0].order.map((o) => [o.identifier, !!o.enabled]));

const setMvu = [];
const getMvu = [];
for (const e of p.prompts) {
  const c = e.content || '';
  /* 初始化变量（别动）只是把 mvu 清空，不算生产者 */
  if (c.includes('{{setvar::mvu::') && !(e.name ?? '').includes('初始化变量')) setMvu.push(e.name);
  if (c.includes('{{getvar::mvu}}')) getMvu.push(e.name);
}

console.log('【设 mvu 变量】的条目：');
for (const n of setMvu) {
  const e = p.prompts.find((x) => x.name === n);
  console.log(`  [${order.get(e.identifier) ? '开' : '关'}] ${n}`);
}
console.log('\n【读 mvu 变量】的条目（只有它们会把 MVU 骨架送进输出格式）：');
for (const n of getMvu) {
  const e = p.prompts.find((x) => x.name === n);
  console.log(`  [${order.get(e.identifier) ? '开' : '关'}] ${n}`);
}

const anySet = setMvu.some((n) => order.get(p.prompts.find((x) => x.name === n).identifier));
const anyGet = getMvu.some((n) => order.get(p.prompts.find((x) => x.name === n).identifier));
console.log(`\nMVU 生产者（设 mvu 变量）开着：${anySet ? '是' : '否'}`);
console.log(`MVU 消费者（读 mvu 变量）开着：${anyGet ? '是' : '否'}`);
console.log(`结论：${anySet && anyGet ? '链路通，模型会看到 MVU 骨架'
  : (!anySet && !anyGet ? '★ 链路两端都关着 → 模型完全没收到"要更新变量"的指令（这就是原因）'
    : (!anySet ? '缺生产者：mvu 变量没被赋值，消费者展开为空' : '缺消费者：mvu 变量没人读，等于没设'))}`);
console.log('\n注：初始化变量（别动）开着，它只做一件事——把 mvu 清空。所以没人设 = 展开成空字符串。');
