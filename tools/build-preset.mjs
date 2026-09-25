#!/usr/bin/env node
/**
 * 预设组装器
 *
 *   node tools/build-preset.mjs
 *
 * 把三份来源预设按 spec/SPEC.md 与 spec/groups.json 拼成一份可导入 SillyTavern 的预设。
 *
 * 铁律（用户的硬约束）：
 *   三份来源预设里的 prompt **一字不改**。本脚本只做三件事：
 *     1) 复制（content / name / role 等字段整体复制）
 *     2) 排顺序（prompt_order）
 *     3) 决定初始开关（enabled）
 *   唯一允许的结构性改动是「内置槽位去重」：同一 identifier 只能有一个主人，
 *   落败的那条换一个新 identifier 并强制关闭——名字与正文仍然原样。
 *   结尾用逐条哈希复核，任何一处内容对不上就直接失败退出。
 *
 * 芳乃只来自 spec/fano-layer.json 的新增条目。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { zip } from './lib/zip.mjs';
import { needAll } from './lib/fixtures.mjs';

/* 夹具守卫：成品预设是把三份源预设的条目按锚点重排出来的，缺一份就没法组装。 */
needAll(['Izumi_0914.json', 'Kemini_Dramatron_v3.1.json', '梦鲸思客V4-0915.json'],
  '组装成品预设（三份源预设都要）');

const ROOT = process.cwd();
const P = (...a) => path.join(ROOT, ...a);
const OUTDIR = P('preset');
fs.mkdirSync(OUTDIR, { recursive: true });

const sha = (s) => crypto.createHash('sha1')
  .update(typeof s === 'string' ? s : JSON.stringify(s ?? null), 'utf8')
  .digest('hex');
/** 由名字派生稳定 uuid：重建不会变，面板的 stableId 匹配才不会失联。 */
const detUuid = (seed) => {
  const h = crypto.createHash('sha1').update('fano::' + seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

/* ── 来源 ─────────────────────────────────────────────────────────── */
const FILES = {
  Izumi: 'Izumi_0914.json',
  Kemini: 'Kemini_Dramatron_v3.1.json',
  梦鲸: '梦鲸思客V4-0915.json',
};
/** groups.json 里 option.source 的写法 → 上面的键 */
const SOURCE_ALIAS = { Izumi: 'Izumi', Kemini: 'Kemini', 梦鲸思客V4: '梦鲸', 梦鲸: '梦鲸' };

const BUILDIN_IDS = new Set([
  'main', 'nsfw', 'jailbreak', 'chatHistory', 'dialogueExamples', 'charDescription',
  'charPersonality', 'worldInfoBefore', 'worldInfoAfter', 'personaDescription', 'scenario',
  'enhanceDefinitions', 'agentSystemPrompt', 'agentTask', 'agentResults',
]);

/** 每个内置槽位由谁当主人（来源:名字）。落败者降级为普通条目。
    表放在 spec/ 里，因为合成夹具生成器（tools/make-fixture.mjs）也要照着它造结构——
    两处各写一遍迟早漂移，到时候"成品能装、夹具装不上"会很难查。 */
const SLOT_OWNER = JSON.parse(fs.readFileSync(P('spec', 'slot-owner.json'), 'utf8'));
delete SLOT_OWNER.$comment;

/* ── 读入 ─────────────────────────────────────────────────────────── */
const src = {};
for (const [key, file] of Object.entries(FILES)) {
  const json = JSON.parse(fs.readFileSync(P(file), 'utf8'));
  const byName = new Map();
  for (const p of json.prompts ?? []) {
    const n = p.name ?? '';
    if (!byName.has(n)) byName.set(n, p);   // 同名取第一条（源里本就有重名）
  }
  const orderIdx = new Map();
  const orderEnabled = new Map();
  for (const po of json.prompt_order ?? []) {
    (po.order ?? []).forEach((o, i) => {
      orderIdx.set(o.identifier, i);
      orderEnabled.set(o.identifier, !!o.enabled);
    });
  }
  src[key] = { key, file, json, byName, orderIdx, orderEnabled };
}
const groupsSpec = JSON.parse(fs.readFileSync(P('spec', 'groups.json'), 'utf8'));
/* 本预设自己新增的条目：芳乃主体层 + MVU 骨架。都不是来源条目。 */
const OWN_LAYERS = ['fano-layer.json', 'mvu-layer.json'].map((file) => ({
  file,
  data: JSON.parse(fs.readFileSync(P('spec', file), 'utf8')),
}));
const OWN_NAMES = new Set(OWN_LAYERS.flatMap(({ data }) => data.entries.map((e) => e.name)));

/* ── 1. 收集要搬运的条目：name → 期望来源 ─────────────────────────── */
const want = new Map();          // name -> sourceKey
const conflicts = [];
const JB = groupsSpec.groups.find((g) => g.id === 'jailbreak');
for (const o of JB.options) {
  const key = SOURCE_ALIAS[o.source] || null;
  for (const n of o.members) if (key) want.set(n, key);
  for (const t of o.tunables ?? []) for (const n of t.members) if (key) want.set(n, key);
}
for (const g of groupsSpec.groups) {
  if (g.id === 'jailbreak' || g.id === 'fano') continue;
  for (const n of g.members ?? []) {
    if (OWN_NAMES.has(n)) continue;      // 自有条目由 spec/*-layer.json 提供，不是来源条目
    if (want.has(n)) {
      /* custom 是"视图"，会重复列出别的模块已经收走的条目；同一来源的重复不算冲突 */
      if (want.get(n) !== 'Izumi') conflicts.push(`${n}：${want.get(n)} vs Izumi`);
      continue;
    }
    want.set(n, 'Izumi');
  }
}
/* custom 里可能混着别的来源（例如梦鲸的自定义禁词），按"哪个源里真的有"校正 */
const corrected = [];
for (const [n, declared] of [...want]) {
  if (src[declared].byName.has(n)) continue;
  const found = Object.keys(FILES).find((k) => src[k].byName.has(n));
  if (found) { corrected.push(`${n}：声明 ${declared} → 实际取自 ${found}`); want.set(n, found); }
}

/* ── 2. 解析成实际条目对象 ────────────────────────────────────────── */
const picked = [];   // { name, source, prompt, enabled }
const unresolved = [];
for (const [n, key] of want) {
  const p = src[key].byName.get(n);
  if (!p) { unresolved.push(`${n}（声明来源 ${key}）`); continue; }
  picked.push({
    name: n,
    source: key,
    prompt: p,
    ownEnabled: src[key].orderEnabled.has(p.identifier)
      ? src[key].orderEnabled.get(p.identifier)
      : false,
    orderIdx: src[key].orderIdx.has(p.identifier) ? src[key].orderIdx.get(p.identifier) : 1e9,
    listed: src[key].orderIdx.has(p.identifier),
  });
}

/* 内置槽位占位条目：来源里靠它们撑起结构（如 Kemini 的 <DATA> 包裹顺序），必须一并带上。
   只补"结构型"的：该来源里 identifier 是内置槽、且不在已选列表里的。 */
const structural = [];
for (const key of ['Kemini']) {
  for (const p of src[key].json.prompts ?? []) {
    if (!BUILDIN_IDS.has(p.identifier)) continue;
    if (picked.some((x) => x.prompt === p)) continue;
    if (SLOT_OWNER[p.identifier] !== `${key}:${p.name ?? ''}`) continue;   // 不是主人的不补
    structural.push({
      name: p.name ?? '',
      source: key,
      prompt: p,
      ownEnabled: src[key].orderEnabled.get(p.identifier) ?? false,
      orderIdx: src[key].orderIdx.get(p.identifier) ?? 1e9,
      listed: src[key].orderIdx.has(p.identifier),
      structural: true,
    });
  }
}

/* ── 3. 内置槽位去重 ─────────────────────────────────────────────── */
const bySlot = new Map();
for (const e of [...structural, ...picked]) {
  if (!BUILDIN_IDS.has(e.prompt.identifier)) continue;
  if (!bySlot.has(e.prompt.identifier)) bySlot.set(e.prompt.identifier, []);
  bySlot.get(e.prompt.identifier).push(e);
}
const degraded = [];
const dropped = [];
const alive = [];
for (const e of [...structural, ...picked]) {
  const id = e.prompt.identifier;
  if (!BUILDIN_IDS.has(id)) { alive.push(e); continue; }
  const ownerSpec = SLOT_OWNER[id];
  const me = `${e.source}:${e.name}`;
  if (ownerSpec === me) { alive.push(e); continue; }
  const empty = !(e.prompt.content ?? '').length;
  if (empty) { dropped.push(`${e.name || '(无名)'}（${e.source} 的空占位，槽位 ${id} 已归 ${ownerSpec}）`); continue; }
  e.degraded = true;
  e.newIdentifier = detUuid('degraded::' + e.source + '::' + id + '::' + e.name);
  degraded.push(`${e.name}（${e.source}）从槽位 ${id} 降级为普通条目 ${e.newIdentifier.slice(0, 8)}…`);
  alive.push(e);
}

/* ── 4. 本预设自己新增的条目（芳乃主体层 + MVU 骨架） ─────────────── */
let ownCounter = 0;
const ownEntries = OWN_LAYERS.flatMap(({ file, data }) =>
  data.entries.map((f) => ({
    name: f.name,
    source: 'OWN',
    orderIdx: ownCounter++,
    listed: true,
    ownEnabled: !!f.enabled,
    own: f,
    layer: file,
    prompt: {
      identifier: detUuid(file + '::' + f.key),
      name: f.name,
      system_prompt: !!f.system_prompt,
      role: f.role || 'system',
      content: f.content,
      injection_position: f.injection_position ?? 0,
      injection_depth: f.injection_depth ?? 4,
    },
  })));

/* ── 5. 排序：自有条目 → Kemini → Izumi → 梦鲸 → 其余 ─────────────── */
const BLOCK = { OWN: 0, FANO: 0, Kemini: 1, Izumi: 2, 梦鲸: 3 };
const ordered = [...ownEntries, ...alive].sort((a, b) => {
  const ba = BLOCK[a.source] ?? 9;
  const bb = BLOCK[b.source] ?? 9;
  if (ba !== bb) return ba - bb;
  if (a.source !== b.source) return a.source < b.source ? -1 : 1;
  if (a.orderIdx !== b.orderIdx) return a.orderIdx - b.orderIdx;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
});

/* ── 6. 初始开关 ─────────────────────────────────────────────────── */
const geminiPool = new Set(JB.options.find((o) => o.id === 'gemini').members);
const otherJB = new Set([
  ...JB.options.filter((o) => o.id !== 'gemini').flatMap((o) => o.members),
  ...JB.options.filter((o) => o.id !== 'gemini').flatMap((o) => (o.tunables ?? []).flatMap((t) => t.members)),
]);
const kmCot = JB.options.find((o) => o.id === 'gemini').tunables.find((t) => t.id === 'km_cot');
/** 需要用户先填内容才能开的条目：默认关，免得带着别人的占位文本上线。 */
const FILL_FIRST = new Set(['💠雪融雪降！（build渠道等过不去外审开）']);
/**
 * 默认必须关闭的整组：摘要。
 *
 * 为什么：Izumi 的摘要功能是「提示词条目 + 4 条配套正则」的组合
 * （`11清理多余事件` 清掉 <current_event>、`9只保留Progress` / `10隐藏近期旧Progress` 压缩旧消息、
 * `12美化事件` 折叠展示）。我们只搬了提示词条目、没搬那套正则，
 * 于是模型照写 <current_event>，却没人清理 → 事件文本（「当前主线任务: MQ.…」）直接漏进聊天。
 * 在把配套正则搬齐之前，默认关掉最干净；用户想要摘要功能可以自己在面板里打开。
 */
const DEFAULT_OFF_GROUPS = ['summary'];
const defaultOff = new Set(
  DEFAULT_OFF_GROUPS.flatMap((id) => (groupsSpec.groups.find((g) => g.id === id)?.members) ?? []),
);
/** 注入锚点：永远开启。它们占住酒馆的内置槽位，关掉就会在切换模型后整体丢上下文。 */
const ANCHORS = new Set(groupsSpec.anchors ?? []);
const anchorMissing = [...ANCHORS].filter((n) => !ordered.some((e) => e.name === n));

/* ── 思维链标签：初始状态也只能有一套标签开着 ───────────────────────
   Kenmini 用 <thinking>（ICOT 还是三段），Izumi 用 konatan_planning~。
   源预设里这两套各自都是开的，直接用来源状态拼在一起就正好复现用户遇到的
   "一个 izumi 形态 + 好几个 kemini 形态"混排。所以这里显式指定唯一默认。 */
const THINKING_TAGS = groupsSpec.thinkingTags ?? [];
const THINKING_DEFAULT = '📽️ICOT（三段）';
const THINKING_ALL = new Set(THINKING_TAGS.flatMap((t) => t.members));

for (const e of ordered) {
  let on = e.ownEnabled;
  if (ANCHORS.has(e.name)) on = true;                              // 锚点无条件开启
  else if (e.own) on = e.ownEnabled;
  else if (THINKING_ALL.has(e.name)) on = e.name === THINKING_DEFAULT;  // 思考方式：只开一个
  else if (geminiPool.has(e.name)) on = true;                       // 默认走 Gemini 骨架
  else if (kmCot && kmCot.members.includes(e.name)) on = e.name === kmCot.default;
  else if (otherJB.has(e.name)) on = false;                        // 另外两套骨架 + 全部档位默认关
  if (FILL_FIRST.has(e.name)) on = false;                          // 必须先由用户填自己的文本
  if (defaultOff.has(e.name)) on = false;                          // 配套缺失的整组，默认关
  if (e.degraded) on = false;
  /* 结构型内置占位（chatHistory / dialogueExamples…）保留来源的开关状态：
     它们是"把角色卡与聊天记录插进提示词"的锚点，关掉就等于不发聊天记录。 */
  e.finalEnabled = on;
}

/* 兜底：万一还有别的路径把两套标签同时点亮，这里再收一次 */
const enabledByTag = THINKING_TAGS.map((t) => ({
  tag: t,
  on: t.members.filter((m) => ordered.find((e) => e.name === m)?.finalEnabled).length,
}));
const keptTag = enabledByTag.find((x) => x.on > 0);
const tagExtinguished = [];
if (keptTag) {
  for (const t of THINKING_TAGS) {
    if (t.id === keptTag.tag.id) continue;
    for (const m of t.members) {
      const e = ordered.find((x) => x.name === m);
      if (e && e.finalEnabled) { e.finalEnabled = false; tagExtinguished.push(m); }
    }
  }
}

/* ── 7. 产出 prompts / prompt_order ──────────────────────────────── */
const prompts = ordered.map((e) => {
  const base = { ...e.prompt };
  if (e.degraded) base.identifier = e.newIdentifier;
  /* 开关状态同时写进条目本身与 prompt_order，避免两处不一致
     （标记类条目如 chatHistory 本来就带 enabled 字段）。 */
  base.enabled = e.finalEnabled;
  return base;
});
const order = ordered.map((e) => ({
  identifier: e.degraded ? e.newIdentifier : e.prompt.identifier,
  enabled: e.finalEnabled,
}));

/* ── 8. 逐条哈希复核：来源内容必须一字不差 ───────────────────────── */
const tampered = [];
const missing = [];
const verified = [];
for (const e of ordered) {
  if (e.own) continue;   // 自有条目没有"来源原文"可比对
  const out = prompts[ordered.indexOf(e)];
  const orig = e.prompt;
  const checks = [
    ['content', out.content, orig.content],
    ['name', out.name, orig.name],
    ['role', out.role, orig.role],
    ['system_prompt', out.system_prompt, orig.system_prompt],
  ];
  for (const [field, a, b] of checks) {
    /* marker 类条目（chatHistory 等）本来就没有 content 字段，两边都是 undefined 即算一致 */
    if (a === undefined && b === undefined) continue;
    if (sha(a) !== sha(b)) tampered.push(`${e.name || '(无名)'}.${field}`);
  }
  if (out.identifier !== orig.identifier && !e.degraded) missing.push(e.name);
  verified.push(e.name);
}

if (tampered.length) {
  console.error('✗ 内容被改动了，禁止产出：');
  for (const t of tampered.slice(0, 20)) console.error('   ' + t);
  process.exit(1);
}

/* ── 9. extensions ──────────────────────────────────────────────── */
const thinkChain = JSON.parse(fs.readFileSync(P('preset', 'fano-thinking-chain.json'), 'utf8'));
/* 另外 7 条正则（正文美化 3 + 防截断过滤 2 + 选项栏 2）：从 v2.8.1 那支原样移植过来，
   放在 preset/fano-regex-extra.json 当数据。 */
const extraRegexes = JSON.parse(fs.readFileSync(P('preset', 'fano-regex-extra.json'), 'utf8'));
const panelCode = fs.readFileSync(P('panel', 'fano-panel.js'), 'utf8');

const base = JSON.parse(fs.readFileSync(P(FILES.Kemini), 'utf8'));
const out = { ...base };
delete out.prompts;
delete out.prompt_order;

out.prompts = prompts;
out.prompt_order = [{ character_id: 100001, order }];
out.extensions = {
  /* 正则顺序敏感，ST 按数组顺序套用：
     先是移植来的 7 条（正文美化 → 防截断过滤：先内层后外层 → 选项栏），
     再是思维链折叠链（前两条折多块 Kemini 形态、后两条折单块 Izumi 形态）。 */
  regex_scripts: [...extraRegexes, ...thinkChain],
  tavern_helper: {
    scripts: [{
      type: 'script',
      enabled: true,
      name: '芳乃 · 预设面板',
      id: 'fano-panel',
      content: panelCode,
      info: '芳乃配色悬浮窗：按子集开关预设条目、破甲按模型分流、自定义项可直接填写。',
      button: { enabled: false, buttons: [] },
      data: {},
      export_with: { data: false, button: true },
    }],
    variables: {},
  },
};
/* 结构照 Kemini：连它那份第三方插件配置（SPreset / 消息压缩）一起带上，保持忠实。
   若用户装了该插件，这几项就是 Kemini 推荐的关状态。 */
if (base.extensions && base.extensions.SPreset) out.extensions.SPreset = base.extensions.SPreset;

/* 固定文件名，不带日期。
   带日期会在 preset/ 里堆出多份成品，导入时极容易拿错旧的那份——
   而旧那份内嵌的是旧面板，于是出现"我明明改了、你却说还是不行"。
   要留版本靠副本/git，不靠文件名。 */
const outFile = '芳乃预设.json';
const outText = JSON.stringify(out);
fs.writeFileSync(P('preset', outFile), outText, 'utf8');

/* 顺手清掉早期带日期的成品，避免再被误导入。
   .zip 也要清：2026-09-20 那份 zip 里嵌的是面板 0.1.0（手机上不显示的那版），
   留着它迟早会被当成"新成品"导进去，然后以为修好的 bug 又回来了。 */
const staleFiles = fs.readdirSync(P('preset')).filter((f) => /^芳乃预设-v\d+-\d+\.(json|zip)$/.test(f));
const staleRemoved = [];
for (const f of staleFiles) {
  fs.unlinkSync(P('preset', f));
  staleRemoved.push(f);
}

/* 同名 zip 一起重打：留着旧 zip 就是留着一个"导进去发现 bug 又回来了"的陷阱。
   每次构建都重打，check-preset.mjs 会验证它跟 json 逐字节同源。 */
{
  const zipPath = P('preset', '芳乃预设.zip');
  fs.writeFileSync(zipPath, zip([{ name: outFile, data: Buffer.from(outText, 'utf8') }]));
}

/* ── 10. 报告 ───────────────────────────────────────────────────── */
const R = [];
R.push(`来源提示词：搬运 ${ordered.filter((e) => !e.own).length} 条，逐条哈希校验通过（content/name/role/system_prompt 全等）`);
R.push(`本预设新增条目：${ownEntries.length} 条（不计入来源）`);
for (const { file, data } of OWN_LAYERS) {
  R.push(`  · ${file}：${data.entries.map((e) => e.name).join('、')}`);
}
R.push(`注入锚点：${ANCHORS.size} 条强制开启${anchorMissing.length ? `　⚠ 其中 ${anchorMissing.length} 条在成品里找不到：${anchorMissing.join('、')}` : ''}`);
R.push(`思维链标签互斥：默认只开「${THINKING_DEFAULT}」`
  + `（共 ${THINKING_TAGS.length} 套标签 / ${THINKING_ALL.size} 条候选）`
  + (tagExtinguished.length ? `　兜底关掉了：${tagExtinguished.join('、')}` : ''));
if (defaultOff.size) {
  R.push(`默认关闭的整组 ${DEFAULT_OFF_GROUPS.join('、')}（共 ${defaultOff.size} 条）：`
    + `配套正则没搬齐，开着会把事件文本漏进聊天`);
}
R.push(`内置槽位主人：${Object.entries(SLOT_OWNER).map(([k, v]) => `${k}→${v.split(':')[1] || v}`).join('　')}`);
if (dropped.length) { R.push(`丢弃空占位 ${dropped.length} 条：`); dropped.forEach((d) => R.push('   · ' + d)); }
if (degraded.length) { R.push(`降级为普通条目 ${degraded.length} 条：`); degraded.forEach((d) => R.push('   · ' + d)); }
if (unresolved.length) { R.push(`⚠ 找不到来源 ${unresolved.length} 条：`); unresolved.forEach((d) => R.push('   · ' + d)); }
if (conflicts.length) { R.push(`⚠ 来源声明冲突 ${conflicts.length} 条：`); conflicts.forEach((d) => R.push('   · ' + d)); }
if (corrected.length) { R.push(`来源已自动校正 ${corrected.length} 条（声明与实际不符，按实际来源取）：`); corrected.forEach((d) => R.push('   · ' + d)); }

const onList = ordered.filter((e) => e.finalEnabled);
R.push('');
R.push(`条目合计 ${prompts.length} 条　初始开启 ${onList.length} 条　初始启用正文 ${onList.reduce((a, e) => a + (e.prompt.content ?? '').length, 0)} 字`);
R.push(`文件 ${outFile}　${(fs.statSync(P('preset', outFile)).size / 1024 / 1024).toFixed(2)} MB`);
if (staleRemoved.length) R.push(`已删除过期成品：${staleRemoved.join('、')}`);
R.push('');
R.push('各来源初始开启条数：');
for (const key of ['OWN', 'Kemini', 'Izumi', '梦鲸']) {
  const list = ordered.filter((e) => e.source === key);
  R.push(`  ${key.padEnd(7)} ${String(list.filter((e) => e.finalEnabled).length).padStart(3)} / ${String(list.length).padStart(3)}`);
}
R.push('');
R.push('前 40 条（顺序 = prompt_order）：');
ordered.slice(0, 40).forEach((e, i) => {
  R.push(`  ${String(i + 1).padStart(3)} [${e.finalEnabled ? '开' : '关'}] ${String(e.source).padEnd(7)} ${e.name || '(无名)'}`);
});

fs.writeFileSync(P('preset', 'build-report.txt'), R.join('\n') + '\n', 'utf8');
console.log(R.join('\n'));
console.log('\n已写出 preset/' + outFile + ' 与 preset/build-report.txt');
