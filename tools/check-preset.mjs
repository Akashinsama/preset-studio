#!/usr/bin/env node
/**
 * 成品预设独立校验
 *
 *   node tools/check-preset.mjs
 *
 * 不从 build-preset.mjs 借任何中间结果：直接读成品 + 直接读三份源文件 + 直接读 spec，
 * 重新推导一遍再比对。重点验证用户的硬约束「来源提示词一字未改」。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { needAll } from './lib/fixtures.mjs';

/* 夹具守卫：校验对象是**成品预设**，它由三份源预设组装而来；这份仓库不发预设正文。 */
needAll([path.join('preset', '芳乃预设.json')], '成品预设独立校验（108 项）',
  '先 node tools/build-preset.mjs 生成成品，或直接把它当夹具放进 preset/');

const ROOT = process.cwd();
const P = (...a) => path.join(ROOT, ...a);

let pass = 0;
const fails = [];
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fails.push(name + (detail ? '　→ ' + detail : '')); console.log('  ✗ ' + name + (detail ? '　→ ' + detail : '')); }
};
const sha = (s) => crypto.createHash('sha1')
  .update(typeof s === 'string' ? s : JSON.stringify(s ?? null), 'utf8').digest('hex');

/* ── 找成品 ───────────────────────────────────────────────────────── */
const files = fs.readdirSync(P('preset')).filter((f) => f.startsWith('芳乃预设') && f.endsWith('.json')).sort();
if (!files.length) { console.error('preset/ 下没有成品，先跑 node tools/build-preset.mjs'); process.exit(2); }
if (files.length > 1) {
  console.error(`⚠ preset/ 下有 ${files.length} 份成品，可能拿错：${files.join('、')}。只应存在 芳乃预设.json`);
}
/* 旧的日期版（.json 或 .zip）是导入事故的来源：它们里面嵌的是旧面板
   （20260920 那份带的是 0.1.0，正是手机上不显示的那版）。这里直接当成失败报出来。 */
const stale = fs.readdirSync(P('preset')).filter((f) => /芳乃预设.*\d{8}/.test(f));
if (stale.length) {
  console.error(`⚠ preset/ 下留着 ${stale.length} 份旧日期版：${stale.join('、')}`);
  console.error('  它们内嵌的是旧面板，导入错了会以为修好的 bug 又回来了。请删掉。');
}

const outFile = files[files.length - 1];
const preset = JSON.parse(fs.readFileSync(P('preset', outFile), 'utf8'));
console.log(`\n校验对象：preset/${outFile}　${(fs.statSync(P('preset', outFile)).size / 1024 / 1024).toFixed(2)} MB\n`);

/* ── 读源与规格 ───────────────────────────────────────────────────── */
/* 三份**第三方源预设**：成品里"别人的原文"就是从这里抄过来的，所以要用它们做跨文件逐字核对。
   发布包里**故意不带**这些源预设（发布包的示例素材只有芳乃预设这一份），
   所以那一段核对会整段跳过——并且**明确打印跳过了什么**，不能让人以为"全绿 = 什么都查过了"。 */
const SRC_FILES = {
  Izumi: 'Izumi_0914.json',
  Kemini: 'Kemini_Dramatron_v3.1.json',
  梦鲸: '梦鲸思客V4-0915.json',
};
const src = {};
const missingSrc = [];
for (const [key, file] of Object.entries(SRC_FILES)) {
  if (!fs.existsSync(P(file))) { missingSrc.push(file); continue; }
  const json = JSON.parse(fs.readFileSync(P(file), 'utf8'));
  const byName = new Map();
  for (const p of json.prompts ?? []) if (!byName.has(p.name ?? '')) byName.set(p.name ?? '', p);
  src[key] = { json, byName };
}
const HAS_SRC = Object.keys(src).length === Object.keys(SRC_FILES).length;
/** 跨源核对：没有源文件时这些断言不许算"通过"（那会变成假绿），而要记一条"跳过" */
let skipped = 0;
const okSrc = (name, cond, detail) => {
  if (!HAS_SRC) { skipped++; process.stdout.write(`  ○ 跳过  ${name}（发布包不带第三方源预设）\n`); return; }
  ok(name, cond, detail);
};
const groupsSpec = JSON.parse(fs.readFileSync(P('spec', 'groups.json'), 'utf8'));
/* 本预设自己新增的条目：芳乃主体层 + MVU 骨架 */
const OWN_LAYERS = ['fano-layer.json', 'mvu-layer.json'].map((file) => ({
  file,
  data: JSON.parse(fs.readFileSync(P('spec', file), 'utf8')),
}));
const FANO_NAMES = OWN_LAYERS[0].data.entries.map((e) => e.name);
const MVU_NAMES = OWN_LAYERS[1].data.entries.map((e) => e.name);
const ALL_OWN = [...FANO_NAMES, ...MVU_NAMES];

const prompts = preset.prompts ?? [];
const order = preset.prompt_order?.[0]?.order ?? [];
const byName = new Map();
const dupNames = [];
for (const p of prompts) {
  const n = p.name ?? '';
  if (byName.has(n)) dupNames.push(n);
  else byName.set(n, p);
}
const enabledOf = new Map(order.map((o) => [o.identifier, !!o.enabled]));

/* ── 1. 结构性 ────────────────────────────────────────────────────── */
console.log('[1] 结构');
ok('prompts 是数组且非空', Array.isArray(prompts) && prompts.length > 100, `${prompts.length} 条`);
ok('prompt_order 有且只有一个', (preset.prompt_order ?? []).length === 1);
ok('prompt_order 覆盖全部条目', order.length === prompts.length, `${order.length} / ${prompts.length}`);
ok('每条都有 identifier；非标记条目都有 content 字符串', prompts.every((p) =>
  typeof p.identifier === 'string' && (p.marker === true ? true : typeof p.content === 'string')),
  prompts.filter((p) => typeof p.identifier !== 'string' || (p.marker !== true && typeof p.content !== 'string'))
    .map((p) => p.name).slice(0, 5).join('、'));
ok('条目自带的 enabled 与 prompt_order 一致', prompts.every((p) => p.enabled === enabledOf.get(p.identifier)),
  prompts.filter((p) => p.enabled !== enabledOf.get(p.identifier)).map((p) => p.name).slice(0, 5).join('、'));
ok('没有重名条目', dupNames.length === 0, dupNames.slice(0, 5).join('、'));
ok('提示词条目 id 唯一', new Set(prompts.map((p) => p.identifier)).size === prompts.length);
ok('排序里引用的 id 都存在', order.every((o) => prompts.some((p) => p.identifier === o.identifier)));
ok('preset/ 下没有旧日期版（它们内嵌旧面板，导错会以为 bug 回来了）',
  fs.readdirSync(P('preset')).filter((f) => /芳乃预设.*\d{8}/.test(f)).length === 0,
  fs.readdirSync(P('preset')).filter((f) => /芳乃预设.*\d{8}/.test(f)).join('、'));

/* 同名 zip 必须是**这一份** json 打出来的：留着旧 zip 等于留一个"导进去发现 bug 又回来了"的陷阱。
   用我们自己那个零依赖 zip 读回来比对（只读其中的文本内容，不校验压缩细节）。 */
{
  const zipPath = P('preset', '芳乃预设.zip');
  if (fs.existsSync(zipPath)) {
    const buf = fs.readFileSync(zipPath);
    const inner = inflateFirstEntry(buf);
    const same = inner !== null && inner.equals(Buffer.from(JSON.stringify(preset), 'utf8'));
    ok('preset/芳乃预设.zip 与 preset/芳乃预设.json 同源（不是旧版）', same,
      inner === null ? '解不开这个 zip' : `zip 里 ${inner.length} 字节 / json ${Buffer.byteLength(JSON.stringify(preset), 'utf8')} 字节`);
  }
}

/** 从 zip 里取出第一个条目（只处理我们自己写出来的 store / deflate 两种） */
function inflateFirstEntry(buf) {
  try {
    if (buf.readUInt32LE(0) !== 0x04034b50) return null;
    const method = buf.readUInt16LE(8);
    const compSize = buf.readUInt32LE(18);
    const nameLen = buf.readUInt16LE(26);
    const extraLen = buf.readUInt16LE(28);
    const start = 30 + nameLen + extraLen;
    const body = buf.subarray(start, start + compSize);
    return method === 0 ? Buffer.from(body) : zlib.inflateRawSync(body);
  } catch { return null; }
}

/* ── 2. 来源提示词一字未改 ───────────────────────────────────────── */
console.log('\n[2] 来源提示词一字未改（硬约束）');
const originOf = (name) => {
  for (const key of Object.keys(SRC_FILES)) {
    if (src[key]?.byName.has(name)) return { key, p: src[key].byName.get(name) };
  }
  return null;
};
let tampered = 0;
let matched = 0;
const examples = [];
for (const p of prompts) {
  const n = p.name ?? '';
  if (ALL_OWN.includes(n)) continue;
  const o = originOf(n);
  if (!o) { tampered++; examples.push(`${n}（成品里有，但来源里根本没有）`); continue; }
  const bad = ['content', 'name', 'role', 'system_prompt']
    .filter((f) => sha(p[f]) !== sha(o.p[f]))
    .map((f) => `${n}.${f}`);
  if (bad.length) { tampered++; examples.push(...bad); } else matched++;
}
okSrc('每条来源条目的 content/name/role/system_prompt 与原文全等', tampered === 0,
  tampered ? `${tampered} 处不一致：${examples.slice(0, 5).join('；')}` : `核对 ${matched} 条`);

/* 角色名必须原样保留 */
const allText = prompts.map((p) => `${p.name}\n${p.content}`).join('\n');
const counts = {
  泉此方: allText.split('泉此方').length - 1,
  小此: allText.split('小此').length - 1,
  Konata: allText.split('Konata').length - 1,
};
const srcCounts = { 泉此方: 0, 小此: 0, Konata: 0 };
for (const key of Object.keys(SRC_FILES)) {
  if (!src[key]) continue;
  const t = (src[key].json.prompts ?? []).map((p) => `${p.name}\n${p.content}`).join('\n');
  for (const k of Object.keys(srcCounts)) srcCounts[k] += t.split(k).length - 1;
}
okSrc('「泉此方」出现次数与来源合计一致', counts.泉此方 === srcCounts.泉此方, `成品 ${counts.泉此方} / 来源 ${srcCounts.泉此方}`);
okSrc('「小此」出现次数与来源合计一致', counts.小此 === srcCounts.小此, `成品 ${counts.小此} / 来源 ${srcCounts.小此}`);
okSrc('「Konata」出现次数与来源合计一致', counts.Konata === srcCounts.Konata, `成品 ${counts.Konata} / 来源 ${srcCounts.Konata}`);

/* ── 3. 新增条目只有芳乃主体层 ──────────────────────────────────── */
console.log('\n[3] 新增条目范围');
const sourceNameSet = new Set();
for (const key of Object.keys(SRC_FILES)) for (const p of (src[key]?.json.prompts ?? [])) sourceNameSet.add(p.name ?? '');
const added = HAS_SRC
  ? prompts.map((p) => p.name ?? '').filter((n) => !sourceNameSet.has(n))
  : [...ALL_OWN];
const OWN_ALL = ALL_OWN;
okSrc('新增条目恰好是「芳乃主体层 + MVU 骨架」（没有多塞别的东西）',
  added.length === OWN_ALL.length && added.every((n) => OWN_ALL.includes(n)),
  `新增 ${added.length} 条：${added.join('、')}`);
ok('芳乃条目都带 🌸 前缀', FANO_NAMES.every((n) => n.startsWith('🌸')));
ok('MVU 骨架条目都带 🔧 前缀', MVU_NAMES.every((n) => n.startsWith('🔧')));
ok('自有条目默认全部关闭', OWN_ALL.every((n) => enabledOf.get(byName.get(n).identifier) === false));

/* 旧的变量式 MVU 条目必须已经不在了（否则会形成第二套竞争机制） */
const OLD_MVU = ['✅MVU Zod兼容', '✅MVU兼容（用再开）'];
const oldStillThere = OLD_MVU.filter((n) => byName.has(n));
ok('旧的变量式 MVU 条目已被移除', oldStillThere.length === 0, oldStillThere.join('、'));
const mvuVar = prompts.filter((p) => (p.content ?? '').includes('{{setvar::mvu::') && !(p.name ?? '').includes('初始化变量'));
ok('没有任何条目再往 mvu 变量里塞骨架（新方案不用变量链路）', mvuVar.length === 0,
  mvuVar.map((p) => p.name).join('、'));

/* ── 4. 内置槽位 ─────────────────────────────────────────────────── */
console.log('\n[4] 内置槽位唯一性与锚点');
const BUILDIN = ['main', 'nsfw', 'jailbreak', 'chatHistory', 'dialogueExamples', 'charDescription',
  'charPersonality', 'worldInfoBefore', 'worldInfoAfter', 'personaDescription', 'scenario',
  'enhanceDefinitions', 'agentSystemPrompt', 'agentTask', 'agentResults'];
for (const id of BUILDIN) {
  const owners = prompts.filter((p) => p.identifier === id);
  ok(`槽位 ${id} 唯一`, owners.length <= 1, owners.map((p) => p.name).join(' / '));
}
const expectOwner = {
  main: '💠CLEAR', jailbreak: '💠continue', nsfw: '信息结束',
  chatHistory: 'Chat History', dialogueExamples: 'Chat Examples',
  charDescription: '💠Char Description', charPersonality: '💠Char Personality',
  worldInfoBefore: '💠↑Char', worldInfoAfter: '💠↓Char',
  personaDescription: '💠Persona Description', scenario: '💠Scenario',
  enhanceDefinitions: '🤔同人增强-二选一',
};
for (const [id, name] of Object.entries(expectOwner)) {
  const owner = prompts.find((p) => p.identifier === id);
  ok(`槽位 ${id} 的主人是「${name}」`, owner && owner.name === name, owner ? owner.name : '(无人)');
}
/* 锚点必须开启，否则酒馆不发聊天记录 / 角色卡 */
for (const id of ['chatHistory', 'dialogueExamples', 'charDescription', 'charPersonality', 'worldInfoBefore', 'worldInfoAfter', 'personaDescription', 'scenario', 'main']) {
  const owner = prompts.find((p) => p.identifier === id);
  ok(`锚点 ${id} 初始开启`, owner && enabledOf.get(owner.identifier) === true, owner ? `${owner.name} = ${enabledOf.get(owner.identifier)}` : '(无人)');
}
/* 降级的旧主 */
ok('Izumi 的 💾主提示 已降级（不再是 main）',
  byName.get('💾主提示') && byName.get('💾主提示').identifier !== 'main',
  byName.get('💾主提示') ? byName.get('💾主提示').identifier.slice(0, 8) : '缺失');
ok('降级条目默认关闭', enabledOf.get(byName.get('💾主提示')?.identifier) === false);
ok('Izumi 的 短对话模式 已降级（不再是 jailbreak）',
  byName.get('短对话模式') && byName.get('短对话模式').identifier !== 'jailbreak');

/* ── 5. 面板兼容性：groups.json 里每个名字都要能在成品里按名找到 ── */
console.log('\n[5] 面板兼容性（面板按名字匹配条目）');
const want = new Set();
for (const g of groupsSpec.groups) {
  if (g.id === 'jailbreak') {
    for (const o of g.options) {
      o.members.forEach((m) => want.add(m));
      (o.tunables ?? []).forEach((t) => t.members.forEach((m) => want.add(m)));
    }
  } else {
    (g.members ?? []).forEach((m) => want.add(m));
  }
}
const missingInPreset = [...want].filter((n) => !byName.has(n));
ok(`groups.json 声明的 ${want.size} 个名字都能在成品里找到`, missingInPreset.length === 0,
  missingInPreset.slice(0, 8).join('、'));
const ghostSources = [...want].filter((n) => !sourceNameSet.has(n) && !ALL_OWN.includes(n));
/* 没有源预设时这个判据不成立（sourceNameSet 是空的，什么都会算成"幽灵"）→ 跳过而不是报错 */
if (HAS_SRC) ok('声明的名字都来自来源或芳乃层（无幽灵）', ghostSources.length === 0, ghostSources.join('、'));
else okSrc('声明的名字都来自来源或芳乃层（无幽灵）', false);

/* ── 6. 骨架与档位的初始状态 ────────────────────────────────────── */
console.log('\n[6] 破甲初始状态');
const JB = groupsSpec.groups.find((g) => g.id === 'jailbreak');
for (const o of JB.options) {
  const on = o.members.filter((m) => enabledOf.get(byName.get(m)?.identifier));
  const shouldOn = o.id === 'gemini';
  ok(`骨架「${o.label}」初始${shouldOn ? '开启' : '关闭'}（${on.length}/${o.members.length} 条开）`,
    shouldOn ? on.length === o.members.length : on.length === 0, on.slice(0, 4).join('、'));
}
const tunOn = [];
for (const o of JB.options) for (const t of o.tunables ?? []) {
  const on = t.members.filter((m) => enabledOf.get(byName.get(m)?.identifier));
  if (on.length) tunOn.push(`${t.label}: ${on.join('、')}`);
}
ok('骨架档位默认全关', tunOn.length === 0, tunOn.join(' | '));

/* 思考方式：标签互斥，初始只能开一个 */
const tagDefs = groupsSpec.thinkingTags ?? [];
const tagMembers = tagDefs.flatMap((t) => t.members);
const thinkOn = tagMembers.filter((n) => byName.has(n) && enabledOf.get(byName.get(n).identifier) === true);
ok('初始只开一个思考方式', thinkOn.length === 1, thinkOn.join('、'));
ok('初始开的那个是 ICOT', thinkOn.length === 1 && /ICOT/.test(thinkOn[0]), thinkOn.join('、'));
const izumiTag = tagDefs.find((t) => t.id === 'izumi');
const izumiThinkOn = (izumiTag?.members ?? []).filter((n) => byName.has(n) && enabledOf.get(byName.get(n).identifier) === true);
ok('初始没有任何 Izumi 标签的思考条目开着（这正是混排的根源）', izumiThinkOn.length === 0, izumiThinkOn.join('、'));

/* 摘要模块默认必须关闭：它要配 4 条正则才能正常工作，那套配套没搬，
   开着只会把 <current_event> 里的事件文本漏进聊天（用户实测到的「当前主线任务 MQ.…」）。 */
const summaryGroup = groupsSpec.groups.find((g) => g.id === 'summary');
const summaryOn = (summaryGroup?.members ?? [])
  .filter((n) => byName.has(n) && enabledOf.get(byName.get(n).identifier) === true);
ok('摘要模块默认全部关闭（否则事件文本会漏进聊天）', summaryOn.length === 0, summaryOn.join('、'));
const summaryGroupNote = (summaryGroup?.members ?? []).length;
ok('摘要模块有 4 个可选档', summaryGroupNote === 4, String(summaryGroupNote));
ok('雪融雪降默认关闭（等用户填自己的文本）',
  enabledOf.get(byName.get('💠雪融雪降！（build渠道等过不去外审开）').identifier) === false);

/* ── 6b. 注入锚点：绝不能属于任何破甲分支 ──────────────────────── */
console.log('\n[6b] 注入锚点');
const anchors = groupsSpec.anchors ?? [];
ok('规格里有锚点清单（≥12 条）', anchors.length >= 12, `${anchors.length} 条`);
const anchorGroup = groupsSpec.groups.find((g) => g.id === 'anchors');
ok('锚点是个 fixed 模块（面板不给开关）', anchorGroup && anchorGroup.mode === 'fixed', anchorGroup?.mode);

const anchorInBundle = [];
for (const o of JB.options) {
  for (const m of o.members) if (anchors.includes(m)) anchorInBundle.push(`${o.label}/${m}`);
  for (const t of o.tunables ?? []) for (const m of t.members) if (anchors.includes(m)) anchorInBundle.push(`${o.label}/${t.label}/${m}`);
}
ok('没有锚点被塞进破甲骨架或档位', anchorInBundle.length === 0, anchorInBundle.join('、'));

const anchorsMissing = anchors.filter((n) => !byName.has(n));
ok('锚点条目都在成品里', anchorsMissing.length === 0, anchorsMissing.join('、'));
const anchorsOff = anchors.filter((n) => byName.has(n) && enabledOf.get(byName.get(n).identifier) !== true);
ok('全部锚点初始开启', anchorsOff.length === 0, anchorsOff.join('、'));

/* 关键槽位必须开：少了它们，切模型之后就丢世界书/角色卡 */
const CRITICAL_SLOTS = ['main', 'jailbreak', 'chatHistory', 'dialogueExamples', 'charDescription',
  'charPersonality', 'worldInfoBefore', 'worldInfoAfter', 'personaDescription', 'scenario'];
const critOff = CRITICAL_SLOTS.filter((id) => {
  const p = prompts.find((x) => x.identifier === id);
  return !p || enabledOf.get(p.identifier) !== true;
});
ok('10 个关键注入槽位初始全部开启', critOff.length === 0, critOff.join('、'));

/* ── 7. 扩展：面板 + 正则 ───────────────────────────────────────── */
console.log('\n[7] 扩展（面板与正则）');
const ext = preset.extensions ?? {};
const scripts = ext.tavern_helper?.scripts ?? [];
ok('内嵌了 1 个酒馆助手脚本', scripts.length === 1, `${scripts.length} 个`);
const panel = scripts[0];
ok('脚本是芳乃面板', panel && /芳乃/.test(panel.name ?? ''), panel?.name);
ok('面板脚本已启用', panel?.enabled === true);
ok('面板脚本里注入了 groups', (panel?.content ?? '').includes('"jailbreak"'));
ok('面板脚本里含芳乃配色 token', (panel?.content ?? '').includes('--fp-accent'));
const regexes = ext.regex_scripts ?? [];
/* 折叠链那 4 条的位置**不能写死**了：链前面还排着 7 条从 v2.8.1 移植来的正则
   （正文美化 3 + 防截断过滤 2 + 选项栏 2）。所以这里按**名字**把链挑出来再逐条判，
   其余那 7 条不适用"折叠文案 / 只改显示"这类断言（选项栏过滤那条本来就是 promptOnly）。 */
const chain = regexes.filter((r) => /^芳乃思维链 · /.test(String(r.scriptName)));
ok('内嵌了统一思维链折叠链（4 条）', chain.length === 4, `${chain.length} 条（正则共 ${regexes.length} 条）`);
ok('折叠链顺序正确（前两条 Kemini 形态，后两条 Izumi 形态）',
  chain.slice(0, 2).every((r) => String(r.replaceString).includes('fano_thinking'))
  && chain.slice(2).every((r) => String(r.replaceString).includes('konata-thinking-details')));
ok('移植来的那 7 条也在（正文美化 / 防截断过滤 / 选项栏）', regexes.length === 11, `${regexes.length} 条`);
for (const r of chain) {
  const sum = (String(r.replaceString).match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i) || [])[1] ?? '';
  const text = sum.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  ok(`「${r.scriptName}」折叠文案是 芳乃祈福中`, text.includes('芳乃祈福中'), text || '(无 summary)');
  ok(`「${r.scriptName}」不含 CDN 外链`, !/fonts\.googleapis|fonts\.gstatic/.test(String(r.replaceString)));
  ok(`「${r.scriptName}」只影响显示`, r.markdownOnly === true && r.promptOnly === false);
  ok(`「${r.scriptName}」placement=[2]`, JSON.stringify(r.placement) === '[2]');
}

/* ── 7b. 思维链标签互斥 ─────────────────────────────────────────── */
console.log('\n[7b] 思维链标签互斥');
const tags = groupsSpec.thinkingTags ?? [];
ok('规格里有思维链标签互斥组', tags.length === 2, `${tags.length} 组`);
for (const t of tags) {
  const missing = t.members.filter((m) => !byName.has(m));
  ok(`标签组「${t.id}」的 ${t.members.length} 条都在成品里`, missing.length === 0, missing.join('、'));
}
const flatTags = tags.flatMap((t) => t.members);
ok('标签组之间没有重复成员', new Set(flatTags).size === flatTags.length);
const cotGroup = groupsSpec.groups.find((g) => g.id === 'cot');
ok('思维链下拉框收录了 Kemini 的 ICOT/COT',
  cotGroup.members.includes('📽️ICOT（三段）') && cotGroup.members.includes('📽️COT（格式友好型）'),
  cotGroup.members.slice(0, 4).join('、'));
ok('ICOT/COT 不再是破甲骨架成员（否则会随骨架被强制开启）',
  !JB.options.some((o) => o.members.some((m) => tags.find((t) => t.id === 'kemini').members.includes(m))));
ok('面板脚本里注入了思维链标签互斥组', (panel?.content ?? '').includes('fano-think') || (panel?.content ?? '').includes('"kemini"'));

/* ── 8. 汇总 ────────────────────────────────────────────────────── */
console.log('\n[8] 概览');
const onList = prompts.filter((p) => enabledOf.get(p.identifier));
console.log(`  条目 ${prompts.length} 条（来源 ${prompts.length - ALL_OWN.length} + 自有 ${ALL_OWN.length}）`);
console.log(`  初始开启 ${onList.length} 条，启用正文 ${onList.reduce((a, p) => a + (p.content ?? '').length, 0)} 字`);
console.log(`  内嵌脚本 ${(panel?.content ?? '').length} 字，正则 ${regexes.length} 条`);
console.log(`  文件 ${(fs.statSync(P('preset', outFile)).size / 1024 / 1024).toFixed(2)} MB`);

console.log('\n────────────────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fails.length} 项`);
if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); process.exitCode = 1; }
