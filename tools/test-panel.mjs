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
 */
import fs from 'node:fs';
import path from 'node:path';
import { needAll } from './lib/fixtures.mjs';

/* 夹具守卫：面板跑在**假酒馆宿主**里，宿主数据是从成品预设生成的（panel/preview-host.js）。 */
needAll([path.join('panel', 'preview-host.js'), path.join('preset', '芳乃预设.json')],
  '面板逻辑测试（120 项）',
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

load(fs.readFileSync(P('panel', 'preview-host.js'), 'utf8'), win, dom.document, localStorage);

let writes = 0;
const rawWrite = win.updatePresetWith;
win.updatePresetWith = async (...args) => { writes++; return rawWrite(...args); };

load(fs.readFileSync(P('panel', 'fano-panel.js'), 'utf8'), win, dom.document, localStorage);

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
await tick(); await tick();
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
await tick(); await tick();
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

console.log('\n────────────────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fails.length} 项　总写回次数 ${writes}`);
if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); process.exitCode = 1; }

function find0(name) { return mock().prompts.find((p) => p.name === name) || null; }
