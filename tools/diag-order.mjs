#!/usr/bin/env node
/** 诊断：真实预设里 prompt_order 的顺序与槽位分布（生成骨架要照这个排） */
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const ANCHORS = ['main', 'nsfw', 'jailbreak', 'chatHistory', 'dialogueExamples', 'charDescription',
  'charPersonality', 'worldInfoBefore', 'worldInfoAfter', 'personaDescription', 'scenario', 'enhanceDefinitions'];

for (const file of process.argv.slice(2).length ? process.argv.slice(2) : ['Izumi_0914.json', 'preset/芳乃预设.json']) {
  if (!fs.existsSync(file)) continue;
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ord = j.prompt_order[0].order;
  const byId = new Map(j.prompts.map((p) => [p.identifier, p]));
  console.log(`\n${file}　order 长度 ${ord.length}`);
  console.log('  槽位在哪几个位置：');
  ord.forEach((o, i) => {
    if (!ANCHORS.includes(o.identifier)) return;
    const p = byId.get(o.identifier) ?? {};
    console.log(`    #${String(i).padStart(3)} ${o.identifier.padEnd(18)} ${o.enabled ? '开' : '关'}　「${p.name ?? '(不在 prompts 里)'}」　正文 ${(p.content ?? '').length} 字`);
  });
  const first = ord.slice(0, 12).map((o, i) => `${i}:${(byId.get(o.identifier)?.name ?? o.identifier).slice(0, 14)}`);
  console.log('  前 12 位：' + first.join(' ｜ '));
}
