#!/usr/bin/env node
/** 看一眼 iz_tail 档位各成员到底写了什么，决定它属于"思维链选择"还是"纯预填充" */
import fs from 'node:fs';

const g = JSON.parse(fs.readFileSync('spec/groups.json', 'utf8'));
const jb = g.groups.find((x) => x.id === 'jailbreak');
const tail = jb.options.find((o) => o.id === 'izumi').tunables.find((t) => t.id === 'iz_tail');

const files = fs.readdirSync('preset').filter((f) => f.startsWith('芳乃预设-') && f.endsWith('.json')).sort();
const p = JSON.parse(fs.readFileSync('preset/' + files[files.length - 1], 'utf8'));
const byName = new Map(p.prompts.map((x) => [x.name ?? '', x]));

console.log('=== iz_tail 档位成员 ===');
for (const m of tail.members) {
  const e = byName.get(m);
  console.log(`\n--- ${m}　(${e ? (e.content ?? '').length : 0} 字)`);
  if (e) console.log('    ' + (e.content ?? '').replace(/\n/g, ' ⏎ ').slice(0, 260));
  const c = e ? e.content ?? '' : '';
  console.log('    含 konatan_planning~ : ' + c.includes('konatan_planning~') + '　含 <think : ' + /<think/i.test(c));
}

console.log('\n=== 当前 cot 组（Izumi 的思维链条目）===');
const cot = g.groups.find((x) => x.id === 'cot');
for (const m of cot.members) {
  const e = byName.get(m);
  const c = e ? e.content ?? '' : '';
  console.log(`  ${m.padEnd(22)} ${c.includes('konatan_planning~') ? 'konatan' : '?'.padEnd(8)}　${(c.match(/字数控制在|条左右|字左右/g) || []).join(',') || ''}`);
}

console.log('\n=== 当前 gemini 的思维链档位 ===');
const kmcot = jb.options.find((o) => o.id === 'gemini').tunables.find((t) => t.id === 'km_cot');
console.log('  ' + kmcot.members.join(' / '));
