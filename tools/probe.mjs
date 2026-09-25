#!/usr/bin/env node
/**
 * 预设检索小工具（只读）
 *
 *   node tools/probe.mjs <预设名片段|all> <正则> [--ctx=120] [--content]
 *
 * 例：
 *   node tools/probe.mjs 梦鲸 "addvar|getglobalvar"
 *   node tools/probe.mjs all "压缩相邻消息"
 *   node tools/probe.mjs Kemini "雪融雪降" --content
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PRESETS = ['Izumi_0914.json', 'Kemini_Dramatron_v3.1.json', '梦鲸思客V4-0915.json'];

const [target = 'all', pattern = '', ...flags] = process.argv.slice(2);
if (!pattern) {
  console.error('用法: node tools/probe.mjs <预设名片段|all> <正则> [--ctx=N] [--content]');
  process.exit(2);
}
const ctxLen = Number((flags.find((f) => f.startsWith('--ctx=')) ?? '--ctx=120').slice(6));
const nameFilter = (flags.find((f) => f.startsWith('--names=')) ?? '').slice(8).split(',').filter(Boolean);
const showContent = flags.includes('--content') || nameFilter.length > 0;
const listMode = flags.includes('--list');
const re = new RegExp(pattern, 'g');

/** --list：只列条目清单，不做匹配 */
if (listMode) {
  for (const file of PRESETS) {
    if (target !== 'all' && !file.includes(target)) continue;
    const json = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    const order = new Map((json.prompt_order?.[0]?.order ?? []).map((o, i) => [o.identifier, { e: o.enabled, i }]));
    console.log(`\n========== ${file} ==========`);
    console.log('序 启 槽位 顺序  长度  条目名 ｜ 开头');
    for (const [i, p] of (json.prompts ?? []).entries()) {
      const o = order.get(p.identifier);
      const c = p.content ?? '';
      const slot = ['main', 'nsfw', 'jailbreak', 'chatHistory', 'dialogueExamples', 'charDescription', 'charPersonality', 'worldInfoBefore', 'worldInfoAfter', 'personaDescription', 'scenario', 'enhanceDefinitions', 'agentSystemPrompt', 'agentTask', 'agentResults'].includes(p.identifier) ? p.identifier : (p.role ?? '');
      console.log(
        String(i).padStart(3) + ' ' +
        (o ? (o.e ? '开' : '关') : '—') + ' ' +
        String(slot).padEnd(18) + ' ' +
        String(o ? o.i : '-').padStart(4) + ' ' +
        String(c.length).padStart(6) + '  ' +
        (p.name || '(无名)') + ' ｜ ' + c.replace(/\s+/g, ' ').trim().slice(0, 60),
      );
    }
  }
  process.exit(0);
}

for (const file of PRESETS) {
  if (target !== 'all' && !file.includes(target)) continue;
  const json = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  const order = new Map((json.prompt_order?.[0]?.order ?? []).map((o, i) => [o.identifier, { e: o.enabled, i }]));
  console.log(`\n========== ${file} ==========`);

  for (const p of json.prompts ?? []) {
    const c = p.content ?? '';
    re.lastIndex = 0;
    const byName = nameFilter.length > 0 && nameFilter.some((n) => (p.name ?? '').includes(n));
    if (!byName && nameFilter.length > 0) continue;
    if (nameFilter.length === 0 && !re.test(c)) continue;
    re.lastIndex = 0;
    const o = order.get(p.identifier);
    const hits = [...c.matchAll(re)];
    console.log(`\n--- ${p.name || p.identifier}  [${p.role}] enabled=${o ? o.e : 'N/A'} order=${o ? o.i : '-'} len=${c.length} 命中${hits.length}处`);
    if (showContent) {
      console.log(c);
    } else {
      for (const m of hits.slice(0, 6)) {
        const s = Math.max(0, m.index - 30);
        console.log('    …' + c.slice(s, m.index + ctxLen).replace(/\n/g, '⏎') + '…');
      }
      if (hits.length > 6) console.log(`    （其余 ${hits.length - 6} 处省略）`);
    }
  }

  // 正则脚本与助手脚本也扫一遍
  for (const r of json.extensions?.regex_scripts ?? []) {
    const blob = `${r.scriptName}\n${r.findRegex}\n${r.replaceString}`;
    re.lastIndex = 0;
    if (re.test(blob)) {
      re.lastIndex = 0;
      console.log(`\n--- [regex] ${r.scriptName}  disabled=${r.disabled} 命中${[...blob.matchAll(re)].length}处`);
      if (flags.includes('--regex')) {
        console.log('    findRegex: ' + r.findRegex);
        console.log('    replaceString:');
        console.log(String(r.replaceString).split('\n').map((l) => '      ' + l).join('\n'));
      }
    }
  }
  for (const s of json.extensions?.tavern_helper?.scripts ?? []) {
    const blob = `${s.name}\n${s.content ?? ''}`;
    re.lastIndex = 0;
    const hits = [...blob.matchAll(re)];
    if (!hits.length) continue;
    console.log(`\n--- [script] ${s.name}  enabled=${s.enabled} 命中${hits.length}处`);
    const seen = new Set();
    for (const m of hits.slice(0, 40)) {
      const s0 = Math.max(0, m.index - 60);
      const snippet = blob.slice(s0, m.index + ctxLen).replace(/\n/g, ' ');
      if (seen.has(snippet)) continue;
      seen.add(snippet);
      console.log('    …' + snippet + '…');
      if (seen.size >= 8) break;
    }
  }
}
