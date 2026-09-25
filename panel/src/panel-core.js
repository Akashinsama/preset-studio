/**
 * 芳乃 · 预设面板　v0.1.0
 * ---------------------------------------------------------------------------
 * 用途：酒馆助手（JS-Slash-Runner）脚本。一个悬浮窗，把当前酒馆预设里的条目
 *       按"子集"重新组织：单选子集渲染成下拉框（选一个自动关掉同组其他），
 *       多选子集渲染成开关排，破甲按模型分流作为一个整组互斥的 bundle。
 *
 * 不依赖任何 CDN。读写预设只用酒馆助手 API：
 *   读  getPreset('in_use')
 *   写  updatePresetWith('in_use', updater, { render: 'immediate' })
 *   兜底 replacePreset('in_use', preset)
 *
 * 注意（来自 Izumi 面板的实地结论）：酒馆助手的 Preset API **不暴露 prompt_order**，
 * 开关状态直接落在 prompts[i].enabled 上，prompt_order 是酒馆原始存储细节，不要碰。
 */

(async function fanoPresetPanel() {
  'use strict';

  /* ══ FANO_PANEL_GROUPS_BEGIN ══════════════════════════════════════════
     分组覆盖：这一段是**给预设生成器（tools/gui）的「面板分组」编辑器读写**的。

     null  = 用面板自带的、按 `spec/groups.json` 注入的那套分组（默认，芳乃这套预设用的）
     对象  = 用这里的：可以把这份面板装到**别的预设**上，让模块列表对上那份预设的条目名

     形状（都是按**条目名**匹配，所以名字必须和预设里的完全一致）：
       {
         groups: [ { id, label, mode: 'fixed'|'single'|'multi'|'editable'|'bundle'|'hidden',
                     note?, members?: [名字…], editable?: { 名字: { hint, locked? } },
                     options?: [ { id, label, members, tunables? } ] } ],
         sections: [ { title, groups: [组 id…] } ],
         thinkingTags: [ { id, label, note?, members: [名字…] } ]
       }
     ═══════════════════════════════════════════════════════════════════ */
  const GROUPS_OVERRIDE = null;
  /* ══ FANO_PANEL_GROUPS_END ════════════════════════════════════════════ */

  /* 面板**自带**的分组（构建期由 spec/groups.json 注入）。
     单独起个名字是为了让编辑器能把它读出来当搭建起点——
     生成器的「面板搭建」需要知道"这块面板本来长什么样"。 */
  const GROUPS_DEFAULT = '__FANO_GROUPS__';
  const DISPLAY_DEFAULT = '__FANO_DISPLAY__';
  const THINKING_TAGS_DEFAULT = '__FANO_THINKING_TAGS__';

  const GROUPS = (GROUPS_OVERRIDE && Array.isArray(GROUPS_OVERRIDE.groups) && GROUPS_OVERRIDE.groups.length)
    ? GROUPS_OVERRIDE.groups
    : GROUPS_DEFAULT;
  const DISPLAY = (GROUPS_OVERRIDE && GROUPS_OVERRIDE.display) || DISPLAY_DEFAULT;
  /** 思维链标签互斥组：同一时刻只能有一套标签的条目处于开启状态。 */
  const THINKING_TAGS = (GROUPS_OVERRIDE && Array.isArray(GROUPS_OVERRIDE.thinkingTags) && GROUPS_OVERRIDE.thinkingTags.length)
    ? GROUPS_OVERRIDE.thinkingTags
    : THINKING_TAGS_DEFAULT;

  /** 源条目名 → 显示名（角色名替换表）。匹配预设仍用源名字，显示用这个名字。 */
  const LBL = (n) => DISPLAY[n] || n;

  /** 需要用户自己敲内容的条目 → { hint, locked }。取自 custom 模块，是全局面板行为的数据源。 */
  const EDITABLE = ((GROUPS.find((g) => g.mode === 'editable') || {}).editable) || {};

  const ID = 'fano-preset-panel-v1';
  const VERSION = '0.4.0';
  const LS = {
    open: ID + '_open_v1',
    night: ID + '_night_v1',
    pos: ID + '_pos_v1',
    size: ID + '_size_v1',
    /* 悬浮球自己的坐标（球是能拖的，跟窗口坐标分开记） */
    ball: ID + '_ball_v1',
    /* 整块隐藏：默认**不落盘**（刷新必然回来）；显式 persistHidden(true) 才写 */
    hidden: ID + '_hidden_v1',
    plans: ID + '_plans_v1',
    collapsed: ID + '_collapsed_v1',
    expanded: ID + '_expanded_v1',
    bundle: ID + '_bundle_v1',
  };

  /* ── 宿主文档：酒馆助手脚本跑在 iframe 里，窗口必须挂到最外层能拿到的页面上 ───
     只往上看一层是不够的：手机上酒馆助手可能是嵌套 iframe，挂到中间层就会渲染在
     看不见的框里（表现就是"手机上打不开面板"）。这里一路走到最顶层同源窗口。

     注意：**不要求对方的 body 已经就绪**。早先这里会检查 `document.body`，
     而脚本执行时机只要稍早于父文档解析完，body 就是 null —— 于是静默退回本地文档，
     面板被挂进看不见的 iframe。桌面/手机加载时序不同，这条能造成"桌面好、手机坏"。 */
  const HOST = (() => {
    const local = { win: window, doc: document, depth: 0, fellBack: false };
    try {
      let w = window;
      let depth = 0;
      while (w.parent && w.parent !== w) {
        const next = w.parent;
        void next.document;              // 跨域在这里就会抛
        w = next;
        depth++;
        if (depth > 10) break;            // 防御：不正常的嵌套
      }
      if (w !== window && w.document) return { win: w, doc: w.document, depth, fellBack: false };
      return local;
    } catch {
      /* 拿不到更外层（跨域）：退回本地文档。这时面板可能渲染在不可见的 iframe 里，
         所以标记出来，让面板自己提示一句。 */
      return { ...local, fellBack: true };
    }
  })();

  /** 宿主文档的 body 未必已就绪；没就绪就等一下，绝不抛异常把整个面板带崩。 */
  function whenHostReady() {
    if (HOST.doc.body) return Promise.resolve(true);
    return new Promise((resolve) => {
      let done = false;
      const finish = (okFlag) => { if (!done) { done = true; resolve(okFlag); } };
      try {
        HOST.doc.addEventListener('DOMContentLoaded', () => finish(!!HOST.doc.body), { once: true });
      } catch { /* 不支持就靠轮询 */ }
      let tries = 0;
      const poll = () => {
        if (done) return;
        if (HOST.doc.body) return finish(true);
        if (++tries > 100) return finish(false);   // 约 5 秒
        setTimeout(poll, 50);
      };
      setTimeout(poll, 50);
    });
  }

  /* ── 展示分区（纯表现层）───────────────────────────────────────────
     默认是芳乃这套预设的排法；装了分组覆盖（GROUPS_OVERRIDE.sections）就用覆盖的。 */
  const SECTIONS_DEFAULT = [
    { title: '芳乃主体层（本预设新增）', groups: ['fano'] },
    { title: '破甲（按模型分流）', groups: ['jailbreak'] },
    { title: '自定义内容（自己填）', groups: ['custom'] },
    { title: '文风', groups: ['style_main', 'style_third', 'style_first', 'style_nsfw', 'style_lib'] },
    { title: '人称与叙事', groups: ['person', 'dialogue_amt', 'difficulty', 'guard'] },
    { title: '思维链', groups: ['cot', 'cot_lang'] },
    { title: 'MVU 变量更新', groups: ['mvu'] },
    { title: 'NSFW', groups: ['nsfw'] },
    { title: '输出与格式', groups: ['out_mode', 'format', 'summary', 'length'] },
    { title: '适配与美化', groups: ['adapter', 'ui'] },
    { title: '其他', groups: ['misc'] },
    { title: '锚点（固定开启，切换模型也不会动）', groups: ['anchors'] },
    { title: '核心（面板不碰）', groups: ['core'] },
  ];
  const SECTIONS = (GROUPS_OVERRIDE && Array.isArray(GROUPS_OVERRIDE.sections) && GROUPS_OVERRIDE.sections.length)
    ? GROUPS_OVERRIDE.sections
    : SECTIONS_DEFAULT;

  /* ══ FANO_PANEL_CONFIG_BEGIN ══════════════════════════════════════════
     这一段是**给预设生成器（tools/gui）的「面板外观」编辑器读写的**：
     它只替换这中间的内容，别处代码一行都不动。

     改完的生效方式：面板启动时读它，把 tokens 合并到下面的 THEMES 上，
     尺寸/圆角/缩放/不透明度/壁纸都从这里取。想手改也行 —— 就是普通 JSON。

     注意 wallpaper.url 只支持 http(s) 链接或 data: 图片；
     用 data: 会把图片塞进预设 JSON（1MB 的图 ≈ 1.4MB base64），体积自己掂量。
     ═══════════════════════════════════════════════════════════════════ */
  const CONFIG = {
    version: 1,
    /* 窗口标题（换一份预设就改成那套的名字；留空用面板自带的） */
    title: '',
    /* 颜色：按主题覆盖（只写你想改的那几个键就行，其余用内置芳乃配色） */
    tokens: {
      day: {},
      night: {},
    },
    /* 悬浮球：大小 / 形状 / 内容是字还是图。
       shape：circle 圆 · square 方 · rounded 圆角方 · diamond 菱形 · triangle 三角 · hexagon 六边
       content.kind='image' 时用 content.image（**只能是 http(s) 外链或 data: 图片**——
       面板跑在酒馆页面里，本机路径那种 C:\… 在那边加载不到）。
       图片为空字符串时自动退回文字。 */
    ball: {
      size: 46,
      glyph: '芳',
      shape: 'circle',
      content: { kind: 'text', image: '' },
    },
    /* 窗口：默认尺寸、以及可拖动的上下限（都在这里改） */
    window: { w: 380, h: 620, minW: 260, minH: 200, maxW: 0, maxH: 0 },
    /* 整体观感 */
    layout: {
      radius: 14,        // 窗口圆角 px
      scale: 1,          // 整体缩放（对面板 CSS 里的 px 生效，1 = 原始大小）
      fontScale: 1,      // 字号倍率（只乘 font-size，不动间距；1 = 原始大小）
      opacity: 1,        // 窗口底色层不透明度（1 = 不透明，0.6 就能透出后面的酒馆界面）
      blur: 14,          // 窗口底色层的背景模糊 px（磨砂感）
    },
    /* 壁纸：只作用于**面板自己**，不动酒馆页面 */
    wallpaper: {
      url: '',           // 空 = 不用壁纸
      fit: 'cover',      // cover / contain / repeat
      opacity: 0.35,
      blur: 0,
      dim: 0.15,         // 压暗层：壁纸太花时把文字压回可读
      dimColor: '#000000',
    },
  };
  /* ══ FANO_PANEL_CONFIG_END ════════════════════════════════════════════ */

  /** 允许的球形状（写错就退回圆形，不让一个错字把球画没）。定义在 CFG 之前，CFG 初始化时要用 */
  const BALL_SHAPES = ['circle', 'square', 'rounded', 'diamond', 'triangle', 'hexagon'];

  /* ── 芳乃 / 千恋万花 配色 token ─────────────────────────────────── */
  const THEMES = {
    day: {
      '--fp-bg': '#fff7fa', '--fp-bg-raised': '#ffffff', '--fp-bg-inset': '#fdeef4',
      '--fp-border': '#f2dbe6', '--fp-border-strong': '#e0b4c8',
      '--fp-input-bg': '#fdeef4', '--fp-input-border': '#e0b4c8',
      '--fp-text': '#3b2c38', '--fp-text-dim': '#8b7684', '--fp-text-faint': '#b6a3b0',
      '--fp-accent': '#d4577f', '--fp-accent-hi': '#ef83a7', '--fp-accent-soft': '#fbe4ec',
      '--fp-gold': '#c8a24a', '--fp-indigo': '#3a4368',
      '--fp-ok': '#4f9e78', '--fp-danger': '#cf4a45', '--fp-warn': '#c98a1f',
      '--fp-shadow': 'rgba(120, 60, 90, 0.18)', '--fp-overlay': 'rgba(255, 247, 250, 0.82)',
    },
    night: {
      '--fp-bg': '#17131c', '--fp-bg-raised': '#221b28', '--fp-bg-inset': '#100d14',
      '--fp-border': '#372c40', '--fp-border-strong': '#54405e',
      '--fp-input-bg': '#100d14', '--fp-input-border': '#54405e',
      '--fp-text': '#f4eaf1', '--fp-text-dim': '#b09aab', '--fp-text-faint': '#7e6c7c',
      '--fp-accent': '#e884a9', '--fp-accent-hi': '#ffa3c3', '--fp-accent-soft': '#3a2430',
      '--fp-gold': '#e0c07a', '--fp-indigo': '#8f9bd0',
      '--fp-ok': '#6fbf8a', '--fp-danger': '#ef6f75', '--fp-warn': '#d8b25f',
      '--fp-shadow': 'rgba(0, 0, 0, 0.55)', '--fp-overlay': 'rgba(23, 19, 28, 0.86)',
    },
  };

  /* 配置 → 生效值。全部做类型与范围夹取：CONFIG 是给人手改的，写错了不能让面板崩。
     注意 null / undefined / 空串一律当"没写"→ 用默认值（Number(null) 是 0，
     不特判的话"清空这个字段"会变成"设成 0"，那就掉进夹取下限了）。 */
  const num = (v, d, lo, hi) => {
    if (v === null || v === undefined || v === '') return d;
    const n = Number(v);
    if (!Number.isFinite(n)) return d;
    return Math.max(lo, Math.min(hi, n));
  };
  const CFG = {
    ball: {
      size: Math.round(num(CONFIG?.ball?.size, 46, 28, 96)),
      glyph: String(CONFIG?.ball?.glyph ?? '芳').slice(0, 3) || '芳',
      shape: BALL_SHAPES.includes(CONFIG?.ball?.shape) ? CONFIG.ball.shape : 'circle',
      content: {
        kind: CONFIG?.ball?.content?.kind === 'image' && String(CONFIG?.ball?.content?.image ?? '').trim()
          ? 'image' : 'text',
        image: String(CONFIG?.ball?.content?.image ?? ''),
      },
    },
    window: {
      w: Math.round(num(CONFIG?.window?.w, 380, 200, 4000)),
      h: Math.round(num(CONFIG?.window?.h, 620, 160, 4000)),
      minW: Math.round(num(CONFIG?.window?.minW, 260, 140, 2000)),
      minH: Math.round(num(CONFIG?.window?.minH, 200, 100, 2000)),
      maxW: Math.round(num(CONFIG?.window?.maxW, 0, 0, 4000)),
      maxH: Math.round(num(CONFIG?.window?.maxH, 0, 0, 4000)),
    },
    layout: {
      radius: num(CONFIG?.layout?.radius, 14, 0, 40),
      scale: num(CONFIG?.layout?.scale, 1, 0.6, 2),
      fontScale: num(CONFIG?.layout?.fontScale, 1, 0.7, 1.8),
      opacity: num(CONFIG?.layout?.opacity, 1, 0.15, 1),
      blur: num(CONFIG?.layout?.blur, 14, 0, 40),
    },
    wallpaper: {
      url: String(CONFIG?.wallpaper?.url ?? ''),
      fit: ['cover', 'contain', 'repeat'].includes(CONFIG?.wallpaper?.fit) ? CONFIG.wallpaper.fit : 'cover',
      opacity: num(CONFIG?.wallpaper?.opacity, 0.35, 0, 1),
      blur: num(CONFIG?.wallpaper?.blur, 0, 0, 40),
      dim: num(CONFIG?.wallpaper?.dim, 0.15, 0, 0.95),
      dimColor: String(CONFIG?.wallpaper?.dimColor ?? '#000000'),
    },
  };
  const hasWallpaper = () => !!CFG.wallpaper.url;

  /** 整体缩放：把面板 CSS 里 ≥3px 的字面量乘一下。
      1px/2px 的描边保持原样，否则细线会被放大成粗边；vw/vh/% 一律不碰。 */
  function scaleCss(css, k) {
    if (Math.abs(k - 1) < 0.001) return css;
    return css.replace(/(\d+(?:\.\d+)?)px/g, (m, n) => {
      const v = Number(n);
      if (v < 3) return m;
      return (Math.round(v * k * 100) / 100) + 'px';
    });
  }

  /** 字号倍率：**只**乘 font-size 的 px，不动间距（想要整体变大用 scale）。 */
  function scaleFontCss(css, k) {
    if (Math.abs(k - 1) < 0.001) return css;
    return css.replace(/font-size:\s*(\d+(?:\.\d+)?)px/g, (m, n) =>
      'font-size:' + (Math.round(Number(n) * k * 100) / 100) + 'px');
  }

  /* ── 小工具 ─────────────────────────────────────────────────────── */
  const el = (tag, cls, text) => {
    const n = HOST.doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const readLS = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } };
  const writeLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 配额满就放弃，不阻断面板 */ } };
  const chars = (s) => (s ? [...s].length : 0);
  const sizeLabel = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n));

  /**
   * 把窗口的尺寸与坐标夹回当前视口。
   *
   * 存的尺寸/坐标可能是别的时候留下的——桌面上拖到右下角、或手机横竖屏切换前定的位置。
   * 直接照用会让窗口整个落在屏幕外，表现就是「打开了但什么都看不见」。
   * 手机上尤其明显：默认 380 宽在 390 的屏幕上配 right:16px，左边缘已经是 -6px；
   * 桌面存下的 x=880 更是完全看不见。
   */
  function clampToViewport(pos, size) {
    const vw = HOST.win.innerWidth || 1024;
    const vh = HOST.win.innerHeight || 768;
    const w = Math.max(CFG.window.minW, Math.min(Number(size && size.w) || CFG.window.w, vw - 24));
    const h = Math.max(CFG.window.minH, Math.min(Number(size && size.h) || CFG.window.h, vh - 140));
    let x = null;
    let y = Math.min(72, Math.max(8, vh - h - 8));
    if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
      x = Math.max(8, Math.min(pos.x, vw - w - 8));
      y = Math.max(8, Math.min(pos.y, Math.max(8, vh - 96)));
    }
    return { w: Math.round(w), h: Math.round(h), x: x === null ? null : Math.round(x), y: Math.round(y) };
  }

  /* ── 酒馆助手适配层（沿用 has()/attempt() 防御式写法） ───────────── */
  const hostFn = (name) => {
    try {
      const w = typeof window !== 'undefined' ? window : {};
      if (typeof w[name] === 'function') return w[name];
      const th = w.TavernHelper;
      if (th && typeof th[name] === 'function') return th[name].bind(th);
    } catch { /* 忽略 */ }
    return undefined;
  };
  const has = (name) => !!hostFn(name);
  const attempt = (label, fn, fallback) => {
    try { return fn(); } catch (e) { console.warn('[芳乃面板] ' + label, e); return fallback; }
  };

  const api = {
    available() { return has('getPreset') && (has('updatePresetWith') || has('replacePreset')); },
    async get() {
      const get = hostFn('getPreset');
      if (!get) throw new Error('缺少酒馆助手 API：getPreset 不可用');
      return await get('in_use');
    },
    async write(updater) {
      const up = hostFn('updatePresetWith');
      if (up) return await up('in_use', updater, { render: 'immediate' });
      const get = hostFn('getPreset');
      const replace = hostFn('replacePreset');
      if (get && replace) {
        const preset = await get('in_use');
        const next = updater(preset) || preset;
        return await replace('in_use', next);
      }
      throw new Error('缺少酒馆助手 API：updatePresetWith / replacePreset 都不可用');
    },
  };

  /* ── 写回串行化（一次切换只写一次预设） ─────────────────────────── */
  let writeChain = Promise.resolve();
  const enqueue = (fn) => {
    writeChain = writeChain.then(fn, fn);
    return writeChain;
  };

  /* ── 状态 ───────────────────────────────────────────────────────── */
  const state = {
    ready: false,
    presetName: '',
    prompts: [],       // 当前预设的 prompts（酒馆助手 Preset API 形状）
    index: new Map(),  // name -> prompt
    missing: new Map(),// groupId -> 缺失成员数
    night: readLS(LS.night, false),
    collapsed: false,
    /* 整块隐藏：默认**只在本次会话有效**（刷新必然回来）。
       存档里有这个键 = 用户显式 persistHidden 过，那就照办。 */
    hidden: readLS(LS.hidden, false) === true,
    persistHidden: readLS(LS.hidden, null) !== null,
    open: readLS(LS.open, true),
    /** 展开了哪些模块（手风琴）。默认全折。 */
    expanded: new Set(readLS(LS.expanded, [])),
    /** 每个 bundle 组选了哪一套（记住用户的选择，而不是靠猜）。 */
    bundles: readLS(LS.bundle, {}),
    /** 在非自定义模块里手动展开了哪些编辑框。 */
    editors: new Set(),
    /** 位置校验：跑飞时只尝试换挂载点一次，避免递归。 */
    remountTried: false,
    lastPlacement: null,
    busy: false,
    lastError: '',
  };

  const on = (p) => !!p && p.enabled !== false;

  function reindex(prompts) {
    const index = new Map();
    for (const p of prompts) {
      if (!p || typeof p !== 'object') continue;
      const n = p.name ?? '';
      if (!index.has(n)) index.set(n, p);          // 同名取第一条（源预设里就有重名）
      if (p.identifier) index.set('#' + p.identifier, p);
    }
    state.prompts = prompts;
    state.index = index;
    state.missing = new Map();
    for (const g of GROUPS) {
      if (g.mode === 'bundle') {
        for (const o of g.options) {
          const names = [...o.members, ...(o.tunables || []).flatMap((t) => t.members)];
          state.missing.set(g.id + ':' + o.id, names.filter((m) => !index.has(m)).length);
        }
      } else if (g.members) {
        state.missing.set(g.id, g.members.filter((m) => !index.has(m)).length);
      }
    }
  }

  const find = (name) => state.index.get(name) || null;

  async function reload(showToast) {
    if (!api.available()) {
      state.ready = false;
      state.lastError = '没找到酒馆助手 API（getPreset / updatePresetWith）。请在装了「酒馆助手」的环境里运行。';
      render();
      return;
    }
    try {
      const preset = await api.get();
      if (!preset) throw new Error('getPreset 返回空');
      state.presetName = preset.name || attempt('name', () => SillyTavern.getContext().name2, '') || '当前预设';
      reindex(Array.isArray(preset.prompts) ? preset.prompts : []);
      state.ready = true;
      state.lastError = '';
      if (showToast) toast('已读取：' + state.presetName, 'ok');
    } catch (e) {
      state.ready = false;
      state.lastError = String(e && e.message ? e.message : e);
    }
    render();
  }

  /**
   * 思维链标签互斥。
   *
   * 踩过的坑：Kemini 的 ICOT/COT 要求用 <thinking> 思考（ICOT 还是三段，
   * 模型会吐 3 个思考块），Izumi 的思维链条目要求用 konatan_planning~。
   * 两套同时开着，模型会把两种都吐出来，折叠后就变成
   * "一个 Izumi 形态 + 好几个 Kemini 形态"混在一起。
   *
   * 规则：一次写入里若开启了某一套标签的条目，就把另外几套标签的条目全部关掉。
   * 组内不互斥（Izumi 的思维链 + 基米flash尾部 本来就要配对用）。
   */
  function enforceThinkingTags(changes) {
    if (!Array.isArray(THINKING_TAGS) || !THINKING_TAGS.length) return changes;
    const turnOn = new Set(changes.filter((c) => c.enabled === true).map((c) => c.name));
    if (!turnOn.size) return changes;
    const active = THINKING_TAGS.filter((t) => (t.members || []).some((m) => turnOn.has(m)));
    if (!active.length) return changes;
    const keep = active[0];
    const others = THINKING_TAGS.filter((t) => t.id !== keep.id);
    if (!others.length) return changes;
    const isOtherMember = (n) => others.some((t) => (t.members || []).includes(n));
    /* 先把"要开另一套标签"的项剔掉，再把那一套统一关干净 */
    const out = changes.filter((c) => !(c.enabled === true && isOtherMember(c.name)));
    const touched = new Set(out.map((c) => c.name));
    for (const t of others) {
      for (const m of t.members || []) {
        if (touched.has(m) || !find(m)) continue;
        out.push({ name: m, enabled: false });
      }
    }
    return out;
  }

  /** 在预设上批量改 enabled / content；一次调用 = 一次写回。 */
  async function apply(input, note) {
    const changes = enforceThinkingTags(input);
    if (!changes.length) return;
    state.busy = true;
    paintBusy();
    await enqueue(async () => {
      try {
        await api.write((preset) => {
          const prompts = Array.isArray(preset.prompts) ? preset.prompts : (preset.prompts = []);
          const idx = new Map();
          for (const p of prompts) {
            if (!p || typeof p !== 'object') continue;
            const n = p.name ?? '';
            if (!idx.has(n)) idx.set(n, p);
            if (p.identifier) idx.set('#' + p.identifier, p);
          }
          for (const ch of changes) {
            const target = idx.get(ch.name) || idx.get('#' + ch.name);
            if (!target) continue;
            if (typeof ch.content === 'string') target.content = ch.content;
            if (typeof ch.enabled === 'boolean') target.enabled = ch.enabled;
          }
          return preset;
        });
        // 本地镜像同步，避免每次操作都重新拉一遍预设
        for (const ch of changes) {
          const p = find(ch.name);
          if (!p) continue;
          if (typeof ch.content === 'string') p.content = ch.content;
          if (typeof ch.enabled === 'boolean') p.enabled = ch.enabled;
        }
        if (note) toast(note, 'ok');
      } catch (e) {
        toast('写回失败：' + (e && e.message ? e.message : e), 'err');
        console.warn('[芳乃面板] write failed', e);
      }
    });
    state.busy = false;
    paintBusy();
    render();
  }

  /** 单选子集：开一个，关同组其他。 */
  function pickSingle(group, name) {
    const changes = [];
    for (const m of group.members) {
      const p = find(m);
      if (!p) continue;
      changes.push({ name: m, enabled: m === name });
    }
    if (!changes.length) return toast('这一组的条目当前预设里都没有', 'err');
    apply(changes, name ? '已切到 ' + name : '已关闭 ' + group.label);
  }

  /** 破甲分流：开满选中骨架，关掉另外两家；再补该骨架"必选一"档位的默认值。 */
  function pickBundle(group, optionId) {
    const changes = [];
    const seen = new Set();
    for (const o of group.options) {
      const want = o.id === optionId;
      for (const m of o.members) {
        if (seen.has(m)) continue;
        seen.add(m);
        const p = find(m);
        if (!p) continue;
        changes.push({ name: m, enabled: want });
      }
    }
    /* 档位不受切换影响（用户自己的选择保留）；只有"必选一却一个都没开"才补默认 */
    const target = group.options.find((o) => o.id === optionId);
    let filled = 0;
    if (target && target.tunables) {
      for (const t of target.tunables) {
        if (!t.ensureOne) continue;
        const present = t.members.filter((m) => find(m));
        if (!present.length) continue;
        if (present.some((m) => on(find(m)))) continue;
        const pick = present.includes(t.default) ? t.default : present[0];
        changes.push({ name: pick, enabled: true });
        filled++;
      }
    }
    if (!changes.length) return toast('这个预设里没有三组破甲条目', 'err');
    /* 记住这次选的是哪一套，下次打开面板还显示这一套 */
    state.bundles[group.id] = optionId;
    writeLS(LS.bundle, state.bundles);
    const opt = group.options.find((o) => o.id === optionId);
    apply(changes, optionId === 'manual'
      ? '已关掉全部破甲骨架'
      : `破甲切到 ${opt.label}${filled ? `（补了 ${filled} 个必选档位）` : ''}`);
  }

  /** 改某一个条目的正文（雪融雪降那种要用户自己填的）。 */
  function saveContent(name, text) {
    if (!find(name)) return toast('当前预设里没有这一条：' + LBL(name), 'err');
    const before = (find(name).content || '').length;
    if (before === text.length && find(name).content === text) return toast('内容没有变化', 'err');
    apply([{ name, content: text }], `已写入「${LBL(name)}」（${before} → ${text.length} 字）`);
  }

  /** 单选档位（不改变互斥语义的开关）。 */
  function pickTunableSingle(group, t, name) {
    const changes = [];
    for (const m of t.members) {
      const p = find(m);
      if (!p) continue;
      changes.push({ name: m, enabled: m === name });
    }
    if (!changes.length) return toast('这一档的条目当前预设里都没有', 'err');
    apply(changes, `${t.label} → ${name ? LBL(name) : '不使用'}`);
  }

  /* ── 可编辑条目：给输入框 ───────────────────────────────────────── */

  /** 输入框块：开关（locked 的除外）+ textarea + 保存/撤销 + 字数。 */
  function editorBlock(name, info) {
    const p = find(name);
    const wrap = el('div', 'fp-editor');
    const head = el('div', 'fp-rowhead');

    if (info && info.locked) {
      head.appendChild(el('span', 'fp-badge', '固定开启'));
    } else {
      const sw = el('div', 'fp-sw');
      sw.dataset.on = p && on(p) ? '1' : '0';
      sw.appendChild(el('span', '', p && on(p) ? '已启用' : '未启用'));
      sw.title = '点一下开关这一条';
      if (p) sw.addEventListener('click', () => toggleOne(name, !on(p)));
      head.appendChild(sw);
    }
    const count = el('span', 'fp-note', p ? `${chars(p.content)} 字` : '当前预设里没有这一条');
    head.appendChild(count);
    wrap.appendChild(head);

    if (!p) return wrap;

    const ta = el('textarea', 'fp-textarea');
    ta.value = p.content || '';
    ta.addEventListener('input', () => { count.textContent = `${chars(ta.value)} 字（保存后生效）`; });
    wrap.appendChild(ta);

    const row = el('div', 'fp-chips');
    row.appendChild(el('span', 'fp-mini', '保存')).addEventListener('click', () => saveContent(name, ta.value));
    row.appendChild(el('span', 'fp-mini', '撤销改动')).addEventListener('click', () => {
      ta.value = find(name)?.content || '';
      count.textContent = `${chars(ta.value)} 字`;
    });
    wrap.appendChild(row);

    if (info && info.hint) wrap.appendChild(el('div', 'fp-modnote', info.hint));
    return wrap;
  }

  /** 开关银行里给可编辑条目用的「✎ 填内容」按钮。 */
  function editBtn(name) {
    const b = el('div', 'fp-sw fp-editbtn');
    b.dataset.on = state.editors.has(name) ? '1' : '0';
    b.appendChild(el('span', '', '✎ 填内容'));
    b.title = '展开输入框，自己填这一条的内容';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.editors.has(name)) state.editors.delete(name);
      else state.editors.add(name);
      render();
    });
    return b;
  }

  /** 把「某个模块里已展开的可编辑项」输入框补到容器尾部。 */
  function appendOpenEditors(box, members) {
    for (const m of members) {
      if (!EDITABLE[m] || !state.editors.has(m)) continue;
      const wrap = el('div', 'fp-tunable');
      wrap.appendChild(el('div', 'fp-tunlabel', LBL(m)));
      wrap.appendChild(editorBlock(m, EDITABLE[m]));
      box.appendChild(wrap);
    }
  }

  function toggleOne(name, enabled) {
    if (!find(name)) return toast('当前预设里没有这一条：' + name, 'err');
    apply([{ name, enabled }], (enabled ? '已开 ' : '已关 ') + name);
  }

  /**
   * 当前用哪一套骨架。
   * 优先用记住的选择——不能靠"哪组成员的都开着"去猜：梦鲸那套骨架只有 1 条，
   * 源预设里恰好开着就会误判。记住的选择失效时（那套在本预设里根本没有条目）才回到推断。
   */
  function currentBundleOption(group) {
    const chosen = state.bundles[group.id];
    if (chosen && group.options.some((o) => o.id === chosen)) {
      if (chosen === 'manual') return chosen;
      const o = group.options.find((x) => x.id === chosen);
      const present = o.members.filter((m) => find(m));
      if (present.some((m) => on(find(m)))) return chosen;
    }
    let best = 'manual';
    let bestScore = 0;
    for (const o of group.options) {
      if (!o.members.length) continue;
      const present = o.members.filter((m) => find(m));
      if (!present.length) continue;
      const score = present.filter((m) => on(find(m))).length;
      if (score > bestScore) { bestScore = score; best = o.id; }
    }
    return best;
  }

  /* ── 小方案 ─────────────────────────────────────────────────────── */
  const managedNames = () => {
    const out = [];
    for (const g of GROUPS) {
      if (g.mode === 'bundle') for (const o of g.options) out.push(...o.members);
      else if (g.mode !== 'fixed' && g.members) out.push(...g.members);
    }
    return [...new Set(out)].filter((n) => find(n));
  };
  const plans = () => readLS(LS.plans, []);
  function savePlan() {
    const snap = {};
    for (const n of managedNames()) if (on(find(n))) snap[n] = 1;
    const name = '方案 ' + (plans().length + 1);
    const next = plans().concat([{ id: 'p' + Date.now(), name, entries: snap }]);
    writeLS(LS.plans, next);
    render();
    toast('已存为「' + name + '」（' + Object.keys(snap).length + ' 条）', 'ok');
  }
  function applyPlan(plan) {
    const changes = [];
    for (const n of managedNames()) {
      const p = find(n);
      changes.push({ name: n, enabled: !!plan.entries[n] });
    }
    apply(changes, '已应用「' + plan.name + '」');
  }

  /* ── toast ──────────────────────────────────────────────────────── */
  let toastTimer = null;
  function toast(msg, kind) {
    /* toast 也必须能容错：body 未就绪时不该把调用方带崩 */
    try {
      if (!HOST.doc.body) { console.log('[芳乃面板] ' + msg); return; }
      let box = HOST.doc.getElementById(ID + '-toast');
      if (!box) {
        box = el('div', 'fp-toast');
        box.id = ID + '-toast';
        HOST.doc.body.appendChild(box);
      }
      box.textContent = msg;
      box.dataset.kind = kind || 'info';
      box.classList.add('fp-toast-show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => box.classList.remove('fp-toast-show'), 2600);
    } catch (e) {
      console.log('[芳乃面板] toast 失败：' + msg, e);
    }
  }
  function paintBusy() {
    const root = HOST.doc.getElementById(ID + '-win');
    if (root) root.dataset.busy = state.busy ? '1' : '0';
  }

  /**
   * 用酒馆自己的 toast 播报一条消息。
   *
   * 为什么需要它：手机 Chrome 上打不开控制台，面板又正好是"看不见"的那一方，
   * 于是用户拿不到任何线索。酒馆的 toastr 渲染在酒馆自己的界面里，手机上一眼就能看到。
   */
  function notifyUser(msg, kind) {
    const level = kind === 'err' ? 'error' : kind === 'ok' ? 'success' : 'info';
    let shown = false;
    for (const scope of [HOST.win, window]) {
      try {
        const t = scope && scope.toastr;
        if (t && typeof t[level] === 'function') { t[level](msg); shown = true; break; }
      } catch { /* 换下一个 */ }
    }
    if (!shown) toast(msg, kind);
    if (kind === 'err') console.error('[芳乃面板] ' + msg);
    else console.log('[芳乃面板] ' + msg);
    return shown;
  }

  /**
   * 量悬浮球是否真的在视口内，并给出可能的原因。
   *
   * 手机上实测到的现象是「悬浮球 (12,-158) / 视口 360×695」——left 正常、top 完全跑飞。
   * 这说明定位所依赖的**包含块高度算成了 0**，也就是 `.fp-root` 没有被拉伸成视口大小。
   * 最常见的原因是页面某层祖先带了 transform / filter / perspective / contain，
   * 于是 `position:fixed` 被"关进"那个祖先的坐标系里。
   */
  function measureBall(ball) {
    const docEl = HOST.doc.documentElement || {};
    const vw = HOST.win.innerWidth || docEl.clientWidth || 0;
    const vh = HOST.win.innerHeight || docEl.clientHeight || 0;
    let rect = null;
    try { rect = ball.getBoundingClientRect(); } catch { /* 某些宿主拿不到几何 */ }
    if (!rect) return { ok: true, rect: '未知', viewport: `${vw}×${vh}`, hint: '' };
    const ok = rect.left >= 0 && rect.top >= 0
      && rect.left + rect.width <= vw + 1 && rect.top + rect.height <= vh + 1;
    const root = HOST.doc.getElementById(ID + '-root');
    let rootH = null;
    try { rootH = root ? Math.round(root.getBoundingClientRect().height) : null; } catch { /* 忽略 */ }
    const hint = rootH === null ? ''
      : `（根容器高 ${rootH}px，挂载点 ${root && root.parentNode === docEl ? 'documentElement' : 'body'}）`;
    return {
      ok,
      rect: `${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}×${Math.round(rect.height)}`,
      viewport: `${vw}×${vh}`,
      rootHeight: rootH,
      mountedOn: root && root.parentNode === docEl ? 'documentElement' : 'body',
      hint,
    };
  }

  /**
   * 渲染后校验悬浮球位置；跑飞了就换个挂载点再试一次。
   *
   * 换挂载点的理由：fixed 定位的包含块由最近的 transform/filter/contain 祖先决定。
   * 若这层祖先在 body 里，把面板挪到 `documentElement` 下（body 的兄弟）就能绕开。
   */
  function afterRenderPlacement(root, ball) {
    const g = measureBall(ball);
    state.lastPlacement = g;
    if (g.ok) return g;
    const docEl = HOST.doc.documentElement;
    if (!state.remountTried && docEl && root.parentNode !== docEl) {
      state.remountTried = true;
      console.warn('[芳乃面板] 悬浮球位置异常（' + g.rect + '），改挂到 documentElement 再试一次');
      try {
        docEl.appendChild(root);
        render();
        return state.lastPlacement;
      } catch (e) {
        console.warn('[芳乃面板] 改挂失败', e);
      }
    }
    return g;
  }

  /** 启动自检：确认面板**真的看得见**。看不见就说清楚是哪一种，别让用户对着空气猜。 */
  function selfCheck() {
    const problems = [];
    if (HOST.fellBack) problems.push('拿不到外层页面（跨域），面板被挂进了内层 iframe');
    if (!HOST.doc.body) problems.push('宿主文档 body 还没就绪');
    const root = HOST.doc.getElementById(ID + '-root');
    if (!root) {
      problems.push('面板根节点没插进页面');
    } else {
      let ball = null;
      try { ball = root.querySelector ? root.querySelector('.fp-launch') : null; } catch { /* 忽略 */ }
      if (!ball) problems.push('悬浮球没创建出来');
      else {
        const g = measureBall(ball);
        if (!g.ok) problems.push(`悬浮球跑到了视口外（${g.rect} / 视口 ${g.viewport}）${g.hint}`);
      }
    }
    if (state.lastError) problems.push('读取预设出错：' + state.lastError);
    return problems;
  }

  /* ── 样式 ───────────────────────────────────────────────────────── */
  function ensureStyle() {
    let s = HOST.doc.getElementById(ID + '-style');
    if (!s) { s = el('style'); s.id = ID + '-style'; HOST.doc.head.appendChild(s); }
    const tokens = (theme) => Object.entries(theme).map(([k, v]) => `${k}:${v};`).join('');
    /* CONFIG.tokens 覆盖内置主题（只写想改的键） */
    const day = { ...THEMES.day, ...((CONFIG && CONFIG.tokens && CONFIG.tokens.day) || {}) };
    const night = { ...THEMES.night, ...((CONFIG && CONFIG.tokens && CONFIG.tokens.night) || {}) };
    const raw = `
.fp-root{position:fixed;top:0;left:0;width:0;height:0;z-index:2147482000;pointer-events:none;
  font-family:system-ui,-apple-system,"Segoe UI","Noto Sans SC",sans-serif;
  font-size:13px;line-height:1.65;color:var(--fp-text);-webkit-font-smoothing:antialiased;}
.fp-root[data-theme="day"]{${tokens(day)}}
.fp-root[data-theme="night"]{${tokens(night)}}

/* 窗口的分层（由下到上）：
   0 底色层（原来的磨砂玻璃，带 CONFIG 的不透明度/模糊）
   1 壁纸层   2 压暗层   3 内容
   分成 4 层是为了让"半透明 + 壁纸 + 文字仍可读"这三件事互不打架。 */
.fp-bglayer{position:absolute;inset:0;z-index:0;background:var(--fp-overlay);
  opacity:var(--fp-opacity,1);backdrop-filter:blur(var(--fp-blur,14px)) saturate(1.1);
  -webkit-backdrop-filter:blur(var(--fp-blur,14px)) saturate(1.1);}
.fp-wall{position:absolute;inset:0;z-index:1;background-position:center;background-repeat:no-repeat;
  opacity:var(--fp-wall-opacity,0);filter:blur(var(--fp-wall-blur,0px));pointer-events:none;}
.fp-wall[data-fit="repeat"]{background-repeat:repeat;background-size:auto;}
.fp-wall[data-fit="contain"]{background-size:contain;}
.fp-wall[data-fit="cover"]{background-size:cover;}
.fp-walldim{position:absolute;inset:0;z-index:2;pointer-events:none;
  background:var(--fp-wall-dim-color,#000);opacity:var(--fp-wall-dim,0);}
.fp-head,.fp-body,.fp-foot{position:relative;z-index:3;}
/* 悬浮球：自己 fixed 定位、坐标由 JS 按视口算好写进去。
   早先靠 .fp-root 的 inset:0 撑满 + bottom:96px 来定位，实测在手机上会算到
   视口外（12,-158）——因为根容器一旦没被拉伸成视口大小（祖先带了 transform/
   filter/contain 等），bottom 就是从零高度算出来的负值。改掉这个依赖。 */
.fp-launch{position:fixed;pointer-events:auto;width:var(--fp-ball,46px);height:var(--fp-ball,46px);
  border-radius:50%;display:grid;place-items:center;
  background:linear-gradient(145deg,var(--fp-accent-hi),var(--fp-accent));color:#fff;cursor:pointer;
  box-shadow:0 6px 18px var(--fp-shadow);border:2px solid var(--fp-gold);
  font-family:Georgia,"Songti SC","SimSun",serif;font-size:calc(var(--fp-ball,46px) * .41);user-select:none;
  -webkit-tap-highlight-color:transparent;}
/* 金色点缀就用在球的金边上（改 --fp-gold 立刻看得见） */
.fp-launch:hover{filter:brightness(1.06)}
.fp-launch[data-open="1"]{opacity:.35}
/* 形状：圆/方/圆角方靠 border-radius，菱形/三角/六边靠 clip-path */
.fp-launch[data-shape="circle"]{border-radius:50%}
.fp-launch[data-shape="square"]{border-radius:2px}
.fp-launch[data-shape="rounded"]{border-radius:26%}
.fp-launch[data-shape="diamond"]{clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%)}
.fp-launch[data-shape="triangle"]{clip-path:polygon(50% 4%,98% 94%,2% 94%)}
.fp-launch[data-shape="hexagon"]{clip-path:polygon(25% 4%,75% 4%,100% 50%,75% 96%,25% 96%,0 50%)}
/* 尖角形状里的字要缩小，不然会顶出边界 */
.fp-launch[data-shape="triangle"],.fp-launch[data-shape="diamond"],.fp-launch[data-shape="hexagon"]{font-size:calc(var(--fp-ball,46px) * .3)}
.fp-ball-img{width:100%;height:100%;object-fit:cover;display:block;border-radius:inherit}
/* 整块隐藏时：根节点连球一起不画 */
.fp-root[data-hidden="1"]{display:none}

/* 窗口自己 fixed 定位，left/top 由 clampToViewport() 算好后写进去。
   底色/磨砂/壁纸都在子层里（.fp-bglayer/.fp-wall/.fp-walldim），
   所以这里背景是透明的，圆角交给 CONFIG。 */
.fp-win{position:fixed;pointer-events:auto;
  background:transparent;
  border:1px solid var(--fp-border-strong);border-radius:var(--fp-radius,14px);
  box-shadow:0 18px 48px var(--fp-shadow);
  display:flex;flex-direction:column;overflow:hidden;
  min-width:var(--fp-minw,260px);min-height:var(--fp-minh,200px);
  max-width:var(--fp-maxw,calc(100vw - 16px));max-height:var(--fp-maxh,calc(100dvh - 16px));}
.fp-win[data-night="1"]{}
.fp-win[data-collapsed="1"] .fp-body,.fp-win[data-collapsed="1"] .fp-foot{display:none}
.fp-win[data-busy="1"]{cursor:progress}

.fp-head{display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:move;touch-action:none;
  background:linear-gradient(180deg,var(--fp-accent-soft),transparent);
  border-bottom:1px solid var(--fp-border);}
.fp-title{flex:1;min-width:0;font-family:Georgia,"Songti SC","STSong","SimSun",serif;font-size:14px;
  color:var(--fp-indigo);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:.4px}
.fp-title small{display:block;font-family:inherit;font-size:10px;color:var(--fp-ok);
  letter-spacing:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fp-icon{width:24px;height:24px;border-radius:7px;border:1px solid var(--fp-border);background:var(--fp-bg-raised);
  color:var(--fp-text-dim);display:grid;place-items:center;cursor:pointer;font-size:12px;flex:0 0 auto}
.fp-icon:hover{color:var(--fp-accent);border-color:var(--fp-border-strong)}

/* 关键：子项必须 flex:0 0 auto。body 高度固定时，默认的 flex-shrink:1 会把每个模块
   压成 2px（只剩边框），标题就点不到了——这就是「点名字展不开」的真凶。 */
.fp-body{flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain;padding:8px 10px 10px;
  display:flex;flex-direction:column;gap:7px}
.fp-body > *{flex:0 0 auto}
.fp-seclabel{font-size:10.5px;font-weight:600;color:var(--fp-text-faint);letter-spacing:.8px;padding:7px 2px 0}
.fp-seclabel:first-child{padding-top:0}

.fp-mod{border:1px solid var(--fp-border);border-radius:10px;background:var(--fp-bg-raised);overflow:hidden}
.fp-mod[data-open="1"]{border-color:var(--fp-border-strong);box-shadow:0 2px 10px var(--fp-shadow)}
.fp-modhead{display:flex;align-items:center;gap:7px;padding:7px 9px;cursor:pointer;user-select:none}
.fp-modhead:hover{background:var(--fp-accent-soft)}
.fp-mod[data-open="1"] .fp-modhead{border-bottom:1px solid var(--fp-border);background:var(--fp-bg-inset)}
.fp-chev{flex:0 0 auto;color:var(--fp-text-faint);font-size:9px;transition:transform .15s}
.fp-mod[data-open="1"] .fp-chev{transform:rotate(90deg);color:var(--fp-accent)}
.fp-modlabel{font-size:12px;font-weight:600;color:var(--fp-text);flex:1 1 auto;min-width:0;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fp-modstate{flex:0 1 auto;max-width:50%;font-size:10.5px;color:var(--fp-accent);text-align:right;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fp-modstate[data-empty="1"]{color:var(--fp-text-faint)}
.fp-modbody{padding:9px;display:flex;flex-direction:column;gap:7px;background:var(--fp-bg)}
.fp-modnote{font-size:10.5px;color:var(--fp-text-faint);line-height:1.5}

/* 破甲档位 */
.fp-tunables{display:flex;flex-direction:column;gap:9px;padding-top:8px;border-top:1px dashed var(--fp-border)}
.fp-tunable{display:flex;flex-direction:column;gap:5px;padding:7px 8px;border-radius:8px;
  border:1px solid var(--fp-border);background:var(--fp-bg-raised)}
.fp-tunlabel{font-size:11.5px;font-weight:600;color:var(--fp-text)}
.fp-textarea{width:100%;box-sizing:border-box;min-height:110px;resize:vertical;padding:6px 8px;
  border-radius:8px;border:1px solid var(--fp-input-border);background:var(--fp-input-bg);
  color:var(--fp-text);font:inherit;font-size:11.5px;line-height:1.5}
.fp-textarea:focus{outline:none;border-color:var(--fp-accent);box-shadow:0 0 0 3px var(--fp-accent-soft)}

/* 可编辑条目的输入框块 */
.fp-editor{display:flex;flex-direction:column;gap:6px}
.fp-editor .fp-textarea{min-height:132px;background:var(--fp-input-bg)}
.fp-editbtn{border-style:dashed;color:var(--fp-text-dim)}
.fp-editbtn[data-on="1"]{border-style:solid}

.fp-rowhead{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}
.fp-note{font-size:10.5px;color:var(--fp-text-faint)}
.fp-badge{font-size:10px;padding:0 5px;border-radius:99px;border:1px solid var(--fp-border-strong);
  color:var(--fp-accent);background:var(--fp-accent-soft);flex:0 0 auto}
.fp-badge[data-kind="miss"]{color:var(--fp-warn);border-color:var(--fp-warn);background:transparent}

.fp-select{width:100%;box-sizing:border-box;padding:5px 7px;border-radius:8px;
  border:1px solid var(--fp-input-border);background:var(--fp-input-bg);color:var(--fp-text);font:inherit;font-size:12px;
  cursor:pointer}
.fp-select:focus{outline:none;border-color:var(--fp-accent);box-shadow:0 0 0 3px var(--fp-accent-soft)}

.fp-switches{display:flex;flex-wrap:wrap;gap:5px}
.fp-sw{display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:99px;
  border:1px solid var(--fp-border);background:var(--fp-bg);color:var(--fp-text-dim);
  font-size:11.5px;cursor:pointer;user-select:none;max-width:100%}
.fp-sw span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:230px}
.fp-sw i{font-style:normal;font-size:9.5px;color:var(--fp-text-faint)}
.fp-sw:hover{border-color:var(--fp-border-strong)}
.fp-sw[data-on="1"]{background:var(--fp-accent-soft);border-color:var(--fp-accent);color:var(--fp-accent)}
.fp-sw[data-on="1"] i{color:var(--fp-accent)}
.fp-sw[data-miss="1"]{opacity:.42;cursor:not-allowed;text-decoration:line-through}

.fp-foot{border-top:1px solid var(--fp-border);padding:8px 10px;display:flex;flex-direction:column;gap:7px;
  background:var(--fp-bg-inset)}
.fp-chips{display:flex;flex-wrap:wrap;gap:5px;align-items:center}
.fp-chip{font-size:11px;padding:3px 9px;border-radius:99px;border:1px solid var(--fp-border-strong);
  background:var(--fp-bg);color:var(--fp-text);cursor:pointer}
.fp-chip:hover{border-color:var(--fp-accent);color:var(--fp-accent)}
.fp-mini{font-size:11px;padding:3px 9px;border-radius:8px;border:1px solid var(--fp-border-strong);
  background:var(--fp-bg);color:var(--fp-text-dim);cursor:pointer}
.fp-mini:hover{color:var(--fp-accent);border-color:var(--fp-accent)}
.fp-warnbox{margin:0 0 8px;padding:7px 9px;border-radius:8px;border:1px solid var(--fp-warn);
  background:var(--fp-accent-soft);color:var(--fp-warn);font-size:11.5px}
/* 出错（读不到预设、注入失败）单独用危险色——和"缺少某些条目"这种提醒区分开 */
.fp-warnbox[data-kind="err"]{border-color:var(--fp-danger);color:var(--fp-danger)}

.fp-resize{position:absolute;right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;touch-action:none}
.fp-resize::after{content:"";position:absolute;right:3px;bottom:3px;width:7px;height:7px;
  border-right:2px solid var(--fp-border-strong);border-bottom:2px solid var(--fp-border-strong)}

.fp-toast{position:fixed;left:50%;bottom:26px;transform:translate(-50%,14px);z-index:10100;
  padding:7px 14px;border-radius:99px;font-size:12px;background:#2b2230;color:#fff;opacity:0;
  pointer-events:none;transition:opacity .18s,transform .18s;max-width:80vw;text-align:center}
.fp-toast[data-kind="ok"]{background:var(--fp-accent,#d4577f)}
.fp-toast[data-kind="err"]{background:#b8403c}
.fp-toast-show{opacity:1;transform:translate(-50%,0)}
`;
    /* 1) 整体缩放（≥3px 的字面量乘一下）  2) 把 CONFIG 的量写成 CSS 变量（放最后，覆盖前面的默认值）
       顺序很重要：先缩放静态 CSS，再追加变量覆盖 —— 变量里的 px 不该被缩放。 */
    const cfgVars = [
      `--fp-radius:${CFG.layout.radius}px`,
      `--fp-opacity:${CFG.layout.opacity}`,
      `--fp-blur:${CFG.layout.blur}px`,
      `--fp-ball:${CFG.ball.size}px`,
      `--fp-wall-opacity:${hasWallpaper() ? CFG.wallpaper.opacity : 0}`,
      `--fp-wall-blur:${CFG.wallpaper.blur}px`,
      `--fp-wall-dim:${hasWallpaper() ? CFG.wallpaper.dim : 0}`,
      `--fp-wall-dim-color:${CFG.wallpaper.dimColor}`,
      `--fp-minw:${CFG.window.minW}px`,
      `--fp-minh:${CFG.window.minH}px`,
      `--fp-maxw:${CFG.window.maxW ? CFG.window.maxW + 'px' : 'calc(100vw - 16px)'}`,
      `--fp-maxh:${CFG.window.maxH ? CFG.window.maxH + 'px' : 'calc(100dvh - 16px)'}`,
    ].join(';');
    s.textContent = scaleFontCss(scaleCss(raw, CFG.layout.scale), CFG.layout.fontScale)
      + `\n.fp-root{${cfgVars};}\n`
      + `.fp-win{min-width:var(--fp-minw,260px);min-height:var(--fp-minh,200px);`
      + `max-width:var(--fp-maxw,calc(100vw - 16px));max-height:var(--fp-maxh,calc(100dvh - 16px));}\n`;
  }

  /* ── 渲染 ───────────────────────────────────────────────────────── */
  function render() {
    /* body 还没就绪时不要硬插，更不要抛异常——抛出去会让整个面板什么都不画。
       等一下就绪再画。 */
    if (!HOST.doc.body) {
      whenHostReady().then((ready) => { if (ready) render(); });
      return;
    }
    try {
      ensureStyle();
    } catch (e) {
      console.warn('[芳乃面板] 注入样式失败', e);
    }
    /* 全量重渲染会把滚动位置冲掉（改一个选项就跳回顶部）。先记住，画完再还回去。 */
    const prevScroll = state.bodyEl ? state.bodyEl.scrollTop : 0;
    let root = HOST.doc.getElementById(ID + '-root');
    if (!root) {
      root = el('div', 'fp-root');
      root.id = ID + '-root';
      HOST.doc.body.appendChild(root);
    }
    root.dataset.theme = state.night ? 'night' : 'day';
    root.dataset.hidden = state.hidden ? '1' : '0';
    root.textContent = '';

    /* 悬浮球：形状 / 内容（字或图）/ 可拖 / 可整块隐藏 */
    if (state.hidden) return;                    // 整块隐藏：连球一起不画
    const ball = el('div', 'fp-launch');
    ball.dataset.open = state.open ? '1' : '0';
    ball.dataset.shape = CFG.ball.shape;
    ball.title = (state.open ? '收起芳乃面板' : '打开芳乃面板') + '（可拖动；Ctrl+Shift+F 整块隐藏）';
    if (CFG.ball.content.kind === 'image') {
      const img = el('img', 'fp-ball-img');
      img.src = CFG.ball.content.image;
      img.alt = '';
      ball.appendChild(img);
    } else {
      ball.textContent = CFG.ball.glyph;
    }
    /* 坐标：优先用上次拖到的位置（夹回视口），否则按当前视口算默认位。
       不依赖容器被拉伸，也不依赖 bottom/env 的解析。 */
    {
      const docEl = HOST.doc.documentElement || {};
      const vw = HOST.win.innerWidth || docEl.clientWidth || 360;
      const vh = HOST.win.innerHeight || docEl.clientHeight || 640;
      const def = {
        x: Math.max(8, Math.min(12, vw - CFG.ball.size - 14)),
        y: Math.max(8, vh - 96 - CFG.ball.size - 8),
      };
      const p = clampBall(readLS(LS.ball, null), def, CFG.ball.size, vw, vh);
      ball.style.left = p.x + 'px';
      ball.style.top = p.y + 'px';
    }
    ball.addEventListener('click', () => {
      /* 刚拖完的那一下 pointerup 之后会跟一个 click：别把它当成"点开面板" */
      if (ballMoved) { ballMoved = false; return; }
      state.open = !state.open;
      writeLS(LS.open, state.open);
      render();
    });
    root.appendChild(ball);
    /* 球自己也能拖（窗口那个是标题栏上的 makeDraggable，两者坐标分开存） */
    makeDraggable(ball, ball, LS.ball, () => { ballMoved = true; });
    if (!state.open) return;

    /* 窗 */
    const win = el('div', 'fp-win');
    win.id = ID + '-win';
    win.dataset.collapsed = state.collapsed ? '1' : '0';
    win.dataset.night = state.night ? '1' : '0';

    /* 底色层 / 壁纸层 / 压暗层（顺序即层级，见样式注释）。
       壁纸为空时壁纸层 opacity 是 0，等于不存在。 */
    win.appendChild(el('div', 'fp-bglayer'));
    if (hasWallpaper()) {
      const wall = el('div', 'fp-wall');
      wall.id = ID + '-wall';
      wall.dataset.fit = CFG.wallpaper.fit;
      wall.style.backgroundImage = `url("${CFG.wallpaper.url.replace(/"/g, '%22')}")`;
      win.appendChild(wall);
      win.appendChild(el('div', 'fp-walldim'));
    }

    /* 位置与尺寸一律先夹回视口。
       存的宽高/坐标可能是桌面上留下的（或手机横竖屏切换前的），
       直接照用会把窗口整个推到屏幕外——表现就是"打开了但什么都看不见"。 */
    const box = clampToViewport(readLS(LS.pos, null), readLS(LS.size, null));
    win.style.width = box.w + 'px';
    win.style.height = box.h + 'px';
    if (box.x === null) {
      win.style.right = '12px';
      win.style.top = box.y + 'px';
    } else {
      win.style.left = box.x + 'px';
      win.style.top = box.y + 'px';
    }

    /* 头 */
    const head = el('div', 'fp-head');
    const title = el('div', 'fp-title', CONFIG?.title || '🌸 芳乃 · 预设面板');
    const sub = el('small', '', state.ready
      ? `${state.presetName}　·　${state.prompts.filter(on).length}/${state.prompts.length} 条开启`
      : (state.lastError || '正在读取预设…'));
    title.appendChild(sub);
    head.appendChild(title);

    const nightBtn = el('div', 'fp-icon', state.night ? '☀' : '🌙');
    nightBtn.title = state.night ? '切到白天配色' : '切到夜间配色';
    nightBtn.addEventListener('click', () => { state.night = !state.night; writeLS(LS.night, state.night); render(); });
    head.appendChild(nightBtn);

    const minBtn = el('div', 'fp-icon', state.collapsed ? '▢' : '—');
    minBtn.title = state.collapsed ? '展开' : '收起';
    minBtn.addEventListener('click', () => { state.collapsed = !state.collapsed; render(); });
    head.appendChild(minBtn);

    const closeBtn = el('div', 'fp-icon', '✕');
    closeBtn.title = '关闭（点悬浮球再打开）';
    closeBtn.addEventListener('click', () => { state.open = false; writeLS(LS.open, false); render(); });
    head.appendChild(closeBtn);
    win.appendChild(head);

    /* 体 */
    const body = el('div', 'fp-body');
    if (HOST.fellBack) {
      const box = el('div', 'fp-warnbox',
        '⚠ 拿不到外层页面的访问权（跨域），面板被挂在了内层 iframe 里——如果你看不到它，这就是原因。'
        + '把 window.__FANO_PANEL__.diagnose() 的结果发出来可以确认。');
      body.appendChild(box);
    }
    if (!state.ready) {
      const box = el('div', 'fp-warnbox', state.lastError || '正在读取预设…');
      if (state.lastError) box.dataset.kind = 'err';
      body.appendChild(box);
    }
    for (const sec of SECTIONS) {
      body.appendChild(el('div', 'fp-seclabel', sec.title));
      for (const gid of sec.groups) {
        const g = GROUPS.find((x) => x.id === gid);
        if (g) body.appendChild(renderGroup(g));
      }
    }
    win.appendChild(body);

    /* 脚 */
    const foot = el('div', 'fp-foot');
    const chips = el('div', 'fp-chips');
    chips.appendChild(el('span', 'fp-note', '小方案：'));
    const ps = plans();
    if (!ps.length) chips.appendChild(el('span', 'fp-note', '（还没存）'));
    for (const plan of ps) {
      const c = el('span', 'fp-chip', plan.name);
      c.title = '点一下应用；右键删除';
      c.addEventListener('click', () => applyPlan(plan));
      c.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        writeLS(LS.plans, plans().filter((x) => x.id !== plan.id));
        render(); toast('已删除「' + plan.name + '」', 'ok');
      });
      chips.appendChild(c);
    }
    chips.appendChild(el('span', 'fp-chip', '＋存为小方案')).addEventListener('click', savePlan);
    foot.appendChild(chips);

    const actions = el('div', 'fp-chips');
    actions.appendChild(el('span', 'fp-mini', '刷新')).addEventListener('click', () => reload(true));
    actions.appendChild(el('span', 'fp-mini', state.expanded.size ? '全部折起' : '全部展开')).addEventListener('click', () => {
      if (state.expanded.size) state.expanded.clear();
      else for (const g of GROUPS) if (g.mode !== 'hidden') state.expanded.add(g.id);
      writeLS(LS.expanded, [...state.expanded]);
      render();
    });
    actions.appendChild(el('span', 'fp-mini', '本组全关')).addEventListener('click', () => {
      const changes = managedNames().filter((n) => on(find(n))).map((n) => ({ name: n, enabled: false }));
      apply(changes, '已关掉面板管理的全部条目');
    });
    actions.appendChild(el('span', 'fp-note', `v${VERSION}（${managedNames().length} 条受管）`));
    foot.appendChild(actions);
    win.appendChild(foot);

    const rz = el('div', 'fp-resize');
    rz.title = '拖动缩放';
    win.appendChild(rz);

    root.appendChild(win);
    state.bodyEl = body;
    if (prevScroll) {
      body.scrollTop = prevScroll;
      /* 有些浏览器在元素刚插入时会重置 scrollTop，下一帧再兜一次 */
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => { body.scrollTop = prevScroll; });
      }
    }
    makeDraggable(win, head);
    makeResizable(win, rz);

    /* 画完校验一次悬浮球位置：跑飞了就换挂载点重试（见 afterRenderPlacement）。
       用户开着的窗口也顺手夹一次，避免它落到屏外。 */
    afterRenderPlacement(root, ball);
    if (state.open) {
      try {
        const r = win.getBoundingClientRect();
        const docEl = HOST.doc.documentElement || {};
        const vw = HOST.win.innerWidth || docEl.clientWidth || 360;
        const vh = HOST.win.innerHeight || docEl.clientHeight || 640;
        if (r.left < 0 || r.left + r.width > vw + 1) {
          win.style.left = `${Math.max(8, Math.min(parseFloat(win.style.left) || 8, vw - r.width - 8))}px`;
        }
        if (r.top < 0 || r.top + 40 > vh) {
          win.style.top = `${Math.max(8, Math.min(parseFloat(win.style.top) || 8, vh - 96))}px`;
        }
      } catch { /* 拿不到几何就算了 */ }
    }
  }

  /** 折叠状态下那一行右边显示的"现在是什么"——不展开也能看清当前状态。 */
  function groupStateText(g) {
    if (g.mode === 'bundle') {
      const active = currentBundleOption(g);
      const opt = g.options.find((o) => o.id === active);
      if (!opt) return '';
      if (active === 'manual') return '手动 · 全关';
      const n = opt.members.filter((m) => find(m)).length;
      const tuned = (opt.tunables || []).filter((t) => t.members.some((m) => { const p = find(m); return p && on(p); })).length;
      return `${opt.source || opt.label} · ${n} 条${tuned ? ` · 档位 ${tuned}` : ''}`;
    }
    if (g.mode === 'fixed') return `${g.members.length} 条 · 不碰`;
    if (g.mode === 'editable') {
      const present = g.members.filter((m) => find(m));
      const onCount = present.filter((m) => on(find(m))).length;
      return `${onCount}/${present.length} 条启用 · 可填写`;
    }
    if (g.mode === 'single') {
      const cur = g.members.find((m) => { const p = find(m); return p && on(p); });
      return cur ? LBL(cur) : '未选';
    }
    const onNames = g.members.filter((m) => { const p = find(m); return p && on(p); });
    if (!onNames.length) return `0/${g.members.length} 开`;
    const head = onNames.slice(0, 2).map(LBL).join('、');
    return `${onNames.length}/${g.members.length} · ${head}${onNames.length > 2 ? ` +${onNames.length - 2}` : ''}`;
  }

  /** 一个档位（tunable）：单选下拉 / 多选开关 / 正文编辑框。 */
  function renderTunable(g, option, t) {
    const wrap = el('div', 'fp-tunable');
    const head = el('div', 'fp-rowhead');
    head.appendChild(el('span', 'fp-tunlabel', t.label));
    const onNames = t.members.filter((m) => { const p = find(m); return p && on(p); });
    head.appendChild(el('span', 'fp-badge', t.ensureOne ? '必选一' : (t.mode === 'text' ? '需填内容' : '可多选')));
    if (t.mode === 'multi' || t.mode === 'text') {
      head.appendChild(el('span', 'fp-note', `${onNames.length}/${t.members.length} 开`));
    }
    wrap.appendChild(head);

    const miss = t.members.filter((m) => !find(m)).length;
    if (miss) {
      const b = el('span', 'fp-badge', '缺' + miss);
      b.dataset.kind = 'miss';
      head.appendChild(b);
    }

    if (t.mode === 'text') {
      const name = t.members[0];
      if (!find(name)) {
        wrap.appendChild(el('div', 'fp-modnote', `当前预设里没有「${LBL(name)}」。`));
        return wrap;
      }
      wrap.appendChild(editorBlock(name, { hint: t.note }));
      return wrap;
    }

    if (t.mode === 'single') {
      const sel = el('select', 'fp-select');
      if (t.optional) {
        const noneOpt = el('option', '', '（不使用）');
        noneOpt.value = '';
        sel.appendChild(noneOpt);
      }
      let cur = '';
      for (const m of t.members) {
        const p = find(m);
        const opt = el('option', '', p ? `${LBL(m)}　(${sizeLabel(chars(p.content))})` : `${LBL(m)}　（缺失）`);
        opt.value = m;
        if (p && on(p)) { opt.selected = true; cur = m; }
        if (!p) opt.disabled = true;
        sel.appendChild(opt);
      }
      sel.value = cur;
      sel.addEventListener('change', () => pickTunableSingle(g, t, sel.value));
      wrap.appendChild(sel);
      if (cur && EDITABLE[cur]) {
        const sub = el('div', 'fp-tunable');
        sub.appendChild(el('div', 'fp-tunlabel', `${LBL(cur)} · 自己填`));
        sub.appendChild(editorBlock(cur, EDITABLE[cur]));
        wrap.appendChild(sub);
      }
      appendOpenEditors(wrap, t.members);
      if (t.note) wrap.appendChild(el('div', 'fp-modnote', t.note));
      return wrap;
    }

    const grid = el('div', 'fp-switches');
    for (const m of t.members) {
      const p = find(m);
      const sw = el('div', 'fp-sw');
      sw.dataset.on = p && on(p) ? '1' : '0';
      if (!p) sw.dataset.miss = '1';
      sw.appendChild(el('span', '', LBL(m)));
      if (p) sw.appendChild(el('i', '', sizeLabel(chars(p.content))));
      sw.title = p ? `${LBL(m)}\n${chars(p.content)} 字　当前：${on(p) ? '开' : '关'}` : `${LBL(m)}\n当前预设里没有这一条`;
      if (p) sw.addEventListener('click', () => toggleOne(m, !on(p)));
      grid.appendChild(sw);
      if (EDITABLE[m]) grid.appendChild(editBtn(m));
    }
    wrap.appendChild(grid);
    appendOpenEditors(wrap, t.members);
    if (t.note) wrap.appendChild(el('div', 'fp-modnote', t.note));
    return wrap;
  }

  function renderGroup(g) {
    const open = state.expanded.has(g.id);
    const mod = el('div', 'fp-mod');
    mod.dataset.open = open ? '1' : '0';
    mod.dataset.group = g.id;

    const miss = g.mode === 'bundle'
      ? g.options.reduce((a, o) => a + (state.missing.get(g.id + ':' + o.id) || 0), 0)
      : (state.missing.get(g.id) || 0);

    const head = el('div', 'fp-modhead');
    head.appendChild(el('span', 'fp-chev', '▶'));
    head.appendChild(el('span', 'fp-modlabel', g.label));
    const text = groupStateText(g);
    const st = el('span', 'fp-modstate', text);
    if (!text || text === '未选' || /^0\//.test(text)) st.dataset.empty = '1';
    head.appendChild(st);
    if (miss) { const b = el('span', 'fp-badge', '缺' + miss); b.dataset.kind = 'miss'; head.appendChild(b); }
    head.title = (g.note || '') + (g.note ? '\n' : '') + '点击展开 / 折叠';
    head.addEventListener('click', () => {
      if (state.expanded.has(g.id)) state.expanded.delete(g.id);
      else state.expanded.add(g.id);
      writeLS(LS.expanded, [...state.expanded]);
      render();
    });
    mod.appendChild(head);

    if (open) mod.appendChild(renderGroupBody(g));
    return mod;
  }

  /** 展开后的内容：bundle 下拉框 / single 下拉框 / multi 开关排。 */
  function renderGroupBody(g) {
    const box = el('div', 'fp-modbody');

    /* bundle：破甲按模型分流 —— 先选骨架，再调这一套骨架的档位 */
    if (g.mode === 'bundle') {
      const active = currentBundleOption(g);
      const sel = el('select', 'fp-select');
      for (const o of g.options) {
        const miss = state.missing.get(g.id + ':' + o.id) || 0;
        const total = o.members.length;
        const opt = el('option', '', total
          ? `${o.label}　(骨架 ${total - miss}/${total} 条)`
          : `${o.label}　（无骨架条目）`);
        opt.value = o.id;
        if (o.id === active) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.addEventListener('change', () => pickBundle(g, sel.value));
      box.appendChild(sel);

      const opt = g.options.find((o) => o.id === active);
      if (opt && opt.tunables && opt.tunables.length) {
        box.appendChild(el('div', 'fp-modnote', `${opt.label}（${opt.source || '—'}）的档位：`));
        const tun = el('div', 'fp-tunables');
        for (const t of opt.tunables) tun.appendChild(renderTunable(g, opt, t));
        box.appendChild(tun);
      } else if (opt && active !== 'manual') {
        box.appendChild(el('div', 'fp-modnote', '这一套没有可调档位。'));
      }

      const others = g.options
        .filter((o) => o.id !== active && o.tunables && o.tunables.length)
        .map((o) => `${o.label} ${o.tunables.length} 项`);
      if (others.length) {
        box.appendChild(el('div', 'fp-modnote', `切到别家后可调的档位：${others.join('、')}。档位不会被切换清掉。`));
      }
      if (g.note) box.appendChild(el('div', 'fp-modnote', g.note));
      return box;
    }

    /* fixed：不暴露 */
    if (g.mode === 'fixed') {
      box.appendChild(el('div', 'fp-modnote', `面板不碰这 ${g.members.length} 条（酒馆内置槽位与核心结构）。`));
      box.appendChild(el('div', 'fp-modnote', g.members.join('、')));
      return box;
    }

    /* editable：整块都是输入框 */
    if (g.mode === 'editable') {
      if (g.note) box.appendChild(el('div', 'fp-modnote', g.note));
      for (const m of g.members) {
        const wrap = el('div', 'fp-tunable');
        wrap.appendChild(el('div', 'fp-tunlabel', LBL(m)));
        wrap.appendChild(editorBlock(m, (g.editable || {})[m] || {}));
        box.appendChild(wrap);
      }
      return box;
    }

    /* single：下拉框 */
    if (g.mode === 'single') {
      const sel = el('select', 'fp-select');
      const noneOpt = el('option', '', '（不使用）');
      noneOpt.value = '';
      sel.appendChild(noneOpt);
      let cur = '';
      for (const m of g.members) {
        const p = find(m);
        const opt = el('option', '', p ? `${LBL(m)}　(${sizeLabel(chars(p.content))})` : `${LBL(m)}　（缺失）`);
        opt.value = m;
        if (p && on(p)) { opt.selected = true; cur = m; }
        if (!p) opt.disabled = true;
        sel.appendChild(opt);
      }
      sel.value = cur;
      sel.addEventListener('change', () => pickSingle(g, sel.value));
      box.appendChild(sel);
      /* 选中的是可编辑条目就直接把输入框摊开，不用再去别处找 */
      if (cur && EDITABLE[cur]) {
        const wrap = el('div', 'fp-tunable');
        wrap.appendChild(el('div', 'fp-tunlabel', `${LBL(cur)} · 自己填`));
        wrap.appendChild(editorBlock(cur, EDITABLE[cur]));
        box.appendChild(wrap);
      } else {
        const eds = g.members.filter((m) => EDITABLE[m]);
        if (eds.length) box.appendChild(el('div', 'fp-modnote',
          `含可编辑项：${eds.map(LBL).join('、')}——选中后这里会出现输入框。`));
      }
      appendOpenEditors(box, g.members);
      if (g.parked) box.appendChild(el('div', 'fp-modnote', '备选库：默认不在条目列表里，选中即启用。'));
      if (g.note) box.appendChild(el('div', 'fp-modnote', g.note));
      return box;
    }

    /* multi：开关排 */
    if (g.parked) box.appendChild(el('div', 'fp-modnote', '备选库：默认不在条目列表里，点开即加入。'));
    const grid = el('div', 'fp-switches');
    for (const m of g.members) {
      const p = find(m);
      const sw = el('div', 'fp-sw');
      sw.dataset.on = p && on(p) ? '1' : '0';
      if (!p) sw.dataset.miss = '1';
      sw.appendChild(el('span', '', LBL(m)));
      if (p) sw.appendChild(el('i', '', sizeLabel(chars(p.content))));
      sw.title = p ? `${LBL(m)}\n${chars(p.content)} 字　当前：${on(p) ? '开' : '关'}` : `${LBL(m)}\n当前预设里没有这一条`;
      if (p) sw.addEventListener('click', () => toggleOne(m, !on(p)));
      grid.appendChild(sw);
      if (EDITABLE[m]) grid.appendChild(editBtn(m));
    }
    box.appendChild(grid);
    appendOpenEditors(box, g.members);
    if (g.note) box.appendChild(el('div', 'fp-modnote', g.note));
    return box;
  }

  /* ── 拖动 / 缩放 ────────────────────────────────────────────────── */
  /* 指针监听只挂一次。之前每次 render() 都往 window 上再挂两个 pointermove/pointerup，
     拖一会儿就堆上百个监听器。 */
  const gesture = { mode: null, target: null, sx: 0, sy: 0, ox: 0, oy: 0, ow: 0, oh: 0, storeKey: null, moved: false, onDrag: null };
  let gestureBound = false;
  /** 球刚被拖过：随后的那次 click 不该被当成"点开面板" */
  let ballMoved = false;

  /** 球的坐标夹回视口（存的坐标可能是别的视口留下的——手机上会整个跑出屏幕） */
  function clampBall(stored, def, size, vw, vh) {
    const x = stored && Number.isFinite(stored.x) ? stored.x : def.x;
    const y = stored && Number.isFinite(stored.y) ? stored.y : def.y;
    return {
      x: Math.round(Math.max(4, Math.min(vw - size - 4, x))),
      y: Math.round(Math.max(4, Math.min(vh - size - 4, y))),
    };
  }

  function bindGestureOnce() {
    if (gestureBound) return;
    gestureBound = true;
    /* Ctrl+Shift+F：整块隐藏 / 恢复。藏起来之后球也没了，所以必须留一个键盘出口，
       否则"隐藏"就等于把自己关在门外（只能靠控制台）。 */
    HOST.doc.addEventListener('keydown', (e) => {
      if (!e.ctrlKey || !e.shiftKey) return;
      if (!(e.key === 'F' || e.key === 'f')) return;
      e.preventDefault();
      state.hidden = !state.hidden;
      if (!state.hidden) state.open = true;
      if (state.persistHidden) writeLS(LS.hidden, state.hidden);
      render();
    });
    HOST.win.addEventListener('pointermove', (e) => {
      if (!gesture.mode || !gesture.target) return;
      if (gesture.mode === 'drag') {
        const x = Math.max(4, Math.min(HOST.win.innerWidth - 80, gesture.ox + e.clientX - gesture.sx));
        const y = Math.max(4, Math.min(HOST.win.innerHeight - 40, gesture.oy + e.clientY - gesture.sy));
        /* 挪过 3px 就算"拖过"，用来把拖动和点击分开（球上这两个手势撞在一起） */
        if (Math.abs(e.clientX - gesture.sx) + Math.abs(e.clientY - gesture.sy) > 3) gesture.moved = true;
        gesture.target.style.left = x + 'px';
        gesture.target.style.top = y + 'px';
        gesture.target.style.right = 'auto';
      } else {
        const w = Math.max(260, Math.min(HOST.win.innerWidth - 16, gesture.ow + e.clientX - gesture.sx));
        const h = Math.max(200, Math.min(HOST.win.innerHeight - 16, gesture.oh + e.clientY - gesture.sy));
        gesture.target.style.width = w + 'px';
        gesture.target.style.height = h + 'px';
      }
    });
    HOST.win.addEventListener('pointerup', () => {
      if (gesture.mode && gesture.target) {
        const r = gesture.target.getBoundingClientRect();
        /* 落盘的键由发起拖动的那个元素决定：窗口是 LS.pos，悬浮球是 LS.ball */
        if (gesture.mode === 'drag') writeLS(gesture.storeKey || LS.pos, { x: Math.round(r.left), y: Math.round(r.top) });
        else writeLS(LS.size, { w: Math.round(r.width), h: Math.round(r.height) });
        if (gesture.moved && gesture.onDrag) { try { gesture.onDrag(); } catch { /* 忽略 */ } }
      }
      gesture.mode = null;
      gesture.target = null;
      gesture.moved = false;
      gesture.onDrag = null;
    });
  }

  function makeDraggable(win, handle, storeKey = LS.pos, onDrag = null) {
    bindGestureOnce();
    handle.addEventListener('pointerdown', (e) => {
      if (e.target.classList && e.target.classList.contains('fp-icon')) return;
      const r = win.getBoundingClientRect();
      gesture.mode = 'drag';
      gesture.target = win;
      gesture.storeKey = storeKey;
      gesture.onDrag = onDrag;
      gesture.moved = false;
      gesture.sx = e.clientX; gesture.sy = e.clientY;
      gesture.ox = r.left; gesture.oy = r.top;
      handle.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    });
  }

  function makeResizable(win, grip) {
    bindGestureOnce();
    grip.addEventListener('pointerdown', (e) => {
      const r = win.getBoundingClientRect();
      gesture.mode = 'resize';
      gesture.target = win;
      gesture.sx = e.clientX; gesture.sy = e.clientY;
      gesture.ow = r.width; gesture.oh = r.height;
      grip.setPointerCapture?.(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    });
  }

  /* ── 启动 ───────────────────────────────────────────────────────── */
  const prev = window.__FANO_PANEL__;
  if (prev && typeof prev.destroy === 'function') attempt('destroy previous', () => prev.destroy());

  /* 屏幕旋转 / 键盘弹出 / 窗口缩放后重新夹一次位置，免得窗口留在屏外。
     监听只挂一次（挂在宿主窗口上）。 */
  let resizeTimer = null;
  const onViewportChange = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.open) render(); }, 180);
  };
  attempt('bind viewport listeners', () => {
    HOST.win.addEventListener('resize', onViewportChange);
    HOST.win.addEventListener('orientationchange', onViewportChange);
  }, undefined);

  window.__FANO_PANEL__ = {
    version: VERSION,
    /** 生效中的外观配置（含夹取后的值）——预设生成器的「面板外观」用它做对照。 */
    config: () => ({ raw: CONFIG, effective: CFG, wallpaper: hasWallpaper() }),
    reload: () => reload(true),
    open: () => { state.open = true; writeLS(LS.open, true); render(); },
    close: () => { state.open = false; writeLS(LS.open, false); render(); },
    /** 卡住了就调这个：清掉存的位置/尺寸/开关状态，并把面板拉回默认样子。 */
    reset() {
      ['_pos_v1', '_size_v1', '_open_v1', '_expanded_v1', '_collapsed_v1', '_night_v1', '_ball_v1', '_hidden_v1'].forEach((suffix) => {
        try { localStorage.removeItem(ID + suffix); } catch { /* 忽略 */ }
      });
      state.open = true;
      state.collapsed = false;
      state.hidden = false;
      state.persistHidden = false;
      state.expanded = new Set();
      state.bodyEl = null;
      try { HOST.doc.getElementById(ID + '-root')?.remove(); } catch { /* 忽略 */ }
      render();
      return '已重置：位置/尺寸/开关状态都恢复默认';
    },
    /* ── 整块隐藏（连球一起藏）──────────────────────────────────────
       默认**不落盘**：刷新就回来。想让"隐藏"一直记住，显式 persistHidden(true)。
       恢复手段三条：Ctrl+Shift+F、控制台 __FANO_PANEL__.show()、或 persistHidden(false) 后刷新。 */
    hide() {
      state.hidden = true;
      if (state.persistHidden) writeLS(LS.hidden, true);
      render();
      return '已隐藏（Ctrl+Shift+F 或 __FANO_PANEL__.show() 恢复）';
    },
    show() {
      state.hidden = false;
      state.open = true;
      if (state.persistHidden) writeLS(LS.hidden, false);
      render();
      return '已显示';
    },
    /** 要"刷新也保持隐藏"就传 true；传 false 恢复成"只在本次会话有效" */
    persistHidden(v) {
      state.persistHidden = !!v;
      try { if (v) writeLS(LS.hidden, !!state.hidden); else localStorage.removeItem(LS.hidden); } catch { /* 忽略 */ }
      return state.persistHidden ? '隐藏状态会记住（刷新也保持）' : '隐藏状态只在本次会话有效';
    },
    isHidden: () => !!state.hidden,
    groups: GROUPS,
    thinkingTags: THINKING_TAGS,
    /** 手机上看不见面板时，让用户把这段结果发我，一眼就能定位是哪一种情况。 */
    diagnose() {
      const rootEl = HOST.doc.getElementById(ID + '-root');
      let launchInDom = false;
      try {
        launchInDom = !!(rootEl && typeof rootEl.querySelector === 'function' && rootEl.querySelector('.fp-launch'));
      } catch { /* 某些宿主没实现 querySelector，忽略即可 */ }
      return {
        version: VERSION,
        host: {
          mountedOn: HOST.doc === document ? '本地文档' : '外层文档',
          depth: HOST.depth,
          crossOriginFallback: HOST.fellBack,
          bodyReady: !!HOST.doc.body,
          viewport: `${HOST.win.innerWidth}×${HOST.win.innerHeight}`,
        },
        state: {
          open: state.open,
          ready: state.ready,
          preset: state.presetName,
          prompts: state.prompts.length,
          lastError: state.lastError,
        },
        rootInDom: !!rootEl,
        launchInDom,
        mountedOn: rootEl && rootEl.parentNode === HOST.doc.documentElement ? 'documentElement' : 'body',
        placement: state.lastPlacement,
        stored: { pos: readLS(LS.pos, null), size: readLS(LS.size, null), ball: readLS(LS.ball, null), hidden: readLS(LS.hidden, null) },
        hidden: { now: !!state.hidden, persisted: !!state.persistHidden },
        ball: { shape: CFG.ball.shape, kind: CFG.ball.content.kind, size: CFG.ball.size },
      };
    },
    destroy() {
      HOST.doc.getElementById(ID + '-root')?.remove();
      HOST.doc.getElementById(ID + '-toast')?.remove();
      HOST.doc.getElementById(ID + '-style')?.remove();
      if (window.__FANO_PANEL__ === this) delete window.__FANO_PANEL__;
    },
  };

  /* 启动失败也要说话，不能静默什么都不画 */
  try {
    await reload(false);
  } catch (e) {
    state.ready = false;
    state.lastError = String((e && e.message) || e);
    console.error('[芳乃面板] 启动失败', e);
    try {
      await whenHostReady();
      render();
    } catch { /* 实在画不出来就只剩控制台 */ }
    notifyUser('芳乃面板启动失败：' + state.lastError, 'err');
  }

  /* 启动自检：面板要是自己看不见，就用酒馆的 toast 把原因播报出来——
     手机上没有控制台，不播报就只能对着空气猜。 */
  try {
    await whenHostReady();
    const problems = selfCheck();
    if (problems.length) {
      notifyUser('芳乃面板：' + problems.join('；') + '　（可在控制台跑 window.__FANO_PANEL__.diagnose() 看详情）', 'err');
    }
  } catch (e) {
    console.warn('[芳乃面板] 自检失败', e);
  }
})();
