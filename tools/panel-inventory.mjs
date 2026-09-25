#!/usr/bin/env node
/**
 * 面板功能清点（只读）
 *
 *   node tools/panel-inventory.mjs [预设名片段|all]
 *
 * 从一个预设内嵌的酒馆助手脚本里抽出：
 *   - localStorage / 状态键
 *   - CSS 设计 token（配色改动的落点）
 *   - UI 标签文案（中文短字符串）
 *   - DOM 交互计数
 * 用来判断"沿用某家的面板"要改哪些地方。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PRESETS = ['Izumi_0914.json', 'Kemini_Dramatron_v3.1.json', '梦鲸思客V4-0915.json'];
const target = process.argv[2] ?? 'all';

const uniq = (arr) => [...new Set(arr)];

for (const file of PRESETS) {
  if (target !== 'all' && !file.includes(target)) continue;
  const json = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  const scripts = json.extensions?.tavern_helper?.scripts ?? [];
  if (!scripts.length) continue;

  console.log(`\n\n################################ ${file} ################################`);

  for (const s of scripts) {
    const c = s.content ?? '';
    if (!c) continue;
    const lines = c.split('\n').length;
    console.log(`\n=========== [script] ${s.name}  enabled=${s.enabled}  ${(c.length / 1024).toFixed(0)}KB / ${lines} 行 ===========`);

    // 1. 状态键
    const stored = uniq([...c.matchAll(/['"]([a-z][a-z0-9_]*_(?:v\d+|key|slots|snapshots|guide|position|size|mode|enabled))['"]/gi)].map((m) => m[1]));
    console.log('\n-- 存储键 --');
    console.log('   ' + (stored.length ? stored.join(', ') : '（无）'));

    // 2. CSS token 及其取值
    const tokenBlock = c.match(/--[a-zA-Z][a-zA-Z0-9-]{1,40}\s*:\s*[^;]{1,60};/g) ?? [];
    console.log(`\n-- CSS token 取值（配色落点，共 ${uniq(tokenBlock).length} 条）--`);
    for (const t of uniq(tokenBlock).slice(0, 40)) console.log('   ' + t.trim());

    // 3. UI 文案：只看赋值上下文与 HTML 文本节点，避开数组里的词表
    const fromAssign = [...c.matchAll(/(?:title|label|placeholder|text|aria-label|tooltip)\s*[:=]\s*['"`]([\u4e00-\u9fff][^'"`\n]{1,22})['"`]/g)].map((m) => m[1].trim());
    const fromHtml = [...c.matchAll(/>\s*([\u4e00-\u9fff][^<>\n]{1,22}?)\s*</g)].map((m) => m[1].trim());
    const labels = uniq([...fromAssign, ...fromHtml]).filter((t) => t.length >= 2);
    console.log(`\n-- UI 文案（${labels.length} 条，前 120）--`);
    console.log('   ' + labels.slice(0, 120).join(' | '));

    // 4. DOM / 交互
    const counts = {};
    for (const k of ['createElement', 'innerHTML', 'addEventListener', 'querySelector', 'toast', 'button', 'panel', 'drag', 'localStorage', 'getPreset', 'updatePresetWith', 'eventOn', 'generate', 'injection', 'prompt_order', 'regex']) {
      const n = (c.match(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length;
      if (n) counts[k] = n;
    }
    console.log('\n-- 关键调用计数 --');
    console.log('   ' + Object.entries(counts).map(([k, v]) => `${k}:${v}`).join('  '));
  }
}
