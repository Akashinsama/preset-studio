#!/usr/bin/env node
/**
 * 面板构建
 *
 *   node tools/build-panel.mjs
 *
 * 把 spec/groups.json 注入 panel/src/panel-core.js → panel/fano-panel.js
 * （可粘贴进酒馆助手的脚本本体）。
 *
 * 预览假数据（panel/preview-host.js）不在这里生成——它必须读**成品预设**，
 * 所以拆到了 tools/build-preview.mjs，在 build-preset.mjs 之后跑。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const P = (...a) => path.join(ROOT, ...a);

const groups = JSON.parse(fs.readFileSync(P('spec', 'groups.json'), 'utf8'));
const core = fs.readFileSync(P('panel', 'src', 'panel-core.js'), 'utf8');

if (!core.includes("'__FANO_GROUPS__'")) throw new Error('panel-core.js 里找不到 __FANO_GROUPS__ 占位符');
if (!core.includes("'__FANO_DISPLAY__'")) throw new Error('panel-core.js 里找不到 __FANO_DISPLAY__ 占位符');
if (!core.includes("'__FANO_THINKING_TAGS__'")) throw new Error('panel-core.js 里找不到 __FANO_THINKING_TAGS__ 占位符');

const indent = (json) => json.split('\n').map((l, i) => (i === 0 ? l : '  ' + l)).join('\n');
const groupsJson = indent(JSON.stringify(groups.groups, null, 2));
const displayJson = indent(JSON.stringify(groups.display || {}, null, 2));
const tagsJson = indent(JSON.stringify(groups.thinkingTags || [], null, 2));

const banner =
  `/**\n * 芳乃 · 预设面板　（自动生成，请勿直接改这个文件）\n` +
  ` * 源：panel/src/panel-core.js + spec/groups.json\n` +
  ` * 构建：node tools/build-panel.mjs\n` +
  ` * 子集：${groups.groups.length} 个　显示名映射：${Object.keys(groups.display || {}).length} 条` +
  `　思维链标签互斥组：${(groups.thinkingTags || []).length} 个\n` +
  ` */\n`;

const out = banner
  + core
    .replace("'__FANO_GROUPS__'", groupsJson)
    .replace("'__FANO_DISPLAY__'", displayJson)
    .replace("'__FANO_THINKING_TAGS__'", tagsJson);
fs.writeFileSync(P('panel', 'fano-panel.js'), out, 'utf8');

const kb = (f) => (fs.statSync(P('panel', f)).size / 1024).toFixed(1) + ' KB';
console.log('已生成 panel/fano-panel.js　' + kb('fano-panel.js')
  + `　（酒馆助手脚本本体，子集 ${groups.groups.length} 个，思维链标签组 ${(groups.thinkingTags || []).length} 个）`);
console.log('下一步：node tools/build-preset.mjs　然后：node tools/build-preview.mjs');
