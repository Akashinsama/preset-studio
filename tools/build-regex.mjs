#!/usr/bin/env node
/**
 * 思维链折叠链生成（统一显示形态）
 *
 *   node tools/build-regex.mjs
 *
 * 规则（用户要求）：
 *   · 只有一个思考块  → 用 Izumi 的展示形态
 *   · 有两个以上      → 用 Kemini 的展示形态（每块一个）
 *
 * 纯正则实现，不需要脚本：靠"顺序 + 前瞻"做到。
 *   1) multi-head：把"后面还有思考块"的块折成 Kemini 形态（即除最后一块外的全部）
 *   2) multi-tail：把"前面已经有 Kemini 折叠块"的最后一块也折成 Kemini 形态
 *   3) single    ：剩下没被折的（也就是从头到尾只有一块）折成 Izumi 形态
 *   4) konatan   ：Izumi 分支的标签，保持 Izumi 原行为，折成 Izumi 形态
 *
 * 三条前瞻/前缀条件保证了"块数"决定形态，而 ST 按数组顺序依次套用正则。
 *
 * 注意：两个模板都只改折叠条上的显示文案，来源提示词与角色名一律不动。
 */
import fs from 'node:fs';
import path from 'node:path';
import { needAll, isSynthetic } from './lib/fixtures.mjs';

/* 夹具守卫：折叠链要两种思维链形态的对照样本（见 samples/README.md）。 */
needAll(['Kemini_Dramatron_v3.1.json', 'Izumi_0914.json'], '折叠链生成（两种思维链形态的对照样本）');

const ROOT = process.cwd();
const P = (...a) => path.join(ROOT, ...a);
const OUT = P('preset');
fs.mkdirSync(OUT, { recursive: true });

const RENAME = JSON.parse(fs.readFileSync(P('spec', 'rename.json'), 'utf8'));

/** 折叠条上的统一文案 */
const FOLD_TEXT = '芳乃祈福中';
/** 各来源里出现过的折叠文案，逐一换成 FOLD_TEXT（只动显示文案，不动角色名） */
const FOLD_LABELS = [
  '小此在思考', '小此思考中', '此方在思考', '思考了一会', '思考了一会儿',
  '正在思考', '思考中…', '思考中...', '思考中', '思考过程', '思维链折叠',
  'Reasoning', 'Thinking', 'Thoughts',
];

/** 剥掉 CDN 字体依赖 */
const CDN_RULES = [
  [/@import\s+url\(['"]?https:\/\/fonts\.googleapis\.com[^)]*\)\s*;?/g, ''],
  [/<link[^>]*fonts\.(googleapis|gstatic)\.com[^>]*>\s*/g, ''],
  [/<link[^>]*rel=["']preconnect["'][^>]*>\s*/g, ''],
];
const LOCAL_FONT = `-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif`;

/** 只在会显示给用户的位置替换折叠文案：<title> 和 <summary> */
function overrideFoldText(html) {
  let hits = 0;
  const swap = (seg) => {
    let out = seg;
    for (const label of FOLD_LABELS) {
      const parts = out.split(label);
      if (parts.length > 1) { hits += parts.length - 1; out = parts.join(FOLD_TEXT); }
    }
    return out;
  };
  let out = html.replace(/<title>([\s\S]*?)<\/title>/gi, (m, inner) => `<title>${swap(inner)}</title>`);
  out = out.replace(/<summary\b[^>]*>([\s\S]*?)<\/summary>/gi, (m, inner) => m.replace(inner, swap(inner)));
  return { html: out, hits };
}

function prepare(rep) {
  const before = String(rep ?? '');
  const fold = overrideFoldText(before);
  let after = fold.html;
  let cdn = 0;
  for (const [re, to] of CDN_RULES) {
    cdn += (after.match(re) || []).length;
    after = after.replace(re, to);
  }
  after = after.replace(/font-family:\s*['"]M PLUS Rounded 1c['"][^;}]*/g, `font-family: ${LOCAL_FONT}`);
  return { before, after, foldHits: fold.hits, cdn };
}

/* ── 取两个来源模板 ───────────────────────────────────────────────── */
const K = JSON.parse(fs.readFileSync(P('Kemini_Dramatron_v3.1.json'), 'utf8'));
const I = JSON.parse(fs.readFileSync(P('Izumi_0914.json'), 'utf8'));
const kmSrc = K.extensions.regex_scripts.find((r) => r.scriptName === '思维链折叠');
const izSrc = I.extensions.regex_scripts.find((r) => r.scriptName === '1美化最近2层思维链（流式）');
if (!kmSrc || !izSrc) { console.error('找不到源模板'); process.exit(1); }

const km = prepare(kmSrc.replaceString);
const iz = prepare(izSrc.replaceString);

/* Kemini 模板的 marker 类名改成我们自己的，避免和别的预设撞，
   也让 multi-tail 的前缀条件有个稳定锚点。 */
const KM_CLASS = 'fano_thinking';
const kmHtml = km.after.split('st_custom_reasoning').join(KM_CLASS);
/** multi-tail 要把 Kemini 模板的 $1 改成 $2（$1 留给前缀） */
const kmHtmlShifted = kmHtml.split('$1').join('$2');

const base = {
  disabled: false,
  runOnEdit: true,
  trimStrings: [],
  placement: [2],
  substituteRegex: 0,
  markdownOnly: true,
  promptOnly: false,
};

const chain = [
  {
    ...base,
    id: 'fano-think-multi-head',
    scriptName: '芳乃思维链 · 多块（Kemini 形态）',
    findRegex: '/<(?:think|thinking)>([\\s\\S]*?)<\\/(?:think|thinking)>(?=[\\s\\S]*?<(?:think|thinking)>)/gi',
    replaceString: kmHtml,
  },
  {
    ...base,
    id: 'fano-think-multi-tail',
    scriptName: '芳乃思维链 · 多块的末块（Kemini 形态）',
    findRegex: `/(<details class="${KM_CLASS}"[\\s\\S]*?<\\/details>[\\s\\S]*?)<(?:think|thinking)>([\\s\\S]*?)<\\/(?:think|thinking)>/gi`,
    replaceString: '$1' + kmHtmlShifted,
  },
  {
    ...base,
    id: 'fano-think-single',
    scriptName: '芳乃思维链 · 单块（Izumi 形态）',
    findRegex: '/<(?:think|thinking)>([\\s\\S]*?)<\\/(?:think|thinking)>/gi',
    replaceString: iz.after,
  },
  {
    ...base,
    id: 'fano-think-konatan',
    scriptName: '芳乃思维链 · Izumi 标签（Izumi 形态）',
    findRegex: izSrc.findRegex,
    replaceString: iz.after,
  },
];

fs.writeFileSync(P('preset', 'fano-thinking-chain.json'), JSON.stringify(chain, null, 2), 'utf8');

/* 旧的单条文件清掉，避免误用 */
for (const f of ['fano-thinking-fold-kemini.json', 'fano-thinking-fold-izumi.json']) {
  const p = P('preset', f);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

const label = (rep) => [...String(rep).matchAll(/<summary\b[^>]*>([\s\S]*?)<\/summary>/gi)]
  .map((m) => m[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim());

console.log('统一折叠链（ST 按数组顺序依次套用）：\n');
for (const [i, r] of chain.entries()) {
  console.log(`[${i + 1}] ${r.scriptName}`);
  console.log(`    findRegex: ${r.findRegex}`);
  console.log(`    模板 ${r.replaceString.length} 字　可见文案: ${JSON.stringify(label(r.replaceString))}`);
  console.log(`    含「${FOLD_TEXT}」: ${r.replaceString.includes(FOLD_TEXT)}\n`);
}
console.log(`Kemini 模板：折叠文案改写 ${km.foldHits} 处，剥 CDN ${km.cdn} 处，类名 → ${KM_CLASS}`);
console.log(`Izumi  模板：折叠文案改写 ${iz.foldHits} 处，剥 CDN ${iz.cdn} 处`);
console.log(`角色名一律保留：泉此方×${iz.after.split('泉此方').length - 1 + km.after.split('泉此方').length - 1}`
  + ` 小此×${iz.after.split('小此').length - 1 + km.after.split('小此').length - 1}`
  + ` Konata×${iz.after.split('Konata').length - 1 + km.after.split('Konata').length - 1}`);
console.log('\n已写出 preset/fano-thinking-chain.json');

/* preset/regex-manifest.json 是**进库的规格**（不是产物）：它记的是这条折叠链的
   "模式"——1 块走单块形态、≥2 块走多块形态。这份规格是当年拿**真预设**推出来的，
   所以**只有真夹具才许覆盖它**：喂合成夹具时推出来的"模式"是拿占位数据反推的，
   写进去等于用一个假的规格盖掉真的，而且看起来一切正常（与 fixtures.mjs 里
   needReal() 的理由完全一样）。缺真夹具就跳过，并说清为什么。 */
const REAL_FIXTURES = !isSynthetic('Izumi_0914.json') && !isSynthetic('Kemini_Dramatron_v3.1.json');
if (REAL_FIXTURES) {
  fs.writeFileSync(P('preset', 'regex-manifest.json'), JSON.stringify({
    $comment: '统一思维链折叠链。按数组顺序套用：先处理多块（Kemini 形态），剩下的单块走 Izumi 形态。',
    displayText: FOLD_TEXT,
    rule: '1 块 → Izumi 形态；≥2 块 → Kemini 形态',
    items: chain.map((r) => ({ id: r.id, name: r.scriptName, findRegex: r.findRegex })),
  }, null, 2), 'utf8');
  console.log('已写出 preset/regex-manifest.json（用的是真夹具）');
} else {
  console.log('跳过 preset/regex-manifest.json：现在这份是**合成夹具**，它的"模式"是占位数据反推出来的，');
  console.log('  不能拿去覆盖进库的规格（真夹具优先；把真预设放成同名再跑这一句就会重写）。');
}
