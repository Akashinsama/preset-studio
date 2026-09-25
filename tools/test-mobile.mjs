#!/usr/bin/env node
/**
 * 手机场景专项测试（假 DOM，390×844 视口）
 *
 *   node tools/test-mobile.mjs
 *
 * 复现并锁死这类问题：
 *   · 存的坐标/尺寸是桌面上留下的（x=880、宽 900），直接照用会把窗口整个推到屏外
 *     —— 表现就是"手机上打开了但什么都看不见"
 *   · 默认 380 宽在 390 的屏幕上配 right:16px，左边缘已经跑到 -6px
 *   · 屏幕旋转/缩放后窗口留在屏外（靠 resize 重新夹）
 *   · 挂载目标是内层 iframe 时会看不见（diagnose 要能报出来）
 */
import fs from 'node:fs';
import path from 'node:path';
import { need } from './lib/fixtures.mjs';

/* 夹具守卫：面板跑在假酒馆宿主里（preview-host.js，由成品预设生成）。 */
need(path.join('panel', 'preview-host.js'), '手机场景测试（20 项）');

const ROOT = process.cwd();
const P = (...a) => path.join(ROOT, ...a);

/* ── 极简 DOM 壳 ─────────────────────────────────────────────────── */
function makeDom() {
  const all = [];
  function makeEl(tag) {
    const node = {
      tagName: String(tag).toUpperCase(),
      id: '', children: [], parentNode: null,
      _listeners: Object.create(null), _text: '', _value: undefined,
      _selected: false, _disabled: false, _title: '',
      scrollTop: 0, scrollHeight: 2000, clientHeight: 500,
      style: {}, dataset: {},
      classList: { add() {}, remove() {}, contains: () => false },
      setPointerCapture() {},
      getBoundingClientRect: () => ({ left: 20, top: 20, width: 366, height: 620 }),
      /* 真 appendChild 会把节点从原父级移走，这里保持一致 */
      appendChild(c) {
        if (c.parentNode) {
          const i = c.parentNode.children.indexOf(c);
          if (i >= 0) c.parentNode.children.splice(i, 1);
        }
        c.parentNode = this; this.children.push(c); return c;
      },
      prepend(c) { c.parentNode = this; this.children.unshift(c); return c; },
      remove() {
        const p = this.parentNode;
        if (p) { const i = p.children.indexOf(this); if (i >= 0) p.children.splice(i, 1); }
        this.parentNode = null;
      },
      addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
      dispatchEvent(t, ev) { for (const f of this._listeners[t] || []) f(ev || { preventDefault() {}, stopPropagation() {} }); },
      querySelector(sel) {
        const cls = sel.startsWith('.') ? sel.slice(1) : null;
        return walk(this).find((n) => (cls
          ? String(n.className).split(' ').includes(cls)
          : n.tagName === sel.toUpperCase())) || null;
      },
      get childElementCount() { return this.children.length; },
      get lastElementChild() { return this.children[this.children.length - 1] ?? null; },
      get className() { return this._cls || ''; },
      set className(v) { this._cls = v; },
      get textContent() { return this._text; },
      set textContent(v) { this._text = String(v); this.children = []; },
      get title() { return this._title; }, set title(v) { this._title = v; },
      get disabled() { return this._disabled; }, set disabled(v) { this._disabled = !!v; },
      get selected() { return this._selected; }, set selected(v) { this._selected = !!v; },
      get value() {
        if (this.tagName === 'SELECT') {
          const sel = this.children.find((c) => c.tagName === 'OPTION' && c._selected);
          if (sel) return sel.value;
          const first = this.children.find((c) => c.tagName === 'OPTION');
          return first ? first.value : this._value;
        }
        return this._value;
      },
      set value(v) {
        this._value = v;
        if (this.tagName === 'SELECT') for (const c of this.children) if (c.tagName === 'OPTION') c._selected = c.value === v;
      },
    };
    all.push(node);
    return node;
  }
  const document = {
    head: makeEl('head'), body: makeEl('body'),
    createElement: makeEl,
    /* 真浏览器只找**挂在文档上**的节点。早先这里扫的是"创建过的全部节点"，
       于是重渲染后会返回已脱离文档的旧节点，量出来的全是过期数据。 */
    getElementById: (id) => {
      const search = (node) => {
        if (node.id === id) return node;
        for (const c of node.children || []) { const r = search(c); if (r) return r; }
        return null;
      };
      return search(document.body) || search(document.head) || null;
    },
  };
  return { document, all };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const walk = (node, out = []) => { for (const c of node.children || []) { out.push(c); walk(c, out); } return out; };

/* ── 断言 ───────────────────────────────────────────────────────── */
let pass = 0;
const fails = [];
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fails.push(name + (detail ? '　→ ' + detail : '')); console.log('  ✗ ' + name + (detail ? '　→ ' + detail : '')); }
};

/* ── 用桌面遗留的坏坐标/超大尺寸启动 ─────────────────────────────── */
const VW = 390;
const VH = 844;
const dom = makeDom();
const store = new Map();
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const winListeners = Object.create(null);
const win = {
  innerWidth: VW, innerHeight: VH,
  addEventListener(t, f) { (winListeners[t] ||= []).push(f); },
  localStorage,
};

const load = (src) => new Function('window', 'document', 'localStorage', 'console', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', src)(
  win, dom.document, localStorage, console, setTimeout, clearTimeout, (fn) => fn(),
);

/* 模拟"同一份配置在桌面上用过"：坐标在右下角、尺寸很大 */
store.set('fano-preset-panel-v1_pos_v1', JSON.stringify({ x: 880, y: 700 }));
store.set('fano-preset-panel-v1_size_v1', JSON.stringify({ w: 900, h: 1100 }));

console.log('手机场景测试（视口 390×844，带着桌面遗留的 x=880 / 900×1100）\n');

load(fs.readFileSync(P('panel', 'preview-host.js'), 'utf8'));
load(fs.readFileSync(P('panel', 'fano-panel.js'), 'utf8'));

await tick(); await tick(); await tick();

console.log('[1] 面板挂起来了');
ok('面板实例存在', !!win.__FANO_PANEL__);
const root = dom.document.getElementById('fano-preset-panel-v1-root');
ok('根节点在 DOM 里', !!root);
const winEl = dom.document.getElementById('fano-preset-panel-v1-win');
ok('窗口节点在 DOM 里', !!winEl);
ok('悬浮球在 DOM 里', !!walk(root).find((n) => n.className === 'fp-launch'));

console.log('\n[2] 尺寸被夹回视口');
const W = parseInt(winEl.style.width, 10);
const H = parseInt(winEl.style.height, 10);
ok(`宽度 ≤ 视口减边距（${VW - 24}）`, W <= VW - 24, `实际 ${W}`);
ok(`高度 ≤ 视口减边距（${VH - 140}）`, H <= VH - 140, `实际 ${H}`);
ok('宽度没被压到不可用', W >= 260, `实际 ${W}`);
ok('高度没被压到不可用', H >= 200, `实际 ${H}`);

console.log('\n[3] 坐标被夹回视口内');
const L = parseInt(winEl.style.left, 10);
const T = parseInt(winEl.style.top, 10);
ok('有 left（不是沿用 right）', winEl.style.left && winEl.style.left !== '', `left=${winEl.style.left}`);
ok('左边缘 ≥ 8', L >= 8, `实际 ${L}`);
ok('右边缘不超出视口', L + W <= VW - 8, `左${L} + 宽${W} = ${L + W} > ${VW - 8}`);
ok('上边缘 ≥ 8 且 ≤ 视口高-96', T >= 8 && T <= VH - 96, `实际 ${T}`);

console.log('\n[4] 旋转/缩放后会重新夹');
console.log(`    已挂的窗口事件：${JSON.stringify(Object.keys(winListeners).map((k) => k + '×' + winListeners[k].length))}`);
win.innerWidth = 320;               // 换成更窄的屏
win.innerHeight = 700;
for (const f of winListeners.resize || []) f({});
await new Promise((r) => setTimeout(r, 260));
/* 注意：重渲染会换掉 .fp-win 节点，必须重新取，否则量的是已脱离文档的旧节点 */
const winEl2 = dom.document.getElementById('fano-preset-panel-v1-win');
ok('resize 后窗口节点是新的', winEl2 !== winEl);
const W2 = parseInt(winEl2.style.width, 10);
const L2 = parseInt(winEl2.style.left, 10);
ok('resize 后宽度跟着收窄', W2 <= 320 - 24, `实际 ${W2}`);
ok('resize 后仍在屏内', L2 >= 8 && L2 + W2 <= 320 - 8, `左${L2} + 宽${W2} = ${L2 + W2}`);

console.log('\n[5] diagnose 能报出挂载情况（手机上排查用）');
const d = win.__FANO_PANEL__.diagnose();
ok('有 diagnose()', !!d);
ok('报出了视口尺寸', d.host.viewport === '390×844' || /×/.test(d.host.viewport), d.host.viewport);
ok('报出了挂载目标', typeof d.host.mountedOn === 'string', d.host.mountedOn);
ok('报出了是否跨域回退', typeof d.host.crossOriginFallback === 'boolean', String(d.host.crossOriginFallback));
ok('报出了悬浮球是否在 DOM 里', d.launchInDom === true, String(d.launchInDom));

console.log('\n────────────────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fails.length} 项`);
if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); process.exitCode = 1; }
