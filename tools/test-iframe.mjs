#!/usr/bin/env node
/**
 * iframe / 时序场景测试（假 DOM）
 *
 *   node tools/test-iframe.mjs
 *
 * 为什么单独一个测试：面板必须挂到**最外层同源文档**。酒馆助手脚本本身跑在 iframe 里，
 * 挂错层就会渲染在看不见的框里——而"桌面上好用、手机上打不开"最典型的原因就是这里。
 * 之前所有浏览器测试都是顶层文档，这条路径**从没被测过**。
 *
 * 覆盖三种情形：
 *   1. 两层嵌套 iframe → 必须挂到最顶层（防截断拦截器同理：要装到**最外层**窗口的 fetch 上，
 *      只往上看一层就会装到中间的 iframe 上，等于没装）
 *   2. 顶层文档的 body 还没就绪 → 不能退回内层，要等就绪后挂上顶层
 *   3. 父窗口跨域（parent.document 抛异常）→ 只能退回本地，并且必须标记出来让面板示警
 *      （防截断这时**宁可不装**：装到不发请求的内层去，只会让人以为它在工作）
 */
import fs from 'node:fs';
import path from 'node:path';
import { need } from './lib/fixtures.mjs';

/* 夹具守卫：面板跑在假酒馆宿主里（preview-host.js，由成品预设生成）。 */
need(path.join('panel', 'preview-host.js'), 'iframe / 时序场景测试（33 项）');

const ROOT = process.cwd();
const P = (...a) => path.join(ROOT, ...a);
const PANEL_SRC = fs.readFileSync(P('panel', 'fano-panel.js'), 'utf8');
const HOST_SRC = fs.readFileSync(P('panel', 'preview-host.js'), 'utf8');

/* ── 造一个可以嵌套的假 window/document ───────────────────────────── */
function makeFrame(label, { bodyReady = true, ballRect = null } = {}) {
  const all = [];
  let body = null;
  let head = null;

  function makeEl(tag) {
    const node = {
      tagName: String(tag).toUpperCase(),
      id: '', children: [], parentNode: null, _cls: '',
      _listeners: Object.create(null), _text: '', _value: undefined,
      _selected: false, _disabled: false, _title: '',
      scrollTop: 0, scrollHeight: 2000, clientHeight: 500,
      style: {}, dataset: {},
      classList: { add() {}, remove() {}, contains: () => false },
      setPointerCapture() {},
      /* 用普通函数（不是箭头）以便拿到 this；ballRect 可让某个用例把悬浮球"摆到视口外" */
      getBoundingClientRect() {
        const DEFAULT_RECT = { left: 20, top: 20, width: 366, height: 620 };
        const isBall = String(this._cls || '').split(' ').includes('fp-launch');
        if (!isBall) return DEFAULT_RECT;
        if (typeof ballRect === 'function') return ballRect() || DEFAULT_RECT;
        return ballRect || DEFAULT_RECT;
      },
      /* 真 appendChild 会把节点从原父级移走（不是两边都留），这里必须一致，
         否则"改挂到 documentElement"会看起来像复制了一份。 */
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
      get className() { return this._cls; }, set className(v) { this._cls = v; },
      get textContent() { return this._text; }, set textContent(v) { this._text = String(v); this.children = []; },
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
  const walk = (node, out = []) => { for (const c of node.children || []) { out.push(c); walk(c, out); } return out; };

  head = makeEl('head');
  if (bodyReady) body = makeEl('body');

  const doc = {
    label,
    get body() { return body; },
    get head() { return head; },
    documentElement: makeEl('html'),
    createElement: makeEl,
    /* 真文档的根是 <html>（documentElement）：面板可能被挂在它下面（body 的兄弟），
       所以搜索必须从 documentElement 开始，否则会误判"找不到"而重复创建一份。 */
    getElementById: (id) => {
      const search = (node) => {
        if (!node) return null;
        if (node.id === id) return node;
        for (const c of node.children || []) { const r = search(c); if (r) return r; }
        return null;
      };
      return search(doc.documentElement) || search(body) || search(head) || null;
    },
    addEventListener() {},
    /* 模拟"解析完成" */
    finishParsing() { if (!body) body = makeEl('body'); },
  };

  const win = {
    label,
    document: doc,
    innerWidth: 390,
    innerHeight: 844,
    parent: null,
    addEventListener() {},
    /* 脚本层防截断就装在这个 fetch 上；每个 frame 各给一个，才分得清"装到了哪一层" */
    fetch: async () => new Response('', { status: 200 }),
  };
  return { win, doc, get body() { return body; }, finishParsing: () => doc.finishParsing() };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await tick(); };

let pass = 0;
const fails = [];
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fails.push(name + (detail ? '　→ ' + detail : '')); console.log('  ✗ ' + name + (detail ? '　→ ' + detail : '')); }
};

const store = new Map();
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

function loadIn(targetWin, src) {
  new Function('window', 'document', 'localStorage', 'console', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', src)(
    targetWin, targetWin.document, localStorage, console, setTimeout, clearTimeout, (fn) => fn(),
  );
}

/* ── 情形 1：两层嵌套 iframe ─────────────────────────────────────── */
console.log('iframe / 时序场景测试\n');
console.log('[1] 两层嵌套 iframe → 必须挂到最顶层');
{
  const top = makeFrame('top');
  const mid = makeFrame('mid');
  const inner = makeFrame('inner');
  inner.win.parent = mid.win;
  mid.win.parent = top.win;
  top.win.parent = top.win;          // 顶层：parent === self
  const fetches = { top: top.win.fetch, mid: mid.win.fetch, inner: inner.win.fetch };

  loadIn(inner.win, HOST_SRC);
  loadIn(inner.win, PANEL_SRC);
  await settle(8);

  const rootTop = top.doc.getElementById('fano-preset-panel-v1-root');
  const rootInner = inner.doc.getElementById('fano-preset-panel-v1-root');
  ok('面板挂到了最顶层文档', !!rootTop);
  ok('内层 iframe 里没有面板', !rootInner);
  ok('顶层有悬浮球', !!(rootTop && rootTop.querySelector('.fp-launch')));
  const d = inner.win.__FANO_PANEL__ && inner.win.__FANO_PANEL__.diagnose();
  ok('diagnose 报出挂载在「外层文档」', d && d.host.mountedOn === '外层文档', d ? d.host.mountedOn : '无');
  ok('diagnose 报出嵌套深度 2', d && d.host.depth === 2, d ? String(d.host.depth) : '无');

  /* 脚本层防截断：请求是**最外层**窗口发的，所以拦截器必须装到那一层的 fetch 上。
     只往上看一层（window.parent ?? window）就会装到 mid 上，等于没装。 */
  const at = top.win.__FANO_ANTITRUNC__;
  ok('防截断拦截器装到了最外层窗口的 fetch 上（不是 iframe 自己那层）',
    !!at && at.installed() === true && top.win.fetch !== fetches.top,
    at ? JSON.stringify({ installed: at.installed(), 认的宿主是最外层: at.hostWindow() === top.win }) : '没有 __FANO_ANTITRUNC__');
  ok('中间那层没被装（说明确实爬到了最外层，不是只爬一层）', mid.win.fetch === fetches.mid);
  ok('内层（脚本所在那层）自己的 fetch 也没被动过', inner.win.fetch === fetches.inner);
  ok('控制台 API 挂在最外层窗口上，开关默认开着',
    typeof at?.isEnabled === 'function' && at.isEnabled() === true);
}

/* ── 情形 2：顶层 body 还没就绪 ─────────────────────────────────── */
console.log('\n[2] 顶层文档 body 还没就绪 → 要等，不能退回内层');
{
  const top = makeFrame('top', { bodyReady: false });
  const inner = makeFrame('inner');
  inner.win.parent = top.win;

  loadIn(inner.win, HOST_SRC);
  loadIn(inner.win, PANEL_SRC);
  await settle(4);
  ok('body 未就绪时，内层也没有面板（没有误挂）', !inner.doc.getElementById('fano-preset-panel-v1-root'));

  top.finishParsing();               // 父文档解析完成
  await settle(12);
  const rootTop = top.doc.getElementById('fano-preset-panel-v1-root');
  ok('body 就绪后，面板补挂到了顶层', !!rootTop);
  ok('内层仍未出现面板', !inner.doc.getElementById('fano-preset-panel-v1-root'));
  const d = inner.win.__FANO_PANEL__.diagnose();
  ok('diagnose 报出 body 已就绪', d.host.bodyReady === true, String(d.host.bodyReady));
}

/* ── 情形 3：父窗口跨域 ─────────────────────────────────────────── */
console.log('\n[3] 父窗口跨域（parent.document 抛异常）→ 退回本地并示警');
{
  const inner = makeFrame('inner');
  inner.win.parent = {
    get document() { throw new Error('Blocked a frame with origin "null" from accessing a cross-origin frame.'); },
  };
  const innerFetch0 = inner.win.fetch;

  loadIn(inner.win, HOST_SRC);
  loadIn(inner.win, PANEL_SRC);
  await settle(8);

  const rootLocal = inner.doc.getElementById('fano-preset-panel-v1-root');
  ok('退回本地文档并渲染（至少不是完全没东西）', !!rootLocal);
  const d = inner.win.__FANO_PANEL__.diagnose();
  ok('diagnose 标记了跨域回退', d.host.crossOriginFallback === true, String(d.host.crossOriginFallback));
  const warn = rootLocal && String(rootLocal.textContent || '').includes('跨域');
  ok('面板顶部显示了跨域警告', warn || !!(rootLocal && rootLocal.querySelector('.fp-warnbox')));

  /* 防截断：拿不到宿主窗口时**宁可不装**，也不能装到 iframe 自己那层（那层不发请求），
     更不能因此把开关悄悄改掉——开关照旧是"开"，只是 installed=false，面板会提示用户。 */
  const at3 = globalThis.__FANO_ANTITRUNC__;
  ok('跨域时：没装（installed=false），但开关没被动过（还是开）',
    !!at3 && at3.installed() === false && at3.isEnabled() === true,
    at3 ? JSON.stringify({ installed: at3.installed(), enabled: at3.isEnabled() }) : '没有 __FANO_ANTITRUNC__');
  ok('跨域时也没往 iframe 自己的 fetch 上乱挂', inner.win.fetch === innerFetch0);
  ok('认不出宿主窗口（hostWindow() 给 null）', at3 && at3.hostWindow() === null, String(at3 && at3.hostWindow()));
}

/* ── 情形 4：版本号与 reset() ───────────────────────────────────── */
console.log('\n[4] 版本号与自救入口');
{
  const top = makeFrame('top');
  const inner = makeFrame('inner');
  inner.win.parent = top.win;
  loadIn(inner.win, HOST_SRC);
  loadIn(inner.win, PANEL_SRC);
  await settle(8);
  const api = inner.win.__FANO_PANEL__;
  ok('版本号已更新到 0.5.x', /^0\.5\./.test(api.version), api.version);
  ok('暴露了能力清单（长按改正文；编辑器导出前检查认它）',
    typeof api.caps === 'function' && api.caps().longPressEdit === true, JSON.stringify(api.caps && api.caps()));
  ok('暴露了外观配置（给生成器的「面板外观」对照用）',
    typeof api.config === 'function' && !!api.config().effective?.layout, JSON.stringify(Object.keys(api.config?.() ?? {})));
  ok('有 reset()（卡住时的自救入口）', typeof api.reset === 'function');
  store.set('fano-preset-panel-v1_pos_v1', JSON.stringify({ x: 9999, y: 9999 }));
  const msg = api.reset();
  ok('reset() 返回了说明', typeof msg === 'string' && msg.length > 4, msg);
  ok('reset() 清掉了存的位置', localStorage.getItem('fano-preset-panel-v1_pos_v1') === null);
  await settle(4);
  ok('reset() 后面板还在', !!top.doc.getElementById('fano-preset-panel-v1-root'));
}

/* ── 情形 5：看不见时用酒馆 toast 播报原因（手机没控制台）───────── */
console.log('\n[5] 启动自检：看不见就说清楚原因');
{
  /* 5a. 跨域回退 → 必须播报 */
  const inner = makeFrame('inner');
  inner.win.parent = {
    get document() { throw new Error('cross-origin'); },
  };
  const said = [];
  inner.win.toastr = { error: (m) => said.push(m), info: (m) => said.push(m), success: (m) => said.push(m) };
  loadIn(inner.win, HOST_SRC);
  loadIn(inner.win, PANEL_SRC);
  await settle(12);
  ok('跨域时播报了一条消息', said.some((m) => /芳乃面板/.test(m)), said.join(' | ') || '（没播报）');
  ok('播报内容点明了跨域', said.some((m) => /跨域/.test(m)), said.join(' | '));

  /* 5b. 一切正常 → 不该打扰用户 */
  const top2 = makeFrame('top');
  const inner2 = makeFrame('inner');
  inner2.win.parent = top2.win;
  const said2 = [];
  inner2.win.toastr = { error: (m) => said2.push(m), info: (m) => said2.push(m), success: (m) => said2.push(m) };
  loadIn(inner2.win, HOST_SRC);
  loadIn(inner2.win, PANEL_SRC);
  await settle(12);
  ok('正常挂载时不打扰用户', said2.length === 0, said2.join(' | '));
}

/* ── 情形 6：悬浮球跑飞 → 自动换挂载点（自愈）───────────────────── */
console.log('\n[6] 悬浮球跑飞时自动换挂载点');
{
  /* 复现手机上的实测数据：悬浮球算到 (12,-158)，视口 360×695。
     这类跑飞通常是 body 或其祖先带了 transform/filter/contain，
     把 position:fixed 的包含块换掉了。换挂到 documentElement 应能绕开。 */
  let broken = true;
  const top = makeFrame('top', { ballRect: () => (broken ? { left: 12, top: -158, width: 46, height: 46 } : null) });
  /* 换到 documentElement 之后就不再"跑飞" */
  const origAppend = top.doc.documentElement.appendChild.bind(top.doc.documentElement);
  let docElAppends = 0;
  top.doc.documentElement.appendChild = (c) => {
    docElAppends++;
    broken = false;
    return origAppend(c);
  };

  const inner = makeFrame('inner');
  inner.win.parent = top.win;
  const said = [];
  inner.win.toastr = { error: (m) => said.push(m), info: (m) => said.push(m), success: (m) => said.push(m) };
  loadIn(inner.win, HOST_SRC);
  loadIn(inner.win, PANEL_SRC);
  await settle(12);

  const rootOnDocEl = top.doc.documentElement.children.find((c) => c.id === 'fano-preset-panel-v1-root');
  ok('跑飞后把面板改挂到了 documentElement', !!rootOnDocEl, `documentElement 子节点 ${docElAppends} 次追加`);
  ok('body 下不再留着面板（真 appendChild 会把节点移走）',
    !top.body || !top.body.children.some((c) => c.id === 'fano-preset-panel-v1-root'));
  const d = inner.win.__FANO_PANEL__.diagnose();
  ok('diagnose 报出挂载点已改', d.mountedOn === 'documentElement', d.mountedOn);
  ok('diagnose 带上了位置校验结果', !!d.placement, JSON.stringify(d.placement));
  ok('改挂后不再播报"跑飞"', !said.some((m) => /视口外/.test(m)), said.join(' | '));
}

console.log('\n────────────────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fails.length} 项`);
if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); process.exitCode = 1; }
