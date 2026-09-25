#!/usr/bin/env node
/**
 * 打包：把编辑器 + 库 + 面板 + 成品预设 + 说明书 装成一个可以整包带走的目录与 zip。
 *
 *   node tools/build-package.mjs
 *
 * 产物：
 *   dist/芳乃预设生成器/            ← 目录（双击 开始.html 就能用）
 *   dist/芳乃预设生成器.zip          ← 同一份东西的压缩包
 *
 * 两条规矩：
 *   1. **示例素材只有芳乃预设这一份**（本工程的成品）。别人的预设（Izumi_0914.json）
 *      是开发环境里跑测试用的，不随包发出去——所以包里 index.html 引的演示数据
 *      被换成 demo/fano-demo.js。
 *   2. **包里的东西必须都能跑**。凡是需要"包外才有的输入"的脚本（build-*.mjs 要第三方
 *      源预设、test-gui.mjs 要 Izumi_0914.json）一律不发——宁可不带，也不带一个跑起来
 *      就报错的脚本。发出去的是：编辑器本体、可编程的库、成品与源码、以及能独立跑的校验。
 */
import fs from 'node:fs';
import path from 'node:path';
import { zip } from './lib/zip.mjs';

const ROOT = process.cwd();
const P = (...a) => path.join(ROOT, ...a);
const OUT = P('dist', '芳乃预设生成器');
const ZIPNAME = '芳乃预设生成器.zip';

/* ── 0. 前置：该有的产物必须在，缺了就别打出一个半残的包 ───────────── */
const REQUIRED = [
  ['tools/gui/index.html', '编辑器页面'],
  ['tools/gui/gui.css', '编辑器样式'],
  ['tools/gui/demo/fano-demo.js', '示例素材（node tools/build-gui-demo.mjs）'],
  ['tools/gui/demo/fano-panel-demo.js', '面板快照（node tools/build-gui-demo.mjs）'],
  ['tools/gui/demo/preview-host-demo.js', '假酒馆 API（node tools/build-gui-demo.mjs）'],
  ['tools/gui/API.md', '给 AI 的接口手册（tools/gui/lib/*.js 的对外函数说明）'],
  ['tools/selftest.mjs', '包内自检'],
  ['panel/fano-panel.js', '面板脚本成品（node tools/build-panel.mjs）'],
  ['panel/preview-host.js', '离线预览宿主（node tools/build-preview.mjs）'],
  ['preset/芳乃预设.json', '成品预设（node tools/build-preset.mjs）'],
  ['preset/芳乃预设.zip', '成品预设 zip'],
  ['spec/groups.json', '分组规格（校验要用）'],
  ['spec/fano-layer.json', '芳乃层规格（校验要用）'],
  ['spec/mvu-layer.json', 'MVU 层规格（校验要用）'],
  ['说明书.md', '说明书'],
];
const missing = REQUIRED.filter(([f]) => !fs.existsSync(P(f)));
if (missing.length) {
  console.error('打不了包，这些产物还没有：');
  for (const [f, why] of missing) console.error(`  · ${f}　—— ${why}`);
  console.error('');
  console.error('本仓库不随附任何预设正文（见 NOTICE.md），所以成品与面板产物要你自己生成：');
  console.error('  node tools/build-preset.mjs    # 需要 samples/ 里的三份源预设（见 samples/README.md）');
  console.error('  node tools/build-panel.mjs     # 需要 spec/groups.json');
  console.error('  node tools/build-preview.mjs   # 需要成品预设');
  process.exit(2);
}

/* 就绪状态：index.html 里那一行演示数据必须正好是我们认得的写法，
   否则"换示例素材"这一步会静默失败——包里就会带着别人的预设发出去。 */
const IDX = P('tools', 'gui', 'index.html');
const idxSrc = fs.readFileSync(IDX, 'utf8');
const DEMO_TAG_OLD = '<script src="demo/izumi-demo.js"></script>';
const DEMO_TAG_NEW = '<script src="demo/fano-demo.js"></script>';
if (!idxSrc.includes(DEMO_TAG_OLD)) {
  console.error(`index.html 里找不到那一行演示数据（${DEMO_TAG_OLD}）——`
    + '编辑器是不是改过？这一行必须存在，打包要把它换成芳乃预设。');
  process.exit(2);
}

/* ── 1. 清空 dist 目录（只清我们自己那个包）──────────────────────────
   注意用 unlinkSync + rmdirSync 自己走一遍，**不要用 fs.rmSync**：
   在本机的文件沙箱下 fs.rmSync 是静默失效的（文件还在），甚至会把这个进程搞崩，
   结果是"包看着打好了，里面混着上一版的旧文件"。 */
const rmTree = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) rmTree(p);
    else fs.unlinkSync(p);
  }
  fs.rmdirSync(dir);
};
rmTree(OUT);
fs.mkdirSync(OUT, { recursive: true });

const stats = [];
const copyFile = (rel, dest = rel) => {
  const from = P(rel);
  const to = path.join(OUT, dest);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  stats.push([dest, fs.statSync(to).size]);
};
/** 递归拷一个目录；skip(相对路径) 返回 true 就不拷 */
const copyDir = (relDir, destDir = relDir, skip = () => false) => {
  for (const e of fs.readdirSync(P(relDir), { withFileTypes: true })) {
    const rel = path.posix.join(relDir, e.name);
    if (skip(rel, e.name)) continue;
    if (e.isDirectory()) copyDir(rel, path.posix.join(destDir, e.name), skip);
    else copyFile(rel, path.posix.join(destDir, e.name));
  }
};

/* ── 2. 编辑器本体：整个 tools/gui 端过去，只把 Izumi 那份演示数据剔除 ── */
copyDir('tools/gui', 'tools/gui', (rel, name) => {
  if (name === 'izumi-demo.js') return true;                 // 别人的预设，不进包
  if (/_browser-check\.html$/.test(name)) return true;       // check-browser 的临时产物
  return false;
});
/* 换演示数据：改成"只有芳乃预设这一份" */
const idxOut = idxSrc.replace(DEMO_TAG_OLD, DEMO_TAG_NEW);
if (!idxOut.includes(DEMO_TAG_NEW) || idxOut.includes('izumi-demo.js')) {
  console.error('换演示数据失败——index.html 里还有 izumi-demo.js 的引用，包会被打歪。');
  process.exit(2);
}
fs.writeFileSync(path.join(OUT, 'tools', 'gui', 'index.html'), idxOut, 'utf8');
console.log(`已改示例素材：demo/izumi-demo.js → demo/fano-demo.js`);

/* ── 3. 面板 / 成品预设 / 规格 / 文档 ──────────────────────────────── */
copyDir('panel', 'panel', (rel, name) => name.startsWith('_') || name === 'browser-check.html.tmp');
copyDir('preset', 'preset', (rel, name) => /芳乃预设.*\d{8}/.test(name));   // 时间戳备份不发
copyDir('spec', 'spec');
for (const f of ['README.md', '使用说明.md', '说明书.md']) copyFile(f);

/* ── 4. 能独立跑的脚本 ────────────────────────────────────────────── */
/* 发这些：在包里跑得起来，而且是"自己验证自己"的那一套。 */
const TOOLS_KEEP = [
  'selftest.mjs',            // 装完先跑这个：库能不能加载、成品对不对
  'check-preset.mjs',        // 成品预设的权威校验（109 项）
  'test-panel.mjs',          // 面板逻辑（假 DOM，155 项）
  'test-panelconfig.mjs',    // 面板配置/分组/壁纸/颜色（101 项）
  'test-mobile.mjs',         // 手机场景（20 项）
  'test-iframe.mjs',         // iframe 嵌套与加载时序（34 项）
  'test-regex.mjs',          // 思维链折叠链（30 项）
  'test-gui.mjs',            // 解析 / 拼装内核 + M3 编辑端到端（353 项）
  'check-browser.mjs',       // 真 Chrome · 面板几何（58 项）
  'check-gui-browser.mjs',   // 真 Chrome · 编辑器十屏
  'build-all.mjs',           // 一条命令重跑整条链（缺夹具会自己造合成夹具）
  'make-fixture.mjs',        // 合成夹具生成器（结构来自 spec/，正文占位）
  'build-regex.mjs',         // 折叠链：有合成夹具就能跑
  'build-preset.mjs',        // 组装样例预设：同上
  'build-preview.mjs',       // 假酒馆宿主：同上
  'build-gui-demo.mjs',      // 重建包里的示例数据
  'build-package.mjs',       // 重新打包
];
for (const f of TOOLS_KEEP) copyFile(path.posix.join('tools', f));
copyDir('tools/lib', 'tools/lib');

/* ── 5. 开始.html：包根上一个双击就能进的入口 ─────────────────────── */
const startHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>芳乃预设生成器</title>
<meta http-equiv="refresh" content="0;url=tools/gui/index.html">
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:linear-gradient(135deg,#2b2233,#4a3b52 40%,#8a6f7d);color:#f4eaf1;
font-family:system-ui,"Microsoft YaHei",sans-serif;text-align:center}
a{color:#ffa3c3}
code{background:rgba(0,0,0,.35);padding:2px 6px;border-radius:6px}
</style>
</head>
<body>
<div>
  <h1 style="font-weight:600;margin:0 0 12px">芳乃预设生成器</h1>
  <p>正在打开编辑器……没自动跳就点这里 → <a href="tools/gui/index.html">tools/gui/index.html</a></p>
  <p style="opacity:.75;font-size:13px">整个编辑器是零依赖的静态页面，双击就能用；
  不联网、不上传、不改你的文件。<br>先读 <code>说明书.md</code>；给 AI 用的接口手册在
  <code>tools/gui/API.md</code>。</p>
</div>
</body>
</html>
`;
fs.writeFileSync(path.join(OUT, '开始.html'), startHtml, 'utf8');

/* ── 6. 清单与自证 ─────────────────────────────────────────────────── */
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(path.relative(OUT, full).split(path.sep).join('/'));
  }
  return out;
};
const files = walk(OUT).sort();
const totalBytes = files.reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0);

/* 自证 1：包里绝不能出现别人的预设 */
const leaked = files.filter((f) => /izumi/i.test(f));
if (leaked.length) { console.error('包里混进了不该有的文件：' + leaked.join('、')); process.exit(2); }
/* 自证 2：示例数据必须是芳乃，而且是**唯一**一份 */
const demoFiles = files.filter((f) => /^tools\/gui\/demo\/.*-demo\.js$/.test(f));
if (!demoFiles.includes('tools/gui/demo/fano-demo.js')) { console.error('包里没有芳乃示例数据'); process.exit(2); }
if (!/demo\/fano-demo\.js/.test(fs.readFileSync(path.join(OUT, 'tools/gui/index.html'), 'utf8'))) {
  console.error('包里的 index.html 没有引用芳乃示例数据'); process.exit(2);
}
/* 自证 3：编辑器自己引的每个文件都在包里（file:// 下少一个就是白屏） */
const html = fs.readFileSync(path.join(OUT, 'tools', 'gui', 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1])
  .filter((u) => !/^(https?:|data:|#)/.test(u));
const broken = refs.filter((u) => !fs.existsSync(path.join(OUT, 'tools', 'gui', u.split('?')[0])));
if (broken.length) { console.error('index.html 引了包里没有的文件：' + broken.join('、')); process.exit(2); }

fs.writeFileSync(path.join(OUT, '包内容清单.txt'),
  ['芳乃预设生成器 · 包内容清单（node tools/build-package.mjs 生成）', '',
    `文件 ${files.length} 个，解包后 ${(totalBytes / 1024 / 1024).toFixed(2)} MB`, '',
    ...files.map((f) => `${String(fs.statSync(path.join(OUT, f)).size).padStart(9)}  ${f}`)].join('\n'), 'utf8');

const zipPath = P('dist', ZIPNAME);
fs.writeFileSync(zipPath, zip(walk(OUT).map((rel) => ({
  name: `芳乃预设生成器/${rel}`,
  data: fs.readFileSync(path.join(OUT, rel)),
}))));

console.log(`\n已打出 dist/芳乃预设生成器/　${files.length} 个文件　${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
const top = [...new Set(files.map((f) => f.split('/')[0]))].sort();
console.log('  顶层：' + top.join('　'));
for (const [rel, size] of stats.filter(([r]) => r.split('/').length <= 2 || /^tools\/(gui\/)?(index|gui)/.test(r))) {
  console.log(`  ${String(Math.round(size / 1024)).padStart(5)} KB  ${rel}`);
}
console.log(`已打出 dist/${ZIPNAME}　${(fs.statSync(zipPath).size / 1024 / 1024).toFixed(2)} MB`);
console.log('\n下一步：验证这个包（对着包里的页面跑同一套断言）');
console.log('  node tools/selftest.mjs');
console.log('  node tools/check-preset.mjs');
console.log('  set DSH_GUI_PAGE=dist\\芳乃预设生成器\\tools\\gui\\index.html && node tools/check-gui-browser.mjs');
