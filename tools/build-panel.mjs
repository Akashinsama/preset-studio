#!/usr/bin/env node
/**
 * 面板构建
 *
 *   node tools/build-panel.mjs
 *
 * 把 spec/groups.json 注入 panel/src/panel-core.js → panel/fano-panel.js
 * （可粘贴进酒馆助手的脚本本体）。脚本层防截断（panel/src/antitrunc.js）
 * 也在这一步整体注入 panel-core.js 的 FANO_ANTITRUNC_BEGIN/END 之间。
 *
 * 预览假数据（panel/preview-host.js）不在这里生成——它必须读**成品预设**，
 * 所以拆到了 tools/build-preview.mjs，在 build-preset.mjs 之后跑。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = process.cwd();
const P = (...a) => path.join(ROOT, ...a);

const groups = JSON.parse(fs.readFileSync(P('spec', 'groups.json'), 'utf8'));
let core = fs.readFileSync(P('panel', 'src', 'panel-core.js'), 'utf8');
const antitrunc = fs.readFileSync(P('panel', 'src', 'antitrunc.js'), 'utf8');

if (!core.includes("'__FANO_GROUPS__'")) throw new Error('panel-core.js 里找不到 __FANO_GROUPS__ 占位符');
if (!core.includes("'__FANO_DISPLAY__'")) throw new Error('panel-core.js 里找不到 __FANO_DISPLAY__ 占位符');
if (!core.includes("'__FANO_THINKING_TAGS__'")) throw new Error('panel-core.js 里找不到 __FANO_THINKING_TAGS__ 占位符');

/* ── 防截断：把 panel/src/antitrunc.js 整体塞进注入点 ────────────────
   （面板脚本只有一个 IIFE，模块里那些类/函数都活在它自己的函数作用域里，
     不会和面板的同名变量打架；所以这里可以直接整段放进去。） */
const AT_HOLE = '  /* __FANO_ANTITRUNC_MODULE__ */';
if (!core.includes(AT_HOLE)) throw new Error('panel-core.js 里找不到防截断注入点（__FANO_ANTITRUNC_MODULE__）');
if (!/function\s+createAntiTruncation\s*\(/.test(antitrunc)) throw new Error('panel/src/antitrunc.js 里找不到 createAntiTruncation()');
if (/^\s*(import|export)\s/m.test(antitrunc)) throw new Error('panel/src/antitrunc.js 里有 import/export，不能整段注入 IIFE');
const atBlock = `  /* ── 以下是 panel/src/antitrunc.js 的内容（构建期注入；要改请改那个文件）── */
${antitrunc.trimEnd()}
  /** 防截断实例。开关读 LS.antitrunc（= fano-antitrunc-v1，顶部 🛡 按钮同一个键）；
      出厂默认值来自 CONFIG.antitrunc.enabled。创建时即按开关决定装不装拦截器。 */
  const ANTITRUNC = createAntiTruncation({
    key: LS.antitrunc,
    defaultOn: CFG.antitrunc.enabled,
    /* 渠道明显不支持时的提醒出口（只提醒，绝不自动关开关）。 */
    onNotice: (msg) => notifyUser(msg, 'warn'),
  });
`;
core = core.replace(AT_HOLE, atBlock.trimEnd());

const indent = (json) => json.split('\n').map((l, i) => (i === 0 ? l : '  ' + l)).join('\n');
const groupsJson = indent(JSON.stringify(groups.groups, null, 2));
const displayJson = indent(JSON.stringify(groups.display || {}, null, 2));
const tagsJson = indent(JSON.stringify(groups.thinkingTags || [], null, 2));

const banner =
  `/**\n * 芳乃 · 预设面板　（自动生成，请勿直接改这个文件）\n` +
  ` * 源：panel/src/panel-core.js + panel/src/antitrunc.js + spec/groups.json\n` +
  ` * 构建：node tools/build-panel.mjs\n` +
  ` * 子集：${groups.groups.length} 个　显示名映射：${Object.keys(groups.display || {}).length} 条` +
  `　思维链标签互斥组：${(groups.thinkingTags || []).length} 个\n` +
  ` */\n`;

const out = banner
  + core
    .replace("'__FANO_GROUPS__'", groupsJson)
    .replace("'__FANO_DISPLAY__'", displayJson)
    .replace("'__FANO_THINKING_TAGS__'", tagsJson);

/* 拼完先过一遍语法：注入是字符串拼接，拼坏了要在这里当场知道，
   而不是等用户把它贴进酒馆、或者等测试莫名其妙地报错。 */
try {
  new vm.Script(out, { filename: 'fano-panel.js' });
} catch (e) {
  console.error('✗ 拼出来的面板脚本有语法错误（多半是注入的那一段没接好）：');
  console.error('  ' + (e && e.message));
  process.exit(1);
}
fs.writeFileSync(P('panel', 'fano-panel.js'), out, 'utf8');

const kb = (f) => (fs.statSync(P('panel', f)).size / 1024).toFixed(1) + ' KB';
console.log('已生成 panel/fano-panel.js　' + kb('fano-panel.js')
  + `　（酒馆助手脚本本体，子集 ${groups.groups.length} 个，思维链标签组 ${(groups.thinkingTags || []).length} 个，`
  + `防截断模块 ${kb('src/antitrunc.js')}）`);
console.log('下一步：node tools/build-preset.mjs　然后：node tools/build-preview.mjs');
