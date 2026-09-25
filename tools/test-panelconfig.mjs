#!/usr/bin/env node
/**
 * 面板外观配置测试（真加载面板 + 假 DOM）
 *
 *   node tools/test-panelconfig.mjs
 *
 * 核心目的只有一个：**锁死两套夹取逻辑不许漂移**。
 * 面板里有一份 CFG（生效值），tools/gui/lib/panelconfig.js 里有一份 clampConfig()，
 * 前者给面板用、后者给生成器的界面和预览用。两边一旦不一致，
 * 界面上看到的和面板里实际发生的就不是一回事了。
 *
 * 做法：用 patchConfig() 改面板源码 → 真加载 → 跟 clampConfig() 逐字段比。
 * 顺带验证：改配置只动那一段、壁纸图层、缩放、颜色 token 生效。
 */
import fs from 'node:fs';
import path from 'node:path';
import { has, need, skip } from './lib/fixtures.mjs';

/* 夹具守卫：这套测试真加载面板，宿主数据来自 preview-host.js（由成品预设生成）；
   另外要一份预设当样本（优先 Izumi，其次成品）。都见 samples/README.md。 */
need(path.join('panel', 'preview-host.js'), '面板外观配置测试（83 项）',
  'preview-host.js 由 node tools/build-preview.mjs 生成，它要成品预设');
if (!has('Izumi_0914.json') && !has(path.join('preset', '芳乃预设.json'))) {
  skip('面板外观配置测试（83 项）的预设样本', ['Izumi_0914.json', '或 preset/芳乃预设.json']);
}

const ROOT = process.cwd();
const P = (...a) => path.join(ROOT, ...a);

let pass = 0;
const fails = [];
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fails.push(name + (detail ? '　→ ' + detail : '')); console.log('  ✗ ' + name + (detail ? '　→ ' + detail : '')); }
};

/* ── 假 DOM（与 test-panel.mjs 同一套写法）──────────────────────── */
function makeDom() {
  const all = [];
  function makeEl(tag) {
    const node = {
      tagName: String(tag).toUpperCase(),
      children: [],
      parentNode: null,
      style: {},
      dataset: {},
      _text: '',
      _attrs: {},
      className: '',
      id: '',
      get textContent() { return this._text; },
      set textContent(v) { this._text = String(v); if (v === '') this.children.length = 0; },
      get firstChild() { return this.children[0] || null; },
      appendChild(c) {
        if (c.parentNode) c.parentNode.children = c.parentNode.children.filter((x) => x !== c);
        c.parentNode = this; this.children.push(c); return c;
      },
      removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; },
      remove() { if (this.parentNode) this.parentNode.removeChild(this); },
      setAttribute(k, v) { this._attrs[k] = String(v); if (k === 'id') this.id = String(v); },
      getAttribute(k) { return this._attrs[k]; },
      addEventListener() {}, removeEventListener() {},
      querySelector(sel) {
        const want = sel.replace(/^\./, '');
        const search = (n) => {
          for (const c of n.children || []) {
            if (sel.startsWith('.') ? (c.className || '').split(/\s+/).includes(want) : c.tagName === sel.toUpperCase()) return c;
            const r = search(c); if (r) return r;
          }
          return null;
        };
        return search(this);
      },
      querySelectorAll() { return []; },
      contains() { return false; },
      focus() {}, select() {},
      get outerHTML() { return `<${this.tagName.toLowerCase()} class="${this.className}">`; },
    };
    all.push(node);
    return node;
  }
  const document = {
    head: makeEl('head'), body: makeEl('body'),
    documentElement: makeEl('html'),
    createElement: makeEl,
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t), children: [] }),
    getElementById: (id) => {
      const search = (n) => {
        for (const c of n.children || []) { if (c.id === id) return c; const r = search(c); if (r) return r; }
        return null;
      };
      return search(document.body) || search(document.head) || null;
    },
    addEventListener() {},
  };
  return { document, all };
}

const load = (source, win, document, localStorage) => {
  new Function('window', 'document', 'localStorage', 'console', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', source)(
    win, document, localStorage, console, setTimeout, clearTimeout, (fn) => fn(),
  );
};
const settle = () => new Promise((r) => setTimeout(r, 0));
const walk = (node, out = []) => { for (const c of node.children || []) { out.push(c); walk(c, out); } return out; };
const byClass = (rootEl, cls) => walk(rootEl).filter((n) => (n.className || '').split(/\s+/).includes(cls));

new Function('globalThis', fs.readFileSync(P('tools', 'gui', 'lib', 'panelconfig.js'), 'utf8'))(globalThis);
const PC = globalThis.PresetPanelConfig;

const PANEL_SRC = fs.readFileSync(P('panel', 'fano-panel.js'), 'utf8');
const HOST_SRC = fs.readFileSync(P('panel', 'preview-host.js'), 'utf8');

/** 用一份配置真加载一次面板，返回它自己算出来的生效值 */
async function boot(cfg) {
  return bootWith(PC.patchConfig(PANEL_SRC, cfg));
}

/** 直接给面板源码（已经改好的），真加载一次 */
async function bootWith(src) {
  const dom = makeDom();
  const win = { innerWidth: 1280, innerHeight: 900, addEventListener() {} };
  const store = new Map();
  const ls = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  win.localStorage = ls;
  load(HOST_SRC, win, dom.document, ls);
  load(src, win, dom.document, ls);
  await settle();
  if (win.__FANO_PANEL__) {
    try { win.__FANO_PANEL__.open(); } catch { /* ignore */ }
    await settle();
  }
  return { win, dom, api: win.__FANO_PANEL__, rootEl: dom.document.getElementById('fano-preset-panel-v1-root') };
}

console.log('面板外观配置测试\n');

/* ── 1. 抠配置 / 写配置 ─────────────────────────────────────────── */
console.log('[1] 配置块的抠取与回写');
{
  const cfg = PC.extractConfig(PANEL_SRC);
  ok('能从面板源码里抠出 CONFIG', !!cfg && typeof cfg === 'object');
  ok('默认配置结构齐全', ['tokens', 'ball', 'window', 'layout', 'wallpaper'].every((k) => k in cfg),
    Object.keys(cfg || {}).join('、'));
  ok('默认壁纸是空的', cfg.wallpaper.url === '');
  ok('默认 scale 是 1', cfg.layout.scale === 1);

  const themes = PC.extractThemes(PANEL_SRC);
  ok('能从面板源码里抠出 THEMES', !!themes && !!themes.day['--fp-bg'] && !!themes.night['--fp-bg'],
    themes ? Object.keys(themes).join('、') : '没抠到');
  ok('day/night 两套 token 键一致',
    JSON.stringify(Object.keys(themes.day).sort()) === JSON.stringify(Object.keys(themes.night).sort()));
  ok('每个内置 token 都有中文说明（界面上不会出现没标签的颜色）',
    Object.keys(themes.day).every((k) => PC.TOKEN_SPEC.some((t) => t.key === k)),
    Object.keys(themes.day).filter((k) => !PC.TOKEN_SPEC.some((t) => t.key === k)).join('、') || '全都对得上');

  /* 回写：只动那一段 */
  const patched = PC.patchConfig(PANEL_SRC, PC.mergeConfig(cfg, { ball: { size: 60, glyph: '乃' } }));
  ok('回写后能再抠出来', PC.extractConfig(patched).ball.size === 60);
  ok('回写不碰配置块之外的内容（前后缀逐字相同）', (() => {
    const a = PANEL_SRC.indexOf(PC.BEGIN);
    const b = patched.indexOf(PC.BEGIN);
    const endA = PANEL_SRC.indexOf(PC.END);
    const endB = patched.indexOf(PC.END);
    return PANEL_SRC.slice(0, a) === patched.slice(0, b)
      && PANEL_SRC.slice(endA) === patched.slice(endB);
  })());
  ok('回写不改变代码行数之外的结构（还能被 panel-test 加载）', patched.includes('const CONFIG = {'));

  /* 标题：配置里唯一"会被人看见的文字"，必须能回写、也必须知道留空的后果。
     面板源码里的兜底文案是写死的芳乃那句——所以生成器**必须**在装进预设时落成具体的字，
     留空不是"没有标题"，而是"面板自称芳乃"（装到别人的预设上就是错的）。 */
  ok('面板自带的标题是空的（留空）', cfg.title === '', JSON.stringify(cfg.title));
  ok('面板源码里有一句写死的兜底标题（留空时真面板显示的就是它）',
    /🌸 芳乃 · 预设面板/.test(PANEL_SRC), '兜底文案不见了——留空的后果变了，去看 ui.js 的 panelTitle()');
  ok('那句兜底标题能被读出来（画布要跟着它，才不会与真面板两样）',
    PC.extractFallbackTitle(PANEL_SRC) === '🌸 芳乃 · 预设面板',
    JSON.stringify(PC.extractFallbackTitle(PANEL_SRC)));
  ok('读不出来时给空串，不抛错', PC.extractFallbackTitle('const CONFIG = {};') === ''
    && PC.extractFallbackTitle('') === '' && PC.extractFallbackTitle(null) === '');
  ok('标题能写进配置块', PC.extractConfig(PC.patchConfig(PANEL_SRC, PC.mergeConfig(cfg, { title: '某人的面板' }))).title === '某人的面板');
  ok('默认配置的形状里必须有 title（少一个键，"只改一个字段"的调用就会把标题抹掉）',
    'title' in PC.DEFAULT_CONFIG && 'version' in PC.DEFAULT_CONFIG,
    Object.keys(PC.DEFAULT_CONFIG).join('、'));
  ok('只改一个字段时标题不会消失（这条曾经真的丢过）', (() => {
    const out = PC.patchConfig(PANEL_SRC, PC.mergeConfig(cfg, { ball: { size: 60 } }));
    return PC.extractConfig(out).title === cfg.title && PC.extractConfig(out).ball.size === 60;
  })());
  ok('标题里的特殊字符不会把配置块写坏', (() => {
    const weird = '引号"\\换行\n中文🎋';
    const out = PC.patchConfig(PANEL_SRC, PC.mergeConfig(cfg, { title: weird }));
    const back = PC.extractConfig(out).title;
    return back === weird && out.includes('const CONFIG = {') && /🌸 芳乃 · 预设面板/.test(out);
  })());
  ok('写标题不碰配置块之外的内容', (() => {
    const out = PC.patchConfig(PANEL_SRC, PC.mergeConfig(cfg, { title: '甲' }));
    return PANEL_SRC.slice(PANEL_SRC.indexOf(PC.END)) === out.slice(out.indexOf(PC.END));
  })());
}

/* ── 2. 夹取逻辑必须与面板一致 ─────────────────────────────────── */
console.log('\n[2] 夹取逻辑：lib 与面板逐字段一致（防漂移）');
{
  const cases = [
    { name: '出厂默认', cfg: {} },
    { name: '越界的值', cfg: { ball: { size: 5 }, window: { w: 10, h: 99999, minW: 99999 }, layout: { scale: 9, opacity: -1, blur: 999, radius: -5 } } },
    { name: '正常自定义', cfg: { ball: { size: 60, glyph: '乃' }, window: { w: 500, h: 700, minW: 300, minH: 240, maxW: 900, maxH: 1000 }, layout: { scale: 1.25, opacity: 0.8, blur: 20, radius: 20 } } },
    { name: '非法类型', cfg: { ball: { size: '大' }, layout: { scale: null, opacity: 'x' } } },
  ];
  for (const c of cases) {
    const booted = await boot(c.cfg);
    const panelEff = booted.api.config().effective;
    const libEff = PC.clampConfig(c.cfg);
    ok(`「${c.name}」面板与 lib 的生效值一致`,
      JSON.stringify(panelEff) === JSON.stringify(libEff),
      `面板=${JSON.stringify(panelEff)}\n              lib =${JSON.stringify(libEff)}`);
  }
  const clamped = PC.clampConfig(cases[1].cfg);
  ok('越界的球大小被夹到下限 28', clamped.ball.size === 28, String(clamped.ball.size));
  ok('越界的缩放被夹到 2', clamped.layout.scale === 2, String(clamped.layout.scale));
  ok('负的不透明度被夹到 0.15', clamped.layout.opacity === 0.15, String(clamped.layout.opacity));
  ok('负的圆角被夹到 0', clamped.layout.radius === 0, String(clamped.layout.radius));
  /* 非法类型（字符串 / null）：一律回落到默认值，而不是被 Number() 蒙成 0 再夹到下限 */
  const clampedBad = PC.clampConfig(cases[3].cfg);
  ok('非法类型回落到默认（球 46 / 缩放松 1）', clampedBad.ball.size === 46 && clampedBad.layout.scale === 1,
    JSON.stringify({ ball: clampedBad.ball, scale: clampedBad.layout.scale, opacity: clampedBad.layout.opacity }));
  ok('null 也当"没写"处理（不透明回落到 1，不是 0.15）', clampedBad.layout.opacity === 1, String(clampedBad.layout.opacity));
}

/* ── 3. 配置真的生效（颜色 / 球 / 窗口 / 圆角 / 缩放）───────────── */
console.log('\n[3] 配置真的写进样式与 DOM');
{
  const b = await boot({
    tokens: { day: { '--fp-accent': '#00ff88', '--fp-bg': '#101010' }, night: { '--fp-text': '#ff00ff' } },
    ball: { size: 64, glyph: '乃' },
    window: { w: 500, h: 700, minW: 300, minH: 240 },
    layout: { radius: 22, scale: 1.2, opacity: 0.75, blur: 6 },
  });
  const style = b.dom.document.getElementById('fano-preset-panel-v1-style');
  ok('样式表被注入', !!style && style.textContent.length > 1000);
  const css = style.textContent;

  ok('自定义的主强调色进了 day 主题', /\.fp-root\[data-theme="day"\]\{[^}]*--fp-accent:#00ff88/.test(css),
    css.slice(css.indexOf('data-theme="day"'), css.indexOf('data-theme="day"') + 120));
  ok('自定义的夜间文字色进了 night 主题', /data-theme="night"\]\{[^}]*--fp-text:#ff00ff/.test(css));
  ok('没改的 token 还是出厂色（--fp-gold）', /--fp-gold:#c8a24a/.test(css));
  ok('球大小写进 CSS 变量', /--fp-ball:64px/.test(css), (css.match(/--fp-ball:[^;}]*/) || [])[0]);
  ok('圆角写进 CSS 变量', /--fp-radius:22px/.test(css));
  ok('不透明度 / 模糊写进 CSS 变量', /--fp-opacity:0\.75/.test(css) && /--fp-blur:6px/.test(css));
  ok('窗口上下限写进 CSS 变量', /--fp-minw:300px/.test(css) && /--fp-minh:240px/.test(css));
  ok('整体缩放把 CSS 里的 px 乘了 1.2（14px → 16.8px）', /font-size:16\.8px/.test(css),
    (css.match(/\.fp-title\{[^}]*/) || [''])[0].slice(0, 120));
  ok('1px 描边没被缩放放大（还是 1px）', /border:1px solid var\(--fp-border-strong\)/.test(css));

  const ball = byClass(b.rootEl, 'fp-launch')[0];
  ok('悬浮球文字用了配置的字形', ball && ball.textContent === '乃', ball ? ball.textContent : '没有球');
  const win = b.dom.document.getElementById('fano-preset-panel-v1-win');
  ok('窗口默认宽度用了配置的 500', win && win.style.width === '500px', win ? win.style.width : '没有窗口');
  ok('窗口默认高度用了配置的 700', win && win.style.height === '700px', win ? win.style.height : '');
  ok('窗口里有底色层（0 层）', byClass(win, 'fp-bglayer').length === 1);
  ok('没配壁纸时没有壁纸层', byClass(win, 'fp-wall').length === 0);
}

/* ── 4. 壁纸层 ──────────────────────────────────────────────────── */
console.log('\n[4] 壁纸：只作用面板，且文字仍可读');
{
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/wD/AL0AAAAASUVORK5CYII=';
  const b = await boot({ wallpaper: { url: tinyPng, fit: 'contain', opacity: 0.5, blur: 3, dim: 0.25, dimColor: '#220011' } });
  const win = b.dom.document.getElementById('fano-preset-panel-v1-win');
  const walls = byClass(win, 'fp-wall');
  ok('配了壁纸就有壁纸层', walls.length === 1, String(walls.length));
  ok('壁纸拟合方式写进 data-fit', walls[0]?.dataset.fit === 'contain', walls[0]?.dataset.fit);
  ok('壁纸用 background-image 挂上去', /^url\("data:image\/png;base64,/.test(walls[0]?.style.backgroundImage || ''),
    (walls[0]?.style.backgroundImage || '').slice(0, 40));
  ok('有压暗层（保证文字可读）', byClass(win, 'fp-walldim').length === 1);
  ok('壁纸层与压暗层在内容之前（层级靠后的才在上面）', (() => {
    const kids = win.children.map((c) => c.className);
    const iWall = kids.indexOf('fp-wall');
    const iDim = kids.indexOf('fp-walldim');
    return iWall >= 0 && iDim > iWall;
  })(), win.children.map((c) => c.className).join(' > '));
  const style = b.dom.document.getElementById('fano-preset-panel-v1-style').textContent;
  ok('壁纸的不透明度/模糊/压暗都进了 CSS 变量',
    /--fp-wall-opacity:0\.5/.test(style) && /--fp-wall-blur:3px/.test(style) && /--fp-wall-dim:0\.25/.test(style)
    && /--fp-wall-dim-color:#220011/.test(style));

  /* 壁纸为空时，压暗层也不该出现（否则白压一层） */
  const b2 = await boot({ wallpaper: { url: '' } });
  const win2 = b2.dom.document.getElementById('fano-preset-panel-v1-win');
  ok('壁纸为空时没有壁纸层也没有压暗层',
    byClass(win2, 'fp-wall').length === 0 && byClass(win2, 'fp-walldim').length === 0);
  ok('壁纸为空时把不透明度归零（不会白铺一层）',
    /--fp-wall-opacity:0/.test(b2.dom.document.getElementById('fano-preset-panel-v1-style').textContent));
}

/* ── 5. 校验器说实话 ───────────────────────────────────────────── */
console.log('\n[5] 导出前校验');
{
  const themes = PC.extractThemes(PANEL_SRC);
  const r1 = PC.validateConfig({}, themes);
  ok('出厂配置：没有错误', r1.errors.length === 0, JSON.stringify(r1.errors));
  ok('出厂配置：没有提醒', r1.warnings.length === 0, JSON.stringify(r1.warnings.map((w) => w.kind)));

  const r2 = PC.validateConfig({ tokens: { day: { '--fp-accent': '不是颜色' } } }, themes);
  ok('乱填颜色 → 报错', r2.errors.some((e) => e.kind === '颜色值不合法'));

  const r3 = PC.validateConfig({ wallpaper: { url: 'file:///C:/x.png' } }, themes);
  ok('壁纸用 file:// → 报错并说明会被浏览器拦', r3.errors.some((e) => e.kind === '壁纸地址不合法'));

  const big = 'data:image/png;base64,' + 'A'.repeat(700 * 1024);
  const r4 = PC.validateConfig({ wallpaper: { url: big } }, themes);
  ok('大图壁纸 → 提醒预设会被撑大', r4.warnings.some((w) => w.kind === '壁纸撑大预设'),
    JSON.stringify(r4.warnings.map((w) => w.kind)));
  ok('体积估算合理（700KB base64 ≈ 525KB 原图）',
    Math.abs(PC.estimateDataUrlBytes(big) - 700 * 1024 * 3 / 4) < 8,
    String(PC.estimateDataUrlBytes(big)));

  const r5 = PC.validateConfig({ wallpaper: { url: 'https://a/b.png', opacity: 0.9, dim: 0 } }, themes);
  ok('壁纸太实、没压暗 → 提醒文字难读', r5.warnings.some((w) => w.kind === '文字可能看不清'));

  const r6 = PC.validateConfig({ window: { w: 200, minW: 400 } }, themes);
  ok('默认宽小于最小宽 → 提醒会被夹', r6.warnings.some((w) => w.kind === '默认宽度小于最小宽度'));
  const r7 = PC.validateConfig({ layout: { opacity: 0.3, scale: 1.9 } }, themes);
  ok('太透明 / 缩放偏大 → 都有提醒',
    r7.warnings.some((w) => w.kind === '面板太透明') && r7.warnings.some((w) => w.kind === '缩放偏大'));

  const changed = PC.changedTokens({ tokens: { day: { '--fp-accent': '#123456' } } }, themes);
  ok('能列出改了哪些出厂色', changed.length === 1 && changed[0].key === '--fp-accent'
    && changed[0].from === themes.day['--fp-accent'], JSON.stringify(changed));
}

/* ── 7. 每个颜色 token 都必须真的被用到（否则"改了没反应"）────────── */
console.log('\n[7] 颜色 token 没有"死开关"：每个都真的被面板用了');
{
  const themes = PC.extractThemes(PANEL_SRC);
  const css = PC.extractCss(PANEL_SRC);
  const cssAndJs = css + PANEL_SRC.replace(css, '');
  const unused = [];
  for (const key of Object.keys(themes.day)) {
    /* 用 var(--fp-x) 或 var(--fp-x, 默认值) 两种写法都算用到了 */
    const re = new RegExp('var\\(\\s*' + key.replace(/-/g, '\\-') + '\\s*[,)]');
    if (!re.test(cssAndJs)) unused.push(key);
  }
  ok('18 个 token 全部在面板里被用到（没有"改了看不出变化"的开关）', unused.length === 0, unused.join('、'));
  ok('token 清单与内置配色一一对应',
    Object.keys(themes.day).every((k) => PC.TOKEN_SPEC.some((t) => t.key === k))
    && PC.TOKEN_SPEC.every((t) => t.key in themes.day),
    `配色 ${Object.keys(themes.day).length} 个 / 说明 ${PC.TOKEN_SPEC.length} 个`);
  ok('每个 token 都有中文说明', PC.TOKEN_SPEC.every((t) => t.label && t.label.length >= 2));
}

/* ── 8. 分组覆盖（GROUPS_OVERRIDE）：装到别人的预设上时用 ───────── */
console.log('\n[6] 分组覆盖：默认 null，写了之后面板真的照它走');{
  ok('出厂状态下分组覆盖是 null（= 用面板自带的分组）', PC.extractGroups(PANEL_SRC) === null,
    JSON.stringify(PC.extractGroups(PANEL_SRC)));

  const ov = {
    groups: [
      { id: 'custom_a', label: '我的选一组', mode: 'single', members: ['条目甲', '条目乙'] },
      { id: 'custom_b', label: '只读区', mode: 'fixed', members: ['条目丙'] },
      { id: 'custom_c', label: '自己填', mode: 'editable', editable: { 条目丁: { hint: '填这个' } }, members: ['条目丁'] },
    ],
    sections: [{ title: '我的分节', groups: ['custom_a', 'custom_b'] }, { title: '填内容', groups: ['custom_c'] }],
    thinkingTags: [{ id: 't1', label: '我的思考组', members: ['条目甲', '条目乙'] }],
  };
  const patched = PC.patchGroups(PANEL_SRC, ov);
  ok('写进去读得回来（逐字段一致）', JSON.stringify(PC.extractGroups(patched)) === JSON.stringify(ov));
  ok('只替换了那一段字面量，前后缀逐字相同', (() => {
    const a = PANEL_SRC.indexOf('const GROUPS_OVERRIDE');
    const b = patched.indexOf('const GROUPS_OVERRIDE');
    return PANEL_SRC.slice(0, a) === patched.slice(0, b);
  })());
  ok('写完仍是合法 JS', (() => { try { new Function(patched); return true; } catch { return false; } })());
  ok('外观配置块没被连带改掉', JSON.stringify(PC.extractConfig(patched)) === JSON.stringify(PC.extractConfig(PANEL_SRC)));
  ok('可以再写回 null（回到面板自带分组）', PC.extractGroups(PC.patchGroups(patched, null)) === null);

  /* 真加载面板：它必须用覆盖的分组，而不是自带那套 */
  const b = await bootWith(patched);
  const api = b.api;
  ok('面板真的用了覆盖后的分组', JSON.stringify(api.groups) === JSON.stringify(ov.groups),
    `面板拿到 ${api.groups.length} 个模块：${api.groups.map((g) => g.label).join('、')}`);
  ok('思维链互斥组也换成覆盖的', JSON.stringify(api.thinkingTags) === JSON.stringify(ov.thinkingTags),
    JSON.stringify(api.thinkingTags));
  const rootEl = b.dom.document.getElementById('fano-preset-panel-v1-root');
  const win = b.dom.document.getElementById('fano-preset-panel-v1-win');
  ok('面板照着自己的分节渲染（标题出现在界面里）', (() => {
    const text = [];
    const walk2 = (n) => { if (n._text) text.push(n._text); for (const c of n.children || []) walk2(c); };
    walk2(rootEl);
    void win;
    return text.some((t) => String(t).includes('我的分节'));
  })());
}

/* ── 9. 「装进预设」导出的脚本必须真的能开悬浮窗（不能只看字段对不对）── */
console.log('\n[9] 装进预设：从**导出的 JSON** 里取出脚本，真加载一次');
{
  const loadLib = (rel) => new Function('globalThis', fs.readFileSync(P('tools', 'gui', 'lib', rel), 'utf8'))(globalThis);
  for (const f of ['parse.js', 'assemble.js', 'invariants.js', 'editor.js', 'skeleton.js', 'groupinfer.js', 'buildops.js']) loadLib(f);
  const PP = globalThis.PresetParse;
  const PE = globalThis.PresetEditor;
  const GI = globalThis.PresetGroupInfer;
  const BOp = globalThis.PresetBuildOps;

  /* 用哪份预设当"别人的预设"：开发仓库用第三方那份（它自带一个别人的脚本，
     正好验证"我们加脚本时不动别人的"）；发布包里没有它，就用成品预设（它也自带面板脚本）。 */
  const THIRD_PARTY = 'Izumi_0914.json';
  const hasThirdParty = fs.existsSync(P(THIRD_PARTY));
  const FIXTURE = hasThirdParty ? THIRD_PARTY : path.join('preset', '芳乃预设.json');
  const raw = fs.readFileSync(P(FIXTURE), 'utf8');
  const json = JSON.parse(raw);
  const model = PP.parsePreset(json, path.basename(FIXTURE), Buffer.byteLength(raw));
  const edit = PE.emptyEdit(model, []);

  /* 走一遍 GUI 里的同一条路：推断分组 → 写进面板源码 → 加脚本 → 导出 */
  const inf = GI.inferGroups(model, json);
  const draft = { ...inf, groups: inf.groups.map((g) => ({ ...g, __section: '推断' })) };
  let attachedSrc = PC.patchConfig(PANEL_SRC, { title: '演练面板' });
  attachedSrc = PC.patchGroups(attachedSrc, BOp.toOverride(draft));
  PE.addScript(edit, json, { name: '演练 · 面板', content: attachedSrc, id: 'preset-panel' });

  const out = PE.applyEdit(json, edit, model);
  const scripts = out.extensions?.tavern_helper?.scripts ?? [];
  const mine = scripts.find((s) => s.name === '演练 · 面板');
  ok('导出的预设里确实有这条脚本', !!mine, scripts.map((s) => s.name).join('、'));
  ok('脚本字段与酒馆助手既有脚本同形',
    mine && JSON.stringify(Object.keys(mine)) === JSON.stringify(['type', 'enabled', 'name', 'id', 'content', 'info', 'button', 'data', 'export_with']),
    mine ? JSON.stringify(Object.keys(mine)) : '');
  ok('脚本默认启用（预设里带脚本的意义就是要它自己跑）', mine?.enabled === true);
  ok('原来那份预设的脚本没被动',
    scripts[0] === json.extensions.tavern_helper.scripts[0]
    && (!hasThirdParty || scripts.some((s) => s.name === '泉此方悬浮窗')),
    `脚本 ${scripts.map((s) => s.name).join('、')}`);

  /* 关键一步：真加载它 */
  const booted = await bootWith(mine.content);
  ok('脚本能跑起来（没在加载时抛错）', !!booted.api, booted.api ? `v${booted.api.version}` : '没有 __FANO_PANEL__');
  const rootEl = booted.dom.document.getElementById('fano-preset-panel-v1-root');
  ok('悬浮窗的根节点被创建出来了（这就是"打开悬浮窗的脚本"）', !!rootEl,
    rootEl ? `子元素 ${rootEl.children.length} 个` : '没有根节点');
  ok('根节点里有悬浮球与窗口两个元素', !!rootEl && rootEl.children.length >= 2,
    rootEl ? rootEl.children.map((c) => c.className).join('、') : '');
  ok('面板用上了写进去的分组（不是它自带的 25 个）',
    (booted.api?.groups?.length ?? 0) > 0 && booted.api.groups.length === draft.groups.length,
    `面板拿到 ${booted.api?.groups?.length} 个 / 草稿 ${draft.groups.length} 个`);
  ok('面板用上了写进去的标题', booted.api?.config?.()?.raw?.title === '演练面板',
    String(booted.api?.config?.()?.raw?.title));
}

console.log('\n────────────────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fails.length} 项`);
if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); process.exitCode = 1; }
