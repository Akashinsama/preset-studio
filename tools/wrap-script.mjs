#!/usr/bin/env node
/**
 * 把一份裸 .js 包成「酒馆助手脚本」JSON（脚本库 / 导入用）。
 *
 *   node tools/wrap-script.mjs <输入.js> [显示名] [输出.json]
 *
 * 例：
 *   node tools/wrap-script.mjs D:\workspace2\九域控制台_酒馆助手版.js 九域控制台
 *
 * 为什么要这个工具：酒馆助手的**导入**入口吃的是它自己的脚本 JSON，
 * 不是裸 .js；而「新建脚本 → 粘贴内容」那条路又要求你手动复制几万字符。
 * 这个工具按官方形状把壳子套好，content 里放的就是你的源码原文（一个字节不改）。
 *
 * 形状（来自 Tavern Helper 的可导入组件格式说明，也是我们自己在预设里写的那种）：
 *   type: "script" | enabled: boolean | name: string | id: string | content: string
 *   info: string | button: {enabled, buttons:[{name, visible}]}
 *   data: object | export_with: {data, button}
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const [inPath, nameArg, outArg] = process.argv.slice(2);
if (!inPath) {
  console.error('用法：node tools/wrap-script.mjs <输入.js> [显示名] [输出.json]');
  process.exit(2);
}
const absIn = path.resolve(inPath);
if (!fs.existsSync(absIn)) { console.error(`找不到输入文件：${absIn}`); process.exit(2); }

/* ── 1. 读源码：去 BOM，其余一个字节不改 ───────────────────────────── */
let src = fs.readFileSync(absIn, 'utf8');
let notes = [];
if (src.charCodeAt(0) === 0xFEFF) { src = src.slice(1); notes.push('输入带 UTF-8 BOM，已去掉（酒馆助手解析 JSON 时 BOM 会捣乱）'); }

/* ── 2. 语法自检：包之前先确认这段 JS 自己站得住 ───────────────────── */
const tmp = path.join(path.dirname(absIn), `._syntax-check-${Date.now()}.js`);
let syntaxOk = true;
let syntaxMsg = '';
try {
  fs.writeFileSync(tmp, src, 'utf8');
  execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
} catch (e) {
  syntaxOk = false;
  syntaxMsg = String(e.stderr || e.message).split('\n').slice(0, 6).join('\n');
} finally {
  if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
}

/* ── 3. 套壳 ───────────────────────────────────────────────────────── */
const base = path.basename(absIn).replace(/\.(js|mjs|cjs|txt)$/i, '');
const name = (nameArg || base).trim() || '未命名脚本';
/* id 用内容哈希 → 同一个脚本重复包出来的 id 相同（重新导入就是"更新"而不是新增一份） */
const id = 'wrapped-' + crypto.createHash('sha1').update(src).digest('hex').slice(0, 8);

/* JSON 字符串里出现 </script> 会让嵌进 HTML 的宿主提前截断；
   转成 <\/script> 是合法 JSON 转义，解析回来还是 </script>，字节等价。 */
const hadScriptTag = /<\/script>/i.test(src);
const content = src.replace(/<\/script>/gi, '<\\/script>');
if (hadScriptTag) notes.push('源码里有 </script>，在 JSON 里写成 <\\/script> 防截断（解析后仍是 </script>）');

const script = {
  type: 'script',
  enabled: true,
  name,
  id,
  content,
  info: `由 tools/wrap-script.mjs 从 ${path.basename(absIn)} 打包。`,
  button: { enabled: false, buttons: [] },
  data: {},
  export_with: { data: false, button: true },
};

/* ── 4. 自证：键序、必填、以及 content 解析回来必须与源码完全一致 ───── */
const WANT_KEYS = ['type', 'enabled', 'name', 'id', 'content', 'info', 'button', 'data', 'export_with'];
const problems = [];
if (JSON.stringify(Object.keys(script)) !== JSON.stringify(WANT_KEYS)) problems.push('键或键序与官方形状不一致');
const round = JSON.parse(JSON.stringify(script));
if (round.content !== src) problems.push('content 解析回来与源码不一致（不该发生）');
for (const k of ['type', 'enabled', 'name', 'id', 'content', 'info', 'button', 'data', 'export_with']) {
  if (script[k] === undefined) problems.push(`缺字段 ${k}`);
}
if (!syntaxOk) problems.push('源码没通过 node --check（语法有错）');

const jsonText = JSON.stringify(script, null, 2);
const outFile = path.resolve(outArg || path.join(path.dirname(absIn), `${name}.脚本.json`));
fs.writeFileSync(outFile, jsonText, 'utf8');
/* 备用：有些导入入口读的是"数组"（预设内部就是数组） */
const arrFile = outFile.replace(/\.json$/i, '') + '-数组.json';
fs.writeFileSync(arrFile, JSON.stringify([script], null, 2), 'utf8');

/* ── 5. 报告 ───────────────────────────────────────────────────────── */
console.log(`输入：${absIn}　${(Buffer.byteLength(src, 'utf8') / 1024).toFixed(1)} KB`);
console.log(`语法自检（node --check）：${syntaxOk ? '通过' : '❌ 没通过\n' + syntaxMsg}`);
console.log(`名字：${name}　id：${id}`);
for (const n of notes) console.log(`注意：${n}`);
console.log(`\n已写出：`);
console.log(`  ${outFile}　${(fs.statSync(outFile).size / 1024).toFixed(1)} KB　（单个脚本对象，先试这个）`);
console.log(`  ${arrFile}　${(fs.statSync(arrFile).size / 1024).toFixed(1)} KB　（同一份包成数组，导入入口读数组时用它）`);
console.log(`\n自证：键序对齐官方形状 ✓　content 解析回来与源码逐字节相同 ${round.content === src ? '✓' : '✗'}　` +
  `字段齐全 ${problems.length === 0 ? '✓' : '✗'}`);
if (problems.length) { console.error('\n有问题：\n  - ' + problems.join('\n  - ')); process.exitCode = 1; }
else console.log('打包完成。导入不进去就改用「新建脚本 → 粘贴源码」，那条路不依赖任何导入格式。');
