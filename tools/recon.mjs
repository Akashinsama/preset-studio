#!/usr/bin/env node
/**
 * 侦察：角色名分布 + 思维链正则的显示文案
 *
 *   node tools/recon.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PRESETS = ['Izumi_0914.json', 'Kemini_Dramatron_v3.1.json', '梦鲸思客V4-0915.json'];
const NAMES = ['泉此方', '小此', 'Konata', '芳乃', '朝武'];
const THINK = /思维链|思考/;

for (const file of PRESETS) {
  const json = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  const order = new Map((json.prompt_order?.[0]?.order ?? []).map((o) => [o.identifier, !!o.enabled]));

  console.log(`\n########## ${file} ##########`);
  console.log('-- 条目里出现次数（名字 / 正文）--');
  for (const n of NAMES) {
    const inName = (json.prompts ?? []).filter((p) => (p.name ?? '').includes(n));
    const inBody = (json.prompts ?? []).filter((p) => (p.content ?? '').includes(n));
    const count = (json.prompts ?? []).reduce((a, p) => a + ((p.content ?? '').split(n).length - 1), 0);
    if (!inName.length && !inBody.length) continue;
    console.log(`  ${n.padEnd(6)} 名字命中 ${String(inName.length).padStart(3)} 条　正文命中 ${String(inBody.length).padStart(3)} 条　正文出现 ${count} 次`);
    if (inName.length) console.log(`         名字含它的条目：${inName.map((p) => p.name).join('、')}`);
  }

  const rx = json.extensions?.regex_scripts ?? [];
  const hit = rx.filter((r) => NAMES.some((n) => `${r.scriptName}${r.findRegex}${r.replaceString}`.includes(n)));
  if (hit.length) {
    console.log('-- 正则里含角色名 --');
    for (const r of hit) console.log(`  ${r.scriptName}　find=${r.findRegex.length}字 replace=${r.replaceString.length}字`);
  }
  const sc = (json.extensions?.tavern_helper?.scripts ?? [])
    .filter((s) => NAMES.some((n) => (s.content ?? '').includes(n)));
  if (sc.length) {
    console.log('-- 面板脚本里含角色名 --');
    for (const s of sc) console.log(`  ${s.name}　${NAMES.map((n) => n + '×' + ((s.content ?? '').split(n).length - 1)).join(' ')}`);
  }
}

console.log('\n\n########## 思维链相关正则的显示文案 ##########');
for (const file of PRESETS) {
  const json = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  for (const r of json.extensions?.regex_scripts ?? []) {
    if (!THINK.test(r.scriptName)) continue;
    console.log(`\n===== [${file}] ${r.scriptName}　disabled=${r.disabled} markdownOnly=${r.markdownOnly} promptOnly=${r.promptOnly} placement=${r.placement}`);
    console.log('  findRegex: ' + r.findRegex.slice(0, 200));
    // 显示用文字通常在 replaceString 开头（折叠标题），或 <summary> 里
    const rep = r.replaceString ?? '';
    const head = rep.slice(0, 400).replace(/\n/g, '⏎');
    console.log('  replaceString 开头: ' + head);
    for (const m of rep.matchAll(/([\u4e00-\u9fff]{2,12}(?:中|中…|中\.\.\.|思考|思维链)[\u4e00-\u9fff]{0,6})/g)) {
      console.log('    ↳ 疑似显示文案: ' + m[1]);
    }
    const sum = rep.match(/<summary[^>]*>([\s\S]{0,80}?)<\/summary>/i);
    if (sum) console.log('    ↳ <summary>: ' + sum[1].replace(/\n/g, '⏎'));
    const det = rep.match(/<details[\s\S]{0,160}/i);
    if (det) console.log('    ↳ <details 段: ' + det[0].replace(/\n/g, '⏎'));
  }
}
