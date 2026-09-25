#!/usr/bin/env node
/** 诊断：哪些内置槽位条目被放进了 Gemini 骨架（即切到别家会被关掉） */
import fs from 'node:fs';

const g = JSON.parse(fs.readFileSync('spec/groups.json', 'utf8'));
const jb = g.groups.find((x) => x.id === 'jailbreak');
const gem = new Set(jb.options.find((o) => o.id === 'gemini').members);

const files = fs.readdirSync('preset').filter((f) => f.startsWith('芳乃预设-') && f.endsWith('.json')).sort();
const p = JSON.parse(fs.readFileSync('preset/' + files[files.length - 1], 'utf8'));

const SLOT = ['main', 'nsfw', 'jailbreak', 'chatHistory', 'dialogueExamples', 'charDescription',
  'charPersonality', 'worldInfoBefore', 'worldInfoAfter', 'personaDescription', 'scenario', 'enhanceDefinitions'];

console.log('内置槽位条目是否落在 Gemini 骨架里：');
let victims = 0;
for (const s of SLOT) {
  const e = p.prompts.find((x) => x.identifier === s);
  const inPool = e && gem.has(e.name);
  if (inPool) victims++;
  console.log('  ' + s.padEnd(20) + (e ? e.name : '(无)').padEnd(26) + (inPool ? '★ 在骨架里 → 切到别家会被关掉' : '不在骨架里'));
}
console.log(`\n受影响槽位：${victims} 个`);
