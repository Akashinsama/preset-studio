#!/usr/bin/env node
/**
 * 诊断：对比桌面上的原版预设与两份"-改"导出，看脚本到底在不在。
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(process.env.USERPROFILE || '', 'Desktop');
const FILES = [
  'Tavo_九域测试0.2.5（正则配套版，也可单独使用）_1yDQB.json',
  'Tavo_九域测试0.2.5（正则配套版，也可单独使用）_1yDQB-改.json',
  'Tavo_九域测试0.2.5（正则配套版，也可单独使用）_1yDQB-改 (1).json',
];

const rows = [];
for (const name of FILES) {
  const p = path.join(DIR, name);
  if (!fs.existsSync(p)) { console.log('缺文件：' + name); continue; }
  const raw = fs.readFileSync(p, 'utf8');
  let json;
  try { json = JSON.parse(raw); } catch (e) { console.log(`${name}：JSON 解析失败 ${e.message}`); continue; }
  const scripts = json.extensions?.tavern_helper?.scripts ?? [];
  const regexes = json.extensions?.regex_scripts ?? [];
  rows.push({
    name,
    kb: (Buffer.byteLength(raw, 'utf8') / 1024).toFixed(1),
    prompts: (json.prompts ?? []).length,
    enabled: (json.prompt_order?.[0]?.order ?? []).filter((o) => o.enabled).length,
    scripts: scripts.length,
    scriptNames: scripts.map((s) => `${s.name}(${(String(s.content ?? '').length / 1024).toFixed(1)}KB,${s.enabled ? 'on' : 'off'})`).join(' + ') || '—',
    hasPanel: scripts.some((s) => String(s.content ?? '').includes('FANO_PANEL_CONFIG_BEGIN')),
    regexes: regexes.length,
    extKeys: Object.keys(json.extensions ?? {}).join(','),
  });
}

for (const r of rows) {
  console.log('════════════════════════════════════════');
  console.log(r.name);
  console.log(`  ${r.kb} KB｜条目 ${r.prompts}｜开启 ${r.enabled}｜正则 ${r.regexes}`);
  console.log(`  脚本 ${r.scripts} 个：${r.scriptNames}`);
  console.log(`  含芳乃面板配置块：${r.hasPanel ? '是' : '否'}`);
  console.log(`  extensions 的键：${r.extKeys}`);
}

/* 和原版对比：逐条 sha1，看导出到底改了什么 */
if (rows.length >= 2) {
  const base = JSON.parse(fs.readFileSync(path.join(DIR, FILES[0]), 'utf8'));
  for (const f of FILES.slice(1)) {
    const p = path.join(DIR, f);
    if (!fs.existsSync(p)) continue;
    const cur = JSON.parse(fs.readFileSync(p, 'utf8'));
    const bp = base.prompts ?? [];
    const cp = cur.prompts ?? [];
    let same = 0;
    const added = [];
    for (let i = 0; i < Math.max(bp.length, cp.length); i++) {
      const a = JSON.stringify(bp[i]);
      const b = JSON.stringify(cp[i]);
      if (a === b) same++;
      else if (bp[i] && !cp[i]) added.push('少了 ' + bp[i].name);
      else if (!bp[i] && cp[i]) added.push('多了 ' + cp[i].name);
      else added.push('改了 ' + (bp[i]?.name ?? '?'));
    }
    console.log('════════════════════════════════════════');
    console.log(`${f} 相对原版：条目 ${bp.length} → ${cp.length}，逐条相同的 ${same} 条`);
    for (const a of added.slice(0, 8)) console.log('   · ' + a);
    const bo = JSON.stringify(base.prompt_order);
    const co = JSON.stringify(cur.prompt_order);
    console.log(`  prompt_order 相同：${bo === co ? '是' : '否'}`);
    const bk = Object.keys(base).filter((k) => k !== 'prompts' && k !== 'prompt_order');
    const differ = bk.filter((k) => JSON.stringify(base[k]) !== JSON.stringify(cur[k]));
    console.log(`  顶层其它字段有变化的：${differ.join('、') || '（无）'}`);
  }
}
