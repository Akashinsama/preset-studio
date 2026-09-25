#!/usr/bin/env node
/**
 * 诊断：M2 体检器在真实预设上的输出
 *
 *   node tools/diag-checkup.mjs                 # Izumi + 成品预设
 *   node tools/diag-checkup.mjs 文件.json ...   # 指定文件
 *
 * 用途有两个：
 *   1. 看体检清单读起来像不像人话（不是断言，是肉眼审查）；
 *   2. **拿成品预设当反例检查器**：我们自己的预设是过了 106 项构建校验的，
 *      如果体检器在它身上报出一堆"必改"，那多半是体检器误报，而不是预设有问题。
 */
import fs from 'node:fs';

const load = (rel) => new Function('globalThis', fs.readFileSync(rel, 'utf8'))(globalThis);
load('tools/gui/lib/parse.js');
load('tools/gui/lib/assemble.js');
load('tools/gui/lib/invariants.js');

const PP = globalThis.PresetParse;
const PA = globalThis.PresetAssemble;
const PI = globalThis.PresetInvariants;

const files = process.argv.slice(2).length ? process.argv.slice(2)
  : ['Izumi_0914.json', 'preset/芳乃预设.json'];

for (const f of files) {
  if (!fs.existsSync(f)) { console.log(`（跳过 ${f}：不存在）\n`); continue; }
  const raw = fs.readFileSync(f, 'utf8');
  const m = PP.parsePreset(JSON.parse(raw), f, Buffer.byteLength(raw));
  const r = PA.assemble(m, { user: 'Master', char: '角色卡' });
  const rep = PI.check(m, r);

  console.log('════════════════════════════════════════════════');
  console.log(`${f}　条目 ${m.counts.prompts} / 开启 ${m.counts.enabled}　正文 ${r.totalChars} 字`);
  console.log(`必改 ${rep.counts.err} · 建议 ${rep.counts.warn} · 提示 ${rep.counts.info}`);
  for (const it of rep.items) {
    console.log(`\n[${rep.levelLabel[it.level]}] ${it.title}`);
    console.log('   为什么：' + it.why.replace(/\n\s*/g, ' ').slice(0, 140));
    console.log('   怎么改：' + it.fix.replace(/\n\s*/g, ' ').slice(0, 120));
    for (const e of it.evidence.slice(0, 6)) console.log('     · ' + e);
    if (it.evidence.length > 6) console.log(`     · …还有 ${it.evidence.length - 6} 条`);
  }
  console.log('');
}
