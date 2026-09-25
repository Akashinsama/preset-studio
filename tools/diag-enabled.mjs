#!/usr/bin/env node
/** 诊断：prompt.enabled 与 prompt_order[].enabled 的关系（导出时必须两边一致） */
import fs from 'node:fs';
for (const file of process.argv.slice(2).length ? process.argv.slice(2) : ['Izumi_0914.json', 'preset/芳乃预设.json']) {
  if (!fs.existsSync(file)) continue;
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ord = j.prompt_order[0].order;
  const byId = new Map(j.prompts.map((p) => [p.identifier, p]));
  let agree = 0, dis = 0;
  const ex = [];
  for (const o of ord) {
    const p = byId.get(o.identifier);
    if (!p) continue;
    if (!!p.enabled === !!o.enabled) agree++;
    else { dis++; if (ex.length < 4) ex.push(`${p.name}: prompt=${!!p.enabled} order=${!!o.enabled}`); }
  }
  const un = j.prompts.filter((p) => !ord.some((o) => o.identifier === p.identifier));
  console.log(`\n${file}`);
  console.log(`  在列表的条目：prompt.enabled 与 order.enabled 一致 ${agree} / 不一致 ${dis}`);
  for (const e of ex) console.log('    · ' + e);
  console.log('  order 里有 identifier 但 prompts 里没有的:', ord.filter((o) => !byId.has(o.identifier)).length);
  console.log('  未列入的条目:', un.length, '（prompt.enabled 分布 ' +
    JSON.stringify(un.reduce((a, p) => { const k = String(!!p.enabled); a[k] = (a[k] || 0) + 1; return a; }, {})) + '）');
}
