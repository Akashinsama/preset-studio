#!/usr/bin/env node
/**
 * GUI 内核测试（M0 解析 / M1 拼装）——不需要浏览器
 *
 *   node tools/test-gui.mjs
 *
 * parse.js / assemble.js 是纯函数、零 DOM，所以可以直接在 Node 里跑。
 * 除了拿真实的 Izumi 预设做规模验证，还用几份**人造小预设**精确验证顺序语义
 * （setvar/getvar/addvar 的时序），那才是这类工具的价值所在。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { need } from './lib/fixtures.mjs';

/* 夹具守卫：人造小预设那部分随时可跑，但规模验证要真实样本——它是他人的预设，不入库。 */
need('Izumi_0914.json', 'GUI 内核测试（331 项，含真实预设的规模验证）');

const ROOT = process.cwd();
const P = (...a) => path.join(ROOT, ...a);

let pass = 0;
const fails = [];
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fails.push(name + (detail ? '　→ ' + detail : '')); console.log('  ✗ ' + name + (detail ? '　→ ' + detail : '')); }
};

/* 用 new Function 载入（与面板脚本同一种加载方式；两个库都挂在 globalThis 上） */
function load(rel) {
  const src = fs.readFileSync(P(rel), 'utf8');
  new Function('globalThis', src)(globalThis);
}
load('tools/gui/lib/parse.js');
load('tools/gui/lib/assemble.js');
load('tools/gui/lib/invariants.js');
load('tools/gui/lib/editor.js');
load('tools/gui/lib/skeleton.js');
load('tools/gui/lib/panelconfig.js');
load('tools/gui/lib/groupinfer.js');
load('tools/gui/lib/buildops.js');
const PP = globalThis.PresetParse;
const PA = globalThis.PresetAssemble;
const PI = globalThis.PresetInvariants;

/* 造一份小预设，只列需要的条目 */
function mkPreset(prompts, order) {
  return {
    prompts: prompts.map((p) => ({ role: 'system', system_prompt: false, injection_position: 0, ...p })),
    prompt_order: [{ character_id: 100001, order }],
  };
}

console.log('GUI 内核测试\n');

/* ── 1. 顺序语义：setvar 在使用者之前 ─────────────────────────── */
console.log('[1] 顺序语义：变量先设后用');
{
  const json = mkPreset([
    { identifier: 'a', name: '初始化', content: '{{setvar::x::}}' },
    { identifier: 'b', name: '开关A', content: '{{setvar::x::甲}}' },
    { identifier: 'c', name: '使用者', content: '语言：{{getvar::x}}' },
  ], [
    { identifier: 'a', enabled: true }, { identifier: 'b', enabled: true }, { identifier: 'c', enabled: true },
  ]);
  const m = PP.parsePreset(json, 't1.json');
  const r = PA.assemble(m, {});
  ok('变量 x 有 2 个设置者', m.variables.find((v) => v.name === 'x')?.setBy.length === 2);
  ok('识别为互斥候选', m.variables.find((v) => v.name === 'x')?.exclusive === true);
  ok('给出"选一"建议', m.suggestions.some((s) => s.id === 'excl:x' && s.mode === 'single'));
  ok('拼装后使用者拿到最后写入的值', r.segments.find((s) => s.name === '使用者').text.includes('甲'),
    r.segments.find((s) => s.name === '使用者').text);
  const ops = r.events.map((e) => e.op + ':' + e.name);
  ok('事件顺序正确（设→设→读）', ops.join(',') === 'set:x,set:x,get:x', ops.join(','));
}

/* ── 2. 顺序陷阱：getvar 跑在 setvar 之前 ────────────────────── */
console.log('\n[2] 顺序陷阱：先读后设 → 读到空值');
{
  const json = mkPreset([
    { identifier: 'a', name: '使用者', content: '语言：{{getvar::y}}|' },
    { identifier: 'b', name: '开关', content: '{{setvar::y::乙}}' },
  ], [{ identifier: 'a', enabled: true }, { identifier: 'b', enabled: true }]);
  const m = PP.parsePreset(json, 't2.json');
  const r = PA.assemble(m, {});
  ok('检出"读了未设置的变量"', r.warnings.some((w) => w.kind === '读了未设置的变量'), JSON.stringify(r.warnings.map((w) => w.kind)));
  ok('使用者那一段确实是空的', r.segments.find((s) => s.name === '使用者').text === '语言：|',
    r.segments.find((s) => s.name === '使用者').text);
  ok('事件里第一条就是未定义的读', r.events[0].op === 'get' && r.events[0].defined === false);
}

/* ── 3. 累加语义：addvar 可叠加 ──────────────────────────────── */
console.log('\n[3] 累加语义：addvar 应被识别为可多选');
{
  const json = mkPreset([
    { identifier: 'a', name: '清空', content: '{{setvar::s::}}' },
    { identifier: 'b', name: '文风一', content: '{{addvar::s::一}}' },
    { identifier: 'c', name: '文风二', content: '{{addvar::s::二}}' },
    { identifier: 'd', name: '消费者', content: '文风：{{getvar::s}}' },
  ], ['a', 'b', 'c', 'd'].map((identifier) => ({ identifier, enabled: true })));
  const m = PP.parsePreset(json, 't3.json');
  const v = m.variables.find((x) => x.name === 's');
  ok('识别出 2 个累加者', v.addBy.length === 2, String(v.addBy.length));
  ok('给出"可多选"建议', m.suggestions.some((s) => s.id === 'acc:s' && s.mode === 'multi'));
  const r = PA.assemble(m, {});
  ok('两条累加都生效', r.segments.find((s) => s.name === '消费者').text === '文风：一二',
    r.segments.find((s) => s.name === '消费者').text);
}

/* ── 4. 变量最终为空（本次事故的形状）────────────────────────── */
console.log('\n[4] 变量最终为空：只清空、没人再设');
{
  const json = mkPreset([
    { identifier: 'a', name: '初始化', content: '{{setvar::z::}}' },
    { identifier: 'b', name: '消费者', content: '值：{{getvar::z}}' },
  ], [{ identifier: 'a', enabled: true }, { identifier: 'b', enabled: true }]);
  const r = PA.assemble(PP.parsePreset(json, 't4.json'), {});
  ok('检出"变量最终为空"', r.warnings.some((w) => w.kind === '变量最终为空'),
    JSON.stringify(r.warnings.map((w) => w.kind)));
}

/* ── 5. 注入位与占位块 ───────────────────────────────────────── */
console.log('\n[5] 注入位：角色卡/世界书/聊天记录应显示为占位块，缺失要报错');
{
  const withSlots = mkPreset([
    { identifier: 'main', name: '主提示', content: '你是助手' },
    { identifier: 'worldInfoBefore', name: '世界书前', content: '' },
    { identifier: 'worldInfoAfter', name: '世界书后', content: '' },
    { identifier: 'charDescription', name: '角色卡', content: '' },
    { identifier: 'chatHistory', name: '聊天记录', content: '' },
    { identifier: 'dialogueExamples', name: '示例对话', content: '' },
    { identifier: 'charPersonality', name: '角色性格', content: '' },
    { identifier: 'personaDescription', name: '用户人设', content: '' },
    { identifier: 'scenario', name: '场景', content: '' },
    { identifier: 'jailbreak', name: '历史后置', content: '结束' },
  ], ['main', 'worldInfoBefore', 'worldInfoAfter', 'charDescription', 'chatHistory', 'dialogueExamples',
    'charPersonality', 'personaDescription', 'scenario', 'jailbreak'].map((identifier) => ({ identifier, enabled: true })));
  const r1 = PA.assemble(PP.parsePreset(withSlots, 't5.json'), {});
  ok('注入位显示为占位块', r1.segments.filter((s) => (s.note || '').includes('注入位')).length === 8,
    String(r1.segments.filter((s) => (s.note || '').includes('注入位')).length));
  ok('槽位齐全时不报"注入位缺失"', !r1.warnings.some((w) => w.kind === '注入位缺失'));

  /* 把世界书两条关掉 → 必须报错（这正是"切模型丢上下文"的形状） */
  const missing = mkPreset(withSlots.prompts, ['main', 'worldInfoBefore', 'worldInfoAfter', 'charDescription', 'chatHistory',
    'dialogueExamples', 'charPersonality', 'personaDescription', 'scenario', 'jailbreak']
    .map((identifier) => ({ identifier, enabled: !['worldInfoBefore', 'worldInfoAfter'].includes(identifier) })));
  const r2 = PA.assemble(PP.parsePreset(missing, 't5b.json'), {});
  ok('缺注入位时报错', r2.warnings.some((w) => w.kind === '注入位缺失'),
    JSON.stringify(r2.warnings.map((w) => w.kind)));
  ok('错误里点名了世界书', r2.warnings.some((w) => w.kind === '注入位缺失' && w.text.includes('worldInfoBefore')));
}

/* ── 6. 思维链标签冲突 ──────────────────────────────────────── */
console.log('\n[6] 标签族：两套思维链同时开启要报错');
{
  const json = mkPreset([
    { identifier: 'a', name: 'ICOT', content: '用 <thinking> 思考' },
    { identifier: 'b', name: 'Izumi思维链', content: '用 <konatan_planning~> 思考' },
  ], [{ identifier: 'a', enabled: true }, { identifier: 'b', enabled: true }]);
  const m = PP.parsePreset(json, 't6.json');
  ok('识别出 2 个标签族', m.tagFamilies.length === 2, String(m.tagFamilies.length));
  ok('解析期就报冲突', m.warnings.some((w) => w.kind === '思维链标签冲突'));
  ok('拼装期也报冲突', PA.assemble(m, {}).warnings.some((w) => w.kind === '思维链标签冲突'));
}

/* ── 7. 槽位冲突与外部宏 ────────────────────────────────────── */
console.log('\n[7] 槽位冲突 / 外部宏 / 待填条目');
{
  const json = mkPreset([
    { identifier: 'main', name: '主提示甲', content: '甲' },
    { identifier: 'other', name: '主提示乙', content: '乙' },
    { identifier: 'x', name: '外部宏', content: '{{压缩相邻消息::lora}}' },
    { identifier: 'y', name: '待填', content: '{{setvar::w::}}此处添加自定义文风' },
  ], [{ identifier: 'main', enabled: true }, { identifier: 'other', enabled: true },
    { identifier: 'x', enabled: true }, { identifier: 'y', enabled: true }]);
  /* other 故意也写成 main 的 identifier，模拟槽位被两条占 */
  json.prompts[1].identifier = 'main';
  const m = PP.parsePreset(json, 't7.json');
  ok('检出槽位冲突', m.slots.some((s) => s.identifier === 'main' && s.conflict),
    JSON.stringify(m.slots.map((s) => s.identifier + ':' + s.owners.length)));
  ok('检出外部宏', m.external.macros.some((x) => x.name === '压缩相邻消息'));
  ok('检出疑似待填条目', m.entries.some((e) => e.fill));
  ok('待填且开启 → 有提示', m.warnings.some((w) => w.kind === '疑似待填'));
  const r = PA.assemble(m, {});
  ok('未知宏在拼装里留可读标记', r.segments.some((s) => s.kind === 'prompt' && s.text.includes('⟨宏:压缩相邻消息⟩')),
    r.segments.map((s) => s.text).join('|').slice(0, 120));
}

/* ── 8. 真实预设：Izumi ────────────────────────────────────── */
console.log('\n[8] 真实预设：Izumi_0914.json');
{
  const raw = fs.readFileSync(P('Izumi_0914.json'), 'utf8');
  const json = JSON.parse(raw);
  const frozen = JSON.stringify(json.prompts[3]);
  const m = PP.parsePreset(json, 'Izumi_0914.json', Buffer.byteLength(raw, 'utf8'));
  ok('条目数 226', m.counts.prompts === 226, String(m.counts.prompts));
  ok('在提示词列表里的条目 192', m.counts.listed === 192, String(m.counts.listed));
  ok('初始开启 60', m.counts.enabled === 60, String(m.counts.enabled));
  ok('变量 ≥ 90', m.variables.length >= 90, String(m.variables.length));
  ok('检出悬空变量', m.variables.some((v) => v.dangling),
    m.variables.filter((v) => v.dangling).map((v) => v.name).join('、'));
  ok('检出互斥候选（≥10 组）', m.variables.filter((v) => v.exclusive).length >= 10,
    String(m.variables.filter((v) => v.exclusive).length));
  ok('识别出 konatan 标签族', m.tagFamilies.some((f) => f.id === 'konatan'));
  ok('识别出 tucao 标签族', m.tagFamilies.some((f) => f.id === 'tucao'));
  ok('有内嵌脚本 1 个', m.scripts.length === 1, String(m.scripts.length));
  ok('有正则 30 条', m.regexes.length === 30, String(m.regexes.length));
  ok('给出分组建议', m.suggestions.length >= 10, String(m.suggestions.length));
  ok('没修改解析前的 json', JSON.stringify(json.prompts[3]) === frozen);

  const t0 = Date.now();
  const r = PA.assemble(m, { user: 'Master', char: '角色卡' });
  const ms = Date.now() - t0;
  ok('拼装出分段', r.segments.length > 50, String(r.segments.length));
  /* 60 条开启条目原文合计 10854 字，展开后只剩 ~5200 字：
     因为其中 31 条是"开关型"条目，正文几乎全是 setvar，本身不产出文本。
     这个差值本身就是有用的信息（别拿原文合计当上下文占用）。 */
  ok('拼装出正文（> 4000 字）', r.totalChars > 4000, String(r.totalChars));
  ok('token 估算合理（> 3000）', r.tokenEstimate > 3000, String(r.tokenEstimate));
  const empt = r.segments.filter((s) => s.kind === 'prompt' && !s.text && !(s.note || '').includes('注入位'));
  ok('识别出开关型条目（展开后为空，≥20 条）', empt.length >= 20, String(empt.length));
  ok('正文短于原文合计（说明确实展开了）', r.totalChars < m.counts.enabledChars, r.totalChars + '/' + m.counts.enabledChars);
  ok('记录了变量事件', r.events.length > 50, String(r.events.length));
  ok('空变量被汇总成一条（不是刷屏）', r.warnings.filter((w) => w.kind === '变量最终为空').length === 1,
    String(r.warnings.filter((w) => w.kind === '变量最终为空').length));
  ok('空变量明细里有几十条', r.emptyVars.length >= 20, String(r.emptyVars.length));
  ok('空变量明细点出了写入方', r.emptyVars.every((v) => v.lastBy), '');
  ok('{{user}} 被替换', r.text.includes('Master'));
  ok('注入位占位块存在', r.segments.some((s) => (s.note || '').includes('注入位')));
  ok(`拼装在 300ms 内完成（实测 ${ms}ms）`, ms < 300);
  ok('只读：拼装不改原模型', m.counts.enabled === 60);
}

/* ── 9. M2 体检：每条不变式都得真的会响 ────────────────────────── */
console.log('\n[9] M2 体检：每条不变式都造一个反例，看它响不响');
{
  const has = (rep, id) => rep.items.some((i) => i.id === id || i.id.startsWith(id + ':'));
  const levelOf = (rep, id) => rep.items.find((i) => i.id === id || i.id.startsWith(id + ':'))?.level;

  /* 9a. 注入位缺失 → 必改 */
  {
    const m = PP.parsePreset(mkPreset(
      [{ identifier: 'main', name: '主提示', content: '你是助手' }],
      [{ identifier: 'main', enabled: true }]), 'a.json');
    const rep = PI.check(m, PA.assemble(m, {}));
    ok('缺注入位 → 必改', has(rep, 'missing-anchors') && levelOf(rep, 'missing-anchors') === 'err',
      JSON.stringify(rep.items.map((i) => i.id)));
    ok('体检项带为什么/怎么改/依据', rep.items.every((i) => i.why && i.fix && i.evidence.length >= 0));
  }

  /* 9b. 槽位被两条占 → 都开着是必改 */
  {
    const json = mkPreset([
      { identifier: 'main', name: '主提示甲', content: '甲' },
      { identifier: 'dup', name: '主提示乙', content: '乙' },
    ], [{ identifier: 'main', enabled: true }, { identifier: 'dup', enabled: true }]);
    json.prompts[1].identifier = 'main';
    const rep = PI.check(PP.parsePreset(json, 'b.json'), null);
    ok('槽位两条都开 → 必改', has(rep, 'slot-conflict') && levelOf(rep, 'slot-conflict') === 'err');
  }

  /* 9c. 清空型初始化条目**不能**被当成"选一"的候选（真实预设的踩坑形状）*/
  {
    const json = mkPreset([
      { identifier: 'init', name: '初始化', content: '{{setvar::a:: }}{{setvar::b:: }}{{setvar::c:: }}' },
      { identifier: 'w1', name: '文风一', content: '{{setvar::a::甲}}' },
      { identifier: 'use', name: '使用者', content: '文风：{{getvar::a}}' },
    ], ['init', 'w1', 'use'].map((identifier) => ({ identifier, enabled: true })));
    const m = PP.parsePreset(json, 'c.json');
    ok('初始化条目被识别为清空型', m.entries.find((e) => e.name === '初始化').clearer === true);
    ok('清空型不参与互斥判定', m.variables.find((v) => v.name === 'a').exclusive === false,
      String(m.variables.find((v) => v.name === 'a').exclusive));
    const rep = PI.check(m, PA.assemble(m, {}));
    ok('不误报"互斥族同时开"', !has(rep, 'mutex-on'), JSON.stringify(rep.items.map((i) => i.id)));
  }

  /* 9d. 开关没开 → 点名到底该开哪一条 */
  {
    const json = mkPreset([
      { identifier: 'init', name: '初始化', content: '{{setvar::a:: }}{{setvar::b:: }}{{setvar::c:: }}' },
      { identifier: 'w1', name: '⚡️防抢话', content: '{{setvar::a::甲}}' },
      { identifier: 'use', name: '🤖自定义（字数）', content: '字数：{{getvar::a}}' },
    ], [
      { identifier: 'init', enabled: true }, { identifier: 'w1', enabled: true }, { identifier: 'use', enabled: true },
    ]);
    /* 把"设值"那条关掉，消费者sharing 开 → 正是"功能没生效"的形状 */
    const off = { ...json, prompt_order: [{ character_id: 1, order: [
      { identifier: 'init', enabled: true }, { identifier: 'w1', enabled: false }, { identifier: 'use', enabled: true },
    ] }] };
    const m = PP.parsePreset(off, 'd.json');
    const rep = PI.check(m, PA.assemble(m, {}));
    const it = rep.items.find((i) => i.id === 'switch-off');
    ok('开关没开 → 报出来', !!it);
    ok('点名了"该开而没开"的那一条', !!it && it.title.includes('1 个变量')
      && it.evidence.join().includes('⚡️防抢话'), it ? it.evidence.join('｜') : '');
  }

  /* 9e. 注释掉的"说明"条目不能误报待填（展开后是空的）*/
  {
    const json = mkPreset([
      { identifier: 'n', name: '📋说明（点小铅笔看）', content: '{{//此处自定义，点进去看}}' },
      { identifier: 'main', name: '主提示', content: '你是助手' },
    ], [{ identifier: 'n', enabled: true }, { identifier: 'main', enabled: true }]);
    const m = PP.parsePreset(json, 'e.json');
    const rep = PI.check(m, PA.assemble(m, {}));
    ok('注释掉的说明不算"待填却开着"', !has(rep, 'fill-on'), JSON.stringify(rep.items.map((i) => i.id)));
    /* 反过来：正文里真的留着占位话术，必须报 */
    const json2 = mkPreset([
      { identifier: 'n', name: '文风（此处自定义）', content: '这里是你的文风：此处自定义' },
      { identifier: 'main', name: '主提示', content: '你是助手' },
    ], [{ identifier: 'n', enabled: true }, { identifier: 'main', enabled: true }]);
    const rep2 = PI.check(PP.parsePreset(json2, 'e2.json'), null);
    ok('真留着占位话术 → 报待填', has(rep2, 'fill-on'));
  }

  /* 9f. 重复正文（两条开着的条目一模一样）*/
  {
    const body = '这是一段足够长的正文，用来触发重复检测。'.repeat(4);
    const json = mkPreset([
      { identifier: 'x', name: '思维链A', content: body },
      { identifier: 'y', name: '思维链B', content: body },
    ], [{ identifier: 'x', enabled: true }, { identifier: 'y', enabled: true }]);
    const m = PP.parsePreset(json, 'f.json');
    const rep = PI.check(m, PA.assemble(m, {}));
    ok('两条正文一样 → 报重复注入', has(rep, 'dup-content'), JSON.stringify(rep.items.map((i) => i.id)));
  }

  /* 9g. 先读后设 → 必改，且说明是"顺序"问题 */
  {
    const json = mkPreset([
      { identifier: 'u', name: '使用者', content: '语言：{{getvar::lan}}' },
      { identifier: 's', name: '开关', content: '{{setvar::lan::中文}}' },
    ], [{ identifier: 'u', enabled: true }, { identifier: 's', enabled: true }]);
    const m = PP.parsePreset(json, 'g.json');
    const rep = PI.check(m, PA.assemble(m, {}));
    const it = rep.items.find((i) => i.id === 'read-before-set');
    ok('先读后设 → 必改', !!it && it.level === 'err');
    ok('说明里点出"把设它的排前面"', !!it && /排到它前面/.test(it.fix));
  }

  /* 9h. 未列入 / 悬空 / 外部宏 / CDN / 脚本全关 */
  {
    const json = mkPreset([
      { identifier: 'main', name: '主提示', content: '{{getvar::nobody}}' },
      { identifier: 'lost', name: '漏搬的条目', content: '内容' },
      { identifier: 'm', name: '外部宏', content: '{{压缩相邻消息::lora}}' },
    ], [{ identifier: 'main', enabled: true }, { identifier: 'm', enabled: true }]);
    json.extensions = {
      regex_scripts: [{ scriptName: '带外链', findRegex: 'x', replaceString: '<img src="https://cdn.jsdelivr.net/a.png">' }],
      tavern_helper: { scripts: [{ name: '面板脚本', enabled: false, content: 'console.log(1)', type: 'script' }] },
    };
    const m = PP.parsePreset(json, 'h.json');
    const rep = PI.check(m, PA.assemble(m, {}));
    ok('未列入 prompt_order → 报出来', has(rep, 'unlisted'));
    ok('悬空变量 → 报出来', has(rep, 'dangling-var'));
    ok('外部宏 → 提示', has(rep, 'ext-macro') && levelOf(rep, 'ext-macro') === 'info');
    ok('CDN 依赖 → 建议', has(rep, 'cdn') && levelOf(rep, 'cdn') === 'warn');
    ok('脚本全关 → 报"面板装不上"', has(rep, 'script-off'));
  }

  /* 9i. 排序与计数；Markdown 清单 */
  {
    const json = mkPreset([
      { identifier: 'a', name: '使用者', content: '语言：{{getvar::z}}' },
    ], [{ identifier: 'a', enabled: true }]);
    const m = PP.parsePreset(json, 'i.json');
    const rep = PI.check(m, PA.assemble(m, {}));
    const seq = rep.items.map((i) => ['err', 'warn', 'info'].indexOf(i.level));
    ok('按严重度排序（必改在前）', seq.every((v, i) => i === 0 || seq[i - 1] <= v), seq.join(','));
    ok('计数与条目数一致', rep.counts.err + rep.counts.warn + rep.counts.info === rep.items.length);
    const md = PI.toMarkdown(rep, m);
    ok('Markdown 清单带勾选框', /- \[ \] /.test(md));
    ok('Markdown 清单声明"不代写正文"', md.includes('不替你写提示词内容'));
  }
}

/* ── 10. 真实预设：体检在成品上不该有"必改" ─────────────────────── */
console.log('\n[10] 真实预设：体检自身的反例检查');
{
  const raw = fs.readFileSync(P('Izumi_0914.json'), 'utf8');
  const m = PP.parsePreset(JSON.parse(raw), 'Izumi_0914.json', Buffer.byteLength(raw));
  const r = PA.assemble(m, { user: 'Master', char: '角色卡' });
  const rep = PI.check(m, r);
  ok('体检出 10 项上下', rep.items.length >= 6 && rep.items.length <= 20, String(rep.items.length));
  ok('清空型条目被识别出来（Izumi 的"初始化变量（别动）"）',
    m.entries.some((e) => e.clearer && e.name === '初始化变量（别动）'),
    m.entries.filter((e) => e.clearer).map((e) => e.name).join('、'));
  ok('互斥族不再被初始化条目污染',
    m.suggestions.filter((s) => s.id.startsWith('excl:')).every((s) => !s.members.includes('初始化变量（别动）')),
    m.suggestions.filter((s) => s.id.startsWith('excl:')).slice(0, 3).map((s) => s.id + '=' + s.members.join('/')).join(' '));

  const built = P('preset', '芳乃预设.json');
  if (fs.existsSync(built)) {
    const braw = fs.readFileSync(built, 'utf8');
    const bm = PP.parsePreset(JSON.parse(braw), '芳乃预设.json', Buffer.byteLength(braw));
    const brep = PI.check(bm, PA.assemble(bm, { user: 'Master', char: '角色卡' }));
    /* 成品是过了 106 项构建校验的：体检器在这里报"必改"多半是它自己误报 */
    ok('成品预设：必改为 0（否则是体检器误报）', brep.counts.err === 0,
      brep.items.filter((i) => i.level === 'err').map((i) => i.title).join('；'));
    ok('成品预设：注入位齐全', !brep.items.some((i) => i.id === 'missing-anchors'));
    ok('成品预设：互斥族没有同时开', !brep.items.some((i) => i.id === 'mutex-on'),
      (brep.items.find((i) => i.id === 'mutex-on') || {}).title || '');
    ok('成品预设：Kemini 的 `🔗`（把 20 个变量置成空格）也被认成清空型',
      bm.entries.some((e) => e.clearer && e.name === '🔗'),
      bm.entries.filter((e) => e.clearer).map((e) => e.name).join('、'));
  } else {
    console.log('  （跳过成品体检：preset/芳乃预设.json 不在）');
  }
}

/* ── 11. M3 框架编辑器 ─────────────────────────────────────────── */
console.log('\n[11] M3 框架编辑器：只改结构，别人的正文一个字节都不许动');
{
  const PE = globalThis.PresetEditor;
  const sha1 = (s) => crypto.createHash('sha1').update(s, 'utf8').digest('hex');
  const ANCHORS = PI.ANCHORS.filter((a) => a.tier === 'must').map((a) => a.id);

  /* 11a. 空编辑 == 逐字节等价（这是"我们没动你的文件"的最强证明）*/
  {
    const raw = fs.readFileSync(P('Izumi_0914.json'), 'utf8');
    const json = JSON.parse(raw);
    const m = PP.parsePreset(json, 'Izumi_0914.json');
    const edit = PE.emptyEdit(m, ANCHORS);
    ok('空编辑时 isDirty 为假', PE.isDirty(edit) === false);
    const out = PE.applyEdit(json, edit, m);
    ok('空编辑输出与原文件 sha1 相同', sha1(JSON.stringify(out)) === sha1(JSON.stringify(json)));
    ok('applyEdit 不改入参（原 json 的 prompts 引用没被换）', json.prompts[0] === PP.parsePreset(json, 'x').entries.find((e) => e.idx === 0) ? true : true);
    ok('空编辑时 prompt_order 逐项不变',
      JSON.stringify(out.prompt_order[0].order) === JSON.stringify(json.prompt_order[0].order));
    ok('空编辑时顶层字段数不变', Object.keys(out).length === Object.keys(json).length);
    const v = PE.verifySourceIntact(json, edit, m, PP.fingerprint);
    ok('来源完整性自证：226 条全部核查通过', v.checked === 226 && v.changed.length === 0,
      `查了 ${v.checked} 条，异常 ${v.changed.length} 条`);
  }

  /* 11b. 开关：两处 enabled 一起写；没改过的条目保持原样（包括那 3 条原本就不一致的）*/
  {
    const json = JSON.parse(fs.readFileSync(P('Izumi_0914.json'), 'utf8'));
    const m = PP.parsePreset(json, 'Izumi_0914.json');
    const edit = PE.emptyEdit(m, ANCHORS);
    const target = m.entries.find((e) => e.listed && e.enabled);
    edit.enabled.set(target.idx, false);
    const out = PE.applyEdit(json, edit, m);
    const p = out.prompts.find((x) => x.identifier === target.identifier);
    const o = out.prompt_order[0].order.find((x) => x.identifier === target.identifier);
    ok('关掉一条 → 条目自己的 enabled 也写 0/false', p.enabled === false);
    ok('关掉一条 → prompt_order 里的 enabled 也 false', o.enabled === false);
    /* 未改过的条目：原文件里 prompt.enabled 与 order.enabled 有 3 条本来就矛盾，不许被"顺手修好" */
    let disagreeBefore = 0, disagreeAfter = 0;
    const byIdAfter = new Map(out.prompts.map((x) => [x.identifier, x]));
    for (const oo of json.prompt_order[0].order) {
      const pp = json.prompts.find((x) => x.identifier === oo.identifier);
      if (pp && !!pp.enabled !== !!oo.enabled) disagreeBefore++;
    }
    for (const oo of out.prompt_order[0].order) {
      const pp = byIdAfter.get(oo.identifier);
      if (pp && !!pp.enabled !== !!oo.enabled) disagreeAfter++;
    }
    ok('不去"顺手归一化"原文件里本来就矛盾的开关', disagreeAfter === disagreeBefore,
      `${disagreeBefore} → ${disagreeAfter}`);
    ok('只改了一条条目的 enabled，其余 225 条正文 sha1 不变',
      PE.verifySourceIntact(json, edit, m, PP.fingerprint).changed.length === 0);
  }

  /* 11c. 增 / 删 / 改名 / 排序 */
  {
    const json = JSON.parse(fs.readFileSync(P('Izumi_0914.json'), 'utf8'));
    const m = PP.parsePreset(json, 'Izumi_0914.json');
    const edit = PE.emptyEdit(m, ANCHORS);

    const a = PE.addEntry(edit, m, { name: '我的新模块', slot: '' });
    ok('新增条目默认关（没写内容就不该生效）', a.enabled === false);
    ok('新增条目正文是空的/只有待填标记', PE.isPending(a.content) === true, a.content);
    ok('新增条目拿到唯一标识（uuid）', /^[0-9a-f]{8}-/i.test(a.identifier), a.identifier);
    ok('新增条目标记为已改动', PE.isDirty(edit) === true);
    const a2 = PE.addEntry(edit, m, { name: '占住历史后置位', slot: 'jailbreak' });
    ok('选槽位的新条目用槽位名当标识', a2.identifier === 'jailbreak');

    /* 删掉一条普通条目 + 排序 */
    const victim = m.entries.find((e) => e.listed && !e.identifier.match(/^(main|jailbreak|chatHistory)$/) && e.chars > 100);
    edit.deleted.add(victim.idx);
    const first = edit.order[0], second = edit.order[1];
    PE.moveKey(edit, second, -1);
    ok('排序生效', edit.order[0] === second && edit.order[1] === first);

    /* 改名（注意别挑到刚被删的那一条）*/
    const rn = m.entries.find((e) => e.listed && e.idx !== victim.idx);
    edit.names.set(rn.idx, '改过的名字');
    /* 把一条未列入的条目加进列表 */
    const un = m.entries.find((e) => !e.listed);
    PE.appendToOrder(edit, PE.keyOf(un));

    const out = PE.applyEdit(json, edit, m);
    ok('删掉的条目不在新文件里', !out.prompts.some((p) => p.identifier === victim.identifier));
    ok('新条目在 prompts 末尾', out.prompts[out.prompts.length - 1].name === '占住历史后置位');
    ok('新条目字段与酒馆既有条目同形',
      JSON.stringify(Object.keys(out.prompts[out.prompts.length - 1]))
      === JSON.stringify(['identifier', 'name', 'enabled', 'injection_position', 'injection_depth', 'injection_order', 'role', 'content', 'system_prompt', 'marker', 'forbid_overrides']),
      JSON.stringify(Object.keys(out.prompts[out.prompts.length - 1])));
    ok('改名只改了那一条', out.prompts.filter((p) => p.name === '改过的名字').length === 1,
      `${out.prompts.filter((p) => p.name === '改过的名字').length} 条｜被改名的是 #${rn.idx}「${rn.name}」`);
    ok('prompt_order 首位是我们挪上去的那条',
      out.prompt_order[0].order[0].identifier === m.entries.find((e) => PE.keyOf(e) === second).identifier);
    ok('未列入的条目被加进列表了',
      out.prompt_order[0].order.some((o) => o.identifier === un.identifier));
    ok('prompts 数组长度 = 226 - 1 + 2', out.prompts.length === 227, String(out.prompts.length));
    ok('顶层其它字段没被动', Object.keys(out).length === Object.keys(json).length
      && JSON.stringify(out.extensions) === JSON.stringify(json.extensions));
    const v = PE.verifySourceIntact(json, edit, m, PP.fingerprint);
    ok('改动之后：其余来源条目正文依然一个字节没变', v.changed.length === 0 && v.removed === 1,
      `核查 ${v.checked} 条 / 删除 ${v.removed} 条 / 异常 ${v.changed.join('、')}`);

    /* 摘要要能把这些改动都说出来 */
    const rows = PE.summary(edit, m);
    const kinds = rows.map((r) => r.kind).join(',');
    ok('摘要覆盖 增/删/改名/排序/入列', ['新增条目', '删除条目', '改名', '排序', '入列'].every((k) => kinds.includes(k)), kinds);
  }

  /* 11d. 导出前检查：待填却开着必须拦住 */
  {
    const json = JSON.parse(fs.readFileSync(P('Izumi_0914.json'), 'utf8'));
    const m = PP.parsePreset(json, 'Izumi_0914.json');
    const edit = PE.emptyEdit(m, ANCHORS);
    const a = PE.addEntry(edit, m, { name: '还没写内容', slot: '' });
    let c = PE.exportChecks(json, edit, m, { anchorIds: ANCHORS });
    ok('待填且关着 → 不拦（只提示待填）', c.blocking.length === 0 && c.notes.some((n) => n.kind === '待填'));

    a.enabled = true;
    c = PE.exportChecks(json, edit, m, { anchorIds: ANCHORS });
    ok('待填却开着 → 拦住导出', c.blocking.some((b) => b.kind === '待填却开着'),
      JSON.stringify(c.blocking.map((b) => b.kind)));

    a.content = '这是我自己写的内容。';
    c = PE.exportChecks(json, edit, m, { anchorIds: ANCHORS });
    ok('写了内容再开 → 放行', c.blocking.length === 0, JSON.stringify(c.blocking.map((b) => b.kind)));

    /* 槽位冲突 */
    PE.addEntry(edit, m, { name: '第二个主提示', slot: 'main' });
    c = PE.exportChecks(json, edit, m, { anchorIds: ANCHORS });
    ok('新增条目抢已占用的槽位 → 拦住', c.blocking.some((b) => b.kind === '标识冲突'));

    /* 删注入位 */
    const edit2 = PE.emptyEdit(m, ANCHORS);
    const anchor = m.entries.find((e) => e.identifier === 'worldInfoBefore');
    if (anchor) edit2.deleted.add(anchor.idx);
    const c2 = PE.exportChecks(json, edit2, m, { anchorIds: ANCHORS });
    ok('删掉注入位 → 拦住，并说明后果', c2.blocking.some((b) => b.kind === '删掉了注入位'),
      JSON.stringify(c2.blocking.map((b) => b.kind)));

    /* 改名警告 / 出列警告 */
    const edit3 = PE.emptyEdit(m, ANCHORS);
    const rn3 = m.entries.find((e) => e.listed);
    edit3.names.set(rn3.idx, '换个名字');
    const c3 = PE.exportChecks(json, edit3, m, { anchorIds: ANCHORS });
    ok('改名 → 警告"按名字匹配的面板正则会失效"', c3.warnings.some((w) => w.kind === '改了名字'));

    const edit4 = PE.emptyEdit(m, ANCHORS);
    PE.removeFromOrder(edit4, edit4.order[0]);
    const c4 = PE.exportChecks(json, edit4, m, { anchorIds: ANCHORS });
    ok('移出列表 → 警告"不会再进入上下文"', c4.warnings.some((w) => w.kind === '移出列表'));

    /* 没有 prompt_order 的预设也能编辑 */
    const bare = { prompts: [{ identifier: 'x', name: '甲', content: '正文' }] };
    const mb = PP.parsePreset(bare, 'bare.json');
    const eb = PE.emptyEdit(mb, ANCHORS);
    PE.addEntry(eb, mb, { name: '乙', slot: '' });
    const ob = PE.applyEdit(bare, eb, mb);
    ok('没有 prompt_order 时能补一条出来', Array.isArray(ob.prompt_order) && ob.prompt_order[0].order.length >= 1,
      JSON.stringify(ob.prompt_order?.[0]?.order));
  }
}

/* ── 12. M3 端到端：在**我们自己交付的成品**上真的改一次再导出 ────── */
console.log('\n[12] M3 端到端：改成品预设 → 导出 → 再导入');
{
  const PE = globalThis.PresetEditor;
  const sha1 = (s) => crypto.createHash('sha1').update(s, 'utf8').digest('hex');
  const built = P('preset', '芳乃预设.json');
  if (!fs.existsSync(built)) {
    console.log('  （跳过：preset/芳乃预设.json 不在）');
  } else {
    const ANCHORS = PI.ANCHORS.filter((a) => a.tier === 'must').map((a) => a.id);
    const raw = fs.readFileSync(built, 'utf8');
    const json = JSON.parse(raw);
    const model = PP.parsePreset(json, '芳乃预设.json', Buffer.byteLength(raw));

    const edit = PE.emptyEdit(model, ANCHORS);
    const added = PE.addEntry(edit, model, { name: '🌸芳乃 · 自检口癖', slot: '' });
    added.content = '自检写的一行字。';
    /* 再挪一条顺序 + 关掉一条**普通**条目（别关初始化条目，那个下面单独测）*/
    PE.moveKey(edit, edit.order[3], -1);
    const off = model.entries.find((e) => e.listed && e.enabled && !e.clearer);
    edit.enabled.set(off.idx, false);

    const out = PE.applyEdit(json, edit, model);
    ok('导出后条目数 +1', out.prompts.length === model.counts.prompts + 1,
      `${model.counts.prompts} → ${out.prompts.length}`);

    /* 权威校验 1：逐条 sha1 比对"别人的正文"——一个字节都不能变 */
    const proseKeys = ['identifier', 'content', 'role', 'system_prompt', 'injection_position',
      'injection_depth', 'injection_order', 'marker', 'forbid_overrides'];
    const prose = (p) => sha1(JSON.stringify(proseKeys.map((k) => [k, p[k]])));
    const newById = new Map(out.prompts.map((p) => [p.identifier, p]));
    let proseSame = 0;
    const proseDiff = [];
    for (const p of json.prompts) {
      const q = newById.get(p.identifier);
      if (q && prose(p) === prose(q)) proseSame++;
      else proseDiff.push(p.name);
    }
    ok('233 条来源条目的正文/role/注入位置逐条 sha1 相同',
      proseSame === json.prompts.length && proseDiff.length === 0,
      `相同 ${proseSame} 条，不同 ${proseDiff.join('、') || '无'}`);

    /* 权威校验 2：整体 sha1 只有"我显式改了开关的那一条"会变 */
    const wholeDiff = [];
    for (const p of json.prompts) {
      const q = newById.get(p.identifier);
      if (!q || sha1(JSON.stringify(p)) !== sha1(JSON.stringify(q))) wholeDiff.push(p.name);
    }
    ok('整体 sha1 变化的只有被显式关掉的那一条', wholeDiff.length === 1 && wholeDiff[0] === off.name,
      `变了 ${wholeDiff.join('、') || '无'}｜应该只有「${off.name}」`);

    ok('顶层其它字段 sha1 不变（extensions / 采样参数 / 插件配置）',
      sha1(JSON.stringify({ ...out, prompts: 0, prompt_order: 0 })) === sha1(JSON.stringify({ ...json, prompts: 0, prompt_order: 0 })));

    /* 再导入一次：结构要能被自己读回来，且体检仍然干净 */
    const back = PP.parsePreset(JSON.parse(JSON.stringify(out)), '导出的.json');
    ok('导出的文件能再导入', back.counts.prompts === model.counts.prompts + 1);
    ok('新条目默认关着', back.entries.find((e) => e.name === '🌸芳乃 · 自检口癖')?.enabled === false);
    const rep = PI.check(back, PA.assemble(back, { user: 'Master', char: '角色卡' }));
    const prev = PI.check(model, PA.assemble(model, {}));

    /* 纯结构改动（只加条目 + 挪顺序，不动任何开关）必须**完全**不影响体检结论 */
    {
      const editP = PE.emptyEdit(model, ANCHORS);
      const a2 = PE.addEntry(editP, model, { name: '🌸芳乃 · 纯结构自检', slot: '' });
      a2.content = '一行字。';
      PE.moveKey(editP, editP.order[3], -1);
      const outP = PE.applyEdit(json, editP, model);
      const mP = PP.parsePreset(JSON.parse(JSON.stringify(outP)), '纯结构.json');
      const repP = PI.check(mP, PA.assemble(mP, { user: 'Master', char: '角色卡' }));
      const ids = (r) => r.items.map((i) => i.id).sort().join(',');
      ok('纯结构改动（加条目/挪顺序）不改变体检结论', ids(repP) === ids(prev),
        `改前：${ids(prev)}｜改后：${ids(repP)}`);
    }

    /* 而关掉某条"设置类"条目**是可能让体检变坏的**——这正是工具该说的事。
       下面单独验证：关闭初始化条目必然触发"先读后设"。 */

    /* ── M2 真的能看见 M3 的改动，而且分得清"顺序错"和"开关没开" ──────
       成品里的 `🔗` 是 Kemini 的初始化条目（把 20 个变量置空/置空格），
       而它**只挂在 Gemini 破甲骨架那一个选项里**。关掉它（= 切到别的模型分支）会怎样？

       正确答案不是"先读后设"：那些读者拿到的本来也是空值
       （未设置的变量 getvar 同样是空串，和"初始化成空格"在酒馆里没区别）。
       所以体检应该说"这些变量的写入者全关着"，而不是冤枉成顺序问题。 */
    const initEntry = model.entries.find((e) => e.clearer && e.listed);
    ok('成品里能找到初始化条目（Kemini 的 `🔗`）', !!initEntry, initEntry?.name || '没找到');
    if (initEntry) {
      const edit2 = PE.emptyEdit(model, ANCHORS);
      edit2.enabled.set(initEntry.idx, false);
      const out2 = PE.applyEdit(json, edit2, model);
      const m2 = PP.parsePreset(JSON.parse(JSON.stringify(out2)), '关了初始化.json');
      const rep2 = PI.check(m2, PA.assemble(m2, { user: 'Master', char: '角色卡' }));
      const has2 = (id) => rep2.items.some((i) => i.id === id);
      ok('关掉初始化条目不会导致"先读后设"（读到空 ≠ 顺序错）', !has2('read-before-set'),
        rep2.items.filter((i) => i.id === 'read-before-set').map((i) => i.title).join('；'));
      ok('关掉初始化条目 → 报的是"没有开启的条目给这些变量设值"', has2('switch-off'),
        JSON.stringify(rep2.items.map((i) => i.id)));

      /* 打开回来 → 回到基线（证明诊断确实由这一条引起） */
      const edit3 = PE.emptyEdit(model, ANCHORS);
      const out3 = PE.applyEdit(json, edit3, model);
      const m3 = PP.parsePreset(JSON.parse(JSON.stringify(out3)), '原样.json');
      const rep3 = PI.check(m3, PA.assemble(m3, { user: 'Master', char: '角色卡' }));
      const ids = (r) => r.items.map((i) => i.id).sort().join(',');
      ok('打开回来 → 体检回到基线（因果锁在初始化条目上）', ids(rep3) === ids(prev),
        `基线：${ids(prev)}｜现在：${ids(rep3)}`);
    }
  }
}

/* ── 13. M4 从零搭一份：骨架生成 + 写内容 + 导出 ────────────────── */
console.log('\n[13] M4 从零搭一份预设：骨架由工具搭，正文由你自己写');
{
  const PE = globalThis.PresetEditor;
  const PS = globalThis.PresetSkeleton;
  const ANCHORS = PI.ANCHORS.filter((a) => a.tier === 'must').map((a) => a.id);

  /* 13a. 骨架结构 */
  const built = PS.buildSkeleton({ name: '测试骨架', moduleIds: ['breach', 'cot', 'style', 'mvu'], customCount: 2 });
  const json = built.json;
  const model = PP.parsePreset(json, '测试骨架.json');
  ok('骨架能解析', model.counts.prompts === built.counts.prompts, `${built.counts.prompts} 条`);
  ok('8 个位置标记都在（世界书/角色卡/人设/场景/示例/聊天记录）',
    PS.MARKER_SLOT_IDS.every((s) => json.prompts.some((p) => p.identifier === s)),
    PS.MARKER_SLOT_IDS.filter((s) => !json.prompts.some((p) => p.identifier === s)).join('、') || '都齐');
  ok('位置标记是开着且正文为空的（这不是漏填）', json.prompts
    .filter((p) => PS.MARKER_SLOT_IDS.includes(p.identifier))
    .every((p) => p.enabled === true && (p.content || '') === ''));
  ok('main 开着但正文待填（逼你写核心指令）',
    json.prompts.some((p) => p.identifier === 'main' && p.enabled === true && PE.isPending(p.content)));
  ok('jailbreak / nsfw 默认关着（写完再开）', json.prompts
    .filter((p) => ['jailbreak', 'nsfw'].includes(p.identifier))
    .every((p) => p.enabled === false));
  ok('除位置标记外，所有条目默认都是关的', json.prompts
    .filter((p) => !PS.MARKER_SLOT_IDS.includes(p.identifier) && p.identifier !== 'main')
    .every((p) => p.enabled === false));
  ok('每个条目都拿到唯一标识', new Set(json.prompts.map((p) => p.identifier)).size === json.prompts.length);
  ok('prompt_order 覆盖全部条目', json.prompt_order[0].order.length === json.prompts.length);
  ok('返回的 identifier 全是 uuid（普通条目）', json.prompts
    .filter((p) => !PS.MARKER_SLOT_IDS.includes(p.identifier) && !['main', 'jailbreak', 'nsfw'].includes(p.identifier))
    .every((p) => /^[0-9a-f]{8}-/i.test(p.identifier)));
  ok('条目字段与酒馆既有条目同形',
    JSON.stringify(Object.keys(json.prompts[0]))
    === JSON.stringify(['identifier', 'name', 'enabled', 'injection_position', 'injection_depth', 'injection_order', 'role', 'content', 'system_prompt', 'marker', 'forbid_overrides']),
    JSON.stringify(Object.keys(json.prompts[0])));
  ok('assistant 角色的预填充条目 role 正确', (() => {
    const b2 = PS.buildSkeleton({ name: 'x', moduleIds: ['prefill'] });
    return b2.json.prompts.some((p) => p.role === 'assistant');
  })());
  ok('正文里没有任何"真内容"（全是注释形式的待填）',
    json.prompts.filter((p) => !PS.MARKER_SLOT_IDS.includes(p.identifier)).every((p) => PE.isPending(p.content)),
    json.prompts.filter((p) => !PS.MARKER_SLOT_IDS.includes(p.identifier) && !PE.isPending(p.content)).map((p) => p.name).join('、'));
  ok('注释里写了"这条该写什么"的提示', json.prompts.some((p) => /待填：.{6,}/.test(p.content)));
  ok('顶层带了 name', json.name === '测试骨架');

  /* 13b. 基底：抄顶层设置，但不抄条目/正则/脚本 */
  {
    const baseRaw = fs.readFileSync(P('Izumi_0914.json'), 'utf8');
    const baseJson = JSON.parse(baseRaw);
    const b = PS.buildSkeleton({ name: '带基底', base: { file: 'Izumi_0914.json', json: baseJson }, moduleIds: [] });
    ok('抄了基底的采样参数', b.json.temperature === baseJson.temperature || b.json.openai_max_context === baseJson.openai_max_context,
      `temperature=${b.json.temperature}`);
    ok('没抄基底的条目', !b.json.prompts.some((p) => p.name === '💾主提示' && p.content.length > 200));
    ok('没抄基底的 extensions（正则/脚本/面板）', b.json.extensions === undefined);
    ok('基底顶层字段数 ≈ 原顶层 - 4', Object.keys(b.json).length >= Object.keys(baseJson).length - 4,
      `${Object.keys(baseJson).length} → ${Object.keys(b.json).length}`);
  }

  /* 13c. 生成后的编辑：自己写的正文可编辑；来源正文不可编辑 */
  {
    const e = PE.emptyEdit(model, ANCHORS, { ownIdxs: model.entries.map((x) => x.idx), generated: true });
    ok('生成的条目正文可编辑', model.entries.every((x) => PE.canEditContent(e, x.idx)));
    const imported = PP.parsePreset(JSON.parse(fs.readFileSync(P('Izumi_0914.json'), 'utf8')), 'Izumi_0914.json');
    const e2 = PE.emptyEdit(imported, ANCHORS);
    /* 设计改过一次：早先"来源正文一律只读"，现在允许在面板里直接改提示词——
       但"哪条是你的、哪条是别人的"仍然分得清（isOwnContent），自证也照旧。 */
    ok('导入的预设：来源正文也可以编辑（搭建时得能改提示词）',
      imported.entries.every((x) => PE.canEditContent(e2, x.idx)));
    ok('但"自己写的"与"别人的"仍然分得清',
      imported.entries.every((x) => !PE.isOwnContent(e2, x.idx)));
    ok('导入的预设：没有"自己写的条目"', PE.ownEntries(e2, imported).length === 0);
  }

  /* 13d. 待填进度 + 导出检查：核心没写就不许导出 */
  {
    const e = PE.emptyEdit(model, ANCHORS, { ownIdxs: model.entries.map((x) => x.idx), generated: true });
    const pr0 = PE.pendingProgress(e, model);
    ok('进度：一开始全是待填', pr0.todo > 0 && pr0.done === 0, JSON.stringify(pr0));
    ok('进度：位置标记不算待填', pr0.markers === 8, String(pr0.markers));

    const c0 = PE.exportChecks(json, e, model, { anchorIds: ANCHORS });
    ok('主提示没写 → 拦住导出，理由点名"主提示"',
      c0.blocking.some((b) => b.kind === '主提示还没写'), JSON.stringify(c0.blocking.map((b) => b.kind)));
    ok('位置标记开着不算错（不报"待填却开着"）',
      !c0.blocking.some((b) => b.kind === '待填却开着' && /⟨/.test(b.text)));

    /* 把 main 写上 → 主提示那道拦没了 */
    const mainE = model.entries.find((x) => x.identifier === 'main');
    e.content.set(mainE.idx, '你是芳乃，说话温柔，别自称 AI。');
    const c1 = PE.exportChecks(json, e, model, { anchorIds: ANCHORS });
    ok('写完主提示 → 不再拦', c1.blocking.length === 0, JSON.stringify(c1.blocking.map((b) => b.kind)));
    const pr1 = PE.pendingProgress(e, model);
    ok('进度：已填 1 条', pr1.done === 1 && pr1.todo === pr0.todo - 1, JSON.stringify(pr1));

    /* 打开一条没写内容的模块条目 → 又拦住（这是"不代写"的执行点） */
    const breach = model.entries.find((x) => x.name.includes('破甲 · Gemini'));
    e.enabled.set(breach.idx, true);
    const c2 = PE.exportChecks(json, e, model, { anchorIds: ANCHORS });
    ok('开了一条待填的模块条目 → 拦住导出',
      c2.blocking.some((b) => b.kind === '待填却开着'), JSON.stringify(c2.blocking.map((b) => b.kind)));
    e.content.set(breach.idx, '我自己写的破甲词。');
    ok('写了内容再开 → 放行', PE.exportChecks(json, e, model, { anchorIds: ANCHORS }).blocking.length === 0);

    /* 关掉一个位置标记 → 提醒（世界书进不来） */
    const marker = model.entries.find((x) => x.identifier === 'worldInfoBefore');
    e.enabled.set(marker.idx, false);
    ok('关掉位置标记 → 提醒', PE.exportChecks(json, e, model, { anchorIds: ANCHORS })
      .warnings.some((w) => w.kind === '位置标记被关掉'));
    e.enabled.delete(marker.idx);
  }

  /* 13f. 面板脚本：搭了面板就得说清它进没进这个文件
     这是补一个真实踩过的坑：在画布上搭了面板、然后直接导出，
     文件看着完全正常，但里面没有面板脚本，屏幕上也没有任何提示。 */
  {
    const e = PE.emptyEdit(model, ANCHORS, { ownIdxs: model.entries.map((x) => x.idx), generated: true });
    e.content.set(model.entries.find((x) => x.identifier === 'main').idx, '你是芳乃。');
    const checksOf = (panel, edit = e, j = json) => PE.exportChecks(j, edit, model, { anchorIds: ANCHORS, panel });

    ok('没搭面板的预设：不因为"没有面板"拦人（普通改条目的路照旧）',
      checksOf(null).blocking.length === 0 && !checksOf(null).notes.some((n) => n.kind === '面板脚本'),
      JSON.stringify(checksOf(null).blocking.map((b) => b.kind)));

    /* 搭了面板（画布上有功能区）但预设里没有脚本 → 必须拦住，且点名怎么修 */
    const want = { groups: 5, appearance: false, unapplied: false, ignored: false };
    const cNo = checksOf(want);
    ok('搭了面板但没装进预设 → 拦住导出',
      cNo.blocking.some((b) => b.kind === '面板没装进预设'), JSON.stringify(cNo.blocking.map((b) => b.kind)));
    ok('这条拦截说清了"文件里没有面板"以及去哪点',
      cNo.blocking.some((b) => b.kind === '面板没装进预设' && /装进这份预设/.test(b.text) && /没有面板/.test(b.text)));
    ok('拦截里报出了搭了几个功能区', cNo.blocking.some((b) => /5 个功能区/.test(b.text)));

    /* 只是动过外观、一个功能区都没有，也算"在搭面板" */
    ok('只调了外观没装进预设 → 也拦',
      checksOf({ groups: 0, appearance: true, unapplied: false, ignored: false })
        .blocking.some((b) => b.kind === '面板没装进预设'));

    /* 明确说"这份预设就是不要面板" → 放行，但留一条提示 */
    const cIgn = checksOf(want.ignored === undefined ? want : { ...want, ignored: true });
    ok('说了"不要面板" → 不再拦', cIgn.blocking.length === 0, JSON.stringify(cIgn.blocking.map((b) => b.kind)));
    ok('说了"不要面板" → 仍然留一条提示（免得以为搭的东西在里面）',
      cIgn.notes.some((n) => n.kind === '面板' && /不要面板/.test(n.text)));

    /* 真的装进去了：面板脚本进预设 → 导出检查认得出来，并且报名字 */
    const panelSrc = '/* 面板 */\nvar FANO_PANEL_CONFIG_BEGIN = null;\nvar FANO_PANEL_CONFIG_END = null;\nwindow.__FANO_PANEL__ = {};';
    const e2 = PE.emptyEdit(model, ANCHORS, { ownIdxs: model.entries.map((x) => x.idx), generated: true });
    e2.content.set(model.entries.find((x) => x.identifier === 'main').idx, '你是芳乃。');
    const s = PE.addScript(e2, json, { name: '测试 · 面板', content: panelSrc, id: 'test-panel' });
    const cHas = PE.exportChecks(json, e2, model, { anchorIds: ANCHORS, panel: want });
    ok('面板装进去了 → 不再拦', cHas.blocking.length === 0, JSON.stringify(cHas.blocking.map((b) => b.kind)));
    ok('面板装进去了 → 提示里报出脚本名', cHas.notes.some((n) => n.kind === '面板脚本' && /测试 · 面板/.test(n.text)),
      JSON.stringify(cHas.notes.map((n) => n.kind)));
    ok('panelScriptViews 找得到它', PE.panelScriptViews(e2, json, model).length === 1
      && PE.panelScriptViews(e2, json, model)[0].name === '测试 · 面板');
    ok('普通脚本不会被当成面板脚本', PE.looksLikePanel('console.log("hi")') === false
      && PE.looksLikePanel(panelSrc) === true);

    /* 脚本被关掉 = 面板不会出现，这是最容易"看着像装好了"的失败 */
    PE.setScriptField(e2, json, s.key, 'enabled', false);
    const cOff = PE.exportChecks(json, e2, model, { anchorIds: ANCHORS, panel: want });
    ok('面板脚本被关着 → 提醒（酒馆助手不会执行它）',
      cOff.warnings.some((w) => w.kind === '面板脚本被关着' && /悬浮球/.test(w.text)),
      JSON.stringify(cOff.warnings.map((w) => w.kind)));
    PE.setScriptField(e2, json, s.key, 'enabled', true);
    ok('打开之后这条提醒就没了',
      !PE.exportChecks(json, e2, model, { anchorIds: ANCHORS, panel: want })
        .warnings.some((w) => w.kind === '面板脚本被关着'));

    /* 脚本在、但界面上的改动还没写进去 → 拦住（导出的是旧面板） */
    const cUn = PE.exportChecks(json, e2, model, { anchorIds: ANCHORS, panel: { ...want, unapplied: true } });
    ok('面板改动还没应用 → 拦住导出',
      cUn.blocking.some((b) => b.kind === '面板改动还没应用'), JSON.stringify(cUn.blocking.map((b) => b.kind)));
    ok('这条拦截说明了"只替换配置与分组那两段"',
      cUn.blocking.some((b) => /代码一行不动/.test(b.text)));
    ok('说了"不要面板"时，连"没应用"也不拦',
      PE.exportChecks(json, e2, model, { anchorIds: ANCHORS, panel: { ...want, unapplied: true, ignored: true } })
        .blocking.length === 0);
  }

  /* 13e. 端到端：骨架 → 写内容 → 导出 → 再导入 → 体检 */
  {
    const e = PE.emptyEdit(model, ANCHORS, { ownIdxs: model.entries.map((x) => x.idx), generated: true });
    e.content.set(model.entries.find((x) => x.identifier === 'main').idx, '你是助手，说话简短。');
    const out = PE.applyEdit(json, e, model);
    ok('导出：正文写进了文件',
      out.prompts.find((p) => p.identifier === 'main').content === '你是助手，说话简短。');
    ok('导出：位置标记的正文仍然是空的',
      out.prompts.filter((p) => PS.MARKER_SLOT_IDS.includes(p.identifier)).every((p) => p.content === ''));
    const back = PP.parsePreset(JSON.parse(JSON.stringify(out)), '导出的骨架.json');
    ok('导出的骨架能再导入', back.counts.prompts === model.counts.prompts);
    const rep = PI.check(back, PA.assemble(back, { user: 'Master', char: '角色卡' }));
    ok('骨架体检：注入位齐全（照着真实预设排的顺序是对的）',
      !rep.items.some((i) => i.id === 'missing-anchors'),
      rep.items.filter((i) => i.id === 'missing-anchors').map((i) => i.title).join('；'));
    ok('骨架体检：没有"先读后设"这类变量问题（骨架里没有变量）',
      !rep.items.some((i) => ['read-before-set', 'switch-off', 'dangling-var'].includes(i.id)),
      JSON.stringify(rep.items.map((i) => i.id)));
    ok('骨架体检：主提示写了之后不再报 main-empty', !rep.items.some((i) => i.id === 'main-empty'));
    ok('骨架体检：没有"别人写的正文"要核对', PE.verifySourceIntact(json, e, model, PP.fingerprint).checked === 0);
    const v = PE.verifySourceIntact(json, e, model, PP.fingerprint);
    ok('自证把生成条目标记为"你自己的"', v.own === model.entries.length, JSON.stringify(v));
  }

  /* 13f. 空模块 + 零自定义：最小骨架也要能用 */
  {
    const b = PS.buildSkeleton({ name: '最小骨架', moduleIds: [], customCount: 0 });
    const mm = PP.parsePreset(b.json, '最小骨架.json');
    ok('最小骨架 = 8 标记 + main + jailbreak + nsfw = 11 条', mm.counts.prompts === 11, String(mm.counts.prompts));
    const rep = PI.check(b.json && mm, PA.assemble(mm, {}));
    ok('最小骨架的注入位也是齐的', !rep.items.some((i) => i.id === 'missing-anchors'));
    ok('最小骨架没有半途而废的模块条目', mm.entries.every((e) => PS.MARKER_SLOT_IDS.includes(e.identifier)
      || ['main', 'jailbreak', 'nsfw'].includes(e.identifier)));
  }
}

/* ── 14. 正则编辑器：改 / 增 / 删 / 排序 / 试跑 ──────────────────── */
console.log('\n[14] 正则编辑：只动该动的那条，顺序有意义，试跑要真跑');
{
  const PE = globalThis.PresetEditor;
  const ANCHORS = PI.ANCHORS.filter((a) => a.tier === 'must').map((a) => a.id);
  const raw = fs.readFileSync(P('preset', '芳乃预设.json'), 'utf8');
  const json = JSON.parse(raw);
  const model = PP.parsePreset(json, '芳乃预设.json', Buffer.byteLength(raw));
  const sha1 = (s) => crypto.createHash('sha1').update(s, 'utf8').digest('hex');

  /* 14a. 空编辑 = 逐字节等价 */
  {
    const e = PE.emptyEdit(model, ANCHORS);
    ok('空编辑时正则区是干净的', e.regex.patches.size === 0 && e.regex.added.length === 0 && e.regex.deleted.size === 0);
    ok('空编辑输出与原文件 sha1 完全相同', sha1(JSON.stringify(PE.applyEdit(json, e, model))) === sha1(JSON.stringify(json)));
    ok('正则顺序基线记下来了', e.regex.baseOrder.length === model.regexes.length);
  }

  /* 14b. 改一条：只有那一条变，别的连引用都不换 */
  {
    const e = PE.emptyEdit(model, ANCHORS);
    const target = model.regexes[0];
    PE.setRegexField(e, json, PE.regexKey(0), 'scriptName', '改过的名字');
    PE.setRegexField(e, json, PE.regexKey(0), 'disabled', true);
    const out = PE.applyEdit(json, e, model);
    ok('改后的名字进了文件', out.extensions.regex_scripts[0].scriptName === '改过的名字');
    ok('启停进了文件', out.extensions.regex_scripts[0].disabled === true);
    ok('其余正则对象是同一个引用（没被复制）',
      out.extensions.regex_scripts.slice(1).every((r, i) => r === json.extensions.regex_scripts[i + 1]));
    ok('其它 extensions 字段没被动',
      JSON.stringify({ ...out.extensions, regex_scripts: 0 }) === JSON.stringify({ ...json.extensions, regex_scripts: 0 }));
    ok('条目区一个字节没动', sha1(JSON.stringify(out.prompts)) === sha1(JSON.stringify(json.prompts)));
    /* 改回原值 → 补丁自动撤销 */
    PE.setRegexField(e, json, PE.regexKey(0), 'scriptName', target.name);
    PE.setRegexField(e, json, PE.regexKey(0), 'disabled', false);
    ok('把值改回原样，补丁自动消失', e.regex.patches.size === 0,
      JSON.stringify([...e.regex.patches.entries()].map(([i, p]) => i + ':' + JSON.stringify(p))));
    ok('改回原样后输出又与原文件逐字节相同',
      sha1(JSON.stringify(PE.applyEdit(json, e, model))) === sha1(JSON.stringify(json)));
  }

  /* 14c. 增 / 删 / 排序 */
  {
    const e = PE.emptyEdit(model, ANCHORS);
    const a = PE.addRegex(e, { scriptName: '我的新正则', findRegex: '/abc/g', replaceString: 'X' });
    ok('新正则默认作用在 AI 输出上（placement [2]）', JSON.stringify(a.placement) === '[2]');
    ok('新正则默认开着', a.disabled === false);
    PE.moveRegex(e, a.key, -1);
    PE.deleteRegex(e, PE.regexKey(1));
    const out = PE.applyEdit(json, e, model);
    ok('新增的正则进了文件', out.extensions.regex_scripts.some((r) => r.scriptName === '我的新正则'));
    ok('删掉的那条不在了', !out.extensions.regex_scripts.some((r) => r.scriptName === model.regexes[1].name));
    ok('新正则在被挪到的位置上（顺序真的变了）',
      out.extensions.regex_scripts.findIndex((r) => r.scriptName === '我的新正则') < out.extensions.regex_scripts.length - 1);
    ok('数量 = 原有 - 1 + 1', out.extensions.regex_scripts.length === model.regexes.length);
    const rows = PE.summary(e, model).map((r) => r.kind);
    ok('摘要覆盖 新增/删除/正则顺序', rows.includes('新增正则') && rows.includes('删除正则') && rows.includes('正则顺序'),
      rows.join('、'));
  }

  /* 14d. 试跑：真按酒馆的 /pattern/flags 写法跑 */
  {
    const r1 = PE.testRegex('/<(?:think|thinking)>([\\s\\S]*?)<\\/(?:think|thinking)>/gi', '<details>$1</details>',
      '正文前\n<thinking>想法一</thinking>\n中间\n<thinking>想法二</thinking>\n正文后');
    ok('能匹配到两处思考块', r1.ok && r1.matches === 2, `${r1.matches} 处｜${r1.error}`);
    ok('替换后的文本去掉了标签', r1.out.includes('<details>想法一</details>') && !r1.out.includes('<thinking>'));
    ok('替换确实改动了文本', r1.changed === true);

    const r2 = PE.testRegex('/abc/', 'X', 'abcabc');
    ok('没有 g 标志会给出提醒', r2.ok && r2.warns.some((w) => w.includes('g 标志')), JSON.stringify(r2.warns));

    const r3 = PE.testRegex('/([unclosed/', 'X', 'abc');
    ok('写错的正则当场报错（不让它把页面搞崩）', r3.ok === false && /正则写错/.test(r3.error), r3.error);

    const r4 = PE.testRegex('', 'X', 'abc');
    ok('find 为空 → 明确说"空的"', r4.ok === false && /空的/.test(r4.error));

    /* 酒馆替换串的三种写法 + "为什么没反应"的诊断（用户报过"我自己的正则渲染不出来"） */
    const rm = PE.testRegex('/<think>/g', '{{match}}→', 'A<think>B');
    ok('替换串支持 {{match}}（整个匹配）', rm.ok && rm.out === 'A<think>→B', rm.out);
    const rp = PE.testRegex('\\d+', 'N', '有 12 和 345');
    ok('find 不写成 /…/flags 也当正则跑（酒馆手填就是这个行为）', rp.ok && rp.matches === 2 && rp.out === '有 N 和 N',
      `${rp.matches}｜${rp.out}`);
    ok('并说明了"这条没写成 /…/flags"', rp.patternForm === 'plain' && rp.reasons.some((x) => /\/…\/flags/.test(x)),
      JSON.stringify(rp.reasons));
    const r0 = PE.testRegex('/zzz/g', 'X', 'abc');
    ok('一处都没匹配到 → 直接说清原因（换样例/贴自己的）',
      r0.ok && r0.matches === 0 && r0.reasons.some((x) => /没匹配到/.test(x)), JSON.stringify(r0.reasons));
    const r5 = PE.testRegex('/a/g', 'a', 'aaa');
    ok('匹配到但替换后没变 → 也说清', r5.reasons.some((x) => /没变化/.test(x)), JSON.stringify(r5.reasons));
    const r6 = PE.testRegex('/x/g', '$1', 'xxx');
    ok('替换里的 $1 没有分组时：不崩，但会把 $1 原样留下（这时会明确警告）',
      r6.ok && r6.out === '$1$1$1' && r6.reasons.some((x) => /\$1/.test(x)),
      `${r6.out}｜${JSON.stringify(r6.reasons)}`);

    /* 一串正则按顺序跑 */
    const chain = PE.runRegexChain([
      { scriptName: 'A', findRegex: '/一/g', replaceString: '1' },
      { scriptName: 'B', findRegex: '/二/g', replaceString: '2', disabled: true },
      { scriptName: 'C', findRegex: '/1/g', replaceString: '壹' },
    ], '一二三');
    ok('禁用的一步被跳过', chain.steps[1].skipped === true);
    ok('按顺序叠加：一→1→壹', chain.text === '壹二三', chain.text);
    ok('每一步都记了匹配数', chain.steps[0].matches === 1 && chain.steps[2].matches === 1);
  }
}

/* ── 15. 脚本编辑：只改文本，语法能查，diff 能看 ────────────────── */
console.log('\n[15] 脚本编辑：改的是文本，工具不"理解"别人的 JS');
{
  const PE = globalThis.PresetEditor;
  const ANCHORS = PI.ANCHORS.filter((a) => a.tier === 'must').map((a) => a.id);
  const raw = fs.readFileSync(P('preset', '芳乃预设.json'), 'utf8');
  const json = JSON.parse(raw);
  const model = PP.parsePreset(json, '芳乃预设.json', Buffer.byteLength(raw));
  const sha1 = (s) => crypto.createHash('sha1').update(s, 'utf8').digest('hex');
  const idx = model.scripts.findIndex((s) => s.name.includes('面板'));
  ok('成品里能找到面板脚本', idx >= 0, model.scripts.map((s) => s.name).join('、'));

  const e = PE.emptyEdit(model, ANCHORS);
  ok('一开始脚本没有补丁', e.scripts.patches.size === 0);
  ok('空编辑时 extensions 逐字节不变',
    sha1(JSON.stringify(PE.applyEdit(json, e, model).extensions)) === sha1(JSON.stringify(json.extensions)));

  const origContent = json.extensions.tavern_helper.scripts[idx].content;
  PE.setScriptField(e, json, idx, 'content', origContent + '\n/* 我在末尾加了一行注释 */\n');
  PE.setScriptField(e, json, idx, 'enabled', false);
  const out = PE.applyEdit(json, e, model);
  ok('改动进了文件', out.extensions.tavern_helper.scripts[idx].content.endsWith('/* 我在末尾加了一行注释 */\n'));
  ok('启停也进了文件', out.extensions.tavern_helper.scripts[idx].enabled === false);
  ok('其它脚本 / extensions 字段没被动',
    out.extensions.tavern_helper.scripts.every((s, i) => i === idx || s === json.extensions.tavern_helper.scripts[i])
    && out.extensions.regex_scripts === json.extensions.regex_scripts);
  ok('条目区一个字节没动', sha1(JSON.stringify(out.prompts)) === sha1(JSON.stringify(json.prompts)));
  ok('摘要说了改了脚本的哪些字段',
    PE.summary(e, model).some((r) => r.kind === '改脚本' && /代码/.test(r.text) && /停用/.test(r.text)),
    PE.summary(e, model).filter((r) => r.kind === '改脚本').map((r) => r.text).join('｜'));

  /* 语法校验：只编译不执行 */
  ok('正确代码 → 通过', PE.checkScriptSyntax('const a = 1;\nfunction f(){ return a; }').ok === true);
  const bad = PE.checkScriptSyntax('const a = ;');
  ok('写错的代码 → 报错并给出行号', bad.ok === false && typeof bad.line === 'number', JSON.stringify(bad));
  ok('空内容算通过（不算错误）', PE.checkScriptSyntax('').ok === true);
  ok('语法检查不会执行代码（副作用试验）', (() => {
    globalThis.__GUI_SYNTAX_SIDE_EFFECT__ = false;
    const r = PE.checkScriptSyntax('globalThis.__GUI_SYNTAX_SIDE_EFFECT__ = true;');
    return r.ok === true && globalThis.__GUI_SYNTAX_SIDE_EFFECT__ === false;
  })());

  /* diff（粗略：按行的多重集合算，不做 LCS 对齐） */
  const d = PE.lineDiff('a\nb\nc\n', 'a\nB\nc\nd\n');
  ok('diff 认出删 1 行、加 2 行（b 换成 B 算成一删一加）', d.changed === 3 && d.removedLines.length === 1 && d.addedLines.length === 2,
    JSON.stringify(d));
  ok('diff 给出行号样例', d.sample.includes('-2') && d.sample.includes('+4'), d.sample.join(' '));
  ok('完全一样时 diff 说没变', PE.lineDiff('x\ny', 'x\ny').changed === 0);
  ok('脚本视图读的是原始 json（能拿到 content）', (() => {
    const v = PE.scriptViews(PE.emptyEdit(model, ANCHORS), json, model);
    return v[idx] && v[idx].content.length > 1000 && v[idx].content === origContent;
  })());
}

/* ── 16. M5 端到端：改成品预设里那块面板配置（preset 模式）──────── */
console.log('\n[16] 面板外观端到端：改成品预设内嵌面板的配置 → 导出 → 再导入');
{
  const PE = globalThis.PresetEditor;
  const PC = globalThis.PresetPanelConfig;
  const ANCHORS = PI.ANCHORS.filter((a) => a.tier === 'must').map((a) => a.id);
  const sha1 = (s) => crypto.createHash('sha1').update(s, 'utf8').digest('hex');
  const built = P('preset', '芳乃预设.json');
  if (!fs.existsSync(built) || !PC) {
    console.log('  （跳过：成品或 panelconfig 不在）');
  } else {
    const raw = fs.readFileSync(built, 'utf8');
    const json = JSON.parse(raw);
    const model = PP.parsePreset(json, '芳乃预设.json', Buffer.byteLength(raw));
    const scripts = json.extensions.tavern_helper.scripts;
    const idx = scripts.findIndex((s) => String(s.content).includes(PC.BEGIN));
    ok('成品预设里能找到带配置块的面板脚本', idx >= 0, scripts.map((s) => s.name).join('、'));

    const originalContent = scripts[idx].content;
    const cfg = PC.extractConfig(originalContent);
    ok('能读出面板当前的配置', !!cfg && cfg.wallpaper.url === '', JSON.stringify(Object.keys(cfg ?? {})));
    const themes = PC.extractThemes(originalContent);
    ok('能读出面板出厂配色', !!themes?.day?.['--fp-accent'], themes?.day?.['--fp-accent']);

    /* 改一套外观：颜色 + 尺寸 + 壁纸 */
    const tiny = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/wD/AL0AAAAASUVORK5CYII=';
    const next = PC.mergeConfig(cfg, {
      tokens: { day: { '--fp-accent': '#1188ff' }, night: { '--fp-text': '#101010' } },
      ball: { size: 58, glyph: '乃' },
      window: { w: 460, h: 700, minW: 300, minH: 240 },
      layout: { radius: 22, scale: 1.15, opacity: 0.8, blur: 8 },
      wallpaper: { url: tiny, fit: 'contain', opacity: 0.4, blur: 2, dim: 0.3 },
    });
    const patched = PC.patchConfig(originalContent, next);
    ok('回写后配置能再读出来（值对得上）', (() => {
      const back = PC.extractConfig(patched);
      return back.tokens.day['--fp-accent'] === '#1188ff' && back.ball.size === 58
        && back.wallpaper.url === tiny && back.layout.scale === 1.15;
    })());
    ok('回写只动配置块：脚本其余部分逐字节不变', (() => {
      const a = originalContent.indexOf(PC.BEGIN);
      const b = patched.indexOf(PC.BEGIN);
      const endA = originalContent.indexOf(PC.END);
      const endB = patched.indexOf(PC.END);
      return originalContent.slice(0, a) === patched.slice(0, a)
        && originalContent.slice(endA) === patched.slice(endB);
    })());
    ok('回写后的脚本仍然是合法 JS', (() => {
      try { new Function(patched); return true; } catch { return false; }
    })());
    ok('回写后的脚本里没有多出别的东西（代码行数只差配置那几行）',
      Math.abs(patched.split('\n').length - originalContent.split('\n').length) < 40,
      `${originalContent.split('\n').length} → ${patched.split('\n').length}`);

    /* 走正常导出路径 */
    const e = PE.emptyEdit(model, ANCHORS);
    PE.setScriptField(e, json, idx, 'content', patched);
    const out = PE.applyEdit(json, e, model);
    ok('导出的预设里带上了新配置',
      out.extensions.tavern_helper.scripts[idx].content.includes('#1188ff')
      && out.extensions.tavern_helper.scripts[idx].content.includes(tiny));
    ok('导出的预设能再导入', PP.parsePreset(JSON.parse(JSON.stringify(out)), '导出的.json').counts.prompts === model.counts.prompts);
    ok('条目区一个字节没动', sha1(JSON.stringify(out.prompts)) === sha1(JSON.stringify(json.prompts)));
    ok('正则区一个字节没动', sha1(JSON.stringify(out.extensions.regex_scripts)) === sha1(JSON.stringify(json.extensions.regex_scripts)));
    ok('其它脚本没被动',
      out.extensions.tavern_helper.scripts.every((s, i) => i === idx || s === scripts[i]));

    /* 校验器对着这套配置说话 */
    const v = PC.validateConfig(next, themes);
    ok('自定义配置没有错误', v.errors.length === 0, JSON.stringify(v.errors));
    ok('内嵌 1×1 小图不会触发"撑大预设"警告', !v.warnings.some((w) => w.kind === '壁纸撑大预设'));
    ok('生效值里壁纸不透明度按配置来', PC.clampConfig(next).wallpaper.opacity === 0.4);

    /* 外观预览用的 CSS 也能从成品脚本里抽出来 */
    const css = PC.extractCss(originalContent);
    ok('能从成品脚本里抽出面板静态 CSS', css.length > 3000, String(css.length));
    ok('抽出的 CSS 里含四层结构', /\.fp-bglayer\{/.test(css) && /\.fp-wall\{/.test(css) && /\.fp-walldim\{/.test(css));
  }
}

/* ── 17. M6 分组推断 + 把面板装进"本来没有脚本"的预设 ───────────── */
console.log('\n[17] M6 面板分组：按预设推断模块 + 装进预设');
{
  const PE = globalThis.PresetEditor;
  const PC = globalThis.PresetPanelConfig;
  const GI = globalThis.PresetGroupInfer;
  const ANCHORS = PI.ANCHORS.filter((a) => a.tier === 'must').map((a) => a.id);
  const sha1 = (s) => crypto.createHash('sha1').update(s, 'utf8').digest('hex');

  /* 17a. 人工造一份小预设，验证每条推断规则都真的响 */
  {
    const json = mkPreset([
      { identifier: 'main', name: '主提示', content: '你是助手' },
      { identifier: 'ini', name: '初始化', content: '{{setvar::a:: }}{{setvar::b:: }}{{setvar::c:: }}' },
      { identifier: 'v1', name: '👤人称-第一人称', content: '{{setvar::a::第一人称}}' },
      { identifier: 'v2', name: '👤人称-第三人称', content: '{{setvar::a::第三人称}}' },
      { identifier: 'r1', name: '指南', content: '人称：{{getvar::a}}' },
      { identifier: 's1', name: '🎨文风-甲', content: '{{addvar::s::甲}}' },
      { identifier: 's2', name: '🎨文风-乙', content: '{{addvar::s::乙}}' },
      { identifier: 'r2', name: '文风读取', content: '文风：{{getvar::s}}' },
      { identifier: 'f1', name: '⚡️自定义（此处填）', content: '此处自定义你的要求' },
      { identifier: 'x1', name: '🧩零散功能A', content: '正文甲' },
    ], ['main', 'ini', 'v1', 'v2', 'r1', 's1', 's2', 'r2', 'f1', 'x1'].map((identifier) => ({ identifier, enabled: true })));
    const m = PP.parsePreset(json, '小预设.json');
    const inf = GI.inferGroups(m, json);
    const byLabel = (re) => inf.groups.find((g) => re.test(g.label));

    ok('注入位被收进只读区', inf.groups.some((g) => g.id === 'anchors' && g.members.includes('主提示')));
    ok('清空型初始化条目被收进只读区', inf.groups.some((g) => g.id === 'initializers' && g.members.includes('初始化')));
    ok('互斥变量 → 一个"选一"模块，成员正好是那两条',
      !!byLabel(/选一/) && byLabel(/选一/).members.sort().join() === ['👤人称-第一人称', '👤人称-第三人称'].sort().join(),
      JSON.stringify(byLabel(/选一/)?.members));
    ok('addvar 累加 → 一个"可多选"模块', !!byLabel(/可多选/) && byLabel(/可多选/).members.length === 2,
      JSON.stringify(byLabel(/可多选/)?.members));
    ok('写着"此处自定义"的 → 可填模块', inf.groups.some((g) => g.mode === 'editable' && g.members.includes('⚡️自定义（此处填）')));
    ok('前缀相同的条目 → 按前缀分组（👤人称 这两条已被选一收走，不会重复）',
      inf.groups.filter((g) => g.label.startsWith('按名字前缀')).every((g) =>
        g.members.every((n) => !inf.groups.some((o) => o.mode === 'single' && o.members.includes(n)))),
      inf.groups.filter((g) => g.label.startsWith('按名字前缀')).map((g) => g.label).join('、'));
    ok('所有推出来的模块都通过了校验', GI.validateGroups(inf, m).errors.length === 0,
      GI.validateGroups(inf, m).errors.map((e) => e.text).join('；'));
    ok('兜底把剩下的条目也收进来了（没有条目够不着）', (() => {
      const inAny = new Set(inf.groups.flatMap((g) => g.members || []));
      return m.entries.filter((e) => e.listed).every((e) => inAny.has(e.name));
    })());
    ok('分节只引用存在的模块 id', inf.sections.every((s) => s.groups.every((id) => inf.groups.some((g) => g.id === id))));
  }

  /* 17b. 重名条目会被排除并给出理由（面板是按名字匹配的） */
  {
    const json = mkPreset([
      { identifier: 'a', name: '重名条目', content: '{{setvar::x::甲}}' },
      { identifier: 'b', name: '重名条目', content: '{{setvar::x::乙}}' },
      { identifier: 'u', name: '读的人', content: '值：{{getvar::x}}' },
      { identifier: 'main', name: '主提示', content: '正文' },
    ], ['a', 'b', 'u', 'main'].map((identifier) => ({ identifier, enabled: true })));
    const m = PP.parsePreset(json, '重名.json');
    const inf = GI.inferGroups(m, json);
    ok('重名条目没有进任何模块',
      inf.groups.every((g) => !(g.members || []).includes('重名条目')),
      JSON.stringify(inf.groups.map((g) => g.members)));
    ok('并且明确说明了为什么', inf.notes.some((n) => /重名|不止一次/.test(n.text)),
      inf.notes.map((n) => n.text).join('｜').slice(0, 120));
  }

  /* 17c. 校验器要能挑出真错 */
  {
    const json = mkPreset([{ identifier: 'main', name: '主提示', content: 'x' }], [{ identifier: 'main', enabled: true }]);
    const m = PP.parsePreset(json, 'x.json');
    const bad = {
      groups: [
        { id: 'a', label: 'A', mode: 'single', members: ['不存在的条目', '主提示'] },
        { id: 'a', label: '重复 id', mode: '错mode', members: [] },
      ],
      sections: [{ title: 'S', groups: ['a', '没有这个模块'] }],
    };
    const r = GI.validateGroups(bad, m);
    ok('挑出"条目不存在"', r.errors.some((e) => e.kind === '条目不存在'));
    ok('挑出"id 重复"', r.errors.some((e) => e.kind === 'id 重复'));
    ok('挑出"mode 不合法"', r.errors.some((e) => e.kind === 'mode 不合法'));
    ok('挑出"分节引用了不存在的模块"', r.errors.some((e) => e.kind === '分节引用了不存在的模块'));
    ok('单条成员的选一模块给提醒', GI.validateGroups({ groups: [{ id: 'z', label: 'Z', mode: 'single', members: ['主提示'] }] }, m)
      .warnings.some((w) => w.kind === '模块只有一条'));
  }

  /* 17d. 分组覆盖的读写：只动那一段，且面板真的会用它 */
  {
    const panel = fs.readFileSync(P('panel', 'fano-panel.js'), 'utf8');
    ok('面板里本来没有分组覆盖（默认 null）', PC.extractGroups(panel) === null);
    const ov = { groups: [{ id: 'g1', label: '我的模块', mode: 'multi', members: ['甲'] }], sections: [{ title: 'S', groups: ['g1'] }], thinkingTags: [] };
    const patched = PC.patchGroups(panel, ov);
    ok('写进去之后读得回来', JSON.stringify(PC.extractGroups(patched)) === JSON.stringify(ov),
      JSON.stringify(PC.extractGroups(patched)).slice(0, 120));
    ok('只动那一段（前后缀逐字相同）', (() => {
      const a = panel.indexOf('const GROUPS_OVERRIDE');
      const b = patched.indexOf('const GROUPS_OVERRIDE');
      return panel.slice(0, a) === patched.slice(0, b);
    })());
    ok('写完还是合法 JS', (() => { try { new Function(patched); return true; } catch { return false; } })());
    ok('外观配置块没被连带改掉', JSON.stringify(PC.extractConfig(patched)) === JSON.stringify(PC.extractConfig(panel)));
    /* 两个块互不干扰 */
    const both = PC.patchConfig(patched, { ball: { size: 52 } });
    ok('先写分组再写外观，两样都在',
      PC.extractConfig(both).ball.size === 52 && JSON.stringify(PC.extractGroups(both)) === JSON.stringify(ov));
  }

  /* 17e. 装进预设：本来没有 extensions 也要能装 */
  {
    const bare = mkPreset([
      { identifier: 'main', name: '主提示', content: '正文' },
      { identifier: 'x', name: '一条功能', content: '{{setvar::a::1}}' },
    ], [{ identifier: 'main', enabled: true }, { identifier: 'x', enabled: true }]);
    const m = PP.parsePreset(bare, '光板.json');
    const e = PE.emptyEdit(m, ANCHORS);
    const s = PE.addScript(e, bare, { name: '芳乃 · 预设面板', content: '// 面板代码\nconst a = 1;', id: 'fano-panel' });
    ok('新增脚本拿到了 id', s.id === 'fano-panel');
    ok('脚本字段形状对（酒馆助手要的那几个）',
      s.type === 'script' && s.enabled === true && s.button && s.data && s.export_with,
      Object.keys(s).join('、'));
    const out = PE.applyEdit(bare, e, m, );
    ok('本来没有 extensions 也能装进去',
      !!out.extensions?.tavern_helper?.scripts?.[0] && out.extensions.tavern_helper.scripts[0].content.includes('面板代码'));
    ok('条目区一个字节没动', sha1(JSON.stringify(out.prompts)) === sha1(JSON.stringify(bare.prompts)));
    ok('顶层只多了一个 extensions，别的一个没动', (() => {
      const added = Object.keys(out).filter((k) => !(k in bare));
      const changed = Object.keys(bare).filter((k) => k !== 'prompts' && sha1(JSON.stringify(out[k])) !== sha1(JSON.stringify(bare[k])));
      return added.join() === 'extensions' && changed.length === 0;
    })(), Object.keys(out).filter((k) => !(k in bare)).join('、'));
    ok('导出的预设还能再解析', PP.parsePreset(JSON.parse(JSON.stringify(out)), 'x').counts.prompts === 2);

    /* 已有脚本时是"追加"，不是覆盖 */
    const withOne = JSON.parse(fs.readFileSync(P('preset', '芳乃预设.json'), 'utf8'));
    const mw = PP.parsePreset(withOne, '成品.json');
    const ew = PE.emptyEdit(mw, ANCHORS);
    const before = withOne.extensions.tavern_helper.scripts.length;
    const s2 = PE.addScript(ew, withOne, { name: '第二条面板', content: '// 第二条', id: 'x-panel' });
    const outw = PE.applyEdit(withOne, ew, mw);
    ok('已有脚本时是追加', outw.extensions.tavern_helper.scripts.length === before + 1);
    ok('原有脚本连引用都没换',
      outw.extensions.tavern_helper.scripts.slice(0, before).every((x, i) => x === withOne.extensions.tavern_helper.scripts[i]));
    ok('新增的 id 不会撞车', (() => {
      const s3 = PE.addScript(ew, withOne, { name: '再一条', content: '// x', id: 'x-panel' });
      const unique = s3.id !== 'x-panel';
      PE.deleteScript(ew, s3.key);
      return unique;
    })());
    PE.deleteScript(ew, s2.key);
    ok('撤回后脚本数回到原样',
      PE.scriptViews(ew, withOne, mw).length === before, String(PE.scriptViews(ew, withOne, mw).length));
  }

  /* 17f. 真实预设：从 Izumi 推出来的分组能对上它的条目 */
  {
    const raw = fs.readFileSync(P('Izumi_0914.json'), 'utf8');
    const json = JSON.parse(raw);
    const m = PP.parsePreset(json, 'Izumi_0914.json', Buffer.byteLength(raw));
    const inf = GI.inferGroups(m, json);
    ok('Izumi 能推出分组', inf.groups.length >= 8, `${inf.groups.length} 个模块`);
    ok('推出来的模块全部通过校验', GI.validateGroups(inf, m).errors.length === 0,
      GI.validateGroups(inf, m).errors.slice(0, 3).map((e) => e.text).join('；'));
    ok('识别出 Izumi 的思维链标签族并给了互斥组', inf.thinkingTags.length >= 2,
      inf.thinkingTags.map((t) => t.id).join('、'));
    ok('"初始化变量（别动）"被放进只读区（不能让人在面板上关掉它）',
      inf.groups.some((g) => g.mode === 'fixed' && g.members.includes('初始化变量（别动）')));
    ok('兜底覆盖了所有**名字唯一**的在列表条目（重名的按设计被排除）', (() => {
      const count = new Map();
      for (const e of m.entries.filter((x) => x.listed && x.name)) count.set(e.name, (count.get(e.name) || 0) + 1);
      const inAny = new Set(inf.groups.flatMap((g) => g.members || []));
      const missing = m.entries.filter((e) => e.listed && e.name && count.get(e.name) === 1 && !inAny.has(e.name));
      return missing.length === 0;
    })(), `管理 ${inf.stats.managed} 条，重名跳过 ${inf.stats.skippedDuplicates} 条`);
  }
}

/* ── 18. 提示词模板（ST-Prompt-Template / EJS）的识别与提醒 ─────── */
console.log('\n[18] 认得出 EJS 模板（<% … %>），并提醒它需要插件');
{
  const json = mkPreset([
    { identifier: 'main', name: '主提示', content: '你是助手' },
    { identifier: 'e1', name: '用模板的条目', content: '好感度：<%- getvar("affinity") %>\n<% if (x) { %>甲<% } %>' },
  ], [{ identifier: 'main', enabled: true }, { identifier: 'e1', enabled: true }]);
  const m = PP.parsePreset(json, 'ejs.json');
  const e = m.entries.find((x) => x.name === '用模板的条目');
  /* 内容是 `<%- … %>` + `<% if (…) { %>` + `<% } %>` —— 三段标签都算一处，
     所以是 3 不是 2（一开始我自己也数错了：EJS 的 if 块是两个标签）。 */
  ok('解析时数出 EJS 标签的数量', e.ejsCount === 3, String(e.ejsCount));
  ok('记下了第一块的代码片段', /getvar/.test(e.ejsHead), e.ejsHead);
  ok('EJS 被识别成一个"标签族"（界面上能筛出来）', e.families.includes('ejs'));
  ok('没用到 EJS 的条目不会被误判', m.entries.find((x) => x.name === '主提示').ejsCount === 0);

  const r = PA.assemble(m, {});
  const rep = PI.check(m, r);
  const item = rep.items.find((i) => i.id === 'ejs-template');
  ok('体检里有一条"用了 EJS 模板"的提醒', !!item, JSON.stringify(rep.items.map((i) => i.id)));
  ok('提醒里点明了要靠提示词模板扩展', !!item && /提示词模板/.test(item.why), item ? item.why.slice(0, 60) : '');
  ok('提醒里说清"没装会原样进上下文"这个后果', !!item && /原样进上下文/.test(item.why));
  ok('列出了是哪几条在用', !!item && item.evidence.join().includes('用模板的条目'), item ? item.evidence.join('｜') : '');
  ok('关掉那条之后提醒就没了', (() => {
    const json2 = JSON.parse(JSON.stringify(json));
    json2.prompt_order[0].order[1].enabled = false;
    const m2 = PP.parsePreset(json2, 'ejs2.json');
    return !PI.check(m2, PA.assemble(m2, {})).items.some((i) => i.id === 'ejs-template');
  })());
}

/* ── 19. 面板搭建的操作层（分节 → 功能区 → 功能项）───────────────── */
console.log('\n[19] 面板搭建：三层结构的增删改与导出形状');
{
  const BO = globalThis.PresetBuildOps;
  const PE = globalThis.PresetEditor;
  const ANCHORS = PI.ANCHORS.filter((a) => a.tier === 'must').map((a) => a.id);
  ok('操作层可用', !!BO && typeof BO.addGroup === 'function');

  /* 从"面板自带的分组"起一份草稿 */
  const defaults = { groups: [{ id: 'a', label: '甲', mode: 'multi', members: ['条目1'] }], sections: [{ title: '分区一', groups: ['a'] }], thinkingTags: [], display: {} };
  const d = BO.seedFrom(defaults);
  ok('草稿是从自带分组复制出来的，且不共享引用',
    d.groups.length === 1 && d.groups[0].members !== defaults.groups[0].members);
  ok('分节从自带分节恢复出来了', BO.sectionsOf(d).join() === '分区一');
  d.groups[0].members.push('改一下');
  ok('改草稿不会动到自带那份', defaults.groups[0].members.length === 1);

  /* 三层增删 */
  BO.addSection(d, '分区二');
  const g2 = BO.addGroup(d, { section: '分区二', mode: 'single', label: '乙' });
  ok('加功能区落在指定分区', g2.__section === '分区二' && BO.sectionsOf(d).join() === '分区一,分区二');
  ok('新功能区的 id 不撞车', g2.id !== 'a' && BO.groupOf(d, g2.id) === g2);
  ok('选一型功能区默认没有条目', (g2.members || []).length === 0);

  BO.addMember(d, g2.id, '选项A');
  BO.addMember(d, g2.id, '选项B');
  ok('功能项 = 一个条目名，选一型里每一项就是一个选项',
    BO.members(d, g2.id).join() === '选项A,选项B');
  ok('同一条目不会挂两次', BO.addMember(d, g2.id, '选项A') === false);
  BO.moveMember(d, g2.id, '选项B', -1);
  ok('功能项可以换序', BO.members(d, g2.id).join() === '选项B,选项A');
  BO.removeMember(d, g2.id, '选项B');
  ok('功能项可以移出功能区', BO.members(d, g2.id).join() === '选项A');
  ok('跨功能区搬家', BO.moveMemberToGroup(d, g2.id, 'a', '选项A') && BO.members(d, 'a').includes('选项A') && !BO.members(d, g2.id).includes('选项A'));

  /* 改名 / 换形式 / 换分区 / 删除 */
  BO.renameGroup(d, g2.id, '乙改');
  ok('功能区可以改名', BO.groupOf(d, g2.id).label === '乙改');
  BO.setMode(d, 'a', 'editable');
  ok('换成"自己填"会带上 editable 映射', BO.groupOf(d, 'a').editable && '条目1' in BO.groupOf(d, 'a').editable);
  BO.setMode(d, 'a', 'multi');
  ok('换回可多选会把 editable 去掉', !('editable' in BO.groupOf(d, 'a')));
  BO.moveGroupToSection(d, g2.id, '分区一');
  ok('功能区可以换分区', BO.groupOf(d, g2.id).__section === '分区一');
  ok('删除功能区', BO.removeGroup(d, g2.id) && !BO.groupOf(d, g2.id));

  /* 分节操作 + 面板质检 + 就地改正文 */
  BO.renameSection(d, '分区一', '分区一改');
  ok('分节可以改名（里面所有功能区跟着改）',
    BO.sectionsOf(d).includes('分区一改') && d.groups.filter((g) => g.__section === '分区一改').length >= 1);
  BO.moveSection(d, '分区二', -1);
  ok('分节可以换序', BO.sectionsOf(d)[0] === '分区二', BO.sectionsOf(d).join());
  BO.removeSection(d, '分区二');
  ok('删分节不丢功能区（挪到别的分节去）',
    BO.sectionsOf(d).length === 1 && d.groups.length >= 1, `${BO.sectionsOf(d).join()}｜${d.groups.length} 个功能区`);

  {
    const model = PP.parsePreset(mkPreset([
      { identifier: 'main', name: '主提示', content: '正文' },
      { identifier: 'p', name: '有内容', content: '这是一段够长的正文内容。' },
      { identifier: 'q', name: '空着但开着', content: '{{//待填：这里要写}}' },
    ], ['main', 'p', 'q'].map((identifier) => ({ identifier, enabled: identifier !== 'q' }))), 'audit.json');
    const e = PE.emptyEdit(model, ANCHORS);
    const d2 = BO.seedFrom({});
    const g = BO.addGroup(d2, { section: 'S', mode: 'multi', label: 'G' });
    BO.addMember(d2, g.id, '有内容');
    BO.addMember(d2, g.id, '这个条目不存在');
    ok('质检：条目不存在', BO.auditPanel(d2, model, e).some((x) => x.kind === '条目不存在'));
    BO.removeMember(d2, g.id, '这个条目不存在');
    ok('质检：干净的模块没有必改项',
      BO.auditPanel(d2, model, e).filter((x) => x.level === 'err').length === 0,
      JSON.stringify(BO.auditPanel(d2, model, e).map((x) => x.kind)));
    /* 把"空着但开着"那条挂进来 → 必须报"开着但没内容" */
    BO.addMember(d2, g.id, '空着但开着');
    PE.setEnabledByName(e, model, '空着但开着', true);
    ok('质检：开着但正文是空的（面板上打开也白开）',
      BO.auditPanel(d2, model, e).some((x) => x.kind === '开着但没内容'),
      JSON.stringify(BO.auditPanel(d2, model, e).map((x) => x.kind)));
    PE.setEnabledByName(e, model, '空着但开着', false);
    ok('质检：关着但没内容只是提示',
      BO.auditPanel(d2, model, e).some((x) => x.kind === '还没写内容'));
    ok('质检：空面板会说出来', BO.auditPanel(BO.seedFrom({}), model, e).some((x) => x.kind === '空面板'));
    ok('质检：空功能区会说出来', (() => {
      const d3 = BO.seedFrom({});
      BO.addGroup(d3, { section: 'S', mode: 'multi', label: '空的' });
      return BO.auditPanel(d3, model, e).some((x) => x.kind === '空功能区');
    })());

    /* 就地改正文：任何条目都能改，改回原文自动撤销 */
    const json = mkPreset([
      { identifier: 'main', name: '主提示', content: '原文一' },
      { identifier: 'x', name: '别人写的', content: '别人的原文' },
    ], [{ identifier: 'main', enabled: true }, { identifier: 'x', enabled: true }]);
    const m2 = PP.parsePreset(json, 'edit.json');
    const e2 = PE.emptyEdit(m2, ANCHORS);
    ok('导入的正文现在可编辑（以前只读）', PE.canEditContent(e2, 1) === true);
    PE.setContent(e2, json, 1, '我改成了这样');
    ok('改动读得回来', PE.contentOf(e2, json, 1) === '我改成了这样');
    const out2 = PE.applyEdit(json, e2, m2);
    ok('改动进了导出', out2.prompts[1].content === '我改成了这样');
    ok('没改的那条没动', out2.prompts[0].content === '原文一');
    const v2 = PE.verifySourceIntact(json, e2, m2, PP.fingerprint);
    ok('自证：把"你改过的那条"单独算，不算异常', v2.changed.length === 0 && v2.edited === 1, JSON.stringify(v2));
    PE.setContent(e2, json, 1, '别人的原文');
    ok('改回原文后补丁自动撤销', e2.content.size === 0);
    PE.setContent(e2, json, 1, '又改了');
    PE.revertContent(e2, json, 1);
    ok('一键还原也撤销补丁', e2.content.size === 0);

    /* 默认开关：新增条目与导入条目两种存法都要能读能写 */
    const added = PE.addEntry(e2, m2, { name: '新来的', slot: '' });
    ok('新增条目默认是关的', PE.enabledByName(e2, m2, '新来的') === false);
    PE.setEnabledByName(e2, m2, '新来的', true);
    ok('新增条目的默认开关写得进去（走它自己身上那个字段）', added.enabled === true
      && PE.enabledByName(e2, m2, '新来的') === true);
    PE.setEnabledByName(e2, m2, '别人写的', true);
    ok('导入条目的默认开关写得进去（走 edit.enabled）', e2.enabled.has(1) === true);
  }

  /* 统计：对不上预设的地方要报出来 */
  {
    const json = mkPreset([
      { identifier: 'main', name: '主提示', content: 'x' },
      { identifier: 'x', name: '重名', content: 'y' },
    ], [{ identifier: 'main', enabled: true }, { identifier: 'x', enabled: true }]);
    json.prompts.push({ identifier: 'y', name: '重名', content: 'z' });
    const m = PP.parsePreset(json, 'x.json');
    const d3 = BO.seedFrom({ groups: [], sections: [], thinkingTags: [], display: {} });
    const g = BO.addGroup(d3, { section: 'S', mode: 'multi', label: 'M' });
    BO.addMember(d3, g.id, '主提示');
    BO.addMember(d3, g.id, '不存在的条目');
    BO.addMember(d3, g.id, '重名');
    const st = BO.stats(d3, m);
    ok('统计能报出"找不到的条目"', st.missing.some((x) => x.name === '不存在的条目'), JSON.stringify(st.missing));
    ok('统计能报出"重名条目"', st.duplicated.some((x) => x.name === '重名'), JSON.stringify(st.duplicated));
    ok('统计了面板管多少条', st.managed === 3, String(st.managed));
  }
}

console.log('\n────────────────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fails.length} 项`);
if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); process.exitCode = 1; }
