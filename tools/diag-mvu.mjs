#!/usr/bin/env node
/** 诊断：MVU（变量更新）在三份来源里靠什么工作，成品里现在有什么 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const P = (...a) => path.join(ROOT, ...a);
const NEEDLES = ['MVU', 'mvu', 'UpdateVariable', '变量更新', 'Zod', 'zod', 'stat_data', 'JSONPatch', 'json_patch', 'schema'];

const SRC = ['Izumi_0914.json', 'Kemini_Dramatron_v3.1.json', '梦鲸思客V4-0915.json'];
const files = fs.readdirSync(P('preset')).filter((f) => f.startsWith('芳乃预设-') && f.endsWith('.json')).sort();

const scan = (label, json, withState) => {
  console.log(`\n########## ${label}`);
  const order = withState
    ? new Map((json.prompt_order?.[0]?.order ?? []).map((o) => [o.identifier, !!o.enabled]))
    : null;

  const hits = [];
  for (const p of json.prompts ?? []) {
    const c = p.content ?? '';
    const n = p.name ?? '';
    const found = NEEDLES.filter((x) => c.includes(x) || n.includes(x));
    if (found.length) hits.push({ name: n, id: p.identifier, len: c.length, found, content: c });
  }
  console.log(`  条目命中 ${hits.length} 条：`);
  for (const h of hits) {
    const st = order ? `[${order.get(h.id) ? '开' : '关'}] ` : '';
    console.log(`    ${st}${h.name || '(无名)'}　${h.len} 字　命中 ${h.found.join(',')}`);
  }

  const rx = (json.extensions?.regex_scripts ?? []).filter((r) =>
    NEEDLES.some((x) => `${r.scriptName}${r.findRegex}${r.replaceString}`.includes(x)));
  console.log(`  正则命中 ${rx.length} 条：`);
  for (const r of rx) console.log(`    [${r.disabled ? '关' : '开'}] ${r.scriptName}`);

  const sc = (json.extensions?.tavern_helper?.scripts ?? []).filter((s) =>
    NEEDLES.some((x) => (s.content ?? '').includes(x)));
  console.log(`  助手脚本命中 ${sc.length} 个：${sc.map((s) => s.name).join('、') || '（无）'}`);
  return hits;
};

for (const file of SRC) {
  const json = JSON.parse(fs.readFileSync(P(file), 'utf8'));
  scan(file, json, false);
}

const built = JSON.parse(fs.readFileSync(P('preset', files[files.length - 1]), 'utf8'));
const bh = scan(`成品 ${files[files.length - 1]}`, built, true);

console.log('\n\n===== 成品里 MVU 相关条目的全文 =====');
for (const h of bh) {
  console.log(`\n--- ${h.name}　(${h.len} 字)`);
  console.log(h.content.slice(0, 900));
}

console.log('\n\n===== 梦鲸的 MVU 机制全文（我们的成品没搬）=====');
const M = JSON.parse(fs.readFileSync(P('梦鲸思客V4-0915.json'), 'utf8'));
for (const n of ['schema初始化', 'MVU强制 - 掉格式打开', 'MVU不更新 - 额外模型解析打开', 'schema初始化-thinking']) {
  const e = (M.prompts ?? []).find((p) => (p.name ?? '') === n);
  if (!e) { console.log(`\n--- ${n}：（梦鲸里没找到）`); continue; }
  console.log(`\n--- ${n}　(${(e.content ?? '').length} 字)`);
  console.log((e.content ?? '').slice(0, 700));
}
