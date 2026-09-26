#!/usr/bin/env node
/**
 * 面板逻辑测试（不需要浏览器）
 *
 *   node tools/test-panel.mjs
 *
 * 用极简 DOM 壳把 panel/fano-panel.js 真跑起来，断言：
 *   · 手风琴：默认折叠、点标题展开、状态在标题可见、折叠状态持久化
 *   · 破甲：先选骨架（三选一互斥），再调这一套骨架的档位（single/multi/text）
 *   · 档位不会被切换模型清掉；"必选一"档位缺省时自动补默认
 *   · 角色名替换表生效（匹配用源名，显示用芳乃名）
 *   · 改完选项不跳回顶部（scrollTop 保持）
 *   · 每次操作只写回一次预设
 *   · 脚本层防截断：顶部「🛡 防截断」点一下真的装/卸拦截器，假上游发一次 generate，
 *     正文真的从合成函数的 content 参数里回来（finish_reason 改回 stop）
 */
import fs from 'node:fs';
import path from 'node:path';
import { needAll } from './lib/fixtures.mjs';

/* 夹具守卫：面板跑在**假酒馆宿主**里，宿主数据是从成品预设生成的（panel/preview-host.js）。 */
needAll([path.join('panel', 'preview-host.js'), path.join('preset', '芳乃预设.json')],
  '面板逻辑测试（137 项）',
  'preview-host.js 由 node tools/build-preview.mjs 生成，它要成品预设');

const ROOT = process.cwd();
const P = (...a) => path.join(ROOT, ...a);

/* ── 极简 DOM 壳 ─────────────────────────────────────────────────── */
function makeDom() {
  const all = [];
  function makeEl(tag) {
    const node = {
      tagName: String(tag).toUpperCase(),
      id: '',
      children: [],
      parentNode: null,
      _listeners: Object.create(null),
      _text: '',
      _value: undefined,
      _selected: false,
      _disabled: false,
      _title: '',
      scrollTop: 0,
      scrollHeight: 2000,
      clientHeight: 400,
      style: {},
      dataset: {},
      classList: { add() {}, remove() {}, contains: () => false },
      setPointerCapture() {},
      getBoundingClientRect: () => ({ left: 20, top: 20, width: 380, height: 620 }),
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
      get childElementCount() { return this.children.length; },
      get lastElementChild() { return this.children[this.children.length - 1] ?? null; },
      get className() { return this._cls || ''; },
      set className(v) { this._cls = v; },
      get textContent() { return this._text; },
      set textContent(v) { this._text = String(v); this.children = []; },
      get title() { return this._title; },
      set title(v) { this._title = v; },
      get disabled() { return this._disabled; },
      set disabled(v) { this._disabled = !!v; },
      get selected() { return this._selected; },
      set selected(v) { this._selected = !!v; },
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
        if (this.tagName === 'SELECT') {
          for (const c of this.children) if (c.tagName === 'OPTION') c._selected = c.value === v;
        }
      },
    };
    all.push(node);
    return node;
  }
  const document = {
    head: makeEl('head'),
    body: makeEl('body'),
    createElement: makeEl,
    /* 真浏览器只找**挂在文档上**的节点。早先这里扫的是"创建过的全部节点"，
       重渲染后会返回已脱离文档的旧节点，量出来的全是过期数据。 */
    getElementById: (id) => {
      const search = (node) => {
        if (node.id === id) return node;
        for (const c of node.children || []) { const r = search(c); if (r) return r; }
        return null;
      };
      return search(document.body) || search(document.head) || null;
    },
    /* 真文档有 addEventListener（面板要往它上面挂 keydown / 长按吞点击）。
       假文档早先没给，于是 render() 走到最后一步就抛异常——面板能画出来，
       但"启动失败"会打印一行，长按这条路径也没法测。 */
    addEventListener() {},
  };
  return { document, all };
}

function load(source, win, document, localStorage) {
  new Function('window', 'document', 'localStorage', 'console', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', source)(
    win, document, localStorage, console, setTimeout, clearTimeout, (fn) => fn(),
  );
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const walk = (node, out = []) => { for (const c of node.children || []) { out.push(c); walk(c, out); } return out; };
const opts = (sel) => sel.children.filter((c) => c.tagName === 'OPTION');

const dom = makeDom();
const win = { innerWidth: 1280, innerHeight: 900, addEventListener() {}, localStorage: null };
const store = new Map();
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
win.localStorage = localStorage;

/* 脚本层防截断要用到的两样东西，必须在面板加载**之前**就位：
   1) window.fetch —— 拦截器就是往它上面挂包装（这里放一个记录请求的假后端）
   2) 顶部按钮 API —— 面板接线时用特性检测找它们（找不到就静默跳过）
      注意：假宿主 preview-host.js 自己也放了一个 `window.eventOn` 空桩，
      所以这三个 API 要等它加载完再盖一次（见下面那段），否则面板接上去的是宿主的空实现。
   事件名与按钮名跟 CONFIG.button 里的一致（默认就是这两个）。 */
const requests = [];
const rawFetch = async (url, init) => {
  const body = JSON.parse(init.body);
  requests.push({ url, body });
  const chunk = (delta, finish) => 'data: ' + JSON.stringify({
    id: 'chatcmpl-test', model: 'fake', created: 1,
    choices: [{ index: 0, delta, finish_reason: finish ?? null }],
  }) + '\n\n';
  /* 假上游：把正文塞进那个合成函数的 content 参数里回传（分两块，模拟流式切片）。
     要是请求里没有合成函数（开关关着，拦截器没参与），就照常回一段普通正文。 */
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const tool = tools.length ? tools[tools.length - 1].function.name : null;
  const sse = tool
    ? chunk({ tool_calls: [{ index: 0, function: { name: tool, arguments: '{"content":"完整正文' } }] })
      + chunk({ tool_calls: [{ index: 0, function: { arguments: '·二号"}' } }] })
      + chunk({}, 'tool_calls')
    : chunk({ content: '普通通道的正文' }) + chunk({}, 'stop');
  return new Response(sse + 'data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
};
win.fetch = rawFetch;
const declaredButtons = [];
const buttonEvents = new Map();
const clickButton = (name) => {
  const fn = buttonEvents.get('evt:' + name);
  if (fn) fn();
  return !!fn;
};

load(fs.readFileSync(P('panel', 'preview-host.js'), 'utf8'), win, dom.document, localStorage);

/* 假宿主加载完再装按钮 API：它自己那个 `window.eventOn` 空桩会盖掉先装的（见上面注释）。 */
win.appendInexistentScriptButtons = (list) => { declaredButtons.push(...list.map((b) => b.name)); };
win.getButtonEvent = (name) => 'evt:' + name;
win.eventOn = (evt, fn) => { buttonEvents.set(evt, fn); };

let writes = 0;
const rawWrite = win.updatePresetWith;
win.updatePresetWith = async (...args) => { writes++; return rawWrite(...args); };

load(fs.readFileSync(P('panel', 'fano-panel.js'), 'utf8'), win, dom.document, localStorage);

/* 三击手势要**等一个窗口**单击才生效（见面板里的 rowClicks：不等就分不清第 2、3 下）。
   凡是"点一下然后马上断言"的地方，都得先 await 这一个。 */
const settleClick = async () => {
  await new Promise((r) => setTimeout(r, win.__FANO_PANEL__.config().effective.edit.tripleClick.ms + 40));
};

/* ── 断言 ───────────────────────────────────────────────────────── */
let pass = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fails.push(name + (detail ? '　→ ' + detail : '')); console.log('  ✗ ' + name + (detail ? '　→ ' + detail : '')); }
}

const mock = () => win.__MOCK_PRESET__;
const enabledSet = () => new Set(mock().prompts.filter((p) => p.enabled !== false).map((p) => p.name));
const contentOf = (n) => mock().prompts.find((p) => p.name === n)?.content ?? '';
const spec = JSON.parse(fs.readFileSync(P('spec', 'groups.json'), 'utf8'));
const groups = spec.groups;
const DISPLAY = spec.display || {};

/* 第一条断言：测试用的假数据必须比成品新，否则测的是上一版预设。
   （早先 build-panel.mjs 在 build-preset.mjs 之前跑，就栽在这里。） */
{
  const pf = fs.readdirSync(P('preset')).filter((f) => f.startsWith('芳乃预设') && f.endsWith('.json')).sort();
  const presetPath = P('preset', pf[pf.length - 1]);
  const hostPath = P('panel', 'preview-host.js');
  const newer = fs.statSync(hostPath).mtimeMs >= fs.statSync(presetPath).mtimeMs;
  ok('预览假数据不比成品旧（否则测的是上一版）', newer,
    newer ? '' : `preview-host.js 比 ${pf[pf.length - 1]} 旧，请重跑 build-preview.mjs`);
  ok('preset/ 下只有一份成品（避免导入时拿错旧版）', pf.length === 1, pf.join('、'));
}

console.log('\n启动面板…');
await tick(); await tick(); await tick();

const root = () => dom.document.getElementById('fano-preset-panel-v1-root');
const nodes = () => walk(root());
const mods = () => nodes().filter((n) => n.className === 'fp-mod');
const modOf = (id) => mods().find((n) => n.dataset.group === id);
const stateOf = (m) => (m ? walk(m).find((n) => n.className === 'fp-modstate')?.textContent : undefined);
const openIds = () => mods().filter((m) => m.dataset.open === '1').map((m) => m.dataset.group);
const inMod = (id) => { const m = modOf(id); return m ? walk(m) : []; };
const selWith = (id, values) => inMod(id).find((n) => n.tagName === 'SELECT' && opts(n).some((o) => values.includes(o.value)));
const switchesIn = (id) => inMod(id).filter((n) => n.className === 'fp-sw');
const tunableLabels = (id) => inMod(id).filter((n) => n.className === 'fp-tunlabel').map((n) => n.textContent);

async function expand(id) {
  const m = modOf(id);
  if (m && m.dataset.open !== '1') { walk(m).find((n) => n.className === 'fp-modhead').dispatchEvent('click'); await tick(); await tick(); }
}

ok('面板已挂载', !!win.__FANO_PANEL__);
ok('渲染出全部模块', mods().length === groups.length, `${mods().length}/${groups.length}`);
ok('默认全部折叠', openIds().length === 0);
const smState = stateOf(modOf('style_main'));
ok('折叠时标题显示当前状态', !!smState && smState !== '未选', String(smState));

/* ── 1. 来源提示词命名：一律不改 ────────────────────────────────── */
console.log('\n[1] 来源提示词命名：一律不改（泉此方 / 小此 / Konata 原文保留）');
ok('display 映射为空（没有任何改名）', Object.keys(DISPLAY).length === 0, `${Object.keys(DISPLAY).length} 条`);
const outMode = groups.find((g) => g.id === 'out_mode');
const srcName = outMode.members.find((m) => m.includes('小此')) || outMode.members[0];
ok('选中一个带「小此」的源条目做样本', srcName.includes('小此'), srcName);
await expand('out_mode');
const selOut = selWith('out_mode', outMode.members);
ok('找得到输出模式下拉框', !!selOut);
const shownLabels = opts(selOut).map((o) => o.textContent).join(' ');
ok('界面显示的就是源条目原名', shownLabels.includes(srcName), srcName);
ok('「小此」没有被换成别的名字', shownLabels.includes('小此'));
/* 点击必须作用在原名上（否则改不动预设） */
const before1 = writes;
selOut.value = srcName; selOut.dispatchEvent('change');
await tick(); await tick();
ok('选原名 → 打开的正是那条源条目', enabledSet().has(srcName), srcName + (enabledSet().has(srcName) ? ' 已开' : ' 没开'));
ok('写回次数 = 1', writes - before1 === 1, `实际 ${writes - before1}`);

/* 芳乃只来自新增主体层 */
console.log('\n[1b] 芳乃主体层：只增不改');
const fanoGroup = groups.find((g) => g.id === 'fano');
ok('有芳乃主体层模块', !!fanoGroup, fanoGroup ? fanoGroup.members.length + ' 条' : '无');
ok('芳乃模块里的名字都带 🌸 前缀', (fanoGroup?.members ?? []).every((m) => m.startsWith('🌸')));
await expand('fano');
const fanoSw = switchesIn('fano').map((n) => n.children[0]?.textContent);
ok('芳乃三条都渲染成开关', fanoSw.length === (fanoGroup?.members.length ?? 0), fanoSw.join('、'));
ok('芳乃条目默认关闭', enabledSet().has(fanoGroup.members[0]) === false, fanoGroup.members[0]);
const bFano = writes;
switchesIn('fano')[0].dispatchEvent('click');
await settleClick();
ok('打开芳乃主体层写回 1 次', writes - bFano === 1, `实际 ${writes - bFano}`);
ok('芳乃主体层真的被打开', enabledSet().has(fanoGroup.members[0]));

/* ── 2. 破甲：骨架 + 档位 ──────────────────────────────────────── */
const jb = groups.find((g) => g.id === 'jailbreak');
const optOf = (id) => jb.options.find((o) => o.id === id);
await expand('jailbreak');
console.log('\n[2] 破甲：先选骨架');
let sel = selWith('jailbreak', ['gemini', 'dsglm', 'izumi', 'manual']);
ok('有骨架下拉框', !!sel);
ok('骨架下拉框有 4 项（三家 + 手动）', sel && opts(sel).length === 4);

let b = writes;
sel.value = 'izumi'; sel.dispatchEvent('change');
await tick(); await tick();
let on = enabledSet();
ok('切到其他模型：写回 1 次', writes - b === 1, `实际 ${writes - b}`);
ok(`Izumi 骨架 ${optOf('izumi').members.length} 条全开`, optOf('izumi').members.every((n) => on.has(n)),
  optOf('izumi').members.filter((n) => !on.has(n)).join(','));
ok('Kemini 骨架全关', optOf('gemini').members.every((n) => !on.has(n)));
ok('梦鲸骨架全关', optOf('dsglm').members.every((n) => !on.has(n)));

console.log('\n[3] 档位只显示当前那一套');
ok('展开后列出了 Izumi 的档位', JSON.stringify(tunableLabels('jailbreak')) === JSON.stringify(optOf('izumi').tunables.map((t) => t.label)),
  tunableLabels('jailbreak').join('、'));

console.log('\n[4] 切到 Gemini，档位跟着换');
b = writes;
sel = selWith('jailbreak', ['gemini', 'dsglm', 'izumi', 'manual']);
sel.value = 'gemini'; sel.dispatchEvent('change');
await tick(); await tick();
on = enabledSet();
ok('切到 Gemini：写回 1 次', writes - b === 1, `实际 ${writes - b}`);
ok(`Kemini 骨架 ${optOf('gemini').members.length} 条全开`, optOf('gemini').members.every((n) => on.has(n)),
  optOf('gemini').members.filter((n) => !on.has(n)).join(','));
ok('Izumi 骨架全关', optOf('izumi').members.every((n) => !on.has(n)));
ok('档位换成了 Kemini 的 3 项', JSON.stringify(tunableLabels('jailbreak')) === JSON.stringify(optOf('gemini').tunables.map((t) => t.label)),
  tunableLabels('jailbreak').join('、'));

/* 必选一：把渠道档位全关掉，再切走切回，应自动补默认（用 DS/GLM 的渠道档位验） */
console.log('\n[5] 必选一档位：缺省时自动补默认');
const chanT = optOf('dsglm').tunables.find((t) => t.id === 'mj_channel');
ok('找到「渠道 / 思考标签」档位', !!chanT && chanT.ensureOne === true);
sel = selWith('jailbreak', ['gemini', 'dsglm', 'izumi', 'manual']);
sel.value = 'dsglm'; sel.dispatchEvent('change');
await tick(); await tick();
for (const m of chanT.members) { const p = find0(m); if (p) p.enabled = false; }
sel = selWith('jailbreak', ['gemini', 'dsglm', 'izumi', 'manual']);
sel.value = 'gemini'; sel.dispatchEvent('change');
await tick(); await tick();
ok('切走时渠道档位是关的', chanT.members.every((m) => !enabledSet().has(m)), chanT.members.filter((m) => enabledSet().has(m)).join(','));
sel = selWith('jailbreak', ['gemini', 'dsglm', 'izumi', 'manual']);
sel.value = 'dsglm'; sel.dispatchEvent('change');
await tick(); await tick();
ok('切回时自动补了默认档位', enabledSet().has(chanT.default), chanT.default);
ok('只补了一个（互斥没坏）', chanT.members.filter((m) => enabledSet().has(m)).length === 1,
  chanT.members.filter((m) => enabledSet().has(m)).join(','));

/* ── 5b. 思维链标签互斥：两套标签不能同时开 ───────────────────── */
console.log('\n[5b] 思维链标签互斥（切换思考方式不会出现两种形态）');
const tags = spec.thinkingTags ?? [];
ok('规格里有 2 套思维链标签', tags.length === 2, `${tags.length} 套`);
const keminiTag = tags.find((t) => t.id === 'kemini');
const izumiTag = tags.find((t) => t.id === 'izumi');
const familiesOn = () => {
  const on = new Set(tags.flatMap((t) => t.members).filter((n) => enabledSet().has(n)));
  return tags.filter((t) => t.members.some((m) => on.has(m))).map((t) => t.id);
};
const tagNamesOn = () => tags.flatMap((t) => t.members).filter((n) => enabledSet().has(n));
ok('初始只开一套标签（不会混排）', familiesOn().length <= 1, `开着：${tagNamesOn().join('、') || '（无）'}`);

await expand('cot');
const cotGroup = groups.find((g) => g.id === 'cot');
ok('思维链下拉框收录了 Kemini 的 ICOT/COT',
  cotGroup.members.includes('📽️ICOT（三段）') && cotGroup.members.includes('📽️COT（格式友好型）'));

b = writes;
let cotSel = selWith('cot', cotGroup.members);
cotSel.value = '思维链-注重流畅性'; cotSel.dispatchEvent('change');
await tick(); await tick();
ok('选 Izumi 思维链写回 1 次', writes - b === 1, `实际 ${writes - b}`);
ok('Izumi 那条开了', enabledSet().has('思维链-注重流畅性'));
ok('Kemini 的 ICOT/COT 被自动关掉', keminiTag.members.every((m) => !enabledSet().has(m)),
  keminiTag.members.filter((m) => enabledSet().has(m)).join('、'));
ok('当前只有一套标签开着', familiesOn().length === 1 && familiesOn()[0] === 'izumi', familiesOn().join('、'));

b = writes;
cotSel = selWith('cot', cotGroup.members);
cotSel.value = '📽️ICOT（三段）'; cotSel.dispatchEvent('change');
await tick(); await tick();
ok('选 ICOT 写回 1 次', writes - b === 1, `实际 ${writes - b}`);
ok('ICOT 开了', enabledSet().has('📽️ICOT（三段）'));
ok(`Izumi 那套 ${izumiTag.members.length} 条全被关掉`, izumiTag.members.every((m) => !enabledSet().has(m)),
  izumiTag.members.filter((m) => enabledSet().has(m)).join('、'));
ok('当前只有一套标签开着', familiesOn().length === 1 && familiesOn()[0] === 'kemini', familiesOn().join('、'));
/* 单块 / 多块 → 形态由条数决定，而条数由 COT / ICOT 决定 */
ok('ICOT 是"三段"（模型会吐 3 个思考块 → Kemini 形态）',
  (mock().prompts.find((p) => p.name === '📽️ICOT（三段）')?.content ?? '').includes('分为三段'));
ok('COT 是单块（→ Izumi 形态）',
  (mock().prompts.find((p) => p.name === '📽️COT（格式友好型）')?.content ?? '').includes('</thinking>')
  && !(mock().prompts.find((p) => p.name === '📽️COT（格式友好型）')?.content ?? '').includes('分为三段'));

/* ── 5c. MVU 一键开关 ─────────────────────────────────────────── */
console.log('\n[5c] MVU 变量更新：一键开关');
const mvuGroup = groups.find((g) => g.id === 'mvu');
ok('规格里有 MVU 模块', !!mvuGroup, mvuGroup ? `${mvuGroup.members.length} 条` : '无');
ok('MVU 模块是单选（一键开/关）', mvuGroup.mode === 'single', mvuGroup.mode);
ok('MVU 模块有「普通」和「Zod」两条', mvuGroup.members.length === 2
  && mvuGroup.members.some((m) => m.includes('普通'))
  && mvuGroup.members.some((m) => m.includes('Zod')), mvuGroup.members.join('、'));
ok('两条 MVU 骨架都默认关闭', mvuGroup.members.every((m) => !enabledSet().has(m)),
  mvuGroup.members.filter((m) => enabledSet().has(m)).join('、'));
/* 旧机制必须已经不在预设里 */
ok('旧的 ✅MVU Zod兼容 已从预设移除',
  !mock().prompts.some((p) => p.name === '✅MVU Zod兼容'));
ok('旧的 ✅MVU兼容（用再开）也已移除',
  !mock().prompts.some((p) => p.name === '✅MVU兼容（用再开）'));

await expand('mvu');
const mvuSel = selWith('mvu', mvuGroup.members);
ok('找得到 MVU 下拉框', !!mvuSel);
ok('下拉框第一项是「不使用」', opts(mvuSel)[0] && opts(mvuSel)[0].value === '',
  opts(mvuSel)[0] ? opts(mvuSel)[0].textContent : '(无)');

const plain = mvuGroup.members.find((m) => m.includes('普通'));
const zod = mvuGroup.members.find((m) => m.includes('Zod'));
b = writes;
mvuSel.value = zod; mvuSel.dispatchEvent('change');
await tick(); await tick();
ok('选「MVU Zod」写回 1 次', writes - b === 1, `实际 ${writes - b}`);
ok('Zod 那条开了', enabledSet().has(zod));
ok('普通那条没被连带开', !enabledSet().has(plain));
ok('两条不会同时开', [plain, zod].filter((m) => enabledSet().has(m)).length === 1);

b = writes;
let mvuSel2 = selWith('mvu', mvuGroup.members);
mvuSel2.value = plain; mvuSel2.dispatchEvent('change');
await tick(); await tick();
ok('切到「MVU 普通」写回 1 次', writes - b === 1, `实际 ${writes - b}`);
ok('普通那条开了、Zod 那条被关掉',
  enabledSet().has(plain) && !enabledSet().has(zod),
  [plain, zod].filter((m) => enabledSet().has(m)).join('、'));

b = writes;
mvuSel2 = selWith('mvu', mvuGroup.members);
mvuSel2.value = ''; mvuSel2.dispatchEvent('change');
await tick(); await tick();
ok('选「不使用」写回 1 次', writes - b === 1, `实际 ${writes - b}`);
ok('两条都被关掉（一键关闭）', mvuGroup.members.every((m) => !enabledSet().has(m)),
  mvuGroup.members.filter((m) => enabledSet().has(m)).join('、'));
/* 新方案不依赖变量链路 */
ok('Zod 骨架里自带 <JSONPatch>', (mock().prompts.find((p) => p.name === zod)?.content ?? '').includes('<JSONPatch>'));
ok('普通骨架里没有 <JSONPatch>', !(mock().prompts.find((p) => p.name === plain)?.content ?? '').includes('<JSONPatch>'));
ok('骨架内容不经过 mvu 变量（字面写入）',
  !(mock().prompts.find((p) => p.name === zod)?.content ?? '').includes('getvar::mvu'));

/* ── 5d. 摘要：默认关（否则事件文本会漏进聊天） ──────────────── */
console.log('\n[5d] 摘要：默认关闭 + 可一键开关');
const sumGroup = groups.find((g) => g.id === 'summary');
ok('规格里有摘要模块', !!sumGroup, sumGroup ? `${sumGroup.members.length} 档` : '无');
ok('摘要是单选（一键开/关）', sumGroup.mode === 'single', sumGroup.mode);
ok('摘要 4 档默认全部关闭（这就是「MQ.…」那段文字的来源）',
  sumGroup.members.every((m) => !enabledSet().has(m)),
  sumGroup.members.filter((m) => enabledSet().has(m)).join('、'));
await expand('summary');
const sumSel = selWith('summary', sumGroup.members);
ok('找得到摘要下拉框', !!sumSel);
ok('摘要下拉框第一项是「不使用」', opts(sumSel)[0] && opts(sumSel)[0].value === '');
b = writes;
sumSel.value = sumGroup.members[1]; sumSel.dispatchEvent('change');
await tick(); await tick();
ok('选一档写回 1 次', writes - b === 1, `实际 ${writes - b}`);
ok('那一档开了、且只开一条', enabledSet().has(sumGroup.members[1])
  && sumGroup.members.filter((m) => enabledSet().has(m)).length === 1);
let sumSel2 = selWith('summary', sumGroup.members);
b = writes;
sumSel2.value = ''; sumSel2.dispatchEvent('change');
await tick(); await tick();
ok('选「不使用」写回 1 次', writes - b === 1, `实际 ${writes - b}`);
ok('又全部关掉', sumGroup.members.every((m) => !enabledSet().has(m)),
  sumGroup.members.filter((m) => enabledSet().has(m)).join('、'));

/* ── 6. 档位不会被切换模型清掉 ─────────────────────────────────── */
console.log('\n[6] 档位不会被切换模型清掉');
/* 先切回 Gemini，后面的用例依赖它的档位可见 */
sel = selWith('jailbreak', ['gemini', 'dsglm', 'izumi', 'manual']);
sel.value = 'gemini'; sel.dispatchEvent('change');
await tick(); await tick();
const defT = optOf('gemini').tunables.find((t) => t.id === 'km_defense');
const defSel = selWith('jailbreak', [...defT.members, '']);
ok('找到防截断档位下拉框', !!defSel);
b = writes;
defSel.value = defT.members[0]; defSel.dispatchEvent('change');
await tick(); await tick();
ok('开了防截断', enabledSet().has(defT.members[0]), defT.members[0]);
ok('写回 1 次', writes - b === 1, `实际 ${writes - b}`);
sel = selWith('jailbreak', ['gemini', 'dsglm', 'izumi', 'manual']);
sel.value = 'izumi'; sel.dispatchEvent('change');
await tick(); await tick();
ok('切到别家后档位自动保留（没被清）', enabledSet().has(defT.members[0]));
sel = selWith('jailbreak', ['gemini', 'dsglm', 'izumi', 'manual']);
sel.value = 'gemini'; sel.dispatchEvent('change');
await tick(); await tick();
ok('切回来档位还在', enabledSet().has(defT.members[0]));

/* ── 6b. 注入锚点：切换模型不能掉上下文 ───────────────────────── */
console.log('\n[6b] 注入锚点：切换模型后上下文注入点必须还在');
const CRITICAL = ['main', 'jailbreak', 'chatHistory', 'dialogueExamples', 'charDescription',
  'charPersonality', 'worldInfoBefore', 'worldInfoAfter', 'personaDescription', 'scenario'];
const ownerOf = (id) => mock().prompts.find((p) => p.identifier === id);
const missingOwners = CRITICAL.filter((id) => !ownerOf(id));
ok('成品里 10 个关键槽位都有主人', missingOwners.length === 0, missingOwners.join('、'));

const anchors = spec.anchors ?? [];
ok('锚点清单够用（≥12 条）', anchors.length >= 12, `${anchors.length} 条`);
const anchorInBundle = [];
for (const o of jb.options) for (const m of o.members) if (anchors.includes(m)) anchorInBundle.push(`${o.label}/${m}`);
ok('没有任何锚点被塞进破甲分支（正是这个 bug 的根源）', anchorInBundle.length === 0, anchorInBundle.join('、'));
ok('锚点在面板里是 fixed（不给开关）', (groups.find((g) => g.id === 'anchors') || {}).mode === 'fixed');

for (const optId of ['izumi', 'dsglm', 'manual', 'gemini']) {
  const sel2 = selWith('jailbreak', ['gemini', 'dsglm', 'izumi', 'manual']);
  sel2.value = optId; sel2.dispatchEvent('change');
  await tick(); await tick();
  const label = jb.options.find((o) => o.id === optId).label;
  const slotOff = CRITICAL.filter((id) => { const p = ownerOf(id); return p && p.enabled === false; });
  ok(`切到「${label}」后关键槽位全部仍在`, slotOff.length === 0,
    slotOff.map((id) => `${id}(${ownerOf(id).name})`).join('、'));
  const anchorOff = anchors.filter((n) => {
    const p = mock().prompts.find((x) => x.name === n);
    return p && p.enabled === false;
  });
  ok(`切到「${label}」后 ${anchors.length} 个锚点全部仍在`, anchorOff.length === 0, anchorOff.join('、'));
}
/* 收尾切回 Gemini，后面的用例依赖它 */
sel = selWith('jailbreak', ['gemini', 'dsglm', 'izumi', 'manual']);
sel.value = 'gemini'; sel.dispatchEvent('change');
await tick(); await tick();

/* ── 7. 正文档位（雪融雪降） ──────────────────────────────────── */
console.log('\n[7] 正文档位：改内容并保存');
const fireT = optOf('gemini').tunables.find((t) => t.mode === 'text');
const fireName = fireT.members[0];
const ta = inMod('jailbreak').find((n) => n.tagName === 'TEXTAREA');
ok('渲染出正文编辑框', !!ta);
ok('编辑框里是当前正文', ta && ta.value === contentOf(fireName), ta ? `${(ta.value || '').length} 字` : '');
if (ta) {
  b = writes;
  ta.value = '这是一段我自己的私有小说填充。'.repeat(30);
  const saveBtn = inMod('jailbreak').find((n) => n.className === 'fp-mini' && n.textContent === '保存');
  ok('有保存按钮', !!saveBtn);
  saveBtn.dispatchEvent('click');
  await tick(); await tick();
  ok('写回 1 次', writes - b === 1, `实际 ${writes - b}`);
  ok('预设里的正文真的被改了', contentOf(fireName) === ta.value, `${contentOf(fireName).length} 字`);
}

/* ── 8. 改完不跳回顶部 ────────────────────────────────────────── */
console.log('\n[8] 改选项后不跳回顶部');
const bodyEl = () => walk(root()).find((n) => n.className === 'fp-body');
bodyEl().scrollTop = 321;
await expand('guard');
const sw = switchesIn('guard')[0];
b = writes;
sw.dispatchEvent('click');
await settleClick();        // 三击手势：单击要等一个窗口才生效
ok('写回 1 次', writes - b === 1, `实际 ${writes - b}`);
ok('重渲染后 scrollTop 保持', bodyEl().scrollTop === 321, `实际 ${bodyEl().scrollTop}`);

/* ── 9. 自定义内容：必须能自己敲进去 ──────────────────────────── */
console.log('\n[9] 自定义内容：给输入框');
const LBL = (n) => DISPLAY[n] || n;
await expand('custom');
const custom = groups.find((g) => g.id === 'custom');
const customMod = modOf('custom');
const editBlocks = walk(customMod).filter((n) => n.className === 'fp-editor');
ok('每条都渲染了输入块', editBlocks.length === custom.members.length, `${editBlocks.length}/${custom.members.length}`);
const tas = walk(customMod).filter((n) => n.tagName === 'TEXTAREA');
ok('输入块里有 textarea', tas.length === custom.members.length, `${tas.length}`);
const lockedNames = Object.entries(custom.editable).filter(([, v]) => v.locked).map(([k]) => k);
const customSwitches = walk(customMod).filter((n) => n.className === 'fp-sw');
ok('固定开启的只给「固定开启」，其余给开关',
  customSwitches.length === custom.members.length - lockedNames.length,
  `${customSwitches.length} 开关 / ${lockedNames.length} 固定 / 共 ${custom.members.length}`);
ok('每条都带提示文案', Object.values(custom.editable).every((v) => v.hint && v.hint.length > 4));

const blockOf = (name) => walk(customMod).filter((n) => n.className === 'fp-tunable')
  .find((w) => walk(w).some((n) => n.className === 'fp-tunlabel' && n.textContent === LBL(name)));
const guideName = '🔴指南（可改）';
const guideBlock = blockOf(guideName);
ok('找得到「指南」的输入块', !!guideBlock);
if (guideBlock) {
  const taG = walk(guideBlock).find((n) => n.tagName === 'TEXTAREA');
  ok('输入框里预填了当前正文', taG && taG.value === contentOf(guideName), taG ? `${(taG.value || '').length} 字` : '');
  b = writes;
  taG.value = '这是我加的规则：每次回复开头先写一句今天的天气。';
  walk(guideBlock).find((n) => n.className === 'fp-mini' && n.textContent === '保存').dispatchEvent('click');
  await tick(); await tick();
  ok('保存写回 1 次', writes - b === 1, `实际 ${writes - b}`);
  ok('预设里的正文真的被改了', contentOf(guideName) === taG.value, `${contentOf(guideName).length} 字`);
}
/* 固定开启的条目还能不能改内容（应该能，只是不能关） */
ok('固定开启的条目也能改内容', !!blockOf('☀️自定义缝合处'));

/* ── 10. 单选模块里选中可编辑项 → 就地出输入框 ────────────────── */
console.log('\n[10] 单选模块里选中可编辑项 → 就地出输入框');
await expand('length');
const lengthSel = selWith('length', ['🤖自定义（字数）', '⚡️字数加强']);
ok('找得到字数下拉框', !!lengthSel);
b = writes;
lengthSel.value = '🤖自定义（字数）'; lengthSel.dispatchEvent('change');
await tick(); await tick();
ok('切换写回 1 次', writes - b === 1, `实际 ${writes - b}`);
ok('length 模块就地出现输入框', inMod('length').some((n) => n.tagName === 'TEXTAREA'));
b = writes;
const taLen = inMod('length').find((n) => n.tagName === 'TEXTAREA');
taLen.value = '每次正文不少于 1500 字，对话占比不超过一半。';
inMod('length').find((n) => n.className === 'fp-mini' && n.textContent === '保存').dispatchEvent('click');
await tick(); await tick();
ok('就地保存也写回 1 次', writes - b === 1, `实际 ${writes - b}`);
ok('字数自定义真的被改了', contentOf('🤖自定义（字数）') === taLen.value);

/* ── 11. 多选里可编辑项带「✎ 填内容」 ─────────────────────────── */
console.log('\n[11] 多选里可编辑项带「✎ 填内容」');
await expand('jailbreak');
const bs = selWith('jailbreak', ['gemini', 'dsglm', 'izumi', 'manual']);
bs.value = 'dsglm'; bs.dispatchEvent('change');
await tick(); await tick();
const editBtn = inMod('jailbreak').find((n) => n.className === 'fp-sw fp-editbtn');
ok('出现「✎ 填内容」按钮', !!editBtn, editBtn ? editBtn.children[0].textContent : '');
ok('展开前没有输入框', !inMod('jailbreak').some((n) => n.tagName === 'TEXTAREA'));
if (editBtn) {
  editBtn.dispatchEvent('click');
  await tick(); await tick();
  ok('点开后出现输入框', inMod('jailbreak').some((n) => n.tagName === 'TEXTAREA'));
  const taBan = inMod('jailbreak').find((n) => n.tagName === 'TEXTAREA');
  b = writes;
  taBan.value = taBan.value + '\n- 禁止使用「仿佛」。';
  inMod('jailbreak').find((n) => n.className === 'fp-mini' && n.textContent === '保存').dispatchEvent('click');
  await tick(); await tick();
  ok('保存自定义禁词写回 1 次', writes - b === 1, `实际 ${writes - b}`);
  ok('自定义禁词真的被改了', contentOf('自定义禁词').includes('仿佛'));
}

/* ── 12. 手风琴与其余 ─────────────────────────────────────────── */
console.log('\n[12] 手风琴');
const foldBtn = nodes().find((n) => n.className === 'fp-mini' && n.textContent === '全部折起');
ok('有「全部折起」', !!foldBtn);
foldBtn.dispatchEvent('click');
await tick(); await tick();
ok('全部折起后没有控件', openIds().length === 0 && nodes().filter((n) => n.tagName === 'SELECT').length === 0);

console.log('\n[13] 脚本层防截断：开关真的装/卸，正文真的从传输函数里回来');
{
  const AT = win.__FANO_ANTITRUNC__;
  const KEY = 'fano-antitrunc-v1';
  ok('控制台 API 在（v2.8.1 那套 __FANO_ANTITRUNC__）', !!AT && typeof AT.isEnabled === 'function' && typeof AT.lastRun === 'function',
    Object.keys(AT ?? {}).join('、'));
  ok('锚点沿用 <format>', AT.anchor === '<format>', String(AT.anchor));
  ok('面板把两个按钮声明给了宿主', declaredButtons.join('|') === '🙈 隐藏|🛡 防截断', declaredButtons.join('|'));
  ok('默认开着，且拦截器真挂在 window.fetch 上（不是只改了个标志位）',
    AT.isEnabled() === true && AT.installed() === true && win.fetch !== rawFetch);

  /* 点一下「🛡 防截断」：必须真的卸下来（window.fetch 回到原样），并把状态写进存档 */
  ok('点得到「🛡 防截断」这个按钮', clickButton('🛡 防截断'), '注册到的事件：' + [...buttonEvents.keys()].join('｜'));
  ok('点一下 = 关：包装从 window.fetch 上摘掉了', AT.isEnabled() === false && AT.installed() === false && win.fetch === rawFetch);
  ok('存档写成 v2.8.1 认的 "0"（换回那一支时状态不丢）', localStorage.getItem(KEY) === '0', String(localStorage.getItem(KEY)));
  clickButton('🛡 防截断');
  ok('再点一下 = 开：拦截器装了回来', AT.isEnabled() === true && AT.installed() === true && win.fetch !== rawFetch);
  ok('存档写成 "1"', localStorage.getItem(KEY) === '1', String(localStorage.getItem(KEY)));

  /* 真发一次 generate：假上游把正文塞进合成函数的 content 参数回传 */
  const res = await win.fetch('/api/backends/openai/generate', {
    method: 'POST',
    body: JSON.stringify({ stream: true, messages: [{ role: 'user', content: '<format> 走起' }] }),
  });
  const sent = requests[0].body;
  const tool = sent.tools[sent.tools.length - 1].function.name;
  ok('请求被改过：多了一个合成传输函数', /^emit_complete_response_/.test(tool), tool);
  ok('tool_choice 被设成 auto（不抢用户自己的工具调用）', sent.tool_choice === 'auto', String(sent.tool_choice));
  ok('控制提示挂在 <format> 锚点**之前**（anchored，不是丢到末尾）',
    sent.messages.length === 2 && String(sent.messages[0].content).includes(tool)
    && String(sent.messages[1].content).includes('<format>'),
    JSON.stringify(sent.messages.map((m) => m.role)));

  const payloads = (await res.text()).split('\n\n')
    .filter((l) => l.startsWith('data: ') && l.slice(6) !== '[DONE]')
    .map((l) => JSON.parse(l.slice(6)));
  const bodyText = payloads.map((p) => p.choices?.[0]?.delta?.content ?? '').join('');
  const finishes = payloads.map((p) => p.choices?.[0]?.finish_reason).filter(Boolean);
  ok('正文从函数调用参数里完整回来了（分块拼接后一字不少）', bodyText === '完整正文·二号', JSON.stringify(bodyText));
  ok('finish_reason 被改回 stop（下游看不到 tool_calls）', finishes.includes('stop') && !finishes.includes('tool_calls'), JSON.stringify(finishes));
  ok('合成 tool_calls 被剥掉了（下游只看到正文）', !payloads.some((p) => p.choices?.[0]?.delta?.tool_calls));
  const run = AT.lastRun();
  ok('lastRun() 报得出结果：transported + 字数 + 分块',
    !!run && run.outcome === 'transported' && run.decodedChars === 7 && run.emittedChars === 7
    && run.decodedChunks === 2 && run.streamed === true && run.endedCleanly === true,
    JSON.stringify(run));

  /* 关掉之后：请求原样透传，一个字段都不许动 */
  clickButton('🛡 防截断');
  requests.length = 0;
  await win.fetch('/api/backends/openai/generate', {
    method: 'POST', body: JSON.stringify({ stream: true, messages: [{ role: 'user', content: '<format> 走起' }] }),
  });
  ok('关掉后请求原样透传（没有合成函数、没有控制提示）',
    requests[0].body.tools === undefined && requests[0].body.messages.length === 1,
    JSON.stringify(requests[0].body));
  clickButton('🛡 防截断');   /* 复位：别把开关状态留给后面的用例 */
}

console.log('\n[14] 三击条目 → 改这一条的正文');
{
  const api = win.__FANO_PANEL__;
  const ms = api.config().effective.edit.tripleClick.ms;
  const sleep = (n) => new Promise((r) => setTimeout(r, n));
  const click = (node) => node.dispatchEvent('click');
  const maskNow = () => dom.document.getElementById('fano-preset-panel-v1-edit');
  const taIn = (node) => (node ? walk(node).find((n) => n.tagName === 'TEXTAREA') : null);
  const miniIn = (node, label) => walk(node).find((n) => n.className === 'fp-mini' && n.textContent === label);

  ok('面板报出了改正文的能力（编辑器导出前检查认它）',
    typeof api.caps === 'function' && api.caps().longPressEdit === true, JSON.stringify(api.caps && api.caps()));
  ok('三击窗口来自配置', ms === 250, String(ms));

  /* ── 多选开关排：每一行都能三击 ── */
  await expand('guard');
  const guardG = groups.find((g) => g.id === 'guard');
  const name = guardG.members.find((m) => find0(m));
  const rowOf = (n) => switchesIn('guard').find((x) => x.children[0] && x.children[0].textContent === n);
  const wasOn = enabledSet().has(name);

  /* 点一下：**不当场生效**，要等一个窗口——这是"分得清三击"必须付的代价 */
  click(rowOf(name));
  ok('点一下不当场生效（先等一个窗口，看后面还有没有第 2、3 下）', enabledSet().has(name) === wasOn,
    `${wasOn} → ${enabledSet().has(name)}`);
  await sleep(ms + 40);
  ok('窗口过去才切：点一下仍然是"开关这一条"', enabledSet().has(name) !== wasOn,
    `${wasOn} → ${enabledSet().has(name)}`);
  ok('点一下不会打开编辑器', !maskNow());

  /* 两下：不算三击，按"点一下"处理（只切一次，不会切两次） */
  const rowTwo = rowOf(name);
  const onBeforeTwo = enabledSet().has(name);
  click(rowTwo); click(rowTwo);
  await sleep(ms + 40);
  ok('两下不算三击，只当点一下（切一次，不是两次）', enabledSet().has(name) !== onBeforeTwo
    && enabledSet().has(name) === !onBeforeTwo, `${onBeforeTwo} → ${enabledSet().has(name)}`);
  ok('两下也不打开编辑器', !maskNow());

  /* 三击：连点三下 → 打开编辑器；**顺手的那两下不会开关这一条** */
  const row3 = rowOf(name);
  const onBeforeTriple = enabledSet().has(name);
  click(row3); click(row3); click(row3);
  const mask = maskNow();
  ok('三击打开正文编辑器', !!mask, mask ? '' : '没出现浮层');
  ok('编辑器里放的就是这一条的正文（字数对得上）',
    !!taIn(mask) && taIn(mask).value === contentOf(name), taIn(mask) ? `${taIn(mask).value.length} 字` : '没有输入框');
  await sleep(ms + 40);
  ok('三击没有顺手开关这一条（前两下被丢掉）', enabledSet().has(name) === onBeforeTriple,
    `${onBeforeTriple} → ${enabledSet().has(name)}`);

  /* ── 保存：只写回一次，正文真的进预设，浮层收起 ── */
  const box = maskNow();
  const ta = taIn(box);
  const w0 = writes;
  ta.value = ta.value + '\n（三击补的一行）';
  miniIn(box, '保存').dispatchEvent('click');
  await tick(); await tick();
  ok('保存只写回一次预设', writes - w0 === 1, `实际 ${writes - w0}`);
  ok('正文真的进了预设', contentOf(name) === ta.value, `${contentOf(name).length} 字`);
  ok('保存后浮层自己收起', !maskNow());

  /* ── 单选组：下拉框是原生控件，它的条目行在下拉框下面 ── */
  const sg = groups.find((g) => g.mode === 'single' && g.members.some((m) => enabledSet().has(m) && find0(m)));
  await expand(sg.id);
  const srow = switchesIn(sg.id)[0];
  const curName = sg.members.find((m) => enabledSet().has(m) && find0(m));
  ok('单选组里也有可三击的"当前条目"行', !!srow && srow.children[0].textContent === curName,
    srow ? srow.children[0].textContent : '没有这一行');
  if (srow) {
    click(srow); click(srow); click(srow);
    const smask = maskNow();
    ok('三击它打开的就是当前选中那一条', !!taIn(smask) && taIn(smask).value === contentOf(curName),
      `${curName}`);
    api.closeEditor();
    await tick();
  }

  /* ── 只读区（注入位标记）：能三击打开，但只给看 ── */
  await expand('anchors');
  const markerName = groups.find((g) => g.id === 'anchors').members.find((m) => find0(m) && find0(m).marker === true);
  const mrow = switchesIn('anchors').find((x) => x.children[0].textContent === markerName);
  click(mrow); click(mrow); click(mrow);
  const mmask = maskNow();
  ok('注入位标记也能三击打开', !!mmask && taIn(mmask).value === contentOf(markerName), String(markerName));
  ok('但只给看：输入框只读、没有保存按钮',
    !!taIn(mmask) && taIn(mmask).readOnly === true && !miniIn(mmask, '保存'));
  api.closeEditor();
  await tick();
  ok('closeEditor() 能收起浮层', !maskNow());
  ok('只读区的那一行也在', switchesIn('anchors').length === groups.find((g) => g.id === 'anchors').members.length,
    `${switchesIn('anchors').length} 行`);
}

console.log('\n[15] 顶部按钮=整块隐藏 / 壁纸开关+纯色 / 小方案三击改名');
{
  const api = win.__FANO_PANEL__;
  const sleep = (n) => new Promise((r) => setTimeout(r, n));
  const rootEl = () => dom.document.getElementById('fano-preset-panel-v1-root');
  const btnName = api.config().effective.button.panel;
  api.open();
  await tick();

  /* ── 15a. 顶部按钮：把悬浮球和面板一起藏起来 / 再叫回来 ──
     （以前它是"开合窗口"，用户点名要的功能是"整块隐藏"。） */
  ok('顶部按钮接上了线（名字取自 CONFIG.button.panel）', buttonEvents.has('evt:' + btnName), String(btnName));
  ok('一开始是显示状态', api.isHidden() === false, String(api.isHidden()));
  clickButton(btnName);
  ok('点一下：整块藏起来（连球一起）', api.isHidden() === true && rootEl().dataset.hidden === '1',
    `hidden=${api.isHidden()} / data-hidden=${rootEl().dataset.hidden}`);
  ok('藏起来之后悬浮球也不画了', !walk(rootEl()).some((n) => n.className === 'fp-launch'));
  ok('隐藏状态落盘（刷新也记得——按钮就是回来的路）',
    localStorage.getItem('fano-preset-panel-v1_hidden_v1') !== null,
    String(localStorage.getItem('fano-preset-panel-v1_hidden_v1')));
  clickButton(btnName);
  ok('再点一下：面板回来了（窗口仍是开着的，不然叫回来也看不见）',
    api.isHidden() === false && rootEl().dataset.hidden === '0' && api.isHidden() === false);

  /* ── 15b. 小方案：三击 chip 就地改名 ── */
  const chipByText = (t) => walk(rootEl()).find((n) => n.className === 'fp-chip' && n.textContent === t);
  const saveChip = chipByText('＋存为小方案');
  ok('脚注里有「＋存为小方案」', !!saveChip);
  saveChip.dispatchEvent('click');
  await tick();
  let ps = api.plans();
  ok('存下了一个小方案', ps.length === 1 && /^方案 \d+$/.test(ps[0].name), JSON.stringify(ps));

  const chipOf = (id) => walk(rootEl()).find((n) => n.className === 'fp-chip' && n.dataset && n.dataset.plan === id);
  const chip = chipOf(ps[0].id);
  ok('方案 chip 上挂着 id（三击改名靠它认人）', !!chip);
  chip.dispatchEvent('click'); chip.dispatchEvent('click'); chip.dispatchEvent('click');
  const input = walk(chip).find((n) => n.tagName === 'INPUT');
  ok('三击 chip → 就地出现改名输入框（预填原名）', !!input && input.value === ps[0].name,
    input ? JSON.stringify(input.value) : '没有输入框');
  input.value = '我的摸鱼方案';
  input.dispatchEvent('keydown', { key: 'Enter', preventDefault() {} });
  await tick();
  ps = api.plans();
  ok('回车保存：名字改掉了', ps[0].name === '我的摸鱼方案', JSON.stringify(ps));
  ok('改名之后 chip 上显示的是新名字', !!chipByText('我的摸鱼方案'));
  ok('程序化入口 renamePlan 也能改',
    api.renamePlan(ps[0].id, '方案·二') === true && api.plans()[0].name === '方案·二');

  /* ── 15b-2. 长按 chip = **删除**（手机上点不出右键，这是那条出口） ── */
  {
    const pev = (node, type, x = 10, y = 10) => node.dispatchEvent(type, {
      clientX: x, clientY: y, button: 0, target: node, preventDefault() {}, stopPropagation() {},
    });
    const victim = chipOf(api.plans()[0].id);
    const wBefore = writes;
    pev(victim, 'pointerdown');
    await new Promise((r) => setTimeout(r, 760));
    ok('长按 chip → 这个方案被删掉', api.plans().length === 0, JSON.stringify(api.plans()));
    pev(victim, 'pointerup');
    victim.dispatchEvent('click');          // 松手跟来的那次 click（派发在已摘下的旧节点上）
    await tick();
    ok('长按之后紧跟的那次 click 被丢掉（没顺手应用一次、没多写回一次）', writes === wBefore,
      `写回 ${wBefore} → ${writes}`);
  }

  /* ── 15c. 壁纸开关 + 纯色背景 ──
     这两个控件只在**配了壁纸**时才长出来，所以另起一套壳、把壁纸塞进 CONFIG 再加载一遍
     （用生成器自己的 patchConfig 塞，免得手写 CONFIG 字面量再对不上）。 */
  const PC = (() => {
    new Function('globalThis', fs.readFileSync(P('tools', 'gui', 'lib', 'panelconfig.js'), 'utf8'))(globalThis);
    return globalThis.PresetPanelConfig;
  })();
  const rawSrc = fs.readFileSync(P('panel', 'fano-panel.js'), 'utf8');
  const cfg0 = PC.extractConfig(rawSrc);
  const src2 = PC.patchConfig(rawSrc, {
    ...cfg0, wallpaper: { ...cfg0.wallpaper, url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' },
  });
  ok('（测试准备）往面板 CONFIG 里塞了一张壁纸', PC.extractConfig(src2).wallpaper.url.length > 0);

  const dom2 = makeDom();
  const store2 = new Map();
  const ls2 = {
    getItem: (k) => (store2.has(k) ? store2.get(k) : null),
    setItem: (k, v) => store2.set(k, String(v)),
    removeItem: (k) => store2.delete(k),
  };
  const win2 = { innerWidth: 1280, innerHeight: 900, addEventListener() {}, localStorage: ls2 };
  win2.fetch = rawFetch;
  win2.appendInexistentScriptButtons = () => {};
  win2.getButtonEvent = (n) => 'evt:' + n;
  win2.eventOn = () => {};
  load(fs.readFileSync(P('panel', 'preview-host.js'), 'utf8'), win2, dom2.document, ls2);
  load(src2, win2, dom2.document, ls2);
  await tick();
  const api2 = win2.__FANO_PANEL__;
  const root2 = () => dom2.document.getElementById('fano-preset-panel-v1-root');
  const style2 = () => dom2.document.head.children.map((c) => c.textContent || '').join('\n');
  const wallEl2 = () => dom2.document.getElementById('fano-preset-panel-v1-wall');
  const iconByTitle = (re) => walk(root2()).find((n) => n.className === 'fp-icon' && re.test(n.title || ''));

  ok('配了壁纸 → 面板认得出', api2.wallpaper().configured === true && api2.wallpaper().shown === true,
    JSON.stringify(api2.wallpaper()));
  ok('壁纸层画出来了', !!wallEl2());
  ok('标题栏有「关掉壁纸」这个按钮', !!iconByTitle(/关掉壁纸/),
    walk(root2()).filter((n) => n.className === 'fp-icon').map((n) => n.title).join('｜'));
  ok('壁纸开着时不给纯色选择器（那时它不生效，给了只会误导）',
    !walk(root2()).some((n) => n.className === 'fp-color'));

  iconByTitle(/关掉壁纸/).dispatchEvent('click');
  await tick();
  ok('点一下：壁纸关掉、改用纯色', api2.wallpaper().on === false && api2.wallpaper().shown === false
    && api2.wallpaper().solidActive === true, JSON.stringify(api2.wallpaper()));
  ok('壁纸层撤掉了', !wallEl2());
  ok('底色层拿到纯色变量 --fp-solid-bg（**没选过色就指向主题 token**，昼夜自动跟着换）',
    /--fp-solid-bg:var\(--fp-solid\)/.test(style2()),
    (style2().match(/--fp-solid-bg:[^;]*/) || ['没有'])[0]);
  ok('关掉之后才出现纯色选择器', !!walk(root2()).find((n) => n.className === 'fp-color'));

  api2.setWallpaper({ color: '#123456' });
  await tick();
  ok('选了色：变量跟着换', api2.wallpaper().solid === '#123456' && /--fp-solid-bg:#123456/i.test(style2()),
    (style2().match(/--fp-solid-bg:[^;]*/) || ['没有'])[0]);
  api2.setWallpaper({ on: true });
  await tick();
  /* 注意：`--fp-solid-bg` 这个名字**在静态 CSS 里本来就有**（.fp-bglayer 的 var 兜底），
     所以这里必须测"有没有被**声明**成某个值"，不能测"名字出现过没有"——踩过。 */
  ok('再开回壁纸：壁纸层回来、纯色变量撤掉',
    api2.wallpaper().shown === true && !!wallEl2() && !/--fp-solid-bg\s*:#/.test(style2()),
    `shown=${api2.wallpaper().shown}｜wall层=${!!wallEl2()}｜`
    + `样式里还有纯色声明=${/--fp-solid-bg\s*:#/.test(style2())}｜${(style2().match(/--fp-solid-bg\s*:[^;]*/) || [''])[0]}`);
  ok('壁纸偏好落盘了（跟夜间模式一样是使用者偏好，不进预设）',
    ls2.getItem('fano-preset-panel-v1_wall_v1') !== null, String(ls2.getItem('fano-preset-panel-v1_wall_v1')));

  /* ── 15d. **预设默认值**：编辑器里把"默认关掉壁纸"设好，装进酒馆就是纯色底 ──
     （这是"使用者偏好"之上的那一层：进文件、可被编辑器设定；用户点过之后以他点的为准。） */
  const src3 = PC.patchConfig(rawSrc, {
    ...cfg0,
    wallpaper: { ...cfg0.wallpaper, url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', enabled: false },
  });
  ok('（测试准备）写进去的是"配了壁纸但默认关着"', PC.extractConfig(src3).wallpaper.enabled === false);

  const dom3 = makeDom();
  const store3 = new Map();
  const ls3 = {
    getItem: (k) => (store3.has(k) ? store3.get(k) : null),
    setItem: (k, v) => store3.set(k, String(v)),
    removeItem: (k) => store3.delete(k),
  };
  const win3 = { innerWidth: 1280, innerHeight: 900, addEventListener() {}, localStorage: ls3 };
  win3.fetch = rawFetch;
  win3.appendInexistentScriptButtons = () => {};
  win3.getButtonEvent = (n) => 'evt:' + n;
  win3.eventOn = () => {};
  load(fs.readFileSync(P('panel', 'preview-host.js'), 'utf8'), win3, dom3.document, ls3);
  load(src3, win3, dom3.document, ls3);
  await tick();
  const api3 = win3.__FANO_PANEL__;
  const style3 = () => dom3.document.head.children.map((c) => c.textContent || '').join('\n');

  ok('预设说"默认关掉壁纸" → 面板一上来就不画壁纸层',
    api3.wallpaper().on === false && api3.wallpaper().shown === false
    && !dom3.document.getElementById('fano-preset-panel-v1-wall'), JSON.stringify(api3.wallpaper()));
  ok('底色用的是纯色底那个**配色 token**（于是昼夜各一套、外观页上就是取色器）',
    /--fp-solid-bg:var\(--fp-solid\)/.test(style3()) && /--fp-solid:#fff7fa/.test(style3()),
    (style3().match(/--fp-solid-bg:[^;]*/) || ['没有'])[0]);
  api3.setWallpaper({ on: true });
  await tick();
  ok('用户点一下就能切回壁纸（预设默认值只是起点）',
    api3.wallpaper().shown === true && !!dom3.document.getElementById('fano-preset-panel-v1-wall'));
}

console.log('\n────────────────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fails.length} 项　总写回次数 ${writes}`);
if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); process.exitCode = 1; }

function find0(name) { return mock().prompts.find((p) => p.name === name) || null; }
