#!/usr/bin/env node
/**
 * 子集设计草案生成（只读）
 *
 *   node tools/design-groups.mjs
 *
 * 用 Izumi 自己的区段标记把 226 条切成区域（区域 = 一个"子集"），
 * 区域外的条目再按名称关键词分桶。产出 spec/proposed-groups.md 供人工过一遍。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'spec');
fs.mkdirSync(OUT, { recursive: true });

const file = 'Izumi_0914.json';
const json = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const order = new Map((json.prompt_order?.[0]?.order ?? []).map((o, i) => [o.identifier, { e: o.enabled, i }]));

/** 区段边界标记：名字里带这些词且正文很短的，视为分界线而不是开关。 */
const isMarker = (p) => {
  const n = p.name ?? '';
  const len = (p.content ?? '').length;
  return len < 160 && /开始|结束|↓|↑|破甲加强区|四选一开|必开其一/.test(n);
};
/** 区域是单选还是多选 */
const modeOf = (open) => (/只开一个|选一|二选一|四选一|必开其一/.test(open) ? 'single' : 'multi');

const prompts = json.prompts ?? [];
const regions = [];
let cur = null;

for (const [i, p] of prompts.entries()) {
  const o = order.get(p.identifier);
  if (isMarker(p)) {
    const n = p.name ?? '';
    const opens = /开始|↓|破甲加强区|四选一开/.test(n) && !/结束|↑/.test(n);
    if (opens) {
      cur = { open: n, openIdx: o ? o.i : i, mode: modeOf(n), members: [] };
      regions.push(cur);
    } else {
      if (cur) { cur.close = n; cur.closeIdx = o ? o.i : i; }
      cur = null;
    }
    continue;
  }
  if (cur) cur.members.push({ p, o, i });
}

const inRegion = new Set(regions.flatMap((r) => r.members.map((m) => m.p.identifier)));
const rest = prompts
  .map((p, i) => ({ p, o: order.get(p.identifier), i }))
  .filter((m) => !inRegion.has(m.p.identifier) && !isMarker(m.p));

/** 区域外条目按关键词分桶 */
const BUCKETS = [
  ['核心身份/槽位', /main|jailbreak|nsfw$|chatHistory|dialogueExamples|charDescription|charPersonality|worldInfo|personaDescription|scenario|enhanceDefinitions|agent|说明|初始化变量|别动|^角色$|\/角色|^user$|\/user/],
  ['人称', /人称/],
  ['字数', /字数|扩写输入|双语对话|思维链语言/],
  ['NSFW', /NSFW|三选一|黑森森|真实|直白色情|谷崎|木珠|体型差|ASMR|本子/],
  ['防截断/防空回', /防截断|429|防空回|kemini防截断/],
  ['思维链', /思维链|思维模式/],
  ['摘要', /摘要|总结/],
  ['格式/示例/美化', /示例|格式|美化|前端|选项栏|弹幕|平行事件|小剧场/],
  ['反注入/防护开关', /^⚡️防|^⛔️|^😡|^🔴防|防媚|防全知|防揣测|防神化|防绝望|防机器人|防重复|防情绪|防过度|防小此/],
  ['叙事/剧情推进', /推剧情|慢推|转折|反直觉|疯狂|难度|客观叙事|转述|抢话|不只看user|心理描写|概念锚定|性格标签|事实增强|同人增强/],
  ['其他', /.*/],
];

const bucketOf = (name) => BUCKETS.find(([, re]) => re.test(name))?.[0] ?? '其他';
const buckets = new Map();
for (const m of rest) {
  const b = bucketOf(m.p.name ?? '');
  if (!buckets.has(b)) buckets.set(b, []);
  buckets.get(b).push(m);
}

/* ── 输出 ─────────────────────────────────────────────────────────── */
const L = [];
const fmt = (m) => {
  const on = m.o ? (m.o.e ? '**开**' : '关') : '—';
  return `\`${m.p.name || '(无名)'}\`(${(m.p.content ?? '').length},${on})`;
};

L.push('# Izumi 条目子集化草案');
L.push('');
L.push(`来源：\`${file}\`，共 ${prompts.length} 条。区域由 Izumi 自己的区段标记切出；区域外条目按关键词分桶。`);
L.push('');
L.push('> 面板里：`single` 子集渲染成下拉框（选中即开、其余全关），`multi` 子集渲染成一排开关。');
L.push('');

L.push('## A. 区段标记切出的子集（自动，可靠）');
L.push('');
for (const r of regions) {
  L.push(`### ${r.open} → ${r.close ?? '(未闭合)'}`);
  L.push('');
  L.push(`- 顺序区间：${r.openIdx}–${r.closeIdx ?? '?'}　**模式：${r.mode === 'single' ? '单选（下拉框）' : '多选（开关排）'}**　成员 ${r.members.length} 条`);
  L.push('');
  L.push(r.members.map(fmt).join('　'));
  L.push('');
}

L.push('## B. 区域外的条目（关键词分桶，需人工调整）');
L.push('');
for (const [b, members] of buckets) {
  L.push(`### ${b}（${members.length} 条）`);
  L.push('');
  L.push(members.map(fmt).join('　'));
  L.push('');
}

L.push('## C. 统计');
L.push('');
L.push(`- 区段子集：${regions.length} 个，覆盖 ${inRegion.size} 条`);
L.push(`- 区域外：${rest.length} 条，分入 ${buckets.size} 桶`);
L.push(`- 合计：${inRegion.size + rest.length} 条（另 ${prompts.length - inRegion.size - rest.length} 条为分界标记，不搬运）`);

fs.writeFileSync(path.join(OUT, 'proposed-groups.md'), L.join('\n'), 'utf8');
console.log(`已写出 spec/proposed-groups.md`);
console.log(`区段子集 ${regions.length} 个 / 覆盖 ${inRegion.size} 条；区域外 ${rest.length} 条 / ${buckets.size} 桶`);
for (const r of regions) console.log(`  [${r.mode}] ${r.open}  (${r.members.length} 条)`);
for (const [b, m] of buckets) console.log(`  [bucket] ${b}  (${m.length} 条)`);
