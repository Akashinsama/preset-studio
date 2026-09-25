#!/usr/bin/env node
/**
 * 面板适配器：把「另一支」面板脚本改造成预设生成器（tools/gui）认得的形态
 *
 *   node tools/adapt-panel.mjs <输入预设.json> [输出预设.json]
 *
 * 干什么：v2.8.1 那份预设里的面板是另一支代码（13.8 万字，自带防截断、顶部两个按钮、
 * 自己那套拖动/隐藏），它**没有**生成器读写用的标记块，所以生成器认不出它、也就改不了它。
 * 这一步把我们那套"插头"接上去，**其余代码一行不动**：
 *
 *   1. 注入 `FANO_PANEL_CONFIG_BEGIN/END` 配置块（默认值从它现有硬编码里读出来）
 *   2. 让运行时代码**读**这个配置：颜色（THEMES 合并）、球直径、窗口默认尺寸、窗口圆角
 *   3. 注入一行 `const raw = \`…\`` 静态样式快照（生成器的画布/预览靠它按**它自己的样式**渲染；
 *      运行时不读它，纯新增，零风险）
 *
 * 不动的：防截断、顶部按钮、它自己的隐藏/拖动、分组、条目——一个字不改。
 * 原文件也不动：默认另存成 `<输入>-适配.json`。
 *
 * ⚠ 能力边界（实测那份脚本里根本没有的东西，生成器界面会对它们置灰）：
 *   壁纸 / 整体缩放 / 不透明度 / 磨砂 / 球形状 / 球上图片 —— 那一支没这些功能。
 *
 * 定位全部用**正则规则**，不写死行号：它将来改版还能重跑。
 */
import fs from 'node:fs';
import path from 'node:path';

const inFile = process.argv[2];
if (!inFile) {
  console.error('用法：node tools/adapt-panel.mjs <输入预设.json> [输出预设.json]');
  process.exit(2);
}
const outFile = process.argv[3] || inFile.replace(/\.json$/i, '') + '-适配.json';

const preset = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const scripts = preset?.extensions?.tavern_helper?.scripts;
if (!Array.isArray(scripts) || !scripts.length) { console.error('这份预设里没有酒馆助手脚本。'); process.exit(2); }
const idx = scripts.findIndex((s) => typeof s.content === 'string' && s.content.length > 1000);
if (idx < 0) { console.error('找不到像面板的长脚本。'); process.exit(2); }
const src0 = scripts[idx].content;

/* ── 已经适配过就别重复注入 ─────────────────────────────────────── */
if (src0.includes('FANO_PANEL_CONFIG_BEGIN')) {
  console.error('这份预设的面板已经有配置块了，不用再适配。');
  process.exit(2);
}

const log = [];
let src = src0;

/* ── 0. 从它现有硬编码里把默认值读出来 ───────────────────────────── */
const num = (re, d) => { const m = re.exec(src0); return m ? Number(m[1]) : d; };

/** 它的昼夜色：`const THEMES = { day: {…}, night: {…} };` —— 键都是 `'--fp-xxx': '#…'` */
function extractThemes(text) {
  const at = text.search(/const\s+THEMES\s*=\s*\{/);
  if (at < 0) return null;
  const start = text.indexOf('{', at);
  let depth = 0; let end = -1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return null;
  const body = text.slice(start, end + 1);
  /* 只认 `'--fp-x': '值'` 这种键值对：够用且不会误读别的写法 */
  const grab = (block) => Object.fromEntries(
    [...block.matchAll(/'(--fp-[\w-]+)'\s*:\s*'([^']*)'/g)].map((m) => [m[1], m[2]]),
  );
  const dayAt = body.indexOf('day');
  const nightAt = body.indexOf('night');
  if (dayAt < 0 || nightAt < 0) return null;
  return { day: grab(body.slice(dayAt, nightAt)), night: grab(body.slice(nightAt)) };
}
const themes = extractThemes(src0) || { day: {}, night: {} };

/* 静态样式快照：它把整张样式表拼在一段模板串里（`s.textContent = \`…\``）。
   注意**不能只取第一处**——那支脚本里别的 textContent 赋值也会用模板串，第一处往往是短文案，
   抽出来就是 0KB（第一次就是这么错的）。所以把所有候选都取出来，挑最长的那一个。 */
function extractCssSnapshot(text) {
  const res = [];
  const re = /textContent\s*=\s*`/g;
  let m;
  while ((m = re.exec(text))) {
    const start = text.indexOf('`', m.index);
    let end = -1;
    for (let i = start + 1; i < text.length; i++) {
      if (text[i] === '\\') { i++; continue; }
      if (text[i] === '`') { end = i; break; }
    }
    if (end > 0) res.push(text.slice(start + 1, end));
  }
  if (!res.length) return '';
  const css = res.sort((a, b) => b.length - a.length)[0];
  /* 模板插值：球直径那种 `${S}` 换成当前值，其余一律去掉——
     快照只给画布看，不是运行时那一份，所以宁可少值也不能留下 `width:px` 这种坏声明。 */
  return css
    .replace(/\$\{S\}/g, String(ballSize))
    .replace(/\$\{[^}]*\}/g, '')
    .replace(/\s+\n/g, '\n');
}

const ballSize = num(/const\s+S\s*=\s*(\d+)\s*;/, 46);
const winW = num(/Number\(size\s*&&\s*size\.w\)\s*\|\|\s*(\d+)/, 380);
const winH = num(/Number\(size\s*&&\s*size\.h\)\s*\|\|\s*(\d+)/, 620);
const radius = num(/\.fp-win\{[^}]*border-radius:\s*(\d+)px/, 14);
log.push(`读出默认值：球 ${ballSize}px　窗口 ${winW}×${winH}　圆角 ${radius}px　`
  + `昼夜色各 ${Object.keys(themes.day).length}/${Object.keys(themes.night).length} 个 token`);

/* ── 1. 配置块：插在脚本最前面（它自己的初始化之前），供生成器读写 ── */
const CONFIG = {
  version: 1,
  title: '',
  tokens: { day: themes.day, night: themes.night },
  ball: { size: ballSize, glyph: '芳', shape: 'circle', content: { kind: 'text', image: '' } },
  window: { w: winW, h: winH, minW: 260, minH: 200, maxW: 0, maxH: 0 },
  layout: { radius, scale: 1, fontScale: 1, opacity: 1, blur: 14 },
  wallpaper: { url: '', fit: 'cover', opacity: 0.35, blur: 0, dim: 0.15, dimColor: '#000000' },
};
const configBlock = `  /* ══ FANO_PANEL_CONFIG_BEGIN ══════════════════════════════════════════
      【适配器注入】这一段是**给预设生成器（tools/gui）的「面板外观」编辑器读写**的。
      它只替换这中间的内容，别处代码一行都不动。
      下面这些默认值是从这份面板原有的硬编码里读出来的；tokens 就是它自己的昼夜色。

      注意：这一支**没有**壁纸/整体缩放/不透明度/球形状/球上图片——那几项在生成器界面里
      对这份预设无效（不是坏了）。
      ═══════════════════════════════════════════════════════════════════ */
  const CONFIG = ${JSON.stringify(CONFIG, null, 2).split('\n').join('\n  ')};
  /* ══ FANO_PANEL_CONFIG_END ════════════════════════════════════════════ */
`;

/* 插到 IIFE 开头（`(function … {` 之后），保证后面所有代码都能用到 CONFIG */
const iife = /\(function\s*\([^)]*\)\s*\{/.exec(src);
src = iife
  ? src.slice(0, iife.index + iife[0].length) + '\n' + configBlock + src.slice(iife.index + iife[0].length)
  : configBlock + src;
log.push(iife ? '配置块已插到 IIFE 开头' : '⚠ 没找到 IIFE 开头，配置块插在最前面（可能无效）');

/* ── 2. 让运行时读配置 ─────────────────────────────────────────── */
/* 2a. 颜色：THEMES 声明之后合并 CONFIG.tokens */
{
  const at = src.search(/const\s+THEMES\s*=\s*\{/);
  if (at >= 0) {
    const start = src.indexOf('{', at);
    let depth = 0; let end = -1;
    for (let i = start; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    const semi = src.indexOf(';', end);
    if (end > 0 && semi > 0) {
      const merge = `\n  /* 【适配器注入】把生成器写的颜色合并进 THEMES（改颜色只改上面那个 CONFIG 块） */
  if (typeof CONFIG !== 'undefined' && CONFIG.tokens) {
    for (const _k of ['day', 'night']) if (CONFIG.tokens[_k]) Object.assign(THEMES[_k], CONFIG.tokens[_k]);
  }`;
      src = src.slice(0, semi + 1) + merge + src.slice(semi + 1);
      log.push('已接上：颜色从 CONFIG.tokens 合并进 THEMES');
    }
  } else log.push('⚠ 没找到 const THEMES，颜色接管跳过');
}
/* 2b. 球直径：const S = 46; */
if (/const\s+S\s*=\s*\d+\s*;/.test(src)) {
  src = src.replace(/const\s+S\s*=\s*\d+\s*;/,
    'const S = (typeof CONFIG !== \'undefined\' && CONFIG.ball && CONFIG.ball.size) || ' + ballSize + ';');
  log.push('已接上：球直径读 CONFIG.ball.size');
} else log.push('⚠ 没找到 `const S = <数字>;`，球直径接管跳过');

/* 2c. 窗口默认尺寸：Number(size && size.w) || 380 */
if (/Number\(size\s*&&\s*size\.w\)\s*\|\|\s*\d+/.test(src)) {
  src = src.replace(/Number\(size\s*&&\s*size\.w\)\s*\|\|\s*\d+/,
    `Number(size && size.w) || ((typeof CONFIG !== 'undefined' && CONFIG.window && CONFIG.window.w) || ${winW})`);
  src = src.replace(/Number\(size\s*&&\s*size\.h\)\s*\|\|\s*\d+/,
    `Number(size && size.h) || ((typeof CONFIG !== 'undefined' && CONFIG.window && CONFIG.window.h) || ${winH})`);
  log.push('已接上：窗口默认尺寸读 CONFIG.window');
} else log.push('⚠ 没找到窗口默认尺寸的写法，接管跳过');

/* 2d. 窗口圆角：只改 .fp-win 里的那个 border-radius */
{
  const winAt = src.indexOf('.fp-win{');
  const rAt = winAt >= 0 ? src.indexOf(`border-radius:${radius}px`, winAt) : -1;
  if (rAt >= 0) {
    src = src.slice(0, rAt)
      + `border-radius:\${(typeof CONFIG !== 'undefined' && CONFIG.layout && CONFIG.layout.radius) || ${radius}}px`
      + src.slice(rAt + `border-radius:${radius}px`.length);
    log.push('已接上：窗口圆角读 CONFIG.layout.radius');
  } else log.push('⚠ 没在 .fp-win 里找到圆角声明，接管跳过');
}

/* ── 3. 静态样式快照（生成器的画布/预览用；运行时读不到它，纯新增）── */
const snapshot = extractCssSnapshot(src0);
if (snapshot && !/const\s+raw\s*=\s*`/.test(src0)) {
  src += `\n\n/* 【适配器注入】下面这一行是**静态样式快照**：生成器的画布/预览靠它按这份面板
   自己的样式渲染，这样画布与真面板长得一样。运行时不读这个变量，纯粹是给工具看的。
   注意：注释里绝不能写出那个赋值语句的原文，否则生成器的抽取器会先匹配到注释。 */
const raw = \`${snapshot.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\`;
`;
  log.push(`已注入静态样式快照（${Math.round(snapshot.length / 1024)}KB）`);
} else if (/const\s+raw\s*=\s*`/.test(src0)) {
  log.push('⚠ 它自己已经有一个 `const raw = `，跳过快照注入（免得撞名）');
} else {
  log.push('⚠ 没找到它的样式模板串，快照跳过（画布会用生成器自带样式）');
}

/* ── 3.5 扩展层：给这一支补上它**没有**的三样 ──────────────────────
   它那支没有壁纸、没有球上图片、没有球形状（实测：`wallpaper` 0 处、`fp-ball-img` 0 处）。
   这里用**纯新增**的方式补：只挂它自己的两个类名（`.fp-launch` 球、`.fp-win` 窗口），
   它原有代码一行不动，也没碰防截断与顶部按钮。
   面板每次重画都会换掉 DOM，所以用 MutationObserver 反复对齐（幂等，不会叠加）。 */
const EXT = `
/* 【适配器注入·扩展层】补上这一支没有的三样：球上图片 / 球形状 / 壁纸。
   只读上面那个 CONFIG 块；它原有代码一行未改。

   关键：酒馆助手脚本跑在 **iframe** 里，而面板通常被挂到**最外层同源文档**
   （第一版就是在这儿栽的：在 iframe 文档里找 .fp-launch 永远找不到，于是什么也没发生）。
   所以下面先自己往上爬到最外层同源文档，再在那儿干活。 */
(function () {
  function hostDoc() {
    var w = window, guard = 0;
    while (guard++ < 6) {
      var up = null;
      try { up = w.parent; } catch (e) { break; }          // 跨域就停在这一层
      if (!up || up === w) break;
      try { if (!up.document) break; } catch (e) { break; } // 取不到 document 也停
      w = up;
    }
    try { return w.document || document; } catch (e) { return document; }
  }
  var D = hostDoc();
  function ballShape(el, shape) {
    var R = { circle: '50%', rounded: '26%', square: '2px' };
    var C = {
      diamond: 'polygon(50% 0,100% 50%,50% 100%,0 50%)',
      triangle: 'polygon(50% 4%,98% 94%,2% 94%)',
      hexagon: 'polygon(25% 4%,75% 4%,100% 50%,75% 96%,25% 96%,0 50%)',
    };
    if (R[shape]) { el.style.borderRadius = R[shape]; el.style.clipPath = ''; }
    else if (C[shape]) { el.style.clipPath = C[shape]; }
  }
  function apply() {
    if (typeof CONFIG === 'undefined' || !CONFIG) return;
    D = hostDoc();                       // 每次重新认一次：首帧时外层文档可能还没就绪
    var b = CONFIG.ball || {}, c = b.content || {};
    var ball = D.querySelector ? D.querySelector('.fp-launch') : null;
    if (ball) {
      ballShape(ball, b.shape);
      if (c.kind === 'image' && c.image) {
        var img = ball.querySelector('img.fp-ball-img');
        if (!img) {
          ball.textContent = '';
          img = D.createElement('img');
          img.className = 'fp-ball-img';
          img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;border-radius:inherit';
          ball.appendChild(img);
        }
        if (img.getAttribute('src') !== c.image) img.setAttribute('src', c.image);
      }
    }
    var W = CONFIG.wallpaper || {}, win = D.querySelector('.fp-win');
    if (!win) return;
    var layer = D.getElementById('adapt-wall');
    if (!W.url) { if (layer) layer.remove(); return; }
    if (!layer) {
      layer = D.createElement('div');
      layer.id = 'adapt-wall';
      layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:0;border-radius:inherit';
      win.insertBefore(layer, win.firstChild);
    }
    layer.style.backgroundImage = 'url("' + String(W.url).replace(/"/g, '%22') + '")';
    layer.style.backgroundSize = W.fit === 'repeat' ? 'auto' : (W.fit || 'cover');
    layer.style.backgroundRepeat = W.fit === 'repeat' ? 'repeat' : 'no-repeat';
    layer.style.opacity = String(W.opacity == null ? 0.35 : W.opacity);
    layer.style.filter = 'blur(' + (W.blur || 0) + 'px)';
  }
  function tick() { try { apply(); } catch (e) { /* 忽略：不能因为扩展层把面板弄崩 */ } }
  tick();
  try { new MutationObserver(tick).observe(D.body || D.documentElement, { childList: true, subtree: true }); }
  catch (e) { /* 观察不了就靠下面的定时器 */ }
  /* 兜底：面板换层（iframe → 最外层）或 DOM 被整体替换时，观察器也救不回来 */
  try { setInterval(tick, 1500); } catch (e) { /* 忽略 */ }
  /* 顺手暴露一个自检口：控制台里 __ACT_ADAPT__() 能看出扩展层到底在不在、认的是哪层文档 */
  try {
    window.__ACT_ADAPT__ = function () {
      var d = hostDoc();
      return {
        inIframe: window !== window.top,
        hostIsTop: d === document,
        ball: !!(d.querySelector && d.querySelector('.fp-launch')),
        wall: !!(d.getElementById && d.getElementById('adapt-wall')),
        ballIsImage: !!(d.querySelector && d.querySelector('.fp-launch img.fp-ball-img')),
        configured: (typeof CONFIG !== 'undefined' && !!CONFIG),
      };
    };
  } catch (e) { /* 忽略 */ }
})();
`;
src += EXT;
log.push('已注入扩展层：球上图片 / 球形状 / 壁纸（纯新增，不动它原有代码）');

/* ── 4. 另存：只换脚本内容，其余（button / 分组 / 防截断 / 条目）原样 ── */
scripts[idx] = { ...scripts[idx], content: src };
fs.writeFileSync(outFile, JSON.stringify(preset), 'utf8');

console.log(`已适配 → ${path.basename(outFile)}（原文件没动）`);
log.forEach((l) => console.log('  · ' + l));
console.log(`  脚本 ${Math.round(src0.length / 1024)}KB → ${Math.round(src.length / 1024)}KB`);
console.log('\n下一步：在编辑器里导入这份新预设 → 「面板外观」应能认出它（颜色/球直径/窗口尺寸/圆角可改）。');
console.log('  分组块（FANO_PANEL_GROUPS）这次没注入——它那份分组格式还要单独转，留到下一版。');
