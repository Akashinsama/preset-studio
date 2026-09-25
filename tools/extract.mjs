#!/usr/bin/env node
/**
 * 阶段1 抽取工具（只读）
 *
 * 读三份酒馆预设，产出：
 *   inventory/entries.json    条目清单（含启用状态、槽位、顺序、正文长度、内容指纹）
 *   inventory/variables.json  变量总线（谁 set、谁 get、有没有悬空引用）
 *   inventory/regex.json      正则脚本清单
 *   inventory/scripts.json    酒馆助手脚本清单（面板/管线）
 *   inventory/macros.json     自定义宏与外部依赖检测
 *   inventory/00-conflicts.md 人类可读的冲突报告（槽位占用 / 变量撞名 / 悬空引用）
 *
 * 不修改任何原始预设文件。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'inventory');
fs.mkdirSync(OUT, { recursive: true });

const PRESETS = [
  'Izumi_0914.json',
  'Kemini_Dramatron_v3.1.json',
  '梦鲸思客V4-0915.json',
];

/** ST 内置提示词标识：全局唯一，一个预设里只能有一份。 */
const SINGLETONS = new Set([
  'main', 'nsfw', 'jailbreak', 'chatHistory', 'dialogueExamples',
  'charDescription', 'charPersonality', 'worldInfoBefore', 'worldInfoAfter',
  'personaDescription', 'scenario', 'enhanceDefinitions',
  'agentSystemPrompt', 'agentTask', 'agentResults',
]);

/** ST 原生宏 / 控制语法白名单。不在此列的 {{...}} 视为外部依赖（插件提供）。 */
const NATIVE_MACROS = new Set([
  'user', 'char', 'description', 'personality', 'scenario', 'persona', 'time',
  'date', 'weekday', 'isotime', 'isodate', 'input', 'lastMessage', 'lastUserMessage',
  'lastCharMessage', 'firstMessage', 'original', 'model', 'maxPrompt', 'maxContext',
  'maxResponse', 'mesExamples', 'mesExamplesRaw', 'jailbreak', 'charPrompt',
  'charInstruction', 'charFirstMessage', 'systemPrompt', 'main', 'nsfw',
  'chatHistory', 'dialogueExamples', 'summary', 'personaDescription',
  'charDescription', 'charPersonality', 'worldInfoBefore', 'worldInfoAfter',
  'scenario', 'enhanceDefinitions', 'bias', 'group', 'groupNotMuted',
  'notChar', 'random', 'pick', 'roll', 'trim', 'noop', 'newline', 'space',
  'reverse', '//', 'comment', 'else', 'if', 'banned', 'idle_duration',
  'lastUserMessage', 'allChatRange', 'agentSystemPrompt', 'agentTask', 'agentResults',
  // ST 变量族（原生宏，与 setvar/getvar 同批引入）
  'addvar', 'setglobalvar', 'getglobalvar', 'incvar', 'decvar', 'deletevar',
  'incglobalvar', 'decglobalvar', 'hasvar', 'hasglobalvar', 'addglobalvar',
  'deleteglobalvar', 'newline', 'space', 'noop', 'pick', 'roll',
]);

const sha = (s) => crypto.createHash('sha1').update(s ?? '', 'utf8').digest('hex').slice(0, 12);
const chars = (s) => (s ? [...s].length : 0);
const oneLine = (s, n = 70) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

function load(file) {
  const raw = fs.readFileSync(path.join(ROOT, file), 'utf8');
  return { raw, json: JSON.parse(raw) };
}

/** 从条目正文里抽变量与宏引用。 */
function scanContent(content) {
  const sets = [];
  const gets = [];
  const macros = new Set();
  if (!content) return { sets, gets, macros: [] };

  for (const m of content.matchAll(/\{\{setvar::([A-Za-z0-9_\u4e00-\u9fff]+)::/g)) sets.push(m[1]);
  for (const m of content.matchAll(/\{\{getvar::([A-Za-z0-9_\u4e00-\u9fff]+)\}\}/g)) gets.push(m[1]);
  for (const m of content.matchAll(/\{\{([^:{}]{1,40}?)(?:::|\}\})/g)) {
    const name = m[1].trim();
    if (!name) continue;
    // {{// 注释 }} 是 ST 原生注释语法，不是宏
    if (name.startsWith('//')) continue;
    // 变量语法已单独处理
    if (name === 'setvar' || name === 'getvar') continue;
    if (!NATIVE_MACROS.has(name)) macros.add(name);
  }
  return { sets, gets, macros: [...macros] };
}

const entriesByPreset = {};
const varsByPreset = {};
const regexByPreset = {};
const scriptsByPreset = {};
const macrosByPreset = {};

for (const file of PRESETS) {
  const { json } = load(file);
  const key = file.replace(/\.json$/i, '');

  // prompt_order：identifier -> { enabled, index }
  const order = new Map();
  for (const po of json.prompt_order ?? []) {
    for (const [i, item] of (po.order ?? []).entries()) {
      order.set(item.identifier, { enabled: !!item.enabled, index: i });
    }
  }

  const entries = [];
  const vars = new Map();   // name -> { setBy:Set, getBy:Set, sample:'' }
  const macros = new Map(); // name -> { usedBy:Set }

  for (const [i, p] of (json.prompts ?? []).entries()) {
    const o = order.get(p.identifier);
    const content = p.content ?? '';
    const { sets, gets, macros: macs } = scanContent(content);

    for (const v of sets) {
      if (!vars.has(v)) vars.set(v, { setBy: new Set(), getBy: new Set(), sample: '' });
      vars.get(v).setBy.add(p.name || p.identifier);
      if (!vars.get(v).sample && content) vars.get(v).sample = oneLine(content, 90);
    }
    for (const v of gets) {
      if (!vars.has(v)) vars.set(v, { setBy: new Set(), getBy: new Set(), sample: '' });
      vars.get(v).getBy.add(p.name || p.identifier);
    }
    for (const m of macs) {
      if (!macros.has(m)) macros.set(m, { usedBy: new Set() });
      macros.get(m).usedBy.add(p.name || p.identifier);
    }

    entries.push({
      idx: i,
      name: p.name ?? '',
      identifier: p.identifier,
      builtin: SINGLETONS.has(p.identifier),
      role: p.role,
      systemPrompt: !!p.system_prompt,
      injectionPosition: p.injection_position ?? 0,
      injectionDepth: p.injection_depth ?? null,
      injectionTrigger: p.injection_trigger ?? [],
      listed: order.has(p.identifier),
      enabled: o ? o.enabled : null,
      orderIndex: o ? o.index : null,
      contentChars: chars(content),
      sha: sha(content),
      head: oneLine(content, 90),
      sets,
      gets,
    });
  }

  const regexes = (json.extensions?.regex_scripts ?? []).map((r) => ({
    name: r.scriptName,
    disabled: !!r.disabled,
    placement: r.placement,
    markdownOnly: !!r.markdownOnly,
    promptOnly: !!r.promptOnly,
    runOnEdit: !!r.runOnEdit,
    findChars: chars(r.findRegex),
    replaceChars: chars(r.replaceString),
  }));

  const scripts = (json.extensions?.tavern_helper?.scripts ?? []).map((s) => ({
    name: s.name,
    enabled: !!s.enabled,
    type: s.type,
    contentChars: chars(s.content),
    hasData: !!s.data && Object.keys(s.data ?? {}).length > 0,
    buttons: (s.button?.buttons ?? []).map((b) => b.name),
    dataGroups: (s.data?.groups ?? []).map((g) => g.label ?? g.id),
  }));

  entriesByPreset[key] = entries;
  varsByPreset[key] = Object.fromEntries(
    [...vars.entries()].map(([name, v]) => [name, {
      setBy: [...v.setBy],
      getBy: [...v.getBy],
      sample: v.sample,
      defined: v.setBy.size > 0,
    }]),
  );
  regexByPreset[key] = regexes;
  scriptsByPreset[key] = scripts;
  macrosByPreset[key] = Object.fromEntries(
    [...macros.entries()].map(([name, v]) => [name, { usedBy: [...v.usedBy] }]),
  );
}

/* ── 写清单 ─────────────────────────────────────────────────────────── */
const dump = (name, data) => {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(data, null, 2), 'utf8');
  return `${name} (${(fs.statSync(path.join(OUT, name)).size / 1024).toFixed(1)} KB)`;
};
const written = [
  dump('entries.json', entriesByPreset),
  dump('variables.json', varsByPreset),
  dump('regex.json', regexByPreset),
  dump('scripts.json', scriptsByPreset),
  dump('macros.json', macrosByPreset),
];

/* ── 冲突报告 ───────────────────────────────────────────────────────── */
const keys = Object.keys(entriesByPreset);
const L = [];
const h = (s) => L.push(`\n## ${s}\n`);
const row = (cells) => L.push(`| ${cells.join(' | ')} |`);

L.push('# 冲突报告（阶段1 自动生成，只读原文件）');
L.push('');
L.push(`生成时间：${new Date().toISOString()}`);
L.push('');
L.push('## 总览');
L.push('');
row(['预设', '条目', '启用', '启用正文', '关闭正文', '正则', '助手脚本', '脚本体积']);
row(['---', '---', '---', '---', '---', '---', '---', '---']);
for (const k of keys) {
  const es = entriesByPreset[k];
  const on = es.filter((e) => e.enabled).reduce((a, e) => a + e.contentChars, 0);
  const off = es.filter((e) => !e.enabled && e.listed).reduce((a, e) => a + e.contentChars, 0);
  const sc = scriptsByPreset[k];
  row([
    k,
    es.length,
    es.filter((e) => e.enabled).length,
    on,
    off,
    regexByPreset[k].length,
    sc.length,
    `${(sc.reduce((a, s) => a + s.contentChars, 0) / 1024).toFixed(0)} KB`,
  ]);
}

h('1. 单例槽位占用（一个预设里只能有一个主人）');
L.push('');
for (const id of SINGLETONS) {
  const hits = keys
    .map((k) => ({ k, e: entriesByPreset[k].find((x) => x.identifier === id) }))
    .filter((x) => x.e);
  if (!hits.length) continue;
  const inOrder = hits.filter((x) => x.e.listed);
  if (inOrder.length < 2) continue;
  L.push(`### \`${id}\` — 被 ${inOrder.length} 家占用`);
  L.push('');
  row(['预设', '条目名', '启用', '正文长度', '开头']);
  row(['---', '---', '---', '---', '---']);
  for (const { k, e } of inOrder) row([k, e.name, e.enabled, e.contentChars, `\`${e.head.slice(0, 50)}\``]);
  L.push('');
}

h('2. 变量撞名（同名被多个预设使用）');
L.push('');
const allVars = new Set(keys.flatMap((k) => Object.keys(varsByPreset[k])));
let collide = 0;
for (const v of [...allVars].sort()) {
  const users = keys.filter((k) => varsByPreset[k][v]);
  if (users.length < 2) continue;
  collide++;
  L.push(`### \`${v}\` — ${users.join(' / ')}`);
  L.push('');
  for (const k of users) {
    const d = varsByPreset[k][v];
    L.push(`- **${k}**：定义者 ${d.setBy.length ? d.setBy.join('、') : '（无，靠外部/面板）'}；引用者 ${d.getBy.length} 个`);
    if (d.sample) L.push(`  - 样例：\`${d.sample.slice(0, 80)}\``);
  }
  L.push('');
}
if (!collide) L.push('（无）');

h('3. 悬空 getvar（引用了本预设内没人 setvar 的变量）');
L.push('');
for (const k of keys) {
  const dangling = Object.entries(varsByPreset[k])
    .filter(([, d]) => !d.defined && d.getBy.length)
    .map(([n, d]) => `${n}(×${d.getBy.length})`);
  L.push(`- **${k}**：${dangling.length ? dangling.join('、') : '无'}`);
}

h('4. 外部宏依赖（非 ST 原生，靠插件提供）');
L.push('');
for (const k of keys) {
  const ms = Object.entries(macrosByPreset[k]).map(([n, d]) => `${n}(×${d.usedBy.length})`);
  L.push(`- **${k}**：${ms.length ? ms.join('、') : '无'}`);
}
L.push('');
L.push('> 命中的宏必须在酒馆助手等插件在场时才有值；缺失时该条目展开为空串。');

h('5. 条目重名');
L.push('');
const nameMap = new Map();
for (const k of keys) for (const e of entriesByPreset[k]) {
  if (!e.name) continue;
  if (!nameMap.has(e.name)) nameMap.set(e.name, new Set());
  nameMap.get(e.name).add(k);
}
const dupNames = [...nameMap.entries()].filter(([, s]) => s.size > 1);
row(['条目名', '出现在']);
row(['---', '---']);
for (const [n, s] of dupNames) row([`\`${n}\``, [...s].join(' / ')]);

h('6. 正则脚本总览（placement=2 为仅显示侧，promptOnly 为仅发送侧）');
L.push('');
for (const k of keys) {
  const rs = regexByPreset[k];
  const on = rs.filter((r) => !r.disabled);
  const sentOnly = on.filter((r) => r.promptOnly && !r.markdownOnly).length;
  const displayOnly = on.filter((r) => r.markdownOnly && !r.promptOnly).length;
  const bothSides = on.filter((r) => r.promptOnly && r.markdownOnly).length;
  const stored = on.filter((r) => !r.promptOnly && !r.markdownOnly).length;
  L.push(`- **${k}**：${rs.length} 条，启用 ${on.length}（仅改发送 ${sentOnly} / 仅改显示 ${displayOnly} / 两侧都改 ${bothSides} / 直接改消息体 ${stored}）`);
}

h('7. 酒馆助手脚本（面板/管线）');
L.push('');
for (const k of keys) {
  L.push(`### ${k}`);
  L.push('');
  row(['脚本', '启用', '体积', '带data', '按钮', 'data分组']);
  row(['---', '---', '---', '---', '---', '---']);
  for (const s of scriptsByPreset[k]) {
    row([s.name, s.enabled, `${(s.contentChars / 1024).toFixed(0)} KB`, s.hasData, s.buttons.join('、') || '-', s.dataGroups.join('、') || '-']);
  }
  L.push('');
}

h('8. 分支区段标记（面板可用来枚举选项）');
L.push('');
for (const k of keys) {
  const secs = entriesByPreset[k].filter((e) => /===/.test(e.name)).map((e) => e.name);
  L.push(`- **${k}**：${secs.length} 个 → ${secs.slice(0, 14).map((s) => `\`${s}\``).join('、')}${secs.length > 14 ? ' …' : ''}`);
}

fs.writeFileSync(path.join(OUT, '00-conflicts.md'), L.join('\n'), 'utf8');
written.push('00-conflicts.md');

console.log('已产出：');
for (const w of written) console.log('  inventory/' + w);
