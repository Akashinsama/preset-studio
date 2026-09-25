/**
 * GUI 主逻辑（零依赖、零框架）
 *
 * 视图分三段：
 *   M0 解析：概览 / 诊断 / 条目 / 槽位 / 变量总线 / 依赖 / 标签族 / 分组建议 / 外部依赖 / 正则 / 脚本
 *   M1 拼装：拼装渲染（可交互开关，实时重拼）/ 变量轨迹
 *   M2 体检：体检 / 待办（通用不变式 → 必改 / 建议 / 提示，可一键复制）
 *
 * 约束：不修改导入的任何文件；所有用户数据用 textContent 写入，不用 innerHTML 拼接。
 */
(function () {
  'use strict';

  const PP = globalThis.PresetParse;
  const PA = globalThis.PresetAssemble;
  const PI = globalThis.PresetInvariants;
  const PE = globalThis.PresetEditor;
  const PS = globalThis.PresetSkeleton;
  const PC = globalThis.PresetPanelConfig;
  const GI = globalThis.PresetGroupInfer;
  const BO = globalThis.PresetBuildOps;
  const PANEL_DEMO = globalThis.__FANO_PANEL_DEMO__ || null;

  /** 酒馆的正则作用面（placement 的取值） */
  const PLACEMENTS = [
    { id: 1, label: '用户输入' },
    { id: 2, label: 'AI 输出' },
    { id: 3, label: '斜杠命令' },
    { id: 5, label: '世界书' },
    { id: 6, label: '思维链' },
  ];

  const state = {
    presets: [],          // { file, bytes, json（原样）, model（原始解析） }
    active: 0,
    view: 'start',
    user: '用户',
    char: '角色',
    edit: null,           // M3 编辑态（开关/改名/增删/排序）
    rev: 0,               // 编辑态版本号，用来缓存派生模型
    entryFilter: 'listed',
    entryQuery: '',
    entryEdit: null,      // 条目浏览页里"正在就地编辑正文"的那一条（idx）；null = 都没展开
  };

  /** 不能在编辑器里删掉的槽位（从体检器的 ANCHORS 拿，避免两处定义） */
  const anchorIds = () => ((PI && PI.ANCHORS) || []).filter((a) => a.tier === 'must').map((a) => a.id);

  /* ── DOM 小工具 ───────────────────────────────────────────────── */
  const $ = (id) => document.getElementById(id);
  function h(tag, attrs, kids) {
    const n = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      /* textarea 的 value **不能用属性设**：HTML 里它的初始内容只来自子文本节点，
         setAttribute('value', …) 会被浏览器忽略 —— 于是"内容存进去了、界面上却是空的"。
         这类 bug 一路躲过了断言，因为断言查的是数据，不是界面上看得见的东西。 */
      else if (k === 'value' && (tag.toLowerCase() === 'textarea' || tag.toLowerCase() === 'input')) n.value = v;
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (k === 'style') Object.assign(n.style, v);
      else if (v === true) n.setAttribute(k, '');
      else n.setAttribute(k, v);
    }
    for (const kid of [].concat(kids ?? [])) {
      if (kid === null || kid === undefined || kid === false) continue;
      n.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
    }
    return n;
  }
  const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); return n; };
  const fmt = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n));
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');

  function banner(msg, kind) {
    const b = $('banner');
    if (!msg) { b.hidden = true; return; }
    b.textContent = msg;
    b.dataset.kind = kind || 'ok';
    b.hidden = false;
  }

  /* ── 载入 ─────────────────────────────────────────────────────── */
  /** 拿到当前预设的编辑态；没有就新建；force=true 表示丢掉重来。
      **每个预设各存一份**——否则"改了半天这份，切去看另一份再切回来"改动就没了。 */
  function resetEdits(force) {
    const p = state.presets[state.active];
    if (!p) { state.edit = null; return; }
    if (force || !p.edit) {
      /* 工具生成的骨架：它的正文是我们自己发的"待填"，所以这些条目的正文可编辑；
         导入的预设相反 —— 来源正文一律只读。 */
      p.edit = p.generated
        ? PE.emptyEdit(p.model, anchorIds(), {
          ownIdxs: p.model.entries.map((e) => e.idx),
          markerIdxs: p.markerIdxs ?? [],
          generated: true,
        })
        : PE.emptyEdit(p.model, anchorIds());
    }
    /* 面板草稿是"**这一份**预设的"草稿：换预设就丢掉。
       否则会出现"拿着 A 的分组去改 B"——画布上显示的条目名 B 里根本不存在，
       更糟的是导出检查会照着 A 的搭建意图去拦 B 的导出（这条是真的会拦住人）。 */
    const key = p.file || '';
    if (state.groupsDraftKey !== key) {
      state.groupsDraft = null;
      state.groupsDraftBaseline = null;
      state.groupsDraftAuto = false;
      state.groupsNotes = null;
      state.buildSel = { kind: 'none' };
      state.panelIgnored = null;
      state.panelStaleIgnored = null;
    }
    state.groupsDraftKey = key;
    state.edit = p.edit;
    state.rev++;
  }

  function addPreset(fileName, json, bytes) {
    try {
      const model = PP.parsePreset(json, fileName, bytes || 0);
      /* 存原始 json（导出要用）+ 原始解析结果（编辑器的基线） */
      state.presets.push({ file: fileName, bytes: bytes || 0, json, model });
      state.active = state.presets.length - 1;
      resetEdits();
      /* 必须重画**下拉框**：早先只 renderAll()，于是"导入了新预设、上面还写着 Izumi"
         —— 用户会以为导入失败或解析错了。 */
      renderPick();
      renderAll();
      banner(`已载入「${fileName}」：${model.counts.prompts} 条条目，其中 ${model.counts.enabled} 条开启。`
        + '（右上角下拉框已切到这一份；左栏「导出新预设」或右上角「导出预设」可以导出改动。）', 'ok');
    } catch (e) {
      banner(`解析「${fileName}」失败：${e.message}`, 'err');
    }
  }

  const preset = () => state.presets[state.active] || null;
  const rawJson = () => preset()?.json ?? null;

  /* 派生模型：把编辑态套到原 json 上再解析一遍。
     这样 M0/M1/M2 看到的、导出的、体检的**都是同一份东西**——
     "预览的就是导出的"不靠承诺，靠共用一条路径。 */
  const derivedCache = { rev: -1, active: -1, model: null };
  function model() {
    const p = preset();
    if (!p) return null;
    if (derivedCache.rev === state.rev && derivedCache.active === state.active) return derivedCache.model;
    const next = PE.applyEdit(p.json, state.edit, p.model);
    derivedCache.rev = state.rev;
    derivedCache.active = state.active;
    derivedCache.model = PP.parsePreset(next, p.file, p.bytes);
    return derivedCache.model;
  }

  const bump = () => { state.rev++; renderAll(); };

  function readFiles(files) {
    for (const f of files) {
      const fr = new FileReader();
      fr.onload = () => {
        try { addPreset(f.name, JSON.parse(String(fr.result)), f.size); }
        catch (e) { banner(`「${f.name}」不是合法的 JSON：${e.message}`, 'err'); }
      };
      fr.onerror = () => banner(`读取「${f.name}」失败。`, 'err');
      fr.readAsText(f);
    }
  }

  /* ── 拼装 / 体检（都跑在派生模型上，所以自动反映编辑结果）───────── */
  const runAssemble = () => PA.assemble(model(), { user: state.user, char: state.char });

  function runCheckup() {
    const m = model();
    if (!m || !PI) return null;
    return PI.check(m, PA.assemble(m, { user: state.user, char: state.char }));
  }

  /** 导出前检查（结构改动自身的规矩，和体检互补） */
  function runExportChecks() {
    const p = preset();
    if (!p || !PE) return { blocking: [], warnings: [], notes: [] };
    return PE.exportChecks(p.json, state.edit, p.model, { anchorIds: anchorIds(), panel: panelIntent() });
  }

  /**
   * 这一轮在画布上"搭过面板"吗？搭的东西进没进面板脚本？
   *
   * 存在的理由是一个真实踩过的坑：在画布上加了功能区/功能项、又调了外观，
   * 然后直接点「导出预设」——导出的文件没有面板脚本，而屏幕上没有任何提示。
   * 面板是**脚本**，条目是 prompts，两条路；导出前必须把这件事问清楚。
   */
  function panelIntent() {
    const p = preset();
    if (!p || !PE || !PC) return null;
    /* 草稿只认自己那份预设的（换预设时 resetEdits 会清掉；这里再挡一道，
       免得"拿着 A 的分组"去判断 B 该不该拦导出）。 */
    const own = state.groupsDraft && state.groupsDraftKey === (p.file || '');
    /* **光看一眼不算搭**：自动推断/兜底草稿是工具自己摆出来的，用户没动过就不该拦他导出。
       真加过/删过/改过之后（draftTouched）才算"你在搭面板"。 */
    const groups = (own && draftTouched()) ? (state.groupsDraft.groups?.length ?? 0) : 0;
    /* 注意：这里只能**读** state.appearance，不能 ensureAppearance()。
       ensureAppearance() 会顺手把状态建出来——那样"只是渲染了导航徽标"也会
       变成"动过外观"，于是每导入一份没有面板的预设都会被拦住导出。 */
    const A0 = state.appearance;
    const appearance = !!A0 && (A0.dirty === true || A0.applied === true);
    /* 两条"我说了算"的活路，都按 revision 记账：动了别的地方就会重新问你。 */
    const ignored = !!state.panelIgnored
      && state.panelIgnored.key === (p.file || '') && state.panelIgnored.rev === state.rev;
    const staleIgnored = !!state.panelStaleIgnored
      && state.panelStaleIgnored.key === (p.file || '') && state.panelStaleIgnored.rev === state.rev;
    if (!groups && !appearance) return { groups: 0, appearance: false, unapplied: false, ignored, staleIgnored };
    let unapplied = false;
    if (appearance || groups) {
      const A = ensureAppearance();
      if (A.source === 'preset') {
        /* "还没应用" = 你**真的动过**东西，而不是"界面上的字面量与脚本不完全相同"。
           外观看 A.dirty（每次改动都会记），分组的看法是"把草稿贴回脚本会不会变样"。
           故意不去比整份源码：标题那种"写的时候替你落成具体的字"的规范化不算你的改动，
           拿整份比对会让人永远解不开这道拦截。 */
        const cfgChanged = A.dirty === true;
        let grpChanged = false;
        if (own) {
          try { grpChanged = PC.patchGroups(A.content, normalizeOverride(state.groupsDraft)) !== A.content; }
          catch { grpChanged = true; }
        }
        unapplied = cfgChanged || grpChanged;
      }
    }
    return { groups, appearance, unapplied, ignored, staleIgnored };
  }

  /**
   * 「导出新预设」里那张面板卡。
   *
   * 面板是**脚本**，不跟着条目走：一个预设可以有条目而完全没有面板。
   * 一个人在画布上搭了半天面板、然后点导出，是很容易漏掉"还没装进去"这一步的——
   * 所以这张卡在导出这一屏就把话说明白，并且给一键的补救。
   */
  function panelCard(pi, panels) {
    const has = panels.length > 0;
    const intent = !!pi && (pi.groups > 0 || pi.appearance === true);
    let level = 'info';
    let pill = h('span', { class: 'pill', text: '这份预设没有面板' });
    const lines = [];
    const btns = [];

    if (has) {
      const s = panels[0];
      const size = Math.round(s.bytes / 1024);
      const sup = PE.panelSupport ? PE.panelSupport(s.content) : { ours: false, missing: [] };
      const stale = sup.ours && sup.missing.includes('longPressEdit');
      const ignoringStale = !!pi && pi.staleIgnored === true;
      if (!s.enabled) {
        level = 'warn';
        pill = h('span', { class: 'pill warn', text: '面板脚本被关着' });
        lines.push(`「${s.name}」（${size}KB）的 enabled 是关的——酒馆助手不会执行它，悬浮球不会出现。去「脚本编辑」打开它。`);
      } else if (stale && !ignoringStale) {
        level = 'err';
        pill = h('span', { class: 'pill err', text: '面板是旧版：不能长按改正文' });
        lines.push(`面板脚本「${s.name}」（${size}KB）里**没有"长按条目改正文"**——导出去以后在酒馆里长按条目不会有反应。`);
        lines.push('点「换成新版面板」把代码换成新版：你在「面板外观 / 面板分组」里改过的设置（标题、颜色、球、窗口、分组）会带过去。');
        btns.push(h('button', { class: 'btn', text: '换成新版面板', onclick: () => upgradePanelScript() }));
        btns.push(h('button', {
          class: 'btn ghost', text: '就带这个旧面板导出', title: '这份预设的面板另有来路、不想被换掉',
          onclick: () => {
            const p = preset();
            state.panelStaleIgnored = { key: p ? (p.file || '') : '', rev: state.rev };
            banner('好——这次带着这个旧面板导出。长按改正文不会有；改动一下别的地方，它会再问你一次。', 'ok');
            renderAll();
          },
        }));
      } else if (stale) {
        level = 'warn';
        pill = h('span', { class: 'pill warn', text: '带着旧版面板导出（已确认）' });
        lines.push(`面板脚本「${s.name}」（${size}KB）是旧版：**长按条目改正文**不会有。`);
        btns.push(h('button', { class: 'btn', text: '还是换成新版面板', onclick: () => upgradePanelScript() }));
      } else if (intent && pi.unapplied) {
        level = 'warn';
        pill = h('span', { class: 'pill warn', text: '界面上的改动还没应用' });
        lines.push(`面板脚本「${s.name}」（${size}KB）在，但你在画布/外观里改的东西还没写进去——现在导出，面板还是改之前的样子。`);
        lines.push('点下面这个按钮写进去（只替换配置与分组那两段，面板代码一行不动）。');
      } else {
        level = 'ok';
        pill = h('span', { class: 'pill on', text: '已装进这份预设' });
        lines.push(`这份预设带着面板脚本「${s.name}」（${size}KB，开启中）——装进酒馆、打开聊天时它会自动执行，右下角出现悬浮球。`);
        if (panels.length > 1) lines.push(`另外还有 ${panels.length - 1} 个面板脚本，多个会同时跑（会出现多个悬浮球）。`);
      }
      btns.push(h('button', { class: 'btn ghost', text: '去面板搭建看看 →', onclick: () => { state.view = 'build'; renderAll(); } }));
      if (intent && pi.unapplied) btns.unshift(h('button', { class: 'btn', text: '装进这份预设（应用改动）', onclick: () => applyPanelEdits() }));
    } else if (intent) {
      level = 'err';
      pill = h('span', { class: 'pill err', text: '还没装进预设' });
      lines.push(`你在画布上搭了面板（${[pi.groups > 0 ? `${pi.groups} 个功能区` : '', pi.appearance ? '外观配置' : ''].filter(Boolean).join(' + ')}），`
        + '但这份预设里没有面板脚本——直接导出的话，文件里**没有面板**，装进酒馆不会出现悬浮球。');
      lines.push('面板是「脚本」（进预设的 extensions.tavern_helper.scripts），不是「条目」，它不会自己跟着条目一起走。');
      btns.push(h('button', { class: 'btn', text: '装进这份预设', onclick: () => applyPanelEdits() }));
      btns.push(h('button', {
        class: 'btn ghost', text: '这份预设就是不要面板',
        onclick: () => {
          const p = preset();
          state.panelIgnored = { key: p ? (p.file || '') : '', rev: state.rev };
          banner('好——这次导出不带面板。搭的东西还在界面上，改一个地方它就会再问你一次。', 'ok');
          renderAll();
        },
      }));
      btns.push(h('button', { class: 'btn ghost', text: '导出面板脚本 .js', onclick: downloadPanelJs, title: '不想动这份预设：单独把面板脚本带走，自己贴进酒馆助手' }));
    } else {
      pill = h('span', { class: 'pill', text: '这份预设没有面板' });
      lines.push('面板是脚本，不跟着条目走：这份预设里没有面板脚本，所以装进酒馆不会有悬浮球（条目照常工作）。');
      lines.push('想要面板：去「面板搭建」按这份预设自动长一个，再点「装进这份预设」。');
      btns.push(h('button', { class: 'btn ghost', text: '去面板搭建 →', onclick: () => { state.view = 'build'; renderAll(); } }));
    }

    return h('div', { class: 'card', 'data-level': level }, [
      h('h3', {}, ['面板脚本　', pill]),
      ...lines.map((t) => h('div', { class: level === 'err' ? 'warnrow' : 'dim', 'data-level': level === 'err' ? 'err' : undefined }, [h('span', { text: t })])),
      h('div', { style: { marginTop: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap' } }, btns),
    ]);
  }

  /* ── 导航 ─────────────────────────────────────────────────────── */
  const VIEWS = [
    { group: '从这里开始', items: [
      { id: 'start', label: '引导：我要做什么' },
      { id: 'build', label: '面板搭建（可视化）' },
    ] },
    { group: 'M0 解析', items: [
      { id: 'overview', label: '概览' },
      { id: 'warnings', label: '诊断', badge: (m) => m.warnings.filter((w) => w.level === 'err').length },
      { id: 'entries', label: '条目', badge: (m) => m.counts.prompts },
      { id: 'slots', label: '槽位占用', badge: (m) => m.slots.filter((s) => s.conflict).length },
      { id: 'variables', label: '变量总线', badge: (m) => m.variables.length },
      { id: 'deps', label: '依赖关系', badge: (m) => m.deps.length },
      { id: 'tags', label: '标签族', badge: (m) => m.tagFamilies.length },
      { id: 'suggestions', label: '分组建议', badge: (m) => m.suggestions.length },
    ] },
    { group: 'M1 拼装', items: [
      { id: 'assemble', label: '拼装渲染' },
      { id: 'vartrace', label: '变量轨迹', badge: (m) => runAssemble().events.length },
    ] },
    { group: 'M2 体检', items: [
      {
        id: 'checkup',
        label: '体检 / 待办',
        badge: () => { const c = runCheckup(); return c && c.items.length ? c.items.length : null; },
        bad: () => { const c = runCheckup(); return !!c && c.counts.err > 0; },
      },
    ] },
    { group: 'M3 编辑', items: [
      {
        id: 'editor',
        label: '框架编辑',
        badge: () => (state.edit && PE.structuralDirty(state.edit) ? '改' : null),
        bad: () => !!(state.edit && PE.structuralDirty(state.edit)),
      },
      {
        id: 'export',
        label: '导出新预设',
        badge: () => { const c = runExportChecks(); return c.blocking.length || null; },
        bad: () => runExportChecks().blocking.length > 0,
      },
    ] },
    { group: 'M4 新建', items: [
      { id: 'new', label: '从零搭一份' },
    ] },
    { group: 'M5 正则 · 脚本 · 外观', items: [
      {
        id: 'regexedit',
        label: '正则编辑',
        badge: (m) => {
          const e = state.edit;
          const n = e ? e.regex.patches.size + e.regex.added.length + e.regex.deleted.size : 0;
          return n || m.regexes.length;
        },
        bad: () => {
          const e = state.edit;
          return !!(e && (e.regex.added.length || e.regex.deleted.size));
        },
      },
      {
        id: 'scriptedit',
        label: '脚本编辑',
        badge: (m) => (state.edit && state.edit.scripts.patches.size) || m.scripts.length,
        bad: () => !!(state.edit && (state.edit.scripts.patches.size || state.edit.scripts.added.length)),
      },
      {
        id: 'appearance',
        label: '面板外观',
        badge: () => (state.appearance ? 1 : null),
      },
    ] },
    { group: 'M6 面板分组', items: [
      {
        id: 'groups',
        label: '面板分组',
        badge: () => {
          const g = state.groupsDraft;
          return g ? g.groups.length : null;
        },
        bad: () => {
          const d = state.groupsDraft;
          if (!d || !GI || !preset()) return false;
          return GI.validateGroups(d, model()).errors.length > 0;
        },
      },
    ] },
    { group: '附件', items: [
      { id: 'external', label: '外部依赖', badge: (m) => m.external.macros.length + m.external.cdn.length },
      { id: 'regex', label: '正则', badge: (m) => m.regexes.length },
      { id: 'scripts', label: '内嵌脚本', badge: (m) => m.scripts.length },
    ] },
  ];

  function renderNav() {
    const nav = clear($('nav'));
    const m = model();
    if (!m) { nav.appendChild(h('div', { class: 'empty', text: '还没有载入预设。点右上角「导入预设…」或使用下面的演示数据。' })); return; }
    for (const g of VIEWS) {
      nav.appendChild(h('div', { class: 'nav-group', text: g.group }));
      for (const it of g.items) {
        const n = it.badge ? it.badge(m) : null;
        const item = h('div', {
          class: 'nav-item', 'data-on': state.view === it.id ? '1' : '0',
          onclick: () => { state.view = it.id; renderAll(); },
        }, [
          h('span', { text: it.label }),
          n ? h('span', { class: 'count', 'data-bad': (it.bad ? it.bad(m) : it.id === 'warnings' && n) ? '1' : '0', text: String(n) }) : null,
        ]);
        nav.appendChild(item);
      }
    }
  }

  /* ── 视图 ─────────────────────────────────────────────────────── */
  const title = (t, d) => [h('h2', { class: 'viewtitle', text: t }), d ? h('p', { class: 'viewdesc', text: d }) : null];
  const table = (cols, rows) => h('table', {}, [
    h('thead', {}, h('tr', {}, cols.map((c) => h('th', { class: c.num ? 'num' : '', text: c.label })))),
    h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c, i) => h('td', { class: cols[i] && cols[i].num ? 'num' : '' }, c))))),
  ]);

  const VIEW_RENDER = {
    /* ── 面板搭建：画布 + 属性栏（这一页就是"看渲染 + 搭预设"合一的地方）── */
    build(m) {
      const p = preset();
      if (!p || !PC || !BO) return [...title('面板搭建', '先导入一份预设（或点「从零搭一份」）。')];
      const A = ensureAppearance();
      const cs0 = canvasState();
      const draft = cs0.draft;
      const editable = cs0.editable;
      const defaultsCount = cs0.defaultsCount;
      const st = BO.stats(draft, m);
      st.editable = editable;
      st.auto = cs0.auto;
      st.defaultsCount = defaultsCount;
      st.defaultsMismatch = cs0.defaultsMismatch;
      const sel = state.buildSel || { kind: 'none' };
      const g = BO.groupOf(draft, sel.id);

      /* 画布上的拖拽换序：功能区之间互换位置（同一个分节内） */      const canvas = buildCanvasDom();
      const winEl = canvas.children ? null : null;
      void winEl;
      (function wireDrag(rootEl) {
        let dragId = null;
        const onDragStart = (ev) => {
          const mod = ev.target.closest ? ev.target.closest('.fp-mod') : null;
          if (!mod) return;
          dragId = mod.dataset.gid;
          if (ev.dataTransfer) ev.dataTransfer.setData('text/plain', dragId);
        };
        const onDragOver = (ev) => {
          if (dragId && ev.target.closest && ev.target.closest('.fp-mod')) ev.preventDefault();
        };
        const onDrop = (ev) => {
          const mod = ev.target.closest ? ev.target.closest('.fp-mod') : null;
          if (!dragId || !mod) return;
          ev.preventDefault();
          const targetId = mod.dataset.gid;
          if (targetId === dragId) return;
          ensureDraft();
          const d = state.groupsDraft;
          const from = d.groups.findIndex((x) => x.id === dragId);
          const to = d.groups.findIndex((x) => x.id === targetId);
          if (from < 0 || to < 0) return;
          const [moved] = d.groups.splice(from, 1);
          d.groups.splice(to, 0, moved);
          /* 拖到别的分节里 = 搬家 */
          if (moved.__section !== d.groups[to].__section) moved.__section = d.groups[to].__section;
          state.rev++;
          renderAll();
          dragId = null;
        };
        rootEl.addEventListener('dragstart', onDragStart);
        rootEl.addEventListener('dragover', onDragOver);
        rootEl.addEventListener('drop', onDrop);
      })(canvas);
      canvas.addEventListener('click', (ev) => {
        /* 点画布空白处 = 取消选中 */
        if (ev.target === canvas) { state.buildSel = { kind: 'none' }; renderAll(); }
      });

      /* 属性栏 */
      const props = h('div', { class: 'props' });
      if (sel.kind === 'section') {
        const title = sel.id;
        const inside = draft.groups.filter((x) => (x.__section || '未分节') === title);
        props.appendChild(h('h3', {}, ['分节：', h('span', { class: 'dim', text: title })]));
        props.appendChild(h('label', { class: 'numfield', style: { width: '100%' } }, [
          h('span', { text: '分节名字（面板上的大标题）' }),
          h('input', {
            type: 'text', class: 'nameinput', value: title,
            onchange: (ev) => { ensureDraft(); BO.renameSection(state.groupsDraft, title, ev.target.value); state.buildSel = { kind: 'section', id: ev.target.value.trim() || title }; state.rev++; renderAll(); },
          }),
        ]));
        props.appendChild(h('div', { class: 'checkline', style: { marginTop: '8px' } }, [
          h('b', { text: `${inside.length} 个功能区` }),
          h('span', { class: 'dim', text: '　' + inside.map((x) => x.label).join('、').slice(0, 80) }),
        ]));
        props.appendChild(h('div', { class: 'buildbar', style: { marginTop: '8px' } }, [
          h('button', { class: 'btn tiny', text: '↑ 上移', onclick: () => { ensureDraft(); BO.moveSection(state.groupsDraft, title, -1); state.rev++; renderAll(); } }),
          h('button', { class: 'btn tiny', text: '↓ 下移', onclick: () => { ensureDraft(); BO.moveSection(state.groupsDraft, title, 1); state.rev++; renderAll(); } }),
          h('button', { class: 'btn tiny', text: '＋加功能区', onclick: () => buildAddGroup(title) }),
          h('button', {
            class: 'btn tiny ghost', text: '删掉这个分节',
            onclick: () => {
              ensureDraft();
              BO.removeSection(state.groupsDraft, title);
              state.buildSel = { kind: 'none' };
              state.rev++;
              renderAll();
              banner('分节删了，但里面的功能区被挪到别的分节去了——不会顺手把你的条目丢掉。', 'ok');
            },
          }),
        ]));
      } else if (sel.kind === 'group' && g) {
        props.appendChild(h('h3', {}, ['功能区：', h('span', { class: 'dim', text: g.label })]));
        props.appendChild(h('label', { class: 'numfield', style: { width: '100%' } }, [
          h('span', { text: '名字（面板上显示的就是它）' }),
          h('input', { type: 'text', class: 'nameinput', value: g.label, onchange: (ev) => { ensureDraft(); BO.renameGroup(state.groupsDraft, g.id, ev.target.value); state.rev++; renderAll(); } }),
        ]));
        props.appendChild(h('label', { class: 'numfield', style: { width: '100%', marginTop: '8px' } }, [
          h('span', { text: '形式' }),
          h('select', { onchange: (ev) => { ensureDraft(); BO.setMode(state.groupsDraft, g.id, ev.target.value); state.rev++; renderAll(); } },
            [['single', '选一（互斥下拉）'], ['multi', '可多选（开关排）'], ['editable', '要你自己填（输入框）'], ['fixed', '只读（面板不碰）']]
              .map(([v, t]) => h('option', { value: v, selected: g.mode === v, text: t }))),
        ]));
        props.appendChild(h('label', { class: 'numfield', style: { width: '100%', marginTop: '8px' } }, [
          h('span', { text: '属于哪个分区' }),
          h('select', { onchange: (ev) => { ensureDraft(); BO.moveGroupToSection(state.groupsDraft, g.id, ev.target.value); state.rev++; renderAll(); } },
            BO.sectionsOf(state.groupsDraft || draft).map((s) => h('option', { value: s, selected: (g.__section || '未分节') === s, text: s }))),
        ]));
        props.appendChild(h('label', { class: 'numfield', style: { width: '100%', marginTop: '8px' } }, [
          h('span', { text: '说明（折起时面板上会写这一句）' }),
          h('input', { type: 'text', class: 'nameinput', value: g.note || '', onchange: (ev) => { ensureDraft(); BO.setNote(state.groupsDraft, g.id, ev.target.value); state.rev++; renderAll(); } }),
        ]));
        props.appendChild(h('div', { class: 'buildbar' }, [
          h('button', { class: 'btn tiny', text: '＋功能项', onclick: () => buildAddItem(g.id, false) }),
          h('button', { class: 'btn tiny', text: '＋功能选项', onclick: () => buildAddItem(g.id, true) }),
          h('button', { class: 'btn tiny ghost', text: '删除这个功能区', onclick: () => { ensureDraft(); BO.removeGroup(state.groupsDraft, g.id); state.buildSel = { kind: 'none' }; state.rev++; renderAll(); } }),
        ]));
        /* 把已有的条目挂进来（不新建） */
        const candidates = m.entries.filter((e) => e.listed && e.name && !(g.members || []).includes(e.name)).map((e) => e.name);
        props.appendChild(h('div', { class: 'checkline', style: { marginTop: '8px' } }, [
          h('b', { text: '把已有条目挂进来　' }),
          h('select', { onchange: (ev) => { if (ev.target.value) buildAttachExisting(g.id, ev.target.value); } },
            [h('option', { value: '', text: `＋ 从预设里选（${candidates.length} 条可选）` })].concat(candidates.slice(0, 400).map((n) => h('option', { value: n, text: n })))),
        ]));
      } else if (sel.kind === 'member' && g) {
        const name = sel.member;
        const entry = m.entries.find((e) => e.name === name);
        const inPreset = !!entry;
        props.appendChild(h('h3', {}, ['功能项：', h('span', { class: 'dim', text: name })]));
        props.appendChild(h('div', { class: 'checkline' }, [
          h('b', { text: '属于　' }), g.label, '（', ({ single: '选一', multi: '可多选', editable: '自己填', fixed: '只读' })[g.mode] || g.mode, '）',
        ]));
        if (inPreset) {
          const cur = PE.contentOf(state.edit, p.json, entry.idx);
          const pending = PE.isPending(cur);
          const editedNow = state.edit.content.has(entry.idx);
          const own = PE.isOwnContent(state.edit, entry.idx);
          props.appendChild(h('div', { class: 'checkline' }, [
            h('b', { text: '这条条目　' }),
            h('span', { class: 'dim', text: `${entry.chars} 字　${entry.enabled ? '默认开' : '默认关'}　${entry.listed ? '在提示词列表里' : '不在列表里'}` }),
            pending ? h('span', { class: 'pill warn', text: '正文待填' }) : null,
            editedNow ? h('span', { class: 'pill warn', text: own ? '你写的' : '你改过' }) : null,
          ]));
          /* 正文就地编辑：搭预设时最常干的事，不该逼人跳到另一页 */
          props.appendChild(h('div', { class: 'checkline', style: { marginTop: '8px' } }, [
            h('b', { text: '正文　' }),
            h('span', { class: 'dim', text: own ? '（你自己写的条目）' : '（导入的原文，改了会记下来，随时能还原）' }),
          ]));
          props.appendChild(h('textarea', {
            class: 'bigtext small mono', rows: 8, value: cur, spellcheck: 'false',
            onchange: (ev) => {
              PE.setContent(state.edit, p.json, entry.idx, ev.target.value);
              state.rev++;
              renderAll();
            },
          }));
          props.appendChild(h('div', { class: 'buildbar' }, [
            h('button', { class: 'btn tiny', text: '↑ 上移', onclick: () => { ensureDraft(); BO.moveMember(state.groupsDraft, g.id, name, -1); state.rev++; renderAll(); } }),
            h('button', { class: 'btn tiny', text: '↓ 下移', onclick: () => { ensureDraft(); BO.moveMember(state.groupsDraft, g.id, name, 1); state.rev++; renderAll(); } }),
            h('button', { class: 'btn tiny ghost', text: '默认打开', onclick: () => { PE.setEnabledByName(state.edit, m, name, true); state.rev++; renderAll(); } }),
            h('button', { class: 'btn tiny ghost', text: '默认关闭', onclick: () => { PE.setEnabledByName(state.edit, m, name, false); state.rev++; renderAll(); } }),
          ]));
          props.appendChild(h('div', { class: 'buildbar' }, [
            editedNow ? h('button', {
              class: 'btn tiny ghost', text: '还原成导入时的原文',
              onclick: () => { PE.revertContent(state.edit, p.json, entry.idx); state.rev++; renderAll(); banner('已还原成导入时的原文。', 'ok'); },
            }) : null,
            h('button', { class: 'btn tiny ghost', text: '从功能区移除', title: '只是从面板上拿掉，条目还在预设里', onclick: () => { ensureDraft(); BO.removeMember(state.groupsDraft, g.id, name); state.buildSel = { kind: 'group', id: g.id }; state.rev++; renderAll(); } }),
          ]));
        } else {
          props.appendChild(h('div', { class: 'warnrow', 'data-level': 'err' }, [
            h('span', { class: 'tag', text: '找不到' }),
            h('span', { text: `预设里没有叫「${name}」的条目——面板会把它显示成"缺失"。要么改名对上，要么从功能区移除。` }),
          ]));
        }
      } else {
        props.appendChild(h('h3', { text: '这份面板' }));
        props.appendChild(h('div', { class: 'kpis' }, [
          h('div', { class: 'kpi' }, [h('b', { text: String(st.groups) }), h('span', { text: '功能区' })]),
          h('div', { class: 'kpi' }, [h('b', { text: String(st.sections) }), h('span', { text: '分节' })]),
          h('div', { class: 'kpi' }, [h('b', { text: String(st.managed) }), h('span', { text: '面板管的条目' })]),
        ]));
        props.appendChild(h('div', { class: 'checkline', style: { marginTop: '8px' } }, [
          h('b', { text: '怎么搭　' }),
          '点左边画布上的**分节标题**改分节、点**功能区**改功能区、点**功能项**改它的正文；'
          + '功能区上的「＋功能项 / ＋功能选项」会真的新建条目。拖功能区换位置。',
        ]));
        props.appendChild(h('div', { class: 'buildbar', style: { marginTop: '10px' } }, [
          h('button', { class: 'btn', text: '＋新建分区', onclick: () => { const t = prompt('新分区的名字（比如"文风"）'); if (t === null) return; const d = ensureDraft(); BO.addSection(d, t); state.buildSel = { kind: 'section', id: t.trim() || '新分区' }; state.rev++; renderAll(); } }),
          h('button', { class: 'btn ghost', text: '按这份预设自动推断', onclick: inferNow }),
          h('button', { class: 'btn ghost', text: '清空成空面板', onclick: () => { state.groupsDraft = BO.seedFrom({}); markDraftBaseline(); state.buildSel = { kind: 'none' }; state.rev++; renderAll(); banner('已清成空面板：从「＋新建分区」开始搭。', 'ok'); } }),
        ]));
      }

      const audit = BO.auditPanel(draft, m, state.edit);
      const auditErr = audit.filter((x) => x.level === 'err');
      return [
        ...title('面板搭建',
          '左边就是面板的渲染（用的是面板自己的样式），也是搭建的地方；右边是选中项的属性。'
          + '三层：**分节 → 功能区 → 功能项**（功能项就是一个条目，选一型功能区里每个条目就是一个选项）。'),
        audit.length ? h('div', { class: 'card', 'data-level': auditErr.length ? 'err' : 'warn' }, [
          h('h3', {}, ['面板质检　',
            auditErr.length ? h('span', { class: 'pill err', text: `${auditErr.length} 项必改` }) : h('span', { class: 'pill on', text: '没有必改项' }),
            h('span', { class: 'warn pill', text: `${audit.length - auditErr.length} 项提醒` }),
          ]),
          ...[...auditErr, ...audit.filter((x) => x.level !== 'err')].slice(0, 12).map((x) => h('div', { class: 'warnrow', 'data-level': x.level }, [
            h('span', { class: 'tag', text: x.kind }),
            h('span', { style: { flex: '1 1 auto' } }, [h('span', { text: x.text }), h('div', { class: 'dim', text: x.fix })]),
            x.entry ? h('button', {
              class: 'btn tiny ghost', text: '去看',
              onclick: () => {
                const owner = draft.groups.find((gg) => (gg.members || []).includes(x.entry));
                if (owner) state.buildSel = { kind: 'member', id: owner.id, member: x.entry };
                renderAll();
              },
            }) : null,
          ])),
          h('div', { class: 'dim', style: { marginTop: '6px' }, text: '质检找的是"导进酒馆之后点了没反应 / 打开了也没用"的地方——这些在面板上不会报错，只会表现为不灵。' }),
        ]) : null,
        (st.missing.length || st.duplicated.length) ? h('div', { class: 'card', 'data-level': 'err' }, [
          h('h3', {}, ['对不上预设的地方　', h('span', { class: 'pill err', text: `${st.missing.length} 处找不到` })]),
          ...st.missing.slice(0, 8).map((x) => h('div', { class: 'warnrow', 'data-level': 'err' }, [
            h('span', { class: 'tag', text: x.group }), h('span', { text: `预设里没有叫「${x.name}」的条目` }),
          ])),
          ...st.duplicated.slice(0, 5).map((x) => h('div', { class: 'warnrow', 'data-level': 'warn' }, [
            h('span', { class: 'tag', text: x.group }), h('span', { text: `「${x.name}」在预设里有重名条目，面板按名字匹配会歧义` }),
          ])),
        ]) : null,
        h('div', { class: 'card' }, [
          h('div', { class: 'buildbar' }, [
            h('span', {
              class: 'pill ' + (st.editable ? 'warn' : 'on'),
              text: st.auto ? '按这份预设自动推断（还没应用）' : (editable ? '草稿（可编辑）' : `面板自带分组（${st.defaultsCount} 个功能区）`),
            }),
            h('button', { class: 'btn tiny', text: '基础样式…', onclick: () => { state.view = 'appearance'; renderAll(); } }),
            h('button', { class: 'btn tiny', text: '装进预设 / 应用', onclick: () => { if (state.groupsDraft) applyGroups(); else attachPanel(); } }),
            h('button', { class: 'btn tiny primary', text: '导出预设 JSON', onclick: () => { const c = runExportChecks(); if (c.blocking.length) { state.view = 'export'; renderAll(); banner(`有 ${c.blocking.length} 项必改挡着导出。`, 'err'); } else exportJson(); } }),
            h('label', { class: 'numfield' }, [
              h('span', { text: '画布高度 px' }),
              h('input', {
                type: 'number', min: '300', max: '1600', step: '40', value: String(state.canvasHeight || 620),
                onchange: (ev) => { state.canvasHeight = Math.max(300, Math.min(1600, Number(ev.target.value) || 620)); renderAll(); },
              }),
            ]),
            h('span', { class: 'dim', text: editable ? '改的是草稿；点上面的按钮才写进面板脚本。' : '现在看的是面板自带的分组；随便点一个编辑动作就会复制成草稿。' }),
          ]),
          h('div', { class: 'buildgrid' }, [
            h('div', { class: 'canvaswrap' }, [canvas]),
            props,
          ]),
        ]),
      ];
    },

    /* ── 引导：从零开始的路线图 ───────────────────────────────────── */
    start(m) {
      const p = preset();
      const go = (view) => () => { state.view = view; renderAll(); };

      /* 进度是**从真实状态算出来的**，不是写死的勾：这样它不会骗人 */
      const rows = [];
      const step = (n, title, done, todo, view, label, view2, label2) => rows.push({ n, title, done, todo, view, label, view2, label2 });

      if (!p) {
        step(1, '导入一份预设（或从零搭一份）', false,
          '左栏「导入预设…」选一份酒馆预设 JSON；如果你手上什么都没有，去「从零搭一份」让工具给你一副骨架。',
          'overview', '看导入了什么', 'new', '从零搭一份');
      } else {
        step(1, `已导入「${m.file}」`, true,
          `${m.counts.prompts} 条条目，${m.counts.enabled} 条开启。想换一份用右上角的下拉框或「导入预设…」。`,
          'overview', '看结构摘要');
      }
      const dirty = state.edit && PE && PE.isDirty(state.edit);
      step(2, '改结构（开关 / 顺序 / 条目名 / 增删）', !!dirty,
        dirty ? '已经改过了。左边 M3「框架编辑」可以继续。' : '左边 **M3 框架编辑**：上移下移、开关、改名字、加自己的条目。不想改就跳过这步。',
        'editor', '去框架编辑');
      const checks = p ? runExportChecks() : { blocking: [] };
      const rep = p ? runCheckup() : null;
      step(3, '体检：把"开关没生效 / 上下文丢了"这类问题先修掉',
        !!rep && rep.counts.err === 0,
        rep ? (rep.counts.err ? `还有 ${rep.counts.err} 项必改。` : `没有必改项（建议 ${rep.counts.warn} 条，可以不理）。`)
          : '导入预设后这里会给你一份「必改 / 建议」清单。',
        'checkup', '看体检清单');
      const attached = !!p && PE && PE.scriptViews(state.edit, p.json, p.model).some((s) => s.content.includes('FANO_PANEL_CONFIG_BEGIN'));
      step(4, '给预设配一个悬浮窗面板（可选，但这是最好玩的一步）', attached,
        attached ? '这份预设里已经有面板脚本了。去「面板外观」调颜色，或去「面板分组」决定面板管哪些条目。'
          : '左边 **M6 面板分组 → 按这份预设自动推断**：工具会推一版模块（哪些是"选一"、哪些能叠加），你在界面上改；然后 **M5 面板外观**调颜色/尺寸/壁纸，点「装进这份预设」就装好了。',
        'groups', '先去推断分组', 'appearance', '再看外观');      const canExport = p && checks.blocking.length === 0;
      step(5, '导出新预设 JSON', false,
        !p ? '导入预设之后才有得导出。'
          : (checks.blocking.length ? `还有 ${checks.blocking.length} 项必改挡着导出（见「导出前检查」）。` : '右上角「导出预设 JSON」就是它；也可以去「导出新预设」看改动摘要与自证。'),
        'export', '打开导出页');

      return [
        ...title('引导：我要做什么',
          '这一页按"你手上的东西"告诉你下一步点哪里。它不是教程文章，是**按当前状态算出来的清单**。'),
        h('div', { class: 'card' }, [
          h('h3', { text: '三条常见路线（点一下直接跳）' }),
          h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
            h('button', { class: 'btn', text: '① 我有一份预设，想改改就用', onclick: go('build') }),
            h('button', { class: 'btn', text: '② 我要从零搭一份', onclick: go('new') }),
            h('button', { class: 'btn', text: '③ 我只想给预设配个好看的面板', onclick: go('appearance') }),
            h('button', {
              class: 'btn ghost', text: '④ 我什么都没有：从一个空面板开始',
              title: '清出一块干净画布，从分节和功能区开始搭',
              onclick: () => {
                if (!preset()) { banner('先导入一份预设（或「从零搭一份」生成骨架），空面板才有东西可管。', 'err'); return; }
                state.groupsDraft = BO.seedFrom({});
                markDraftBaseline();
                state.buildSel = { kind: 'none' };
                state.view = 'build';
                state.rev++;
                renderAll();
                banner('已清出空面板：点「＋新建分区」→ 再「＋加功能区」→ 再「＋功能项」（会真的新建条目）。', 'ok');
              },
            }),
          ]),
          h('div', { class: 'checkline', style: { marginTop: '8px' } }, [
            h('b', { text: '三个地方最常用　' }),
            h('span', { class: 'dim', text: '右上角「导入预设…」「导出预设 JSON」；左栏第二项「面板搭建」边看边搭；「面板外观」调颜色尺寸壁纸。' }),
          ]),
        ]),
        h('div', { class: 'card' }, [
          h('h3', { text: '说明书 / 给 AI 的接口' }),
          h('div', { class: 'checkline' }, [
            h('b', { text: '文档在包根目录　' }),
            h('span', {}, [
              h('a', { href: '../../说明书.md', target: '_blank', text: '说明书.md' }),
              h('span', { class: 'dim', text: '（第一部分给人：界面导览 + 五条常见路线 + 故障排查；第二部分给 AI：怎么把这里的代码当库调用）　' }),
              h('a', { href: 'API.md', target: '_blank', text: 'tools/gui/API.md' }),
              h('span', { class: 'dim', text: '（8 个模块的完整函数清单与数据结构）' }),
            ]),
          ]),
          h('div', { class: 'checkline' }, [
            h('b', { text: '命令行校验　' }),
            h('span', { class: 'dim', text: '在这个包根目录跑 node tools/selftest.mjs（库 + 成品 + 面板一次过）；'
              + '要更彻底就 node tools/check-preset.mjs 与 node tools/check-gui-browser.mjs（后者要本机有 Chrome）。' }),
          ]),
        ]),
        h('div', { class: 'card' }, [
          h('h3', { text: '按顺序走一遍（做到哪一步，这里就打勾）' }),
          ...rows.map((r) => h('div', { class: 'warnrow', 'data-level': r.done ? 'ok' : 'info' }, [
            h('span', { class: 'tag', text: (r.done ? '✓ ' : '') + '第 ' + r.n + ' 步' }),
            h('span', { style: { flex: '1 1 auto' } }, [
              h('b', { text: r.title }),
              h('div', { class: 'dim', text: r.todo }),
            ]),
            h('span', {}, [
              h('button', { class: 'btn tiny', text: r.label, onclick: go(r.view) }),
              r.label2 ? h('button', { class: 'btn tiny ghost', text: r.label2, onclick: go(r.view2) }) : null,
            ]),
          ])),
        ]),
        h('div', { class: 'card' }, [
          h('h3', { text: '这个工具能替你做 / 不能替你做' }),
          h('div', { class: 'checkline' }, [h('b', { text: '能　' }),
            '改结构（开关、顺序、条目名、增删条目）、把别人的正文一个字不改地带着走、体检出"开关没生效/上下文丢了"、'
            + '给预设配面板（外观 + 管哪些条目）、改正则（带试跑与渲染预览）、改脚本（带语法校验）、从零生成骨架、导出成品。']),
          h('div', { class: 'checkline' }, [h('b', { text: '不能　' }),
            '替你写提示词正文（新条目的正文一律留空标「待填」）、判断破甲强度（那得你在真实渠道里试）。']),
        ]),
      ];
    },

    /* ── M0 解析 ─────────────────────────────────────────────────── */
    overview(m) {
      const on = m.entries.filter((e) => e.enabled && e.listed);
      const errs = m.warnings.filter((w) => w.level === 'err');
      const warns = m.warnings.filter((w) => w.level === 'warn');
      return [
        ...title(m.file, '这份预设的结构摘要。下面每一块都能在左侧单独展开细看。'),
        h('div', { class: 'card' }, [
          h('h3', { text: '规模' }),
          h('div', { class: 'kpis' }, [
            h('div', { class: 'kpi' }, [h('b', { text: String(m.counts.prompts) }), h('span', { text: '条目总数' })]),
            h('div', { class: 'kpi' }, [h('b', { text: String(m.counts.listed) }), h('span', { text: '在提示词列表里' })]),
            h('div', { class: 'kpi' }, [h('b', { text: String(m.counts.enabled) }), h('span', { text: '初始开启' })]),
            h('div', { class: 'kpi' }, [h('b', { text: fmt(m.counts.enabledChars) }), h('span', { text: '开启正文（字）' })]),
            h('div', { class: 'kpi' }, [h('b', { text: String(m.variables.length) }), h('span', { text: '变量' })]),
            h('div', { class: 'kpi' }, [h('b', { text: String(m.tagFamilies.length) }), h('span', { text: '标签族' })]),
            h('div', { class: 'kpi' }, [h('b', { text: String(m.regexes.length) }), h('span', { text: '正则' })]),
            h('div', { class: 'kpi' }, [h('b', { text: String(m.scripts.length) }), h('span', { text: '内嵌脚本' })]),
          ]),
        ]),
        h('div', { class: 'card' }, [
          h('h3', {}, [`诊断：`, h('span', { class: 'pill err', text: `${errs.length} 个错误` }), ' ', h('span', { class: 'pill warn', text: `${warns.length} 个提示` })]),
          errs.length + warns.length ? h('div', {}, [...errs, ...warns].slice(0, 6).map((w) => warnRow(w)))
            : h('div', { class: 'empty', text: '没发现问题。' }),
          h('div', { style: { marginTop: '8px' } }, h('button', { class: 'btn ghost', text: '查看全部诊断', onclick: () => { state.view = 'warnings'; renderAll(); } })),
        ]),
        h('div', { class: 'card' }, [
          h('h3', { text: '开启条目占正文的比例' }),
          h('div', { class: 'kpis' }, [
            h('div', { class: 'kpi' }, [h('b', { text: `${on.length}/${m.counts.listed}` }), h('span', { text: '开启 / 在列表' })]),
            h('div', { class: 'kpi' }, [h('b', { text: pct(m.counts.enabledChars, m.counts.totalChars) }), h('span', { text: '正文占比' })]),
          ]),
        ]),
      ];
    },

    warnings(m) {
      return [
        ...title('诊断', '结构层面的问题：槽位冲突、悬空变量、注入位缺失、思维链标签冲突、疑似待填……这些都不看模型表现，只看结构。'),
        m.warnings.length
          ? h('div', { class: 'card' }, m.warnings.map((w) => warnRow(w)))
          : h('div', { class: 'card' }, h('div', { class: 'empty', text: '没发现问题。' })),
      ];
    },

    entries(m) {
      const f = state.entryFilter;
      const q = state.entryQuery.trim();
      let list = m.entries;
      if (f === 'listed') list = list.filter((e) => e.listed);
      else if (f === 'enabled') list = list.filter((e) => e.listed && e.enabled);
      else if (f === 'unlisted') list = list.filter((e) => !e.listed);
      else if (f === 'slot') list = list.filter((e) => e.slot);
      else if (f === 'fill') list = list.filter((e) => e.fill);
      else if (f === 'macro') list = list.filter((e) => e.macros.length);
      if (q) list = list.filter((e) => (e.name + e.head).includes(q));

      const seg = (opts) => h('div', { class: 'kpis' }, opts.map(([id, label]) => h('button', {
        class: 'btn' + (f === id ? '' : ' ghost'), text: `${label}`, onclick: () => { state.entryFilter = id; renderAll(); },
      })));
      return [
        ...title('条目', `${list.length} 条。顺序 = 酒馆 prompt_order 的顺序；未列入的条目不会进入提示词。`),
        h('div', { class: 'card' }, [
          seg([['listed', '在列表'], ['enabled', '已开启'], ['unlisted', '未列入'], ['slot', '占用槽位'], ['fill', '疑似待填'], ['macro', '含外部宏'], ['all', '全部']]),
          h('div', { style: { marginTop: '8px', display: 'flex', gap: '8px', alignItems: 'center' } }, [
            h('input', { type: 'text', value: q, placeholder: '搜索条目名或正文开头…', style: { flex: '1 1 auto', padding: '5px 8px', border: '1px solid var(--border-strong)', borderRadius: '7px', font: 'inherit', fontSize: '12px' },
              oninput: (ev) => { state.entryQuery = ev.target.value; const keep = document.activeElement; renderAll(); void keep; } }),
          ]),
        ]),
        h('div', { class: 'card' }, table([
          { label: '#', num: true }, { label: '条目名' }, { label: '槽位' }, { label: 'role' }, { label: '状态' }, { label: '长度', num: true }, { label: '正文开头' },
        ], list.map((e) => {
          /* 点条目名就地编辑正文：走 M3 同一条路（PE.setContent），
             所以"已改"标记、导出、来源自证、一键还原全都自动一致，不新增第二套状态。 */
          const editing = state.entryEdit === e.idx;
          const editable = PE.canEditContent(state.edit, e.idx);
          const changed = state.edit.content.has(e.idx);
          const head = editing
            ? h('div', {}, [
              h('textarea', {
                class: 'bigtext small mono', rows: 6, spellcheck: 'false',
                value: PE.contentOf(state.edit, preset().json, e.idx),
                onchange: (ev) => { PE.setContent(state.edit, preset().json, e.idx, ev.target.value); state.rev++; renderAll(); },
              }),
              h('div', { class: 'buildbar' }, [
                h('button', {
                  class: 'btn tiny ghost', text: '还原成导入时的原文',
                  onclick: () => { PE.revertContent(state.edit, preset().json, e.idx); state.rev++; renderAll(); banner('已还原成导入时的原文。', 'ok'); },
                }),
                h('span', { class: 'dim', text: '改完点别处即生效；导出的就是改过的版本' }),
              ]),
            ])
            : h('span', { class: 'mono dim', text: e.head });
          return [
            String(e.listed ? e.orderIndex : '—'),
            editable
              ? h('span', {
                class: 'mono', style: { cursor: 'pointer', textDecoration: 'underline dotted' },
                title: editing ? '收起' : '点开就地编辑正文',
                onclick: () => { state.entryEdit = editing ? null : e.idx; renderAll(); },
              }, [(e.name || '(无名)'), changed ? h('span', { class: 'pill warn', text: '已改' }) : null])
              : (e.name || '(无名)'),
            e.slot ? h('span', { class: 'pill slot', text: e.slotLabel }) : '',
            e.role + (e.systemPrompt ? ' /sys' : ''),
            h('span', { class: 'pill ' + (e.enabled ? 'on' : 'off'), text: e.enabled ? '开' : '关' }),
            fmt(e.chars),
            head,
          ];
        }))),
      ];
    },

    slots(m) {
      return [
        ...title('槽位占用', '酒馆的内置槽位全局唯一——同一个槽位被两条占用时，只有一条会生效。这正是"切模型丢世界书"那类事故的起点。'),
        m.slots.length ? h('div', { class: 'card' }, m.slots.map((s) => h('div', { style: { padding: '7px 0', borderBottom: '1px dashed var(--border)' } }, [
          h('div', {}, [
            h('b', { text: s.label }),
            ' ',
            h('code', { class: 'dim', text: s.identifier }),
            ' ',
            s.injected ? h('span', { class: 'pill slot', text: '酒馆注入位' }) : null,
            s.conflict ? h('span', { class: 'pill err', text: `冲突 ${s.owners.length} 选 1` }) : null,
          ]),
          h('div', { class: 'dim', style: { paddingLeft: '2px' } }, s.owners.map((o) => h('div', {}, [
            h('span', { class: 'pill ' + (o.enabled ? 'on' : 'off'), text: o.enabled ? '开' : '关' }),
            ' ',
            o.name,
            h('span', { class: 'dim', text: `　${o.chars} 字` }),
          ]))),
        ]))) : h('div', { class: 'card' }, h('div', { class: 'empty', text: '没有条目占用内置槽位。' })),
      ];
    },

    variables(m) {
      return [
        ...title('变量总线', '{{setvar}} / {{addvar}} 写入，{{getvar}} 读取。悬空 = 有人读但没人写（展开就是空字符串）；互斥 = 多条设置同一个变量。'),
        h('div', { class: 'card' }, table([
          { label: '变量' }, { label: '设置者', num: true }, { label: '累加者', num: true }, { label: '读取者', num: true }, { label: '状态' },
        ], m.variables.map((v) => [
          h('code', { text: v.name }),
          String(v.setBy.length),
          String(v.addBy.length),
          String(v.getBy.length),
          v.dangling ? h('span', { class: 'pill err', text: '悬空' })
            : v.exclusive ? h('span', { class: 'pill warn', text: `互斥候选（${v.setBy.length} 选 1）` })
              : v.addBy.length ? h('span', { class: 'pill', text: '累加式' })
                : h('span', { class: 'pill on', text: '正常' }),
        ]))),
      ];
    },

    deps(m) {
      const byVar = new Map();
      for (const d of m.deps) {
        if (!byVar.has(d.variable)) byVar.set(d.variable, []);
        byVar.get(d.variable).push(d);
      }
      const nameOf = (i) => m.entries.find((e) => e.idx === i)?.name || '(无名)';
      return [
        ...title('依赖关系', '谁给谁供数：左边是设置该变量的条目，右边是读它的条目。箭头断了就是悬空。'),
        byVar.size ? h('div', { class: 'card' }, [...byVar.entries()].map(([v, ds]) => h('div', { style: { padding: '6px 0', borderBottom: '1px dashed var(--border)' } }, [
          h('code', { text: v }),
          h('div', { class: 'dim', style: { paddingLeft: '10px' } },
            [...new Set(ds.map((d) => nameOf(d.from)))].map((from) => {
              const tos = [...new Set(ds.filter((d) => nameOf(d.from) === from).map((d) => nameOf(d.to)))];
              return h('div', {}, [`${from} → ${tos.join('、')}`]);
            })),
        ]))) : h('div', { class: 'card' }, h('div', { class: 'empty', text: '没有条目间的变量依赖。' })),
      ];
    },

    tags(m) {
      return [
        ...title('标签族', '按正文里出现的结构标签归类。**同一族的多条适合"选一"；不同族的思维链标签同时开启，模型会同时吐出两种结构。**'),
        m.tagFamilies.length ? m.tagFamilies.map((f) => h('div', { class: 'card' }, [
          h('h3', {}, [f.label, ' ', h('span', { class: 'pill', text: f.role }), ` ${f.members.filter((x) => x.enabled).length}/${f.members.length} 条开启`]),
          h('div', {}, f.members.map((x) => h('span', { class: 'pill ' + (x.enabled ? 'on' : 'off'), style: { marginRight: '4px', marginBottom: '4px' }, text: x.name }))),
        ])) : h('div', { class: 'card' }, h('div', { class: 'empty', text: '没有识别到结构标签。' })),
      ];
    },

    suggestions(m) {
      return [
        ...title('分组建议', '从"变量怎么被写、标签属于哪一族"推出来的分组候选。**推断一定会有误判，所以每条都带依据；人工判断优先。**'),
        h('div', { class: 'card' }, h('p', { class: 'viewdesc', text: 'M0 阶段只给建议，不动结构。等你确认后才会进入计划与编辑。' })),
        m.suggestions.length ? m.suggestions.map((s) => h('div', { class: 'card' }, [
          h('h3', {}, [h('span', { class: 'pill ' + (s.mode === 'single' ? 'warn' : 'on'), text: s.mode === 'single' ? '建议：选一' : '建议：可多选' }), ' ', h('code', { text: s.id })]),
          h('p', { class: 'viewdesc', style: { margin: '4px 0 8px' }, text: s.reason }),
          h('div', {}, s.members.map((n) => h('span', { class: 'pill', style: { marginRight: '4px', marginBottom: '4px' }, text: n }))),
        ])) : h('div', { class: 'card' }, h('div', { class: 'empty', text: '没有可推断的分组。' })),
      ];
    },

    assemble(m) {
      const r = runAssemble();
      const toggles = m.entries.filter((e) => e.listed);
      const errs = r.warnings.filter((w) => w.level === 'err');
      return [
        ...title('拼装渲染', '按 prompt_order 顺序把启用的条目拼成"实际会发给模型的那一段"，并**按顺序展开变量**。这里的开关是试算，不改你的文件。'),
        errs.length ? h('div', { class: 'card' }, errs.map((w) => warnRow(w))) : null,
        h('div', { class: 'card' }, [
          h('h3', { text: '试算开关' }),
          h('div', { class: 'dim', style: { marginBottom: '6px' }, text: '这里改的开关就是编辑器的开关（同一份状态），会一起进导出。' }),
          h('div', { class: 'toggles' }, toggles.map((e) => {
            const on = state.edit.enabled.has(e.idx) ? state.edit.enabled.get(e.idx) : e.enabled;
            return h('label', { class: 'tg', 'data-on': on ? '1' : '0' }, [
              h('input', { type: 'checkbox', checked: on, onchange: (ev) => { state.edit.enabled.set(e.idx, ev.target.checked); bump(); } }),
              e.name || '(无名)',
            ]);
          })),
          h('div', { style: { marginTop: '8px' } }, h('button', {
            class: 'btn ghost', text: '恢复预设原始开关',
            onclick: () => { state.edit.enabled = new Map(); bump(); },
          })),
        ]),
        h('div', { class: 'card' }, [
          h('h3', { text: '统计' }),
          h('div', { class: 'kpis' }, [
            h('div', { class: 'kpi' }, [h('b', { text: String(r.segments.filter((s) => s.kind === 'prompt').length) }), h('span', { text: '参与拼装的条目' })]),
            h('div', { class: 'kpi' }, [h('b', { text: fmt(r.totalChars) }), h('span', { text: '总字符' })]),
            h('div', { class: 'kpi' }, [h('b', { text: '≈' + fmt(r.tokenEstimate) }), h('span', { text: 'token（粗略估算）' })]),
            h('div', { class: 'kpi' }, [h('b', { text: String(r.skipped.length) }), h('span', { text: '已关闭被跳过' })]),
            h('div', { class: 'kpi' }, [h('b', { text: String(r.unlisted.length) }), h('span', { text: '未列入列表' })]),
          ]),
          h('p', { class: 'viewdesc', style: { marginTop: '8px' } }, '注：这里只做提示词拼装。酒馆的正则（尤其是"仅改发送"的那些）会在这之后作用于消息文本，本视图没有模拟它们——正则清单见左侧。'),
        ]),
        ...r.segments.map(segCard),
        h('div', { class: 'card' }, [
          h('h3', { text: '完整拼装结果' }),
          h('textarea', { class: 'bigtext', readonly: true, value: r.text }),
        ]),
      ];
    },

    vartrace(m) {
      const r = runAssemble();
      return [
        ...title('变量轨迹', '按拼装顺序排列的每一次 set / add / get。**这是"变量没生效"这类问题最直接的证据**：能看到它在什么时候被写、被谁覆盖、被谁读到时还是空的。'),
        r.events.length ? h('div', { class: 'card' }, table([
          { label: '#', num: true }, { label: '操作' }, { label: '变量' }, { label: '来自条目' }, { label: '值' },
        ], r.events.map((ev, i) => [
          String(i + 1),
          h('span', { class: 'pill ' + (ev.op === 'get' ? (ev.defined ? 'on' : 'err') : 'warn'), text: ev.op === 'get' ? '读' : ev.op === 'add' ? '累加' : '设' }),
          h('code', { text: ev.name }),
          ev.by,
          h('span', { class: 'mono dim', text: ev.op === 'get' ? (ev.defined ? (ev.value || '(空)') : '(未设置→空)') : (ev.value === '' ? '(清空)' : ev.value) }),
        ]))) : h('div', { class: 'card' }, h('div', { class: 'empty', text: '拼装过程中没有变量操作。' })),
      ];
    },

    external(m) {
      return [
        ...title('外部依赖', '不在这份预设里的东西：插件提供的宏、外部 CDN。缺了它们，相关条目会展开成占位符或直接失效。'),
        h('div', { class: 'card' }, [
          h('h3', { text: `非原生宏（${m.external.macros.length}）` }),
          m.external.macros.length ? table([{ label: '宏' }, { label: '用它的条目' }],
            m.external.macros.map((x) => [h('code', { text: `{{${x.name}::…}}` }), x.by.join('、')]))
            : h('div', { class: 'empty', text: '没有。' }),
        ]),
        h('div', { class: 'card' }, [
          h('h3', { text: `外部 CDN（${m.external.cdn.length}）` }),
          m.external.cdn.length ? h('div', {}, m.external.cdn.map((x) => h('div', { text: x })))
            : h('div', { class: 'empty', text: '没有。' }),
        ]),
      ];
    },

    regex(m) {
      const kind = (r) => (r.promptOnly && r.markdownOnly ? '两侧都改' : r.promptOnly ? '仅改发送' : r.markdownOnly ? '仅改显示' : '改消息体');
      return [
        ...title('正则', '正则作用于消息文本，不是提示词列表。注意"仅改发送"那些会改变模型看到的内容。'),
        h('div', { class: 'card' }, table([
          { label: '状态' }, { label: '名称' }, { label: '作用面' }, { label: 'find', num: true }, { label: 'replace', num: true }, { label: 'CDN' },
        ], m.regexes.map((r) => [
          h('span', { class: 'pill ' + (r.disabled ? 'off' : 'on'), text: r.disabled ? '关' : '开' }),
          r.name,
          kind(r),
          fmt(r.find.length),
          fmt(r.replaceChars),
          r.cdn ? h('span', { class: 'pill warn', text: '外链' }) : '',
        ]))),
      ];
    },

    checkup(m) {
      const rep = runCheckup();
      if (!rep) return [...title('体检 / 待办', '还没有载入预设。')];
      const c = rep.counts;
      return [
        ...title('体检 / 待办',
          '把 M0 的事实和 M1 的真实展开对照一份"任何酒馆预设都该满足"的规矩，分「必改 / 建议 / 提示」三档。'
          + '每条都写清为什么、怎么改、依据是什么；拿不准的不会写成"必改"。'),
        h('div', { class: 'card' }, [
          h('div', { class: 'kpis' }, [
            h('div', { class: 'kpi', 'data-bad': c.err ? '1' : '0' }, [h('b', { text: String(c.err) }), h('span', { text: '必改' })]),
            h('div', { class: 'kpi' }, [h('b', { text: String(c.warn) }), h('span', { text: '建议' })]),
            h('div', { class: 'kpi' }, [h('b', { text: String(c.info) }), h('span', { text: '提示' })]),
          ]),
          h('div', { style: { marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
            h('button', { class: 'btn', text: '复制待办清单', onclick: copyChecklist }),
            h('button', { class: 'btn ghost', text: '下载清单 .md', onclick: downloadChecklist }),
          ]),
          h('div', { class: 'dim', style: { marginTop: '8px' }, text: '清单里只有结构和改法，不含任何提示词正文——正文得你自己写。' }),
        ]),
        rep.items.length
          ? h('div', {}, rep.items.map(checkupItem))
          : h('div', { class: 'card' }, h('div', { class: 'empty', text: '这一份没查出问题。' })),
      ];
    },

    /* ── M4 从零搭一份 ──────────────────────────────────────────── */
    new(m) {
      const baseOptions = [{ value: '', label: '空结构（只生成结构；采样参数等用酒馆默认）' }]
        .concat(state.presets.map((p, i) => ({ value: String(i), label: `以「${p.file}」为底（抄它的顶层设置，不抄条目/正则/脚本）` })));
      const picked = state.skeletonDraft ?? (state.skeletonDraft = { name: '我的预设', base: '', modules: ['breach', 'cot', 'style'], custom: 0 });

      const checkRow = (mod) => h('label', { class: 'modrow' }, [
        h('input', {
          type: 'checkbox', checked: picked.modules.includes(mod.id),
          onchange: (ev) => {
            picked.modules = ev.target.checked
              ? picked.modules.concat([mod.id])
              : picked.modules.filter((x) => x !== mod.id);
            renderAll();
          },
        }),
        h('span', { style: { flex: '1 1 auto' } }, [
          h('b', { text: mod.label }),
          h('div', { class: 'dim', text: mod.note }),
        ]),
      ]);

      return [
        ...title('从零搭一份预设',
          '工具只搭**骨架**：条目名、槽位、顺序、开关，以及"这条该写什么"的注释提示。'
          + '正文一个字都不代写——生成出来的每条正文都是注释形式的「待填」，等你自己敲。'),
        h('div', { class: 'card' }, [
          h('h3', { text: '1. 起个名字 + 选基底' }),
          h('div', { class: 'addform' }, [
            h('input', {
              type: 'text', class: 'nameinput', value: picked.name, placeholder: '预设名，例如：我的角色预设',
              onchange: (ev) => { picked.name = ev.target.value; },
            }),
            h('select', {
              onchange: (ev) => { picked.base = ev.target.value; renderAll(); },
            }, baseOptions.map((o) => h('option', { value: o.value, selected: picked.base === o.value, text: o.label }))),
          ]),
          h('div', { class: 'dim', style: { marginTop: '6px' }, text: '基底只用来抄顶层设置（采样参数、上下文上限这类）。**不搬**它的条目，也**不搬**它的正则/脚本/面板——那些通常绑死原预设的条目名。' }),
        ]),
        h('div', { class: 'card' }, [
          h('h3', { text: '2. 勾要哪些模块（都可以以后再改）' }),
          h('div', {}, PS.MODULES.filter((x) => !x.required).map(checkRow)),
          h('div', { class: 'addform', style: { marginTop: '10px' } }, [
            h('span', { text: '再加几条空条目：' }),
            h('input', {
              type: 'number', min: '0', max: '20', value: String(picked.custom), style: { width: '70px' },
              onchange: (ev) => { picked.custom = Number(ev.target.value) || 0; renderAll(); },
            }),
          ]),
        ]),
        h('div', { class: 'card' }, [
          h('h3', { text: '3. 会生成什么' }),
          h('div', {}, PS.describe({ moduleIds: picked.modules, customCount: picked.custom }).map((r) => h('div', { class: 'warnrow', 'data-level': 'info' }, [
            h('span', { class: 'tag', text: r.kind }), h('span', { text: r.text }),
          ]))),
          h('div', { class: 'checkline', style: { marginTop: '10px' } }, [
            h('b', { text: '位置标记为什么是空的　' }),
            '世界书、角色卡、人设、场景、示例对话、聊天记录这 8 个槽位是酒馆"往这儿塞东西"的位置——'
            + '它们的正文本来就是 0 字，但必须开着，否则那些内容根本进不来。这不是漏填。',
          ]),
          h('div', { class: 'checkline' }, [
            h('b', { text: '生成之后　' }),
            '会直接落到「框架编辑」：那里每条你自己写的条目都有输入框，写完内容再打开它。',
          ]),
          h('div', { style: { marginTop: '10px' } }, h('button', {
            class: 'btn', text: '生成骨架并打开 →', onclick: generateSkeleton,
          })),
        ]),
      ];
    },

    /* ── M3 框架编辑 ─────────────────────────────────────────────── */
    editor(m) {
      const e = state.edit;
      if (!e) return [...title('框架编辑', '先载入一份预设。')];
      const rows = PE.summary(e, preset().model);
      const byIdx = new Map(preset().model.entries.map((x) => [x.idx, x]));
      const addedByKey = new Map(e.added.map((a) => [a.key, a]));

      const effOn = (idx, fallback) => (e.enabled.has(idx) ? e.enabled.get(idx) : fallback);

      /* 注意：table() 自己负责包 <tr>，所以这里返回的是"一行单元格"，不是 <tr> */
      const cellsOf = (key) => {
        const isAdded = key.startsWith('a:');
        const a = addedByKey.get(key);
        const en = isAdded ? null : byIdx.get(Number(key.slice(1)));
        if (!isAdded && !en) return null;
        const name = isAdded ? a.name : (e.names.get(en.idx) ?? en.name);
        const on = isAdded ? a.enabled : effOn(en.idx, en.enabled);
        const chars = isAdded ? [...(a.content ?? '')].length : en.chars;
        return [
          h('td', { class: 'num' }, [
            h('button', { class: 'btn tiny', text: '↑', title: '上移', onclick: () => { PE.moveKey(e, key, -1); bump(); } }),
            h('button', { class: 'btn tiny', text: '↓', title: '下移', onclick: () => { PE.moveKey(e, key, 1); bump(); } }),
          ]),
          h('td', {}, h('input', {
            type: 'checkbox', checked: on, title: '开关（会同时写进条目和 prompt_order）',
            onchange: (ev) => {
              if (isAdded) a.enabled = ev.target.checked; else e.enabled.set(en.idx, ev.target.checked);
              bump();
            },
          })),
          h('td', {}, isAdded
            ? h('span', {}, [h('b', { text: a.name }), ' ', h('span', { class: 'pill slot', text: '新增' })])
            : h('input', {
              type: 'text', value: name, class: 'nameinput',
              onchange: (ev) => {
                const v = ev.target.value;
                if (v === en.name) e.names.delete(en.idx); else e.names.set(en.idx, v);
                bump();
              },
            })),
          h('td', {}, isAdded
            ? h('span', { class: 'pill ' + (a.slot ? 'slot' : 'off'), text: a.slot || '普通条目' })
            : (en.slot ? h('span', { class: 'pill slot', text: en.slotLabel }) : h('span', { class: 'dim', text: '—' }))),
          h('td', { class: 'dim', text: isAdded ? a.role : en.role }),
          h('td', { class: 'num' }, [
            h('span', { text: fmt(chars) }),
            isAdded && PE.isPending(a.content) ? h('span', { class: 'pill warn', text: '待填' }) : null,
          ]),
          h('td', {}, [
            h('button', {
              class: 'btn tiny ghost', text: '移出列表', title: '只从提示词列表移走，条目还在文件里',
              onclick: () => { PE.removeFromOrder(e, key); bump(); },
            }),
            h('button', {
              class: 'btn tiny ghost', text: '删除',
              onclick: () => {
                if (isAdded) PE.deleteAdded(e, key); else { e.deleted.add(en.idx); PE.removeFromOrder(e, key); }
                bump();
              },
            }),
          ]),
        ];
      };

      const unlisted = preset().model.entries.filter((x) => !x.listed && !e.deleted.has(x.idx));

      return [
        ...title('框架编辑',
          '改的是**结构**：顺序、开关、增删条目、改条目名。别人的正文一个字都不动，'
          + '新增条目的正文留空标「待填」，由你自己写。改完左边 M0/M1/M2 看到的就已经是新结构了。'),
        h('div', { class: 'card' }, [
          h('h3', {}, ['改动摘要　', rows.length ? h('span', { class: 'pill warn', text: `${rows.length} 项` }) : h('span', { class: 'pill on', text: '还没改' })]),
          rows.length ? h('div', {}, rows.map((r) => h('div', { class: 'warnrow', 'data-level': 'warn' }, [
            h('span', { class: 'tag', text: r.kind }), h('span', { text: r.text }),
          ]))) : h('div', { class: 'empty', text: '还没做改动。下面的开关/上移下移/改名都会算进来。' }),
          h('div', { style: { marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
            h('button', { class: 'btn ghost', text: '重置全部改动', onclick: () => { resetEdits(true); renderAll(); banner('已重置，回到导入时的状态。', 'ok'); } }),
            h('button', { class: 'btn', text: '去导出新预设 →', onclick: () => { state.view = 'export'; renderAll(); } }),
          ]),
        ]),
        h('div', { class: 'card' }, [
          h('h3', { text: '新增条目（正文留空，等你自己写）' }),
          h('div', { class: 'addform' }, [
            h('input', { type: 'text', id: 'new-name', placeholder: '条目名字，例如：🌸我的口癖', class: 'nameinput' }),
            h('select', { id: 'new-slot' }, PE.SLOT_CHOICES.map((s) => h('option', { value: s.id, text: s.label }))),
            h('select', { id: 'new-role' }, ['system', 'user', 'assistant'].map((r) => h('option', { value: r, text: 'role: ' + r }))),
            h('button', {
              class: 'btn', text: '＋ 添加',
              onclick: () => {
                const name = ($('new-name').value || '').trim();
                const slot = $('new-slot').value;
                const role = $('new-role').value;
                const a = PE.addEntry(state.edit, preset().model, { name, slot, role });
                $('new-name').value = '';
                bump();
                banner(`已添加「${a.name}」：正文是空的、默认关着，写完内容再打开它。`, 'ok');
              },
            }),
          ]),
          h('div', { class: 'dim', style: { marginTop: '6px' }, text: '不选槽位 = 普通条目（自动生成一个唯一标识）；选槽位 = 占住酒馆的注入位，一个槽位只能有一个主人。' }),
          e.added.length ? h('div', { style: { marginTop: '10px' } }, e.added.map((a) => h('div', { class: 'addeditem' }, [
            h('div', {}, [
              h('b', { text: a.name }), ' ',
              h('span', { class: 'pill ' + (a.enabled ? 'on' : 'off'), text: a.enabled ? '开启' : '默认关' }), ' ',
              a.marker ? h('span', { class: 'pill slot', text: '位置标记' })
                : (PE.isPending(a.content) ? h('span', { class: 'pill warn', text: '待填' }) : h('span', { class: 'pill on', text: '已填' })),
              a.slot ? h('span', { class: 'pill slot', text: a.slot }) : null,
            ]),
            a.marker
              ? h('div', { class: 'dim', text: '这是注入位标记：正文保持为空，写完别的内容也不用管它。' })
              : h('div', { class: 'dim', text: '正文在下面「你写的正文」里敲。' }),
          ]))) : null,
        ]),
        h('div', { class: 'card' }, [
          h('h3', {}, ['你写的正文　', (() => {
            const pr = PE.pendingProgress(e, preset().model);
            if (!pr.total) return h('span', { class: 'dim', text: '（这份预设没有你自己写的条目）' });
            return h('span', {}, [
              h('span', { class: pr.todo ? 'pill warn' : 'pill on', text: pr.todo ? `待填 ${pr.todo} 条` : '都填好了' }),
              ' ',
              h('span', { class: 'dim', text: `${pr.done}/${pr.total - pr.markers} 已填` + (pr.markers ? `　另有 ${pr.markers} 个位置标记（正文为空是对的）` : '') }),
            ]);
          })()]),
          (() => {
            const own = PE.ownEntries(e, preset().model);
            /* 你**改过的导入条目**也列在这儿：改正文的地方应该只有一处，
               不然"我在面板里改的正文去哪了"就会变成问题。 */
            const editedSrc = [...e.content.keys()]
              .filter((idx) => !e.own.has(idx) && !e.deleted.has(idx))
              .map((idx) => {
                const en = preset().model.entries.find((x) => x.idx === idx);
                if (!en) return null;
                return { kind: 'edited', idx, name: e.names.get(idx) ?? en.name, content: e.content.get(idx), enabled: e.enabled.has(idx) ? e.enabled.get(idx) : en.enabled, marker: false };
              })
              .filter(Boolean);
            const writable = own.filter((r) => !r.marker).concat(editedSrc);
            if (!writable.length) {
              return h('div', { class: 'empty', text: '这份预设还没有你自己写的条目。想写自己的东西：用下面的「＋ 添加」，去「从面板搭建」加功能项，或者去「从零搭一份」生成骨架。' });
            }
            return h('div', {}, writable.map((r) => h('div', { class: 'addeditem' }, [
              h('div', {}, [
                h('b', { text: r.name }), ' ',
                h('span', { class: 'pill ' + (r.enabled ? 'on' : 'off'), text: r.enabled ? '开启' : '默认关' }), ' ',
                PE.isPending(r.content) ? h('span', { class: 'pill warn', text: '待填' }) : h('span', { class: 'pill on', text: '已填' }),
                r.kind === 'added' ? h('span', { class: 'pill slot', text: '新增' }) : null,
                r.kind === 'edited' ? h('span', { class: 'pill warn', text: '改过导入的原文' }) : null,
              ]),
              h('textarea', {
                class: 'bigtext small', rows: 4, value: r.content,
                placeholder: '在这里写这条的内容（工具不代写）',
                onchange: (ev) => {
                  if (r.kind === 'added') {
                    const a = e.added.find((x) => x.key === r.key);
                    if (a) a.content = ev.target.value;
                  } else {
                    PE.setContent(e, preset().json, r.idx, ev.target.value);
                  }
                  bump();
                },
              }),
              r.kind === 'edited' ? h('button', {
                class: 'btn tiny ghost', text: '还原成导入时的原文',
                onclick: () => { PE.revertContent(e, preset().json, r.idx); bump(); },
              }) : null,
            ])));
          })(),
        ]),
        h('div', { class: 'card' }, [
          h('h3', {}, ['提示词列表顺序　', h('span', { class: 'dim', text: `${e.order.length} 条（酒馆按这个顺序拼）` })]),
          h('div', { class: 'dim', style: { marginBottom: '6px' }, text: '上移 = 更靠前。变量是先设后用，所以"设置类"条目要排在"读取类"前面。' }),
          table([{ label: '序', num: true }, { label: '开' }, { label: '条目名（可直接改）' }, { label: '槽位' }, { label: 'role' }, { label: '长度', num: true }, { label: '操作' }],
            e.order.map(cellsOf).filter(Boolean)),
        ]),
        unlisted.length ? h('div', { class: 'card' }, [
          h('h3', {}, ['未列入提示词列表的条目　', h('span', { class: 'pill warn', text: `${unlisted.length} 条永远不会生效` })]),
          h('div', {}, unlisted.map((x) => h('div', { class: 'warnrow' }, [
            h('span', { class: 'tag', text: `${x.chars} 字` }),
            h('span', { style: { flex: '1 1 auto' }, text: x.name }),
            h('button', { class: 'btn tiny', text: '加入列表', onclick: () => { PE.appendToOrder(e, PE.keyOf(x)); bump(); } }),
          ]))),
        ]) : null,
      ];
    },

    /* ── M3 导出 ─────────────────────────────────────────────────── */
    export(m) {
      const p = preset();
      const e = state.edit;
      if (!p || !e) return [...title('导出新预设', '先载入一份预设。')];
      const c = runExportChecks();
      const rows = PE.summary(e, p.model);
      const intact = PE.verifySourceIntact(p.json, e, p.model, PP.fingerprint);
      const rep = runCheckup();
      const blocked = c.blocking.length > 0;
      const pi = panelIntent();
      const panels = PE.panelScriptViews(e, p.json, p.model);

      return [
        ...title('导出新预设',
          '导出的是一份**完整的新预设文件**（不是补丁）：你的结构改动 + 别人的原文，一字未改。'
          + '格式和导入时一样紧凑，改完可以直接扔进酒馆。'),
        panelCard(pi, panels),
        h('div', { class: 'card' }, [
          h('h3', {}, ['改动　', rows.length ? h('span', { class: 'pill warn', text: `${rows.length} 项` }) : h('span', { class: 'pill on', text: '没有改动' })]),
          rows.length ? h('div', {}, rows.map((r) => h('div', { class: 'warnrow', 'data-level': 'warn' }, [
            h('span', { class: 'tag', text: r.kind }), h('span', { text: r.text }),
          ]))) : h('div', { class: 'empty', text: '内容与原文件一致——现在导出会和导入的那份逐字节等价（测试里就是这么断言的）。' }),
        ]),
        h('div', { class: 'card', 'data-level': blocked ? 'err' : 'info' }, [
          h('h3', {}, ['导出前检查　',
            blocked ? h('span', { class: 'pill err', text: `${c.blocking.length} 项必须先处理` })
              : h('span', { class: 'pill on', text: '通过' }),
            c.warnings.length ? h('span', { class: 'pill warn', text: `${c.warnings.length} 项提醒` }) : null,
          ]),
          c.blocking.length ? h('div', {}, c.blocking.map((b) => h('div', { class: 'warnrow', 'data-level': 'err' }, [
            h('span', { class: 'tag', text: b.kind }), h('span', { text: b.text }),
          ]))) : null,
          c.warnings.length ? h('div', {}, c.warnings.map((b) => h('div', { class: 'warnrow', 'data-level': 'warn' }, [
            h('span', { class: 'tag', text: b.kind }), h('span', { text: b.text }),
          ]))) : null,
          c.notes.length ? h('div', {}, c.notes.map((b) => h('div', { class: 'warnrow', 'data-level': 'info' }, [
            h('span', { class: 'tag', text: b.kind }), h('span', { text: b.text }),
          ]))) : null,
        ]),
        h('div', { class: 'card' }, [
          h('h3', { text: '来源完整性自证' }),
          h('div', { class: 'checkline' }, [
            h('b', { text: '核对结果　' }),
            intact.own && !intact.checked
              ? `这份预设是工具生成的骨架：${intact.own} 条条目全部由你自己写，没有"别人的正文"需要核对。`
              : `逐条比对了 ${intact.checked} 条来源条目的正文 / role / 注入位置：`
                + (intact.changed.length ? `有 ${intact.changed.length} 条对不上（${intact.changed.slice(0, 5).join('、')}）` : '全部一致，一个字都没改')
                + (intact.removed ? `；另有 ${intact.removed} 条是你显式删除的` : '')
                + (intact.edited ? `；另有 ${intact.edited} 条是你**显式改过正文**的（要还原在「面板搭建」里点一下就行）` : '')
                + (intact.own ? `；${intact.own} 条是你自己写的` : '') + '。',
          ]),
          h('div', { class: 'dim', text: '这里用的是本地指纹（发现"被改过"够用了）；工程里的 Node 测试用 sha1 做权威校验。' }),
        ]),
        h('div', { class: 'card' }, [
          h('h3', { text: '导出' }),
          h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
            h('button', {
              class: 'btn', text: blocked ? '有必改项，先处理' : '导出新预设 JSON', disabled: blocked ? true : null,
              onclick: exportJson,
            }),
            h('button', { class: 'btn ghost', text: '导出改动报告 .md', onclick: exportChangeReport }),
            h('button', { class: 'btn ghost', text: '复制体检待办', onclick: copyChecklist }),
          ]),
          h('div', { class: 'dim', style: { marginTop: '8px' }, text: rep
            ? `导出后这份新预设的体检结论：必改 ${rep.counts.err} · 建议 ${rep.counts.warn} · 提示 ${rep.counts.info}（左侧「体检 / 待办」看明细）。`
            : '' }),
          h('div', { class: 'dim', style: { marginTop: '4px' }, text: '工具只搭骨架：新增条目的正文永远要你自己写；它也不会改别人原有的一个字。' }),
        ]),
      ];
    },

    /* ── M5 正则编辑 ─────────────────────────────────────────────── */
    regexedit(m) {
      const e = state.edit;
      const p = preset();
      if (!e || !p) return [...title('正则编辑', '先载入一份预设。')];
      const rows = PE.regexViews(e, p.json, p.model);
      const sample = state.regexSample ?? (state.regexSample = '正文开头。\n<thinking>第一段思考</thinking>\n中间正文。\n<thinking>第二段思考</thinking>\n结尾。');
      const chain = PE.runRegexChain(rows, sample);

      const field = (v, onChange, opts = {}) => h('input', {
        type: 'text', value: v, class: 'nameinput', placeholder: opts.placeholder ?? '',
        onchange: (ev) => { onChange(ev.target.value); bump(); },
      });

      const rowCard = (r, i) => {
        const t = PE.testRegex(r.findRegex, r.replaceString, sample);
        const warn = [];
        if (!r.findRegex) warn.push('find 是空的，这条不会做任何事。');
        if (t.ok && t.matches === 0) warn.push('在这段样例里一处都没匹配到。');
        if (r.cdn) warn.push('这条正则里有外部链接（CDN），断网/被墙时会失效。');
        if (!r.disabled && r.promptOnly && r.markdownOnly) warn.push('同时勾了"仅改发送"和"仅改显示"，等于两侧都改。');

        return h('div', { class: 'card', 'data-level': r.disabled ? 'info' : 'warn' }, [
          h('h3', {}, [
            h('span', { class: 'pill ' + (r.disabled ? 'off' : 'on'), text: r.disabled ? '已停用' : '启用中' }),
            ' ',
            String(i + 1), '. ', r.scriptName || '(无名)',
            r.isNew ? h('span', { class: 'pill slot', text: '新增' }) : null,
            r.changed ? h('span', { class: 'pill warn', text: '已改' }) : null,
          ]),
          h('div', { class: 'addform' }, [
            h('label', { class: 'modrow', style: { border: 'none', padding: '0' } }, [
              h('input', {
                type: 'checkbox', checked: !r.disabled,
                onchange: (ev) => { PE.setRegexField(e, p.json, r.key, 'disabled', !ev.target.checked); bump(); },
              }),
              h('span', { text: '启用' }),
            ]),
            field(r.scriptName, (v) => PE.setRegexField(e, p.json, r.key, 'scriptName', v), { placeholder: '正则名字' }),
            h('button', { class: 'btn tiny', text: '↑', onclick: () => { PE.moveRegex(e, r.key, -1); bump(); } }),
            h('button', { class: 'btn tiny', text: '↓', onclick: () => { PE.moveRegex(e, r.key, 1); bump(); } }),
            h('button', {
              class: 'btn tiny ghost', text: '删除',
              onclick: () => { PE.deleteRegex(e, r.key); bump(); },
            }),
          ]),
          h('div', { class: 'checkline' }, [
            h('b', { text: 'find　' }),
            h('span', { class: 'dim', text: '酒馆写法：/内容/标志。带 g 才会替换全部匹配。' }),
          ]),
          h('textarea', {
            class: 'bigtext small mono', rows: 3, value: r.findRegex, placeholder: '/<(?:think|thinking)>([\\s\\S]*?)<\\/(?:think|thinking)>/gi',
            onchange: (ev) => { PE.setRegexField(e, p.json, r.key, 'findRegex', ev.target.value); bump(); },
          }),
          h('div', { class: 'checkline' }, [h('b', { text: '替换为　' }), h('span', { class: 'dim', text: '$1 表示第一个括号组。' })]),
          h('textarea', {
            class: 'bigtext small mono', rows: 3, value: r.replaceString,
            onchange: (ev) => { PE.setRegexField(e, p.json, r.key, 'replaceString', ev.target.value); bump(); },
          }),
          h('div', { class: 'checkline' }, [
            h('b', { text: '作用面　' }),
            h('span', {}, PLACEMENTS.map((pl) => h('label', { class: 'tg', 'data-on': (r.placement || []).includes(pl.id) ? '1' : '0' }, [
              h('input', {
                type: 'checkbox', checked: (r.placement || []).includes(pl.id),
                onchange: (ev) => {
                  const cur = new Set(r.placement || []);
                  if (ev.target.checked) cur.add(pl.id); else cur.delete(pl.id);
                  PE.setRegexField(e, p.json, r.key, 'placement', [...cur].sort((a, b) => a - b));
                  bump();
                },
              }),
              pl.label,
            ]))),
          ]),
          h('div', { class: 'checkline' }, [
            h('b', { text: '只改　　　' }),
            h('label', { class: 'tg', 'data-on': r.markdownOnly ? '1' : '0' }, [
              h('input', {
                type: 'checkbox', checked: !!r.markdownOnly,
                onchange: (ev) => { PE.setRegexField(e, p.json, r.key, 'markdownOnly', ev.target.checked); bump(); },
              }),
              '仅显示（不发送）',
            ]),
            h('label', { class: 'tg', 'data-on': r.promptOnly ? '1' : '0' }, [
              h('input', {
                type: 'checkbox', checked: !!r.promptOnly,
                onchange: (ev) => { PE.setRegexField(e, p.json, r.key, 'promptOnly', ev.target.checked); bump(); },
              }),
              '仅发送（不改显示）',
            ]),
          ]),
          h('div', { class: 'checkline' }, [
            h('b', { text: '试跑　' }),
            t.ok
              ? h('span', {}, [
                h('span', { class: t.matches ? 'pill on' : 'pill off', text: `匹配 ${t.matches} 处` }),
                ' ',
                h('span', { class: 'dim', text: t.changed ? '替换会改动文本' : '替换后文本没变' }),
              ])
              : h('span', { class: 'pill err', text: t.error }),
          ]),
          (t.reasons || []).length ? h('div', { class: 'dim', style: { marginLeft: '2px' } },
            (t.reasons || []).map((rs) => h('div', { text: '· ' + rs }))) : null,
          t.ok && t.changed ? h('div', { class: 'duo' }, [
            h('div', {}, [
              h('div', { class: 'checkline' }, [h('b', { text: '替换后（纯文本）' })]),
              h('pre', { class: 'preview', text: t.out.slice(0, 900) }),
            ]),
            h('div', {}, [
              h('div', { class: 'checkline' }, [h('b', { text: '渲染出来' })]),
              h('div', { class: 'renderbox', html: sanitizeHtml(t.out.slice(0, 2500)) }),
            ]),
          ]) : null,
          warn.length ? h('div', {}, warn.map((w) => h('div', { class: 'warnrow', 'data-level': 'warn' }, [
            h('span', { class: 'tag', text: '注意' }), h('span', { text: w }),
          ]))) : null,
        ]);
      };

      return [
        ...title('正则编辑',
          '正则作用于**消息文本**（不是提示词列表）：AI 吐出来的内容、用户输入、思维链。'
          + '它们按顺序依次套用，所以顺序和内容一样重要。这里改完能当场拿样例试跑。'),
        h('div', { class: 'card' }, [
          h('h3', {}, ['这套正则合起来的效果　', h('span', { class: 'dim', text: `${rows.filter((r) => !r.disabled).length} 条启用中` })]),
          h('div', { class: 'checkline' }, [h('b', { text: '样例文本（自己贴一段来试）' })]),
          h('textarea', {
            class: 'bigtext small', rows: 4, value: sample,
            onchange: (ev) => { state.regexSample = ev.target.value; bump(); },
          }),
          /* 拿预设里**真实条目**的正文当样例：自己的正则往往是针对某种输出写的，
             用我编的样例当然匹配不到。这个选择器就是为这件事加的。 */
          h('div', { class: 'checkline', style: { marginTop: '6px' } }, [
            h('b', { text: '或者用预设里的条目当样例　' }),
            h('select', {
              onchange: (ev) => {
                const idx = Number(ev.target.value);
                if (!Number.isInteger(idx) || ev.target.value === '') return;
                const en = m.entries.find((x) => x.idx === idx);
                if (en) {
                  state.regexSample = en.content;
                  bump();
                  banner(`已把「${en.name}」的正文拿来当样例（${en.chars} 字）。`, 'ok');
                }
              },
            }, [h('option', { value: '', text: '选一条…' })].concat(
              m.entries.filter((e) => e.chars > 20).slice(0, 300).map((e) => h('option', { value: String(e.idx), text: `${e.name}（${e.chars} 字）` })),
            )),
            h('span', { class: 'dim', text: '　自己的正则常常只认某种输出，用真内容试才准。' }),
          ]),
          h('div', { class: 'checkline', style: { marginTop: '8px' } }, [
            h('b', { text: '按顺序跑完的结果　' }),
            h('span', { class: 'dim', text: chain.steps.map((s) => `${s.name}:${s.skipped ? '跳过' : s.matches}`).join(' → ') }),
          ]),
          /* 一半一半：左边纯文本（看字符对不对），右边渲染出来（看折叠条/卡片长什么样） */
          h('div', { class: 'duo' }, [
            h('div', {}, [
              h('div', { class: 'checkline' }, [h('b', { text: '纯文本' })]),
              h('pre', { class: 'preview', text: chain.text.slice(0, 1500) }),
            ]),
            h('div', {}, [
              h('div', { class: 'checkline' }, [
                h('b', { text: '渲染出来' }),
                h('span', { class: 'dim', text: '　（这就是这条消息在酒馆里的样子）' }),
              ]),
              h('div', { class: 'renderbox', html: sanitizeHtml(chain.text.slice(0, 4000)) }),
            ]),
          ]),
          h('div', { class: 'dim', style: { marginTop: '6px' }, text: '渲染用的是浏览器默认样式（酒馆自己的 CSS 不在这个页面里），但折叠条能不能点、有没有被吃掉，一眼就能看出来。'
            + '插入前已经剔掉了 script / on* 事件这类能执行的东西。' }),
        ]),
        h('div', { class: 'card' }, [
          h('div', { class: 'addform' }, [
            h('button', {
              class: 'btn', text: '＋ 新增正则',
              onclick: () => { PE.addRegex(state.edit, { scriptName: '我的新正则' }); bump(); banner('已加一条空正则，接着填 find 和替换内容。', 'ok'); },
            }),
            h('span', { class: 'dim', text: `共 ${rows.length} 条（原有 ${m.regexes.length} 条）` }),
          ]),
        ]),
        ...(rows.length ? rows.map(rowCard) : [h('div', { class: 'card' }, h('div', { class: 'empty', text: '这份预设没有正则。' }))]),
      ];
    },

    /* ── M5 脚本编辑 ─────────────────────────────────────────────── */
    scriptedit(m) {
      const e = state.edit;
      const p = preset();
      if (!e || !p) return [...title('脚本编辑', '先载入一份预设。')];
      const rows = PE.scriptViews(e, p.json, p.model);

      return [
        ...title('脚本编辑',
          '这里改的是**文本**：名字、启停、代码。工具不会去"理解"或自动重写别人的 JS——'
          + '任何号称能可视化改任意脚本的界面都是在骗自己。所以给你的是：代码框、语法校验（只编译不执行）、和原文的 diff。'),
        h('div', { class: 'card' }, [
          h('div', { class: 'checkline' }, [
            h('b', { text: '改面板外观？　' }),
            '别在这里手改颜色——去左边「面板外观」，那里有颜色选择器和实时预览，'
            + '它只替换面板脚本里的那段配置，代码一行都不动。',
          ]),
        ]),
        ...(rows.length ? rows.map((s) => {
          const syntax = PE.checkScriptSyntax(s.content);
          const diff = PE.lineDiff(s.originalContent, s.content);
          const big = s.content.length;
          return h('div', { class: 'card', 'data-level': s.changed ? 'warn' : 'info' }, [
            h('h3', {}, [
              h('span', { class: 'pill ' + (s.enabled ? 'on' : 'off'), text: s.enabled ? '启用' : '停用' }),
              ' ',
              s.name || '(无名)',
              s.changed ? h('span', { class: 'pill warn', text: `已改：${s.changedFields.map((f) => ({ content: '代码', name: '名字', enabled: '启停' }[f] || f)).join('、')}` }) : null,
              e.scripts.deleted.has(s.idx) ? h('span', { class: 'pill err', text: '已标记删除·导出时不会带上' }) : null,
            ]),
            h('div', { class: 'addform' }, [
              h('label', { class: 'modrow', style: { border: 'none', padding: '0' } }, [
                h('input', {
                  type: 'checkbox', checked: s.enabled,
                  onchange: (ev) => { PE.setScriptField(e, p.json, s.idx, 'enabled', ev.target.checked); bump(); },
                }),
                h('span', { text: '启用' }),
              ]),
              h('input', {
                type: 'text', class: 'nameinput', value: s.name,
                onchange: (ev) => { PE.setScriptField(e, p.json, s.idx, 'name', ev.target.value); bump(); },
              }),
              h('button', {
                class: 'btn tiny ghost', text: '复制代码到剪贴板',
                onclick: () => copyText(s.content, '脚本代码'),
              }),
              h('button', {
                class: 'btn tiny ghost', text: e.scripts.deleted.has(s.idx) ? '取消删除' : '删除这个脚本',
                title: '导出时不再带上这条脚本（可反悔；面板脚本删掉后就能用「装进这份预设」顶进来）',
                onclick: () => {
                  if (e.scripts.deleted.has(s.idx)) {
                    PE.undeleteScript(e, 's' + s.idx);
                    banner('已取消删除：这条脚本导出的照旧带上。', 'ok');
                  } else {
                    PE.deleteScript(e, 's' + s.idx);
                    banner(`已标记删除「${s.name || '(无名)'}」——导出的预设里不会再有它（想反悔再点一次）。`
                      + (s.button && s.button.enabled ? '注意：它带的顶部按钮「⚙」也会一起消失。' : ''), 'warn');
                  }
                  bump();
                },
              }),
              h('button', {
                class: 'btn tiny ghost', text: '还原这条',
                onclick: () => {
                  if ('content' in (e.scripts.patches.get(s.idx) ?? {})) PE.setScriptField(e, p.json, s.idx, 'content', s.originalContent);
                  if ('name' in (e.scripts.patches.get(s.idx) ?? {})) PE.setScriptField(e, p.json, s.idx, 'name', m.scripts[s.idx]?.name ?? '');
                  if ('enabled' in (e.scripts.patches.get(s.idx) ?? {})) PE.setScriptField(e, p.json, s.idx, 'enabled', !!m.scripts[s.idx]?.enabled);
                  bump();
                },
              }),
            ]),
            h('div', { class: 'checkline' }, [
              h('b', { text: '语法　' }),
              syntax.empty ? h('span', { class: 'dim', text: '（空脚本）' })
                : syntax.ok ? h('span', { class: 'pill on', text: '能编译通过' })
                  : h('span', { class: 'pill err', text: `第 ${syntax.line ?? '?'} 行有问题：${syntax.error}` }),
              h('span', { class: 'dim', text: '　只做语法解析，不执行你的代码。' }),
            ]),
            h('div', { class: 'checkline' }, [
              h('b', { text: '与原文的差别　' }),
              diff.changed
                ? h('span', {}, [
                  h('span', { class: 'pill warn', text: `删 ${diff.removedLines.length} 行 / 加 ${diff.addedLines.length} 行` }),
                  h('span', { class: 'dim', text: `　行号 ${diff.sample.join(' ')}　（${diff.beforeLines} → ${diff.afterLines} 行）` }),
                ])
                : h('span', { class: 'dim', text: '和原文一样' }),
            ]),
            h('div', { class: 'checkline' }, [
              h('b', { text: '体积　' }),
              h('span', { class: 'dim', text: `${(big / 1024).toFixed(1)} KB` }),
              big > 200 * 1024 ? h('span', { class: 'pill warn', text: '很大，预设会跟着变大' }) : null,
              s.buttons.length ? h('span', { class: 'dim', text: `　按钮：${s.buttons.join('、')}` }) : null,
            ]),
            h('textarea', {
              class: 'bigtext mono', rows: 18, value: s.content, spellcheck: 'false',
              onchange: (ev) => { PE.setScriptField(e, p.json, s.idx, 'content', ev.target.value); bump(); },
            }),
          ]);
        }) : [h('div', { class: 'card' }, h('div', { class: 'empty', text: '这份预设没有内嵌脚本。' }))]),
      ];
    },

    /* ── M5 面板外观 ─────────────────────────────────────────────── */
    appearance(m) {
      const p = preset();
      if (!PC || !PANEL_DEMO) {
        return [...title('面板外观', '面板配置模块没载入——先跑 node tools/build-gui-demo.mjs 生成面板快照。')];
      }
      const A = ensureAppearance();
      const cfg = A.config;
      const themes = A.themes;
      const check = PC.validateConfig(cfg, themes);

      /* 颜色：一个 token 一行，白天/夜间并排。
         **每种颜色都有取色器**——带透明度的（窗口底色、阴影）给"取色器 + 透明度滑杆"，
         早先它们只有文字框，于是"背景色居然没法选色"（用户报的）。
         注意 table() 自己负责包 <tr>，所以这里返回的是**单元格数组**。 */
      const colorCell = (tier, spec) => {
        const factory = themes[tier][spec.key];
        const cur = cfg.tokens?.[tier]?.[spec.key] ?? '';
        const eff = cur || factory;
        const set = (v) => { setToken(tier, spec.key, v); bump(); };
        const clear = () => set('');
        if (spec.type === 'alpha') {
          const { hex, a } = splitColor(eff);
          return h('div', { class: 'alpha-cell' }, [
            h('div', { class: 'row2' }, [
              h('input', { type: 'color', value: hex, title: '选颜色', onchange: (ev) => set(composeRgba(ev.target.value, splitColor(eff).a)) }),
              h('input', { type: 'range', min: '0', max: '1', step: '0.02', value: String(a), title: '透明度',
                oninput: (ev) => set(composeRgba(splitColor(eff).hex, Number(ev.target.value))) }),
              h('span', { class: 'pct', text: Math.round(a * 100) + '%' }),
              h('button', { class: 'btn tiny ghost', text: '出厂', title: `恢复为 ${factory}`, onclick: clear }),
            ]),
            h('input', {
              type: 'text', class: 'nameinput mono', value: cur, placeholder: factory,
              onchange: (ev) => set(ev.target.value.trim()),
            }),
          ]);
        }
        return h('div', { class: 'colorcell' }, [
          h('input', { type: 'color', value: toHex(eff), onchange: (ev) => set(ev.target.value) }),
          h('input', {
            type: 'text', class: 'nameinput mono', value: cur, placeholder: factory,
            onchange: (ev) => set(ev.target.value.trim()),
          }),
          h('button', { class: 'btn tiny ghost', text: '出厂', title: `恢复为 ${factory}`, onclick: clear }),
        ]);
      };

      const colorRow = (spec) => [
        h('td', {}, [h('b', { text: spec.label }), h('div', { class: 'dim mono', text: spec.key })]),
        ...['day', 'night'].map((tier) => h('td', {}, [colorCell(tier, spec)])),
      ];

      const numField = (label, value, opts, onChange, hint) => h('label', { class: 'numfield' }, [
        h('span', { text: label }),
        h('input', {
          type: 'number', value: String(value), min: String(opts.min), max: String(opts.max), step: String(opts.step ?? 1),
          onchange: (ev) => { onChange(Number(ev.target.value)); bump(); },
        }),
        hint ? h('span', { class: 'dim', text: hint }) : null,
      ]);

      const W = cfg.window;
      const L = cfg.layout;
      const B = cfg.ball;
      const WALL = cfg.wallpaper;

      /* 两栏：左边全是控件，右边是**粘性预览**——选色的时候不用来回上下滚。
         （用户报过："我选色的时候居然要上下滑动才能看预览效果"，这一条就是为它改的。） */
      const left = [];
      const rail = [];

      left.push(h('div', { class: 'card' }, [
          h('h3', {}, [
            '来源　',
            A.source === 'preset'
              ? h('span', { class: 'pill on', text: `当前预设的脚本「${A.scriptName}」` })
              : h('span', { class: 'pill warn', text: `内置面板模板 ${PANEL_DEMO.version}（这份预设里没有带配置块的面板脚本）` }),
            A.dirty ? h('span', { class: 'pill warn', text: '有未应用的改动' }) : null,
          ]),
          h('div', { class: 'checkline' }, [
            h('b', { text: '能改什么　' }),
            '颜色（白天/夜间各一套）· 悬浮球大小与字形 · 窗口默认尺寸与上下限 · 圆角 · 字号 · 整体缩放 · 窗口不透明度与磨砂 · 面板壁纸。',
          ]),
          h('div', { style: { marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
            h('button', { class: 'btn', text: (preset() && PE.panelScriptViews(state.edit, preset().json, preset().model).length) ? '应用到面板脚本' : '记下配置', onclick: applyAppearance }),
            /* 「装进这份预设」只在**这份预设里真的没有**我们的面板脚本时才给：
               判定要用实时检测，不能用 A.source——那是"面板外观"状态刚建立时的来源，
               导入新预设后不会重算，于是会出现"提示让你用『应用到面板脚本』、
               按钮上却写着『装进这份预设』"这种自相矛盾的界面。 */
            (preset() && PE.panelScriptViews(state.edit, preset().json, preset().model).length) ? null : h('button', {
              class: 'btn', text: '装进这份预设', title: '把面板脚本写进这份预设的扩展里（之后就能一起导出）',
              onclick: () => { const s = attachPanel(); if (s) banner('已把面板装进预设：外观 + 分组都写进去了。去「导出新预设」生成文件。', 'ok'); },
            }),
            h('button', { class: 'btn ghost', text: '导出面板脚本 .js', onclick: downloadPanelJs }),
            h('button', { class: 'btn ghost', text: '导出独立预览页', onclick: downloadPreviewPage, title: '一个可以双击打开的 HTML：真跑面板本体，带你现在这套配置' }),
            h('button', { class: 'btn ghost', text: '从当前面板重新读取', onclick: () => { state.appearance = null; bump(); } }),
          ]),
          A.applied ? h('div', { class: 'checkline', style: { marginTop: '6px' } }, [
            h('span', { class: 'pill on', text: '已应用' }),
            h('span', { class: 'dim', text: '　去「导出新预设」把它导出成文件。' }),
          ]) : null,
      ]));

      /* 标题单独一张卡、放在最前面：它是"这个面板是谁的"唯一辨识处。
         藏在观感最底下的时候，装到别的预设上就会看到面板自称"芳乃"——这个坑真踩过。 */
      const titleField = h('input', {
        type: 'text', class: 'nameinput', value: cfg.title ?? '',
        placeholder: `留空 = 用这份预设的名字（${presetName()}）`,
        onchange: (ev) => { cfg.title = ev.target.value; appearanceMarkDirty(); bump(); },
      });
      left.push(h('div', { class: 'card' }, [
          h('h3', {}, ['面板标题　',
            h('span', { class: 'pill' + (A.dirty ? ' warn' : ' on'), text: `现在显示：${panelTitle()}` })]),
          h('div', { class: 'checkline' }, [
            h('b', { text: '这是面板顶上那行字　' }),
            '面板装在谁的预设上就写谁的名字。留空不算"没有标题"——那会让面板显示它源码里自带的那句'
            + '（芳乃那句），装到别的预设上就是错的；所以导出时留空会替你落成这份预设的名字。',
          ]),
          h('div', { style: { marginTop: '10px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, [
            titleField,
            h('button', {
              class: 'btn tiny ghost', text: '用这份预设的名字',
              onclick: () => { cfg.title = ''; appearanceMarkDirty(); bump(); banner(`标题留空 = 用「${presetName()}」——画布、预览与真面板都会显示它。`, 'ok'); },
            }),
          ]),
      ]));
      /* 颜色：带取色器（含带透明度的那些） */
      left.push(h('div', { class: 'card' }, [
        h('h3', {}, ['颜色　', h('span', { class: 'dim', text: '白天/夜间各一套；带透明度的项给的是「取色器 + 透明度」两个控件；留空 = 出厂色' })]),
        table([{ label: '这一项控制什么' }, { label: '白天' }, { label: '夜间' }], PC.TOKEN_SPEC.map(colorRow)),
      ]));
        /* 尺寸与观感 */
      left.push(h('div', { class: 'card' }, [
          h('h3', { text: '悬浮球' }),
          h('div', { class: 'kpis' }, [
            numField('直径 px', B.size, { min: 28, max: 96 }, (v) => { cfg.ball.size = v; }, '手机上建议 ≥40'),
            h('label', { class: 'numfield' }, [
              h('span', { text: '形状' }),
              h('select', {
                onchange: (ev) => { cfg.ball.shape = ev.target.value; bump(); },
              }, [
                ['circle', '圆形'], ['square', '方形'], ['rounded', '圆角方'],
                ['diamond', '菱形'], ['triangle', '三角形'], ['hexagon', '六边形'],
              ].map(([v, label]) => h('option', { value: v, selected: (B.shape || 'circle') === v, text: label }))),
            ]),
            h('label', { class: 'numfield' }, [
              h('span', { text: '球上是' }),
              h('select', {
                onchange: (ev) => {
                  /* B.content 可能不存在（预设里嵌的是旧版面板脚本，那时没有这个字段）——
                     所以一律从兜底结构上改，避免抛错把整张卡片连同"直径 px"一起弄没。 */
                  const prev = (B && B.content) || {};
                  cfg.ball.content = { kind: ev.target.value, image: String(prev.image || '') };
                  bump();
                },
              }, [
                ['text', '字'], ['image', '图片'],
              ].map(([v, label]) => h('option', { value: v, selected: ((B && B.content && B.content.kind) || 'text') === v, text: label }))),
            ]),
            h('label', { class: 'numfield' }, [
              h('span', { text: '球上的字' }),
              h('input', {
                type: 'text', class: 'nameinput', value: B.glyph, style: { width: '70px' },
                onchange: (ev) => { cfg.ball.glyph = ev.target.value; bump(); },
              }),
            ]),
            h('label', { class: 'numfield' }, [
              h('span', { text: '球上的图（本机图片）' }),
              h('input', {
                type: 'file', accept: 'image/*',
                onchange: (ev) => {
                  const f = ev.target.files && ev.target.files[0];
                  ev.target.value = '';
                  if (!f) return;
                  const fr = new FileReader();
                  fr.onload = () => {
                    const img = new Image();
                    img.onload = () => {
                      /* 缩到 ≤128px 再转 data URI：球最大 96px，128 够清晰又省体积 */
                      const k = Math.min(1, 128 / Math.max(img.width, img.height));
                      const cv = document.createElement('canvas');
                      cv.width = Math.max(1, Math.round(img.width * k));
                      cv.height = Math.max(1, Math.round(img.height * k));
                      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
                      const uri = cv.toDataURL('image/png');
                      cfg.ball.content = { kind: 'image', image: uri };
                      const kb = Math.round(uri.length / 1024);
                      banner(`球上图片已换：${cv.width}×${cv.height}，写进预设约 ${kb}KB（原图 ${Math.round(f.size / 1024)}KB）。`
                        + '图片是**本机那张压进预设的**，不依赖外网。', kb > 300 ? 'err' : 'ok');
                      bump();
                    };
                    img.onerror = () => banner('这张图读不出来，换一张试试。', 'err');
                    img.src = String(fr.result);
                  };
                  fr.onerror = () => banner('读文件失败。', 'err');
                  fr.readAsDataURL(f);
                },
              }),
            ]),
          ]),
          h('p', { class: 'viewdesc', text: '形状六种；球上可以放字或图片。图片走"本机图 → 压到 128px → 写进预设"这条自包含路线（不依赖外网），代价是预设体积里多几十 KB。球在酒馆里可拖动、Ctrl+Shift+F 整块隐藏（隐藏默认不落盘，刷新就回来）。' }),
      ]));
      left.push(h('div', { class: 'card' }, [
          h('h3', { text: '窗口' }),
          h('div', { class: 'kpis' }, [
            numField('默认宽', W.w, { min: 200, max: 4000 }, (v) => { cfg.window.w = v; }),
            numField('默认高', W.h, { min: 160, max: 4000 }, (v) => { cfg.window.h = v; }),
            numField('最小宽', W.minW, { min: 140, max: 2000 }, (v) => { cfg.window.minW = v; }),
            numField('最小高', W.minH, { min: 100, max: 2000 }, (v) => { cfg.window.minH = v; }),
            numField('最大宽', W.maxW, { min: 0, max: 4000 }, (v) => { cfg.window.maxW = v; }, '0 = 不限'),
            numField('最大高', W.maxH, { min: 0, max: 4000 }, (v) => { cfg.window.maxH = v; }, '0 = 不限'),
          ]),
          h('div', { class: 'dim', style: { marginTop: '6px' }, text: '这些是"你拖动窗口"时的默认值与边界；酒馆里拖过的位置和尺寸仍然会记住。' }),
      ]));
      /* 尺寸与观感 */
      left.push(h('div', { class: 'card' }, [
          h('h3', { text: '观感' }),          h('div', { class: 'kpis' }, [
            numField('圆角 px', L.radius, { min: 0, max: 40 }, (v) => { cfg.layout.radius = v; }),
            numField('字号倍率', L.fontScale, { min: 0.7, max: 1.8, step: 0.05 }, (v) => { cfg.layout.fontScale = v; }, '只放大字，不动间距'),
            numField('整体缩放', L.scale, { min: 0.6, max: 2, step: 0.05 }, (v) => { cfg.layout.scale = v; }, '字号+间距一起缩'),
            numField('不透明度', L.opacity, { min: 0.15, max: 1, step: 0.05 }, (v) => { cfg.layout.opacity = v; }, '1 = 不透'),
            numField('磨砂模糊 px', L.blur, { min: 0, max: 40 }, (v) => { cfg.layout.blur = v; }),
          ]),
          h('div', { class: 'dim', style: { marginTop: '8px' }, text: '标题在上面那张卡里。' }),
      ]));
      /* 交互：长按条目改正文（面板 0.5.0 起的能力）。
         显示值走 clampConfig（夹取后的生效值，缺键/脏值都有默认），
         写入走 setLongPress：老面板的 CONFIG 里没有 edit，这一步会把它建出来。 */
      const ED = PC.clampConfig(cfg).edit.longPress;
      const setLongPress = (patch) => {
        if (!cfg.edit || typeof cfg.edit !== 'object') cfg.edit = {};
        const cur = cfg.edit.longPress && typeof cfg.edit.longPress === 'object' ? cfg.edit.longPress : {};
        cfg.edit.longPress = { ...cur, ...patch };
        appearanceMarkDirty();
        bump();
      };
      left.push(h('div', { class: 'card' }, [
          h('h3', {}, ['交互　',
            ED.enabled ? h('span', { class: 'pill on', text: '长按看/改正文：开' }) : h('span', { class: 'pill off', text: '长按看/改正文：关' })]),
          h('div', { class: 'checkline' }, [
            h('b', { text: '在酒馆里长按条目　' }),
            '按住面板上任一条目（多选开关行、单选下拉下面那行、只读区的名字）就打开它的正文编辑器，改完点保存——和其它操作一样只写回预设一次。',
          ]),
          h('div', { class: 'kpis' }, [
            h('label', { class: 'numfield' }, [
              h('span', { text: '长按改正文' }),
              h('input', {
                type: 'checkbox', checked: ED.enabled,
                onchange: (ev) => setLongPress({ enabled: ev.target.checked }),
              }),
              h('span', { class: 'dim', text: '关掉就整个手势都不存在（面板上也不会提"长按"两个字）' }),
            ]),
            numField('长按时长 ms', ED.ms, { min: 250, max: 1500, step: 50 }, (v) => setLongPress({ ms: v }), '按这么久算长按；移动超过 8px 就取消'),
          ]),
          h('p', { class: 'viewdesc', text: '判定规则：按住不动才算长按；手机上一滑动就是"在滚动"，不会误触；长按触发后紧跟着的那次点击会被吞掉，所以不会顺手把条目开关掉。酒馆的注入位标记（聊天记录/角色卡/世界书这些位置标记）长按只给看——它们的正文必须为空，写进去会让对应内容进不了上下文。' }),
      ]));
      /* 壁纸 */
      left.push(h('div', { class: 'card' }, [
          h('h3', {}, ['壁纸　', WALL.url ? h('span', { class: 'pill on', text: '已设置' }) : h('span', { class: 'pill off', text: '没用壁纸' })]),
          h('div', { class: 'checkline' }, [
            h('b', { text: '只作用在面板上　' }),
            '不动酒馆页面本身——整页换背景是另一件事（那是酒馆主题/插件的活），风险也更大。',
          ]),
          h('div', { class: 'addform' }, [
            h('label', { class: 'btn' }, [
              h('input', {
                type: 'file', accept: 'image/*', hidden: true,
                onchange: (ev) => { readWallpaper(ev.target.files?.[0]); ev.target.value = ''; },
              }),
              '选择本机图片…',
            ]),
            h('input', {
              type: 'text', class: 'nameinput mono', value: /^data:/.test(WALL.url) ? '（已内嵌本机图片）' : WALL.url,
              placeholder: '或粘贴一个图片链接 https://…', readOnly: /^data:/.test(WALL.url) ? true : null,
              onchange: (ev) => { if (!/^data:/.test(WALL.url)) { cfg.wallpaper.url = ev.target.value.trim(); bump(); } },
            }),
            WALL.url ? h('button', { class: 'btn tiny ghost', text: '清除壁纸', onclick: () => { cfg.wallpaper.url = ''; bump(); } }) : null,
          ]),
          WALL.url && /^data:/.test(WALL.url) ? h('div', { class: 'dim', style: { marginTop: '6px' },
            text: `图片约 ${(PC.estimateDataUrlBytes(WALL.url) / 1024).toFixed(0)} KB，内嵌进预设后大约 ${(WALL.url.length / 1024).toFixed(0)} KB —— 预设会因此变大。` }) : null,
          h('div', { class: 'kpis', style: { marginTop: '10px' } }, [
            h('label', { class: 'numfield' }, [
              h('span', { text: '铺法' }),
              h('select', {
                onchange: (ev) => { cfg.wallpaper.fit = ev.target.value; bump(); },
              }, PC.FIT.map((f) => h('option', { value: f, selected: WALL.fit === f, text: { cover: '铺满（裁切）', contain: '完整显示', repeat: '平铺' }[f] }))),
            ]),
            numField('壁纸不透明度', WALL.opacity, { min: 0, max: 1, step: 0.05 }, (v) => { cfg.wallpaper.opacity = v; }),
            numField('壁纸模糊 px', WALL.blur, { min: 0, max: 40 }, (v) => { cfg.wallpaper.blur = v; }),
            numField('压暗', WALL.dim, { min: 0, max: 0.95, step: 0.05 }, (v) => { cfg.wallpaper.dim = v; }, '壁纸太花就调大'),
            h('label', { class: 'numfield' }, [
              h('span', { text: '压暗颜色' }),
              h('input', { type: 'color', value: toHex(WALL.dimColor), onchange: (ev) => { cfg.wallpaper.dimColor = ev.target.value; bump(); } }),
            ]),
          ]),
      ]));

      /* 右侧粘性栏：预览 + 校验，跟着滚，选色时一直看得见 */
      rail.push(h('div', { class: 'card' }, [
        h('h3', {}, ['预览（面板真样式 + 你现在这套配置）　',
          h('button', {
            class: 'btn tiny', text: A.night ? '看白天' : '看夜间',
            onclick: () => { A.night = !A.night; renderAll(); },
          }),
        ]),
        h('div', { class: 'fp-preview', id: 'fp-preview' }, buildPreviewDom(cfg, themes, A)),
        h('div', { class: 'fp-preview-note', text: '预览框里的深色渐变是模拟酒馆页面，用来看半透明与壁纸的效果；悬浮球与窗口在真酒馆里是可拖动的。' }),
      ]));
      if (check.errors.length || check.warnings.length) {
        rail.push(h('div', { class: 'card', 'data-level': check.errors.length ? 'err' : 'warn' }, [
          h('h3', {}, ['配置检查　',
            check.errors.length ? h('span', { class: 'pill err', text: `${check.errors.length} 项错误` }) : h('span', { class: 'pill on', text: '没有错误' }),
            check.warnings.length ? h('span', { class: 'pill warn', text: `${check.warnings.length} 项提醒` }) : null,
          ]),
          ...[...check.errors, ...check.warnings].map((x) => h('div', { class: 'warnrow', 'data-level': check.errors.includes(x) ? 'err' : 'warn' }, [
            h('span', { class: 'tag', text: x.kind }), h('span', { text: x.text }),
          ])),
        ]));
      }
      return [
        ...title('面板外观',
          '调的是**面板自己**的样子：颜色、悬浮球、窗口尺寸、圆角、字号、缩放、不透明度和壁纸。'
          + '预览用的是面板自己的样式表（不是另画一个像的），并且**跟着滚**——选颜色时不用来回上下翻。'),
        h('div', { class: 'appeargrid' }, [
          h('div', { class: 'appearleft' }, left),
          h('div', { class: 'previewrail' }, rail),
        ]),
      ];
    },

    /* ── M6 面板分组 ─────────────────────────────────────────────── */
    groups(m) {
      const p = preset();
      if (!p || !GI) return [...title('面板分组', '先载入一份预设。')];
      const A = ensureAppearance();
      const draft = state.groupsDraft;
      const check = draft ? GI.validateGroups(draft, m) : { errors: [], warnings: [] };
      const names = m.entries.filter((e) => e.listed).map((e) => e.name).filter(Boolean);
      const nameSet = new Set(names);

      const sectionsOf = (d) => {
        const seen = [];
        for (const g of d.groups) {
          const s = g.__section || '未分节';
          if (!seen.includes(s)) seen.push(s);
        }
        return seen;
      };

      const groupCard = (g, i) => {
        const bad = (g.members || []).filter((n) => !nameSet.has(n));
        return h('div', { class: 'card', 'data-level': bad.length ? 'err' : 'info' }, [
          h('h3', {}, [
            h('span', { class: 'pill ' + (g.mode === 'fixed' ? 'slot' : g.mode === 'editable' ? 'warn' : 'on'), text: g.mode }),
            ' ',
            h('input', {
              type: 'text', class: 'nameinput', value: g.label, style: { width: '260px', display: 'inline-block' },
              onchange: (ev) => { g.label = ev.target.value; bump(); },
            }),
            ' ',
            h('span', { class: 'dim', text: `${(g.members || []).length} 条` }),
          ]),
          h('div', { class: 'addform' }, [
            h('label', { class: 'numfield' }, [
              h('span', { text: '模式' }),
              h('select', {
                onchange: (ev) => { g.mode = ev.target.value; bump(); },
              }, ['single', 'multi', 'fixed', 'editable', 'hidden'].map((mo) => h('option', {
                value: mo, selected: g.mode === mo,
                text: { single: '选一（互斥）', multi: '可多选', fixed: '只读（面板不碰）', editable: '可填输入框', hidden: '隐藏' }[mo],
              }))),
            ]),
            h('label', { class: 'numfield' }, [
              h('span', { text: '分节' }),
              h('select', {
                onchange: (ev) => { g.__section = ev.target.value === '__new' ? (prompt('新分节的名字') || g.__section || '未分节') : ev.target.value; bump(); },
              }, sectionsOf({ groups: draft.groups }).concat(['__new']).map((s) => h('option', {
                value: s, selected: (g.__section || '未分节') === s, text: s === '__new' ? '＋ 新分节…' : s,
              }))),
            ]),
            h('button', { class: 'btn tiny', text: '↑', onclick: () => { moveGroup(draft, i, -1); bump(); } }),
            h('button', { class: 'btn tiny', text: '↓', onclick: () => { moveGroup(draft, i, 1); bump(); } }),
            h('button', {
              class: 'btn tiny ghost', text: '删除模块',
              onclick: () => { draft.groups.splice(i, 1); bump(); },
            }),
          ]),
          h('div', { class: 'checkline' }, [h('b', { text: '说明　' }), h('span', { class: 'dim', text: g.note || '（没有说明）' })]),
          h('div', { class: 'memberlist' }, (g.members || []).map((n) => h('span', { class: 'chip', 'data-bad': nameSet.has(n) ? '0' : '1', title: nameSet.has(n) ? '' : '这个名字在这份预设里找不到' }, [
            n,
            h('b', {
              text: '✕', title: '移出模块',
              onclick: () => { g.members = g.members.filter((x) => x !== n); ensureEditableMap(draft, i, g); bump(); },
            }),
          ]))),
          h('div', { class: 'addform', style: { marginTop: '8px' } }, [
            h('select', {
              onchange: (ev) => {
                const v = ev.target.value;
                if (!v) return;
                g.members = (g.members || []).concat([v]);
                ensureEditableMap(draft, i, g);
                ev.target.value = '';
                bump();
              },
            }, [h('option', { value: '', text: '＋ 加条目…' })].concat(
              names.filter((n) => !(g.members || []).includes(n)).map((n) => h('option', { value: n, text: n })),
            )),
            bad.length ? h('span', { class: 'pill err', text: `${bad.length} 个名字不在预设里` }) : null,
          ]),
        ]);
      };

      return [
        ...title('面板分组',
          '这一页决定**面板上出现哪些模块、每个模块管哪些条目**。面板是按**条目名**匹配的，所以名字必须和预设里完全一致。'
          + '点心「按这份预设自动推断」可以从变量关系推出一版草稿，再自己改。'),
        h('div', { class: 'card' }, [
          h('h3', {}, ['这份面板现在用哪套分组　',
            draft
              ? h('span', { class: 'pill warn', text: `草稿：${draft.groups.length} 个模块（还没应用）` })
              : h('span', { class: 'pill on', text: '面板自带的分组' }),
          ]),
          h('div', { class: 'checkline' }, [
            h('b', { text: '什么时候需要改它　' }),
            '把这份面板换到**另一份预设**上时。面板自带的分组按的是它原来那份预设的条目名，'
            + '换一份就会列出一堆找不到的条目。推断一遍就能对上那份预设。',
          ]),
          h('div', { style: { marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
            h('button', { class: 'btn', text: '按这份预设自动推断', onclick: inferNow }),
            h('button', { class: 'btn ghost', text: '加入所有条目（兜底草稿）', onclick: () => { state.groupsDraft = draftAll(m); markDraftBaseline(); bump(); } }),
            h('button', { class: 'btn ghost', text: '清空草稿（回到面板自带）', onclick: () => { state.groupsDraft = null; state.groupsDraftBaseline = null; bump(); } }),
            h('button', { class: 'btn', text: (preset() && PE.panelScriptViews(state.edit, preset().json, preset().model).length) ? '应用到面板脚本' : '装进这份预设', onclick: applyGroups }),
          ]),
          h('div', { class: 'dim', style: { marginTop: '8px' }, text: '应用/装进只替换面板脚本里那段「分组覆盖」，代码一行不动。' }),
        ]),
        (check.errors.length || check.warnings.length) ? h('div', { class: 'card', 'data-level': check.errors.length ? 'err' : 'warn' }, [
          h('h3', {}, ['分组检查　',
            check.errors.length ? h('span', { class: 'pill err', text: `${check.errors.length} 项错误` }) : h('span', { class: 'pill on', text: '没有错误' }),
            check.warnings.length ? h('span', { class: 'pill warn', text: `${check.warnings.length} 项提醒` }) : null,
          ]),
          ...[...check.errors, ...check.warnings].slice(0, 14).map((x) => h('div', { class: 'warnrow', 'data-level': check.errors.includes(x) ? 'err' : 'warn' }, [
            h('span', { class: 'tag', text: x.kind }), h('span', { text: x.text }),
          ])),
        ]) : null,
        draft ? h('div', { class: 'card' }, [
          h('div', { class: 'addform' }, [
            h('input', { type: 'text', class: 'nameinput', id: 'new-group-name', placeholder: '新模块名字', style: { flex: '1 1 200px' } }),
            h('button', {
              class: 'btn', text: '＋ 新建模块',
              onclick: () => {
                const name = ($('new-group-name').value || '').trim() || '新模块';
                draft.groups.push({ id: 'g' + Date.now().toString(36), label: name, mode: 'multi', note: '', members: [], __section: '未分节' });
                bump();
              },
            }),
            h('span', { class: 'dim', text: `共 ${draft.groups.length} 个模块 / 分节 ${sectionsOf(draft).length} 个` }),
          ]),
        ]) : null,
        ...(draft ? draft.groups.map(groupCard) : [
          h('div', { class: 'card' }, h('div', { class: 'empty', text: '现在用的是面板自带的分组。点上面的「按这份预设自动推断」生成一版草稿。' })),
        ]),
        /* 分节的顺序也照草稿显示一遍，让人看清最终长什么样 */
        draft ? h('div', { class: 'card' }, [
          h('h3', { text: '面板上会长成这样（分节 → 模块）' }),
          ...sectionsOf(draft).map((s) => h('div', { class: 'checkline' }, [
            h('b', { text: s + '　' }),
            h('span', { class: 'dim', text: draft.groups.filter((g) => (g.__section || '未分节') === s).map((g) => `${g.label}(${g.mode})`).join('、') }),
          ])),
        ]) : null,
      ];
    },

    scripts(m) {
      return [
        ...title('内嵌脚本', '跟着预设一起分发的酒馆助手脚本。它们能改预设、改消息、加界面——也是"看不见的依赖"。'),
        m.scripts.length ? m.scripts.map((s) => h('div', { class: 'card' }, [
          h('h3', {}, [
            s.name, ' ',
            h('span', { class: 'pill ' + (s.enabled ? 'on' : 'off'), text: s.enabled ? '启用' : '停用' }),
            s.cdn ? h('span', { class: 'pill warn', text: '含外部链接' }) : null,
          ]),
          h('div', { class: 'kpis' }, [
            h('div', { class: 'kpi' }, [h('b', { text: fmt(s.chars) }), h('span', { text: '字符' })]),
            h('div', { class: 'kpi' }, [h('b', { text: String(s.buttons.length) }), h('span', { text: '按钮' })]),
            h('div', { class: 'kpi' }, [h('b', { text: s.hasData ? '有' : '无' }), h('span', { text: '附带 data 配置' })]),
          ]),
          s.buttons.length ? h('div', { class: 'dim', text: '按钮：' + s.buttons.join('、') }) : null,
        ])) : h('div', { class: 'card' }, h('div', { class: 'empty', text: '没有内嵌脚本。' })),
      ];
    },
  };

  function warnRow(w) {
    return h('div', { class: 'warnrow', 'data-level': w.level }, [
      h('span', { class: 'tag', text: w.kind }),
      h('span', { text: w.text }),
    ]);
  }

  /* ── M2 体检视图 ────────────────────────────────────────────────── */
  function checkupItem(it) {
    return h('div', { class: 'card', 'data-level': it.level }, [
      h('h3', {}, [
        h('span', { class: 'pill ' + (it.level === 'err' ? 'err' : it.level === 'warn' ? 'warn' : 'slot'), text: PI.LEVEL_LABEL[it.level] }),
        ' ',
        it.title,
      ]),
      h('div', { class: 'checkline' }, [h('b', { text: '为什么　' }), it.why]),
      h('div', { class: 'checkline' }, [h('b', { text: '怎么改　' }), it.fix]),
      it.evidence.length ? h('div', { class: 'checkev' }, [
        h('b', { text: '依据' }),
        h('ul', {}, it.evidence.map((e) => h('li', { text: e }))),
      ]) : null,
    ]);
  }

  /** 复制待办：file:// 下 navigator.clipboard 不一定可用，所以还给一个"下载 .md"的退路 */
  function copyChecklist() {
    const m = model();
    const rep = runCheckup();
    if (!rep) return;
    const md = PI.toMarkdown(rep, m);
    const ok = () => banner('待办清单已复制到剪贴板。', 'ok');
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(md).then(ok, () => banner('复制被浏览器拦了，用右边「下载清单 .md」吧。', 'warn'));
        return;
      }
    } catch { /* 落到下面的兜底 */ }
    const ta = document.createElement('textarea');
    ta.value = md;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let done = false;
    try { done = document.execCommand('copy'); } catch { done = false; }
    ta.remove();
    if (done) ok(); else banner('复制被浏览器拦了，用右边「下载清单 .md」吧。', 'warn');
  }

  function downloadChecklist() {    const m = model();
    const rep = runCheckup();
    if (!rep) return;
    const blob = new Blob([PI.toMarkdown(rep, m)], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = m.file.replace(/\.json$/i, '') + '-待办清单.md';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    banner('清单已下载。', 'ok');
  }

  function segCard(s) {
    const open = s.kind === 'prompt' && !s.note;
    const body = h('div', { class: 'segbody' }, [
      s.kind === 'prompt' ? h('pre', { text: s.text || '(展开后为空)' }) : h('div', { class: 'dim', text: s.note }),
    ]);
    const head = h('div', {
      class: 'seghead',
      onclick: () => { seg.dataset.open = seg.dataset.open === '1' ? '0' : '1'; },
    }, [
      h('span', { class: 'name', text: s.name }),
      s.slot ? h('span', { class: 'pill slot', text: s.slotLabel }) : null,
      s.role ? h('span', { class: 'pill', text: s.role }) : null,
      h('span', { class: 'dim', text: `${fmt(s.chars)} 字` }),
      s.note ? h('span', { class: 'pill warn', text: s.note }) : null,
    ]);
    const seg = h('div', { class: 'seg', 'data-kind': s.kind, 'data-open': open ? '1' : '0' }, [head, body]);
    return seg;
  }

  /* ── 渲染 ─────────────────────────────────────────────────────── */
  function renderAll() {
    /* 先记住滚动位置：`.content` 是滚动容器，而这里是**清空再重建**，
       清空那一瞬间内容高度归零，滚动位置就被夹到 0 了 ——
       表现就是"点了编辑，页面自己跳回最上方"（用户报过）。
       所以画完必须把位置还回去。 */
    const scrollers = [$('view'), document.querySelector('.content'), document.querySelector('.nav')]
      .filter((n) => n && typeof n.scrollTop === 'number');
    const saved = scrollers.map((n) => n.scrollTop);

    const m = model();
    renderNav();
    const view = clear($('view'));
    if (!m) {
      view.appendChild(h('div', { class: 'card' }, [
        h('h3', { text: '还没有载入预设' }),
        h('p', { class: 'viewdesc', text: '用右上角「导入预设…」选一份酒馆预设 JSON（可以多选），或者点下面的按钮载入自带的演示数据。' }),
        h('button', { class: 'btn', text: '载入演示数据（Izumi）', onclick: loadDemo }),
      ]));
      $('foot-stats').textContent = '未载入';
      return;
    }
    (() => {
      const fn = VIEW_RENDER[state.view] || VIEW_RENDER.start;
      for (const node of fn(m)) if (node) view.appendChild(node);
    })();
    /* 画完把滚动位置还回去（顺序：先还内容，再还外层） */
    scrollers.forEach((n, i) => { try { n.scrollTop = saved[i]; } catch { /* 忽略 */ } });
    const r = runAssemble();
    const rep = runCheckup();
    const dirty = state.edit && PE.structuralDirty(state.edit);
    const tag = preset().generated ? '（工具生成的骨架）' : (dirty ? '（已改结构）' : '');
    $('foot-stats').textContent = `${m.file}${tag}　条目 ${m.counts.prompts}　开启 ${m.counts.enabled}　拼装 ≈${fmt(r.tokenEstimate)} token　诊断 ${m.warnings.filter((w) => w.level === 'err').length}错/${m.warnings.filter((w) => w.level === 'warn').length}提示`
      + (rep ? `　体检 必改 ${rep.counts.err}/建议 ${rep.counts.warn}` : '');
  }

  function renderPick() {
    const sel = clear($('preset-pick'));
    if (!state.presets.length) { sel.appendChild(h('option', { text: '（无）' })); return; }
    state.presets.forEach((p, i) => sel.appendChild(h('option', { value: String(i), selected: i === state.active, text: p.file })));
  }

  /* ── ⟳ 软刷新（不重载文档）───────────────────────────────────────
     它解决的问题：跑完某个重活（大列表、预览 iframe、连着重画很多次）之后页面变迟钝。
     解法是**把当前这一屏重新挂一遍**——#view / #nav 本来就是"清空再建"，重建之后
     节点、事件、预览 iframe 全是新的，攒下来的界面残渣跟着一起没了。

     为什么不用 location.reload()：这个页面的状态**全在内存里**——导入的预设
     （可能是几 MB 的 JSON）、M3/M5/M6 的编辑草稿、以及一堆"打了字但还没失焦提交"
     的输入框（不少字段是 onchange 才写回 state 的）。真刷新一次全没，而且 boot()
     还会顺手把演示数据顶上来，看着就像"我的预设丢了"。所以这里刻意不重载，
     只做一件事：把活输入框里的值先抄下来 → 重画 → 再填回去。

     代价要说清：没重载就清不掉 JS 堆，它治的是"界面层的卡"，
     治不了"某段代码把主线程占死了"——那种情况按钮自己也点不动。 */

  /** 记输入框路径的根。两份根分别记，因为重画的就是这两块 */
  const fieldRoots = () => [$('view'), document.querySelector('.top')].filter(Boolean);

  /** 要连滚动位置一起保住的容器（#view 与 .content 是同一个节点，去重） */
  function scrollers() {
    const list = [$('view'), document.querySelector('.nav'), document.querySelector('.canvaswrap .fp-body')].filter(Boolean);
    return list.filter((n, i) => list.indexOf(n) === i);
  }

  const isField = (el) => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
  const nowMs = () => (globalThis.performance && performance.now ? performance.now() : Date.now());

  /** 从 root 数到 node 的 childNodes 下标链；node 不在 root 里就返回 null */
  function nodePath(root, node) {
    const path = [];
    let cur = node;
    while (cur && cur !== root) {
      const parent = cur.parentNode;
      if (!parent) return null;
      path.unshift(Array.prototype.indexOf.call(parent.childNodes, cur));
      cur = parent;
    }
    return cur === root ? path : null;
  }

  function nodeAt(root, path) {
    let cur = root;
    for (const i of path) { cur = cur.childNodes[i]; if (!cur) return null; }
    return cur;
  }

  /** 把活输入框的当前状态抄下来（含"打了字还没失焦"的，那正是要救的东西） */
  function captureFields() {
    const out = [];
    fieldRoots().forEach((root, ri) => {
      for (const el of root.querySelectorAll('input, textarea, select')) {
        if (el.type === 'file') continue;          /* 文件框的值抄不走，抄了也没用 */
        const path = nodePath(root, el);
        if (!path) continue;
        const boxed = el.type === 'checkbox' || el.type === 'radio';
        out.push({
          root: ri, path, tag: el.tagName, type: el.type || '',
          value: boxed ? null : el.value,
          checked: boxed ? el.checked : null,
          sel: typeof el.selectionStart === 'number' ? [el.selectionStart, el.selectionEnd] : null,
          focused: document.activeElement === el,
        });
      }
    });
    return out;
  }

  /** 填回去。路径对不上（标签/类型不一样）就跳过——宁可少填一个，也不往错的框里写字 */
  function restoreFields(saved) {
    const roots = fieldRoots();
    let n = 0;
    for (const s of saved) {
      const root = roots[s.root];
      if (!root) continue;
      const el = nodeAt(root, s.path);
      if (!isField(el) || el.tagName !== s.tag || (el.type || '') !== s.type) continue;
      if (s.value !== null) el.value = s.value;
      if (s.checked !== null) el.checked = s.checked;
      if (s.sel && typeof el.setSelectionRange === 'function') {
        try { el.setSelectionRange(s.sel[0], s.sel[1]); } catch { /* number/color 这类没有选区，忽略 */ }
      }
      if (s.focused) { try { el.focus({ preventScroll: true }); } catch { /* 忽略 */ } }
      n++;
    }
    return n;
  }

  /** 干活的同步版本：抄 → 清横幅 → 重画 → 填回+还原滚动。返回 { fields, ms } */
  function runSoftRefresh() {
    const t0 = nowMs();
    let fields = [];
    try { fields = captureFields(); } catch { fields = []; }
    const scrolls = scrollers().map((n) => n.scrollTop);

    banner('');        /* 上一轮的提示先清掉，否则"刷新了"和旧消息混在一起，看不出哪句是新的 */
    renderPick();      /* 顶栏那个下拉也重画一遍，保证它和视图是同一份状态 */
    renderAll();

    /* renderAll() 自己会把 #view/.content/.nav 的位置还回去，但"视图内部的滚动容器"
       （比如面板画布 .fp-body）它不管 —— 这里补齐。 */
    let back = 0;
    try {
      const again = scrollers();
      again.forEach((n, i) => { if (typeof scrolls[i] === 'number') n.scrollTop = scrolls[i]; });
      back = restoreFields(fields);
    } catch { /* 填不回去也不能让"刷新"本身失败——它至少已经把视图重挂过了 */ }
    return { fields: back, ms: Math.max(0, Math.round(nowMs() - t0)) };
  }

  /** 按钮那一路：先置忙让浏览器画一帧，再干活。setTimeout 而非 rAF——
      rAF 在后台标签页会被冻结，那样按钮会一直卡在"刷新中"。 */
  function softRefresh() {
    const btn = $('btn-refresh');
    if (btn) { btn.disabled = true; btn.textContent = '⟳ 刷新中…'; }
    setTimeout(() => {
      try {
        const r = runSoftRefresh();
        banner(`已刷新页面显示：当前这一屏重挂了一遍${r.fields ? `，${r.fields} 个输入框里的内容原样填回` : ''}（${r.ms} ms）。`
          + '预设和编辑草稿始终在内存里，没有被重新载入。', 'ok');
      } catch (e) {
        banner('刷新时出错：' + (e && e.message ? e.message : e), 'err');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = '⟳ 刷新'; }
      }
    }, 0);
  }

  function loadDemo() {
    const demo = globalThis.__DEMO_PRESETS__ || [];
    if (!demo.length) {
      /* 这条不是"坏了"，而是**故意的**：公开仓库只发工具与文档，演示数据是从预设正文
         生成的，所以不在仓库里（见 NOTICE.md / samples/README.md）。
         直接导入自己的预设就能用，所以这里给一句能照做的话，而不是一个红叉。 */
      banner('没有演示数据（工具照样能用）：本仓库不随附预设正文，演示数据也就没有生成。'
        + '点右上角「导入预设…」选一份你自己的酒馆预设即可；'
        + '想要演示数据，按 samples/README.md 放好夹具后跑 node tools/build-gui-demo.mjs。', 'ok');
      return;
    }
    state.presets = [];
    for (const d of demo) state.presets.push({ file: d.file, bytes: d.bytes, json: d.json, model: PP.parsePreset(d.json, d.file, d.bytes) });
    state.active = 0;
    resetEdits();
    renderPick(); renderAll();
    banner(`已载入演示数据「${demo[0].file}」。左边 M0 解析、M1 拼装、M2 体检，M3 那组可以改结构并导出。`, 'ok');
  }

  /* ── M4 生成骨架 ───────────────────────────────────────────────── */
  function generateSkeleton() {
    const d = state.skeletonDraft ?? { name: '我的预设', base: '', modules: [], custom: 0 };
    const base = d.base === '' ? null : state.presets[Number(d.base)] ?? null;
    const built = PS.buildSkeleton({ name: d.name, base, moduleIds: d.modules, customCount: d.custom });
    const model = PP.parsePreset(built.json, built.name + '.json', 0);
    /* 位置标记的 idx 由解析结果反查 */
    const markerIdxs = model.entries.filter((e) => PS.MARKER_SLOT_IDS.includes(e.identifier)).map((e) => e.idx);
    state.presets.push({
      file: built.name + '.json', bytes: 0, json: built.json, model,
      generated: true, markerIdxs,
    });
    state.active = state.presets.length - 1;
    resetEdits();
    state.view = 'editor';
    renderPick();
    renderAll();
    banner(`已生成骨架「${built.name}」：${built.counts.prompts} 条（${built.counts.markers} 个位置标记开着，其余默认关）。
            现在去「框架编辑」里逐条写正文——正文得你自己写。`.replace(/\s+/g, ' '), 'ok');
  }

  /* ── M6 面板分组：草稿、推断、应用 ─────────────────────────────── */

  /** 面板脚本里那段"分组覆盖"；没有就返回 null（= 面板自带那套） */
  function currentGroupOverride() {
    const A = ensureAppearance();
    const src = A.source === 'preset' ? A.content : (PANEL_DEMO?.source ?? '');
    try { return PC.extractGroups(src); } catch { return null; }
  }

  /** 把推断结果变成可编辑草稿（给每个模块补一个 __section，界面用它排分节） */
  function draftFromInference(inf) {
    const sectionOf = new Map();
    for (const s of inf.sections) for (const id of s.groups) sectionOf.set(id, s.title);
    return {
      groups: inf.groups.map((g) => ({ ...g, members: [...(g.members || [])], __section: sectionOf.get(g.id) || '未分节' })),
      thinkingTags: inf.thinkingTags || [],
      display: inf.display || {},
      source: 'inferred',
    };
  }

  function inferNow() {
    const p = preset();
    const m = model();
    if (!p || !m || !GI) return;
    const inf = GI.inferGroups(m, p.json);
    state.groupsDraft = draftFromInference(inf);
    state.groupsNotes = inf.notes;
    markDraftBaseline();          // 推断出来的不算"你搭的"——你得动手改它才算
    bump();
    banner(`已推断出 ${inf.groups.length} 个模块（管理 ${inf.stats.managed} 条条目）。名字都是猜的，点开逐个改。`, 'ok');
  }

  /** 兜底草稿：把所有条目塞进一个模块（推断不出来时至少能用） */
  function draftAll(m) {
    const names = m.entries.filter((e) => e.listed && e.name).map((e) => e.name);
    return {
      groups: [{ id: 'all', label: '全部条目', mode: 'multi', note: '兜底草稿：所有条目都在一个模块里，自己拆。', members: names, __section: '全部' }],
      thinkingTags: [],
      display: {},
      source: 'manual',
    };
  }

  function moveGroup(draft, i, delta) {
    const j = i + delta;
    if (j < 0 || j >= draft.groups.length) return;
    const [g] = draft.groups.splice(i, 1);
    draft.groups.splice(j, 0, g);
  }

  /** editable 模块的 editable 映射要跟着 members 走（面板靠它渲染输入框） */
  function ensureEditableMap(draft, i, g) {
    if (g.mode !== 'editable') return;
    const map = {};
    for (const n of g.members || []) map[n] = (g.editable?.[n]) || { hint: '这条要你填内容。' };
    g.editable = map;
  }

  /** 草稿 → 写进面板的形状（去掉 __section，重建 sections） */
  function normalizeOverride(draft) {
    const groups = draft.groups.map((g) => {
      const clean = { ...g };
      const sec = clean.__section;
      delete clean.__section;
      if (clean.mode === 'editable') {
        const map = {};
        for (const n of clean.members || []) map[n] = clean.editable?.[n] || { hint: '这条要你填内容。' };
        clean.editable = map;
      } else {
        delete clean.editable;
      }
      clean.__sec = sec;
      return clean;
    });
    const sections = [];
    for (const g of groups) {
      const title = g.__sec || '未分节';
      let s = sections.find((x) => x.title === title);
      if (!s) { s = { title, groups: [] }; sections.push(s); }
      s.groups.push(g.id);
    }
    for (const g of groups) delete g.__sec;
    return {
      groups,
      sections,
      thinkingTags: draft.thinkingTags || [],
      display: draft.display || {},
    };
  }

  /** 当前面板源码 + 外观配置 + 分组覆盖（除非传 false） */
  function panelSourceWithEdits(withGroups = true) {
    const A = ensureAppearance();
    let src = A.source === 'preset' ? A.content : (PANEL_DEMO?.source ?? '');
    /* 标题落成具体的字（没填就用预设名）——见 panelTitle() 的注释：
       留空会让真面板显示它自带那句兜底文案，与画布不一致。 */
    src = PC.patchConfig(src, { ...A.config, title: panelTitle() });
    if (withGroups && state.groupsDraft) src = PC.patchGroups(src, normalizeOverride(state.groupsDraft));
    return src;
  }

  /** 把面板写进当前预设的扩展里（这份预设本来没有面板脚本时用） */
  function attachPanelFrom(src) {
    const p = preset();
    if (!p || !PE) return null;
    /* 已经有一份就别再塞第二份：两份面板脚本会同时跑，桌面上会出现两个悬浮球 */
    const existing = PE.panelScriptViews(state.edit, p.json, p.model)[0];
    if (existing) {
      banner(`这份预设里已经有面板脚本了（「${existing.name}」）——用「应用到面板脚本」更新它，别装第二份。`, 'warn');
      state.appearance = null;
      bump();
      return null;
    }
    const s = PE.addScript(state.edit, p.json, { name: presetName() + ' · 面板', content: src, id: 'preset-panel' });
    state.appearance = null;          // 重新读：现在这份预设里已经有面板脚本了
    state.groupsAttached = true;
    state.panelIgnored = null;
    state.panelStaleIgnored = null;
    bump();
    return s;
  }

  function attachPanel() {
    const p = preset();
    if (!p || !PE) return null;
    if (PE.panelScriptViews(state.edit, p.json, p.model).length) return attachPanelFrom('');  // 撞车时会自己报警并返回 null
    let src;
    try { src = panelSourceWithEdits(); } catch (e) { banner('生成面板脚本失败：' + e.message, 'err'); return null; }
    return attachPanelFrom(src);
  }

  /**
   * 把「外观」和「分组」两边的改动**一次性**写进面板脚本。
   *
   * 两处按钮共用这一条路：分开写的话很容易只应用一半——先改颜色、又去改分组，
   * 只点了其中一个按钮，另一半就留在界面里没进文件（导出检查会拦住，但不该先制造它）。
   */
  function applyPanelEdits({ quiet = false } = {}) {
    const p = preset();
    if (!p || !PE || !PC) { banner('先载入一份预设。', 'err'); return null; }
    let src;
    try { src = panelSourceWithEdits(); } catch (e) { banner('生成面板脚本失败：' + e.message, 'err'); return null; }
    const hit = PE.panelScriptViews(state.edit, p.json, p.model)[0];
    if (!hit) {
      const s = attachPanelFrom(src);
      if (s && !quiet) banner('这份预设本来没有面板脚本——已把面板（含你这套外观与分组）装进预设的扩展里。去「导出新预设」生成文件。', 'ok');
      return s;
    }
    PE.setScriptField(state.edit, p.json, hit.ref, 'content', src);
    const A = ensureAppearance();
    /* 写进脚本的标题同时写回界面状态：两边说的必须是同一句话，
       否则「面板标题」那个输入框会一直显示空白，而面板早就有名字了。 */
    A.config = { ...A.config, title: panelTitle() };
    A.content = src;
    A.baseline = JSON.stringify(A.config);
    A.dirty = false;
    A.applied = true;
    state.panelIgnored = null;
    state.panelStaleIgnored = null;
    markDraftBaseline();          // 刚写进去的这份草稿已经"落地"了，不再是待应用状态
    bump();
    if (!quiet) banner('已把外观与分组写进面板脚本（只替换配置与分组那两段，面板代码一行不动）。去「导出新预设」生成文件。', 'ok');
    return hit;
  }

  function applyGroups() {
    if (!state.groupsDraft) { banner('还没有草稿——先点「按这份预设自动推断」。', 'err'); return; }
    applyPanelEdits();
  }

  /**
   * 一键补救：把预设里那份**旧面板**换成新版面板脚本。
   *
   * 只换代码，保住"你的设置"：CONFIG（外观，标题落成具体的字）与 GROUPS_OVERRIDE（分组）。
   * 之所以要这一步：面板是**脚本**，预设里嵌的是那一刻的快照——旧预设里带着的是旧面板，
   * 于是"我明明改了、你却说还是不行"（面板升级了，旧预设里那份却不会跟着变）。
   * 旧脚本里除这两段之外的东西搬不过去（那是另一版实现），换之前界面上会说清楚。
   */
  function upgradePanelScript() {
    const p = preset();
    if (!p || !PE || !PC || !PANEL_DEMO?.source) { banner('面板源码没载入（先跑 node tools/build-gui-demo.mjs）。', 'err'); return null; }
    const hit = PE.panelScriptViews(state.edit, p.json, p.model)[0];
    if (!hit) { banner('这份预设里没有面板脚本——先去「面板外观」点「装进这份预设」。', 'err'); return null; }
    let src;
    try {
      src = PE.upgradePanelContent(hit.content, PANEL_DEMO.source, { title: panelTitle() });
    } catch (e) { banner('换成新版面板失败：' + e.message, 'err'); return null; }
    PE.setScriptField(state.edit, p.json, hit.ref, 'content', src);
    state.appearance = null;        // 重新读一遍：现在脚本是新的了
    state.panelStaleIgnored = null;
    bump();
    banner('已把面板脚本换成新版（你改过的外观与分组都带过去了）。去「导出新预设」生成文件。', 'ok');
    return src;
  }

  /**
   * 把文本里的 HTML 渲染出来看效果（正则改的常常是 `<details>` / `<div>` 这类东西，
   * 只给转义后的纯文本等于没让人看见"渲染成什么样"）。
   *
   * 安全：先把 script / iframe / on* 事件 / javascript: 链接剔掉再插进 DOM。
   * 内容来自使用者自己的预设，但"能执行脚本"这个可能性本身就不该留着——
   * 这个页面是本地 file:// 打开的，出错没有任何隔离层。
   */
  function sanitizeHtml(html) {
    /* EJS 模板（提示词模板扩展）在这里没法执行，也没必要假装能——
       把它换成看得见的占位，免得渲染预览里出现一堆被浏览器当成注释/未知标签吃掉的东西。 */
    const src = String(html ?? '').replace(/<%[-_=]?([\s\S]*?)[-_]?%>/g, (m, code) =>
      `<span class="ejs-chip" title="模板代码，由提示词模板扩展在发送前渲染">‹模板: ${String(code).trim().slice(0, 40)}›</span>`);
    const tpl = document.createElement('template');
    tpl.innerHTML = src;
    const drop = ['script', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form'];
    for (const tag of drop) for (const n of [...tpl.content.querySelectorAll(tag)]) n.remove();
    for (const n of [...tpl.content.querySelectorAll('*')]) {
      for (const attr of [...n.attributes]) {
        const name = attr.name.toLowerCase();
        const val = String(attr.value || '');
        if (name.startsWith('on')) { n.removeAttribute(attr.name); continue; }
        if ((name === 'href' || name === 'src' || name === 'xlink:href') && /^\s*(javascript|data:text\/html)/i.test(val)) {
          n.removeAttribute(attr.name);
        }
      }
    }
    return tpl.innerHTML;
  }

  /* ── 搭建：草稿与画布 ───────────────────────────────────────────── */

  /**
   * 画布要画的分组。
   * · 有草稿（推断过 / 改过）→ 用草稿
   * · 没草稿 → 用**面板自带的分组**（只读展示）；第一次编辑动作会把它复制成草稿，
   *   这样"看渲染"和"搭预设"是同一个面，而不是两个入口。
   */
  function canvasState() {
    if (state.groupsDraft) return { draft: state.groupsDraft, editable: true, auto: state.groupsDraftAuto };
    const A = ensureAppearance();
    const src = A.source === 'preset' ? A.content : (PANEL_DEMO?.source ?? '');
    let defaults = { groups: [], sections: [], thinkingTags: [], display: {} };
    try { defaults = PC.extractDefaults(src); } catch { /* 用空的 */ }

    /* 关键一步：面板自带的那些分组是按**它原来那份预设**的条目名写的。
       换一份预设（或者这份预设本来就没面板）时，照着它画只会画出一堆"找不到的条目"——
       所以先量一下对得上多少，对不上就**直接按当前预设推断一版**当起点。
       这就是"导入任何预设 → 自动长出一个面板"真正落地的地方。 */
    const m = model();
    const names = new Set((m?.entries ?? []).map((e) => e.name).filter(Boolean));
    const all = defaults.groups.flatMap((g) => (g.mode === 'bundle'
      ? (g.options || []).flatMap((o) => o.members || [])
      : (g.members || [])));
    const hit = all.filter((n) => names.has(n)).length;
    const ratio = all.length ? hit / all.length : 0;

    if (defaults.groups.length && ratio < 0.5 && GI && m) {
      const inf = GI.inferGroups(m, preset()?.json);
      state.groupsDraft = draftFromInference(inf);
      state.groupsDraftKey = preset()?.file || '';
      state.groupsDraftAuto = true;
      state.groupsNotes = inf.notes;
      markDraftBaseline();        // 自动推断只负责"摆出来给你看"，别拿它去拦人导出
      return { draft: state.groupsDraft, editable: true, auto: true, defaultsMismatch: { hit, total: all.length } };
    }
    return { draft: BO.seedFrom(defaults), editable: false, auto: false, defaultsCount: defaults.groups.length };
  }

  /** 第一次编辑动作：把"面板自带的分组"复制成草稿并记下来 */
  function ensureDraft() {
    if (state.groupsDraft) { state.groupsDraftKey = preset()?.file || ''; return state.groupsDraft; }
    state.groupsDraft = canvasState().draft;
    state.groupsDraftKey = preset()?.file || '';
    state.groupsDraftSeeded = true;
    markDraftBaseline();
    banner('已把面板自带的分组复制成一份可编辑草稿——原面板不动，改完点「应用到面板脚本 / 装进这份预设」才生效。', 'ok');
    return state.groupsDraft;
  }

  /**
   * 给草稿拍一张"程序自己摆出来的样子"的快照。
   *
   * 用途只有一个：区分**你看了一眼**和**你真的搭了**。
   * 自动推断/兜底草稿/清空成空面板都是工具自己摆出来的——用户只是打开了那一屏，
   * 这时候导出被拦住就是"管得太宽"（拦一个什么都没做的人）。
   * 加过/删过/改过名字之后草稿与快照不同，那才算"你在搭面板"。
   */
  function markDraftBaseline() {
    state.groupsDraftBaseline = state.groupsDraft ? JSON.stringify(state.groupsDraft) : null;
  }

  /** 这份草稿被用户动过吗（不是程序刚摆出来的那份样子） */
  function draftTouched() {
    if (!state.groupsDraft) return false;
    if (state.groupsDraftBaseline == null) return true;      // 没拍过快照 = 当动过（保守）
    try { return JSON.stringify(state.groupsDraft) !== state.groupsDraftBaseline; } catch { return true; }
  }

  /** 这份预设叫什么（用文件名去掉扩展名；没有就用电↔默认） */
  function presetName() {
    const p = preset();
    if (!p) return '预设';
    return String(p.file || '').replace(/\.json$/i, '') || p.file || '预设';
  }

  /**
   * 面板顶上那行字：`CONFIG.title` 优先，没写就用**这份预设的名字**——
   * 不写死任何一个预设的名字，也**绝不留空**。
   *
   * 留空是个陷阱（真踩过）：写进脚本的 title 是空的时候，面板本体自己有一句兜底文案
   * （面板源码里那句「🌸 芳乃 · 预设面板」），于是画布上显示的是"这份预设的名字"、
   * 装进酒馆却显示另一句——把面板装到别的预设上就是明摆着的错。
   * 所以**写进预设时一律把标题落成具体的字**，让画布、预览、真面板三处一致。
   *
   * 留空分两种情况（见 extractFallbackTitle 的注释）：
   *   · 预设**自带**的面板留空 → 那是面板作者的意图，用源码里那句兜底文案；
   *   · 生成器**新装进**别人预设的面板 → 用那份预设的名字（装到谁家就写谁的名字）。
   */
  function panelTitle() {
    const A = ensureAppearance();
    const typed = (A.config?.title ?? '').trim();
    if (typed) return typed;
    if (A.source === 'preset' && A.sourceFallbackTitle) return A.sourceFallbackTitle;
    return presetName();
  }

  /** 生成一个不撞车的条目名（新功能项 / 新选项用它） */
  function freshEntryName(base) {
    const used = new Set(model().entries.map((e) => e.name));
    let i = 1;
    while (used.has(`${base} ${i}`)) i++;
    return `${base} ${i}`;
  }

  /** 加一个功能项 / 功能选项：**新建一个空条目**并挂进这个功能区 */
  function buildAddItem(groupId, asOption) {
    const draft = ensureDraft();
    const p = preset();
    const name = freshEntryName(asOption ? '新选项' : '新功能');
    const a = PE.addEntry(state.edit, p.model, { name, slot: '' });
    BO.addMember(draft, groupId, a.name);
    state.rev++;
    renderAll();
    banner(`已新建条目「${a.name}」（正文留空标「待填」、默认关着）并挂进这个功能区。去「框架编辑」的「你写的正文」里填内容。`, 'ok');
    return a;
  }

  /** 把**已经存在**的条目挂进功能区（不新建） */
  function buildAttachExisting(groupId, name) {
    const draft = ensureDraft();
    BO.addMember(draft, groupId, name);
    state.rev++;
    renderAll();
  }

  function freshGroupLabel(draft) {
    let i = 1;
    while (draft.groups.some((g) => g.label === `新功能区 ${i}`)) i++;
    return `新功能区 ${i}`;
  }

  /** 新建一个功能区 */
  function buildAddGroup(section) {
    const draft = ensureDraft();
    const g = BO.addGroup(draft, { section, mode: 'multi', label: freshGroupLabel(draft) });
    state.rev++;
    renderAll();
    banner(`已在「${section}」下加了功能区「${g.label}」——接着点它的「＋功能项」往里加条目。`, 'ok');
    return g;
  }

  /* ── 搭建：画布渲染 ─────────────────────────────────────────────── */

  /** 画布 = 面板真样式 + 可点的三层结构（分节 → 功能区 → 功能项） */
  function buildCanvasDom() {
    const A = ensureAppearance();
    const { draft, editable, defaultsCount } = canvasState();
    const clamped = PC.clampConfig(A.config);
    const style = h('style', { text: previewStyle(A.config, A.themes, A.css) });
    const sel = state.buildSel || { kind: 'none' };
    const isSel = (kind, id, member) => sel.kind === kind && sel.id === id && (member === undefined || sel.member === member);
    const pick = (kind, id, member) => (ev) => { ev.stopPropagation(); state.buildSel = { kind, id, member }; renderAll(); };

    const groupRow = (g) => {
      const gSel = isSel('group', g.id);
      const head = h('div', {
        class: 'fp-modhead',
        style: gSel ? { outline: '2px solid var(--accent)', outlineOffset: '-2px' } : {},
        onclick: pick('group', g.id),
      }, [
        h('span', { class: 'fp-modlabel', text: g.label }),
        h('span', { class: 'fp-modstate', text: `${({ single: '选一', multi: '可多选', fixed: '只读', editable: '自己填', bundle: '骨架', hidden: '隐藏' })[g.mode] || g.mode} · ${((g.members) || []).length} 条` }),
      ]);
      const body = h('div', { class: 'fp-modbody' });
      if (g.mode === 'single' || g.mode === 'bundle') {
        body.appendChild(h('select', { class: 'fp-select' }, ((g.members) || []).map((m) => h('option', { text: m }))));
      } else if (g.mode === 'editable') {
        for (const m of g.members || []) {
          body.appendChild(h('div', { class: 'fp-editrow', onclick: pick('member', g.id, m) }, [
            h('div', { class: 'fp-note', text: m }),
            /* 用**面板自己的输入框样式**（.fp-textarea）：这样"输入框底色"这一项
               在画布上调什么，装进酒馆就是什么——不然画布上是工具自己的灰框子，骗人。 */
            h('textarea', { class: 'fp-textarea', rows: 2, readOnly: true, value: (g.editable?.[m]?.hint) || '（要你自己填内容）' }),
          ]));
        }
      } else {
        const chips = h('div', { class: 'fp-chips' });
        for (const m of g.members || []) {
          chips.appendChild(h('span', { class: 'fp-sw', 'data-on': isSel('member', g.id, m) ? '1' : '0', onclick: pick('member', g.id, m) }, [h('i', { text: '·' }), m]));
        }
        if (!(g.members || []).length) chips.appendChild(h('span', { class: 'fp-note', text: '（这个功能区还没有条目）' }));
        body.appendChild(chips);
      }
      body.appendChild(h('div', { class: 'buildbar' }, [
        h('button', { class: 'btn tiny', text: '＋功能项', title: '新建一个条目挂到这里（正文留空待填）', onclick: (e) => { e.stopPropagation(); buildAddItem(g.id, false); } }),
        h('button', { class: 'btn tiny', text: '＋功能选项', title: '再加一个互斥选项（同样新建一个条目）', onclick: (e) => { e.stopPropagation(); buildAddItem(g.id, true); } }),
        h('button', { class: 'btn tiny ghost', text: '↑', onclick: (e) => { e.stopPropagation(); ensureDraft(); BO.moveGroup(state.groupsDraft, g.id, -1); state.rev++; renderAll(); } }),
        h('button', { class: 'btn tiny ghost', text: '↓', onclick: (e) => { e.stopPropagation(); ensureDraft(); BO.moveGroup(state.groupsDraft, g.id, 1); state.rev++; renderAll(); } }),
        h('button', { class: 'btn tiny ghost', text: '删除', onclick: (e) => { e.stopPropagation(); ensureDraft(); BO.removeGroup(state.groupsDraft, g.id); state.rev++; renderAll(); } }),
      ]));
      return h('div', { class: 'fp-mod', 'data-sel': gSel ? '1' : '0', draggable: 'true', 'data-gid': g.id }, [head, body]);
    };

    const body = h('div', { class: 'fp-body' }, []);
    for (const sec of BO.sectionsOf(draft)) {
      const secSel = isSel('section', sec);
      body.appendChild(h('div', {
        class: 'fp-seclabel',
        style: secSel ? { outline: '2px solid var(--accent)', outlineOffset: '-2px', cursor: 'pointer' } : { cursor: 'pointer' },
        title: '点一下改这个分节',
        onclick: pick('section', sec),
      }, sec));
      for (const g of draft.groups.filter((x) => (x.__section || '未分节') === sec)) body.appendChild(groupRow(g));
      body.appendChild(h('div', { class: 'buildbar' }, [
        h('button', { class: 'btn tiny ghost', text: '＋在这个分区里加功能区', onclick: () => buildAddGroup(sec) }),
      ]));
    }
    if (!draft.groups.length) body.appendChild(h('div', { class: 'fp-warnbox', text: '这个面板还是空的：点下面的「＋新建分区」开始搭。' }));

    const win = h('div', { class: 'fp-win', style: { width: Math.min(clamped.window.w, 560) + 'px', height: (state.canvasHeight || 620) + 'px' } }, [
      h('div', { class: 'fp-bglayer' }),
      PC.hasWallpaper(clamped) ? h('div', { class: 'fp-wall', 'data-fit': clamped.wallpaper.fit, style: { backgroundImage: `url("${clamped.wallpaper.url.replace(/"/g, '%22')}")` } }) : null,
      PC.hasWallpaper(clamped) ? h('div', { class: 'fp-walldim' }) : null,
      h('div', { class: 'fp-head' }, [
        h('div', { class: 'fp-title' }, [panelTitle(), h('small', { text: editable ? '搭建中（草稿）' : `面板自带的分组（${defaultsCount} 个功能区）` })]),
        h('div', { class: 'fp-icon', text: A.night ? '☀' : '🌙', onclick: () => { A.night = !A.night; renderAll(); } }),
        h('div', { class: 'fp-icon', text: '—' }),
        h('div', { class: 'fp-icon', text: '✕' }),
      ]),
      body,
    ]);

    return h('div', { class: 'fp-root', 'data-theme': A.night ? 'night' : 'day' }, [
      style,
      (() => {
        /* 预览里的球要跟真面板一个样子：形状靠内联样式（预览页没有面板那套 CSS），图片铺满球 */
        const b = clamped.ball;
        const SHAPE = {
          circle: { borderRadius: '50%' }, square: { borderRadius: '2px' }, rounded: { borderRadius: '26%' },
          diamond: { clipPath: 'polygon(50% 0,100% 50%,50% 100%,0 50%)' },
          triangle: { clipPath: 'polygon(50% 4%,98% 94%,2% 94%)' },
          hexagon: { clipPath: 'polygon(25% 4%,75% 4%,100% 50%,75% 96%,25% 96%,0 50%)' },
        };
        const bc = (b && b.content) || {};
        const kids = bc.kind === 'image' && bc.image
          ? [h('img', { class: 'fp-ball-img', src: b.content.image, style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } })]
          : [b.glyph];
        return h('div', { class: 'fp-launch', style: SHAPE[b.shape] || SHAPE.circle }, kids);
      })(),
      win,
    ]);
  }

  /* ── M5 面板外观：状态与预览 ───────────────────────────────────── */
  /**
   * 外观编辑态。来源有两种：
   *   · 当前预设里带了配置块的面板脚本 → 改它的 content（走正常导出路径）
   *   · 没有 → 用构建期发过来的内置面板模板（只能导出 .js / 预览页）
   * 这是"能不能改到真东西"的分界线，所以界面上明说了是哪种。
   */
  function ensureAppearance() {
    const p = preset();
    const key = p ? p.file : '(未载入)';
    if (state.appearance && state.appearance.key === key) return state.appearance;

    let source = 'template';
    let scriptIdx = -1;
    let scriptRef = -1;
    let scriptName = '';
    let sourceFallbackTitle = '';
    let content = PANEL_DEMO?.source ?? '';
    if (p && PC && PE && state.edit) {
      const views = PE.scriptViews(state.edit, p.json, p.model);
      const hit = views.find((v) => v.content.includes(PC.BEGIN));
      if (hit) {
        source = 'preset'; scriptIdx = hit.idx; scriptRef = hit.ref; scriptName = hit.name; content = hit.content;
        /* 面板**本来就长在这份预设里**（不是这次装进去的）时，源码那句兜底标题才算数——
           否则"生成器新装进别人预设的面板"会拿芳乃那句当自己的名字。 */
        if (!hit.isNew) sourceFallbackTitle = PC.extractFallbackTitle ? PC.extractFallbackTitle(content) : '';
      }
    }
    /* 读配置时一律**按出厂形状补齐**：预设里那份面板可能是旧版（或者干脆是别人那支），
       它的 CONFIG 块里没有后来才加的键（antitrunc / button / edit……）。
       原样拿来当配置用的话，界面上一读新键就抛异常——整页白掉。
       （真实踩过：导入一份自带旧面板的预设，点「面板外观」直接
        `Cannot read properties of undefined (reading 'longPress')`。）
       mergeConfig 会把 DEFAULT_CONFIG 里每一个键都补齐，所以下面那些
       `cfg.window` / `cfg.edit` 直接取字段是安全的。 */
    let config;
    if (PC) {
      let raw = null;
      try { raw = PC.extractConfig(content); } catch { /* 读不出来就用模板那份 */ }
      config = PC.mergeConfig(PC.DEFAULT_CONFIG, raw || PANEL_DEMO?.config || {});
    } else {
      config = PANEL_DEMO?.config || {};
    }
    const themes = (PC && PC.extractThemes(content)) || PANEL_DEMO?.themes || { day: {}, night: {} };
    const css = (PC && PC.extractCss(content)) || PANEL_DEMO?.css || '';
    const A = {
      key, source, scriptIdx, scriptRef, scriptName, sourceFallbackTitle, config, themes, css,
      baseline: JSON.stringify(config), dirty: false, applied: false, night: false, content,
    };
    state.appearance = A;
    return A;
  }

  function appearanceMarkDirty() {
    const A = state.appearance;
    if (!A) return;
    A.dirty = JSON.stringify(A.config) !== A.baseline;
    A.applied = false;
  }

  function setToken(tier, key, value) {
    const A = ensureAppearance();
    A.config.tokens = A.config.tokens ?? { day: {}, night: {} };
    A.config.tokens[tier] = { ...(A.config.tokens[tier] ?? {}) };
    if (value === '' || value === null || value === undefined) delete A.config.tokens[tier][key];
    else A.config.tokens[tier][key] = value;
    /* 你正在改哪一套，预览就切到哪一套——否则"改白天的颜色、预览停在夜间"会让人以为没生效 */
    A.night = tier === 'night';
    appearanceMarkDirty();
  }

  /** #abc / rgb() / rgba() → #rrggbb（只给 <input type=color> 用；认不出来就给个中性灰） */
  function toHex(v) {
    const s = String(v ?? '').trim();
    if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(s)) return ('#' + s.slice(1).split('').map((c) => c + c).join('')).toLowerCase();
    const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
    if (m) {
      const hx = (n) => Math.max(0, Math.min(255, Math.round(Number(n)))).toString(16).padStart(2, '0');
      return '#' + hx(m[1]) + hx(m[2]) + hx(m[3]);
    }
    return '#888888';
  }

  /** 颜色值 → {hex, a}（带透明度的项要拆成"颜色 + 透明度"两个控件） */
  function splitColor(v) {
    const s = String(v ?? '').trim();
    const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(s);
    if (m) {
      const a = m[4] === undefined ? 1 : (String(m[4]).endsWith('%') ? Number(String(m[4]).slice(0, -1)) / 100 : Number(m[4]));
      return { hex: toHex(s), a: Number.isFinite(a) ? Math.max(0, Math.min(1, a)) : 1 };
    }
    return { hex: toHex(s), a: 1 };
  }
  const composeRgba = (hex, a) => {
    const h = String(hex).replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const n = (i) => parseInt(full.slice(i, i + 2), 16) || 0;
    return `rgba(${n(0)}, ${n(2)}, ${n(4)}, ${Math.round(Number(a) * 100) / 100})`;
  };

  /**
   * 预览：**用面板自己的样式表**，只额外加一段"把 fixed 改成摆位"的作用域覆盖。
   * 面板的样式本来就是给悬浮窗写的（position:fixed + JS 算坐标），
   * 在预览框里必须改成相对定位，否则它会飞到整个页面上——这一点在界面上也说明了。
   */
  /**
   * 预览的样式 = **面板自己的 CSS** + 作用域覆盖 + CONFIG 变量 + 主题 token。
   *
   * 顺序很关键：面板 CSS 在前，覆盖与变量在后（同优先级下后者胜）。
   *
   * 这里曾经出过一个"看着对、其实全错"的 bug：早期版本只注入了 A_PREVIEW_SCOPE，
   * **根本没把面板 CSS 放进来**，于是预览里所有元素都没有样式，改颜色自然"看不出变化"。
   * 当时的断言查的是"CSS 文本里有没有这个颜色"（有）——查错了对象。
   * 现在 selftest 直接查**浏览器算出来的样式**（getComputedStyle）。
   */
    /* 预览的样式 = 面板自己的 CSS + 作用域覆盖 + CONFIG 变量 + 主题 token。
       顺序很关键：面板 CSS 在前，覆盖与变量在后（同优先级下后者胜）。 */
  /**
   * 预览/画布共用的样式：面板自己的 CSS + 你调出来的那套颜色变量。
   *
   * 变量要**两个作用域都发**：「面板外观」的预览栏是 `.fp-preview .fp-root`，
   * 「面板搭建」的画布是 `.canvaswrap .fp-root`（gui.css 把悬浮窗摆回文档流）。
   * 早先只发了前者，于是画布上的面板元素拿不到任何 `--fp-*`——颜色、输入框底色
   * 在画布上怎么调都不动（"改了没反应"就是这么来的）。
   */
  function previewStyle(cfg, themes, panelCss) {
    const clamped = PC.clampConfig(cfg);
    const day = { ...themes.day, ...(cfg.tokens?.day ?? {}) };
    const night = { ...themes.night, ...(cfg.tokens?.night ?? {}) };
    const tokens = (t) => Object.entries(t).map(([k, v]) => `${k}:${v};`).join('');
    const vars = Object.entries(PC.toCssVars(clamped)).map(([k, v]) => `${k}:${v};`).join('');
    const base = PC.scaleFontCss(PC.scaleCss(String(panelCss || ''), clamped.layout.scale), clamped.layout.fontScale);
    const scopes = ['.fp-preview .fp-root', '.canvaswrap .fp-root'];
    const vars4 = scopes.map((s) => `${s}{${vars}}\n`
      + `${s}[data-theme="day"]{${tokens(day)}}\n`
      + `${s}[data-theme="night"]{${tokens(night)}}\n`).join('');
    return base
      + PC.scaleCss(A_PREVIEW_SCOPE, clamped.layout.scale)
      + vars4;
  }

  const A_PREVIEW_SCOPE = `
/* 预览专用：把面板的 fixed 悬浮定位改成"摆在预览框里"。
   面板本体一个字都没改，真装到酒馆里仍然是可拖动的悬浮窗。 */
.fp-preview{position:relative;height:440px;border-radius:12px;overflow:hidden;
  border:1px solid var(--border-strong);
  background:linear-gradient(135deg,#2b2233 0%,#4a3b52 40%,#8a6f7d 100%);}
.fp-preview .fp-root{position:relative;width:auto;height:auto;pointer-events:auto;z-index:auto;
  background:transparent;overflow:visible}
.fp-preview .fp-launch{position:absolute;left:10px;bottom:26px;top:auto;cursor:default}
.fp-preview .fp-win{position:absolute;left:16px;top:14px;cursor:default;max-width:none;max-height:none}
.fp-preview .fp-win .fp-body{overflow:auto;max-height:none}
`;

  /** 预览的内容：用面板真实的类名摆内容，才看得出字号/间距/颜色 */
  function buildPreviewDom(cfg, themes, A) {
    const clamped = PC.clampConfig(cfg);
    const style = h('style', { text: previewStyle(cfg, themes, A?.css) });

    const icon = (ch) => h('div', { class: 'fp-icon', text: ch });
    const head = h('div', { class: 'fp-head' }, [
      h('div', { class: 'fp-title' }, [panelTitle(), h('small', { text: '预览' })]),
      icon(A.night ? '☀' : '🌙'),
      icon('—'),
      icon('✕'),
    ]);

    const modRow = (label, state2, body) => h('div', { class: 'fp-mod' }, [
      h('div', { class: 'fp-modhead' }, [
        h('span', { class: 'fp-modlabel', text: label }),
        h('span', { class: 'fp-modstate', text: state2 }),
      ]),
      body ? h('div', { class: 'fp-modbody' }, [h('div', { class: 'fp-modnote', text: body })]) : null,
    ]);

    /* 预览的模块行：能用**真实分组**就用真实的（这样看清"装上去之后面板管什么"），
       没有分组就用一份示意结构。 */
    let body;
    const ov = (() => {
      try { return state.groupsDraft ? normalizeOverride(state.groupsDraft) : currentGroupOverride(); } catch { return null; }
    })();
    if (ov && ov.groups && ov.groups.length) {
      const shown = ov.groups.filter((g) => g.mode !== 'hidden').slice(0, 4);
      body = h('div', { class: 'fp-body' }, [
        ...shown.map((g) => {
          const n = (g.members || []).length;
          const modeLabel = { single: '选一', multi: '可多选', fixed: '只读', editable: '自己填', bundle: '骨架' }[g.mode] || g.mode;
          if (g.mode === 'fixed') return modRow(g.label, `只读 · ${n} 条`, '面板不碰这一组。');
          if (g.mode === 'editable') return h('div', { class: 'fp-mod' }, [
            h('div', { class: 'fp-modhead' }, [h('span', { class: 'fp-modlabel', text: g.label }), h('span', { class: 'fp-modstate', text: `自己填 · ${n} 条` })]),
            h('div', { class: 'fp-modbody' }, [
              h('div', { class: 'fp-modnote', text: '示例输入框：' }),
              h('textarea', { class: 'fp-textarea', rows: 2, value: (g.members || [])[0] ? `（${g.members[0]} 的内容会显示在这里）` : '', readOnly: true }),
            ]),
          ]);
          return modRow(g.label, `${modeLabel} · ${n} 条`, (g.members || []).slice(0, 3).join('、'));
        }),
        ov.groups.length > shown.length ? h('div', { class: 'fp-modnote', text: `……还有 ${ov.groups.length - shown.length} 个模块` }) : null,
        ov.thinkingTags?.length ? h('div', { class: 'fp-warnbox', text: `思维链互斥组 ${ov.thinkingTags.length} 个：开一条会自动关掉同族其它条。` }) : null,
      ]);
    } else {
      body = h('div', { class: 'fp-body' }, [
        modRow('破甲（按模型分流）', 'Gemini · 已开', '这是示意结构——去「面板分组」推断一份属于这份预设的模块表。'),
        modRow('思维链 / 思考方式', 'ICOT（三段）', '两套标签互斥，只能选一个。'),
        h('div', { class: 'fp-rowhead', text: '自定义内容（自己填）' }),
        h('label', { class: 'fp-chk' }, [h('span', { text: '示例开关' }), h('span', { class: 'fp-note', text: '开' })]),
        h('select', { class: 'fp-select' }, [h('option', { text: '示例下拉项一' }), h('option', { text: '示例下拉项二' })]),
        h('div', { class: 'fp-warnbox', text: '示例警告条：某条被引用的条目不在预设里。' }),
      ]);
    }
    const foot = h('div', { class: 'fp-foot' }, [
      h('span', { class: 'fp-note', text: 'v' + (PANEL_DEMO?.version ?? '?') + '　·　' + (ov && ov.groups?.length ? `${ov.groups.length} 个模块` : '示意结构') }),
    ]);

    const win = h('div', { class: 'fp-win', style: { width: clamped.window.w + 'px', height: clamped.window.h + 'px' } }, [
      h('div', { class: 'fp-bglayer' }),
      PC.hasWallpaper(clamped) ? h('div', {
        class: 'fp-wall', 'data-fit': clamped.wallpaper.fit,
        style: { backgroundImage: `url("${clamped.wallpaper.url.replace(/"/g, '%22')}")` },
      }) : null,
      PC.hasWallpaper(clamped) ? h('div', { class: 'fp-walldim' }) : null,
      head, body, foot,
    ]);

    return h('div', { class: 'fp-root', 'data-theme': A.night ? 'night' : 'day' }, [
      style,
      (() => {
        /* 预览里的球要跟真面板一个样子：形状靠内联样式（预览页没有面板那套 CSS），图片铺满球 */
        const b = clamped.ball;
        const SHAPE = {
          circle: { borderRadius: '50%' }, square: { borderRadius: '2px' }, rounded: { borderRadius: '26%' },
          diamond: { clipPath: 'polygon(50% 0,100% 50%,50% 100%,0 50%)' },
          triangle: { clipPath: 'polygon(50% 4%,98% 94%,2% 94%)' },
          hexagon: { clipPath: 'polygon(25% 4%,75% 4%,100% 50%,75% 96%,25% 96%,0 50%)' },
        };
        const bc = (b && b.content) || {};
        const kids = bc.kind === 'image' && bc.image
          ? [h('img', { class: 'fp-ball-img', src: b.content.image, style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } })]
          : [b.glyph];
        return h('div', { class: 'fp-launch', style: SHAPE[b.shape] || SHAPE.circle }, kids);
      })(),
      win,
    ]);
  }

  /* ── M5 外观：应用与导出 ───────────────────────────────────────── */
  function applyAppearance() {
    const A = ensureAppearance();
    if (A.source === 'preset') { applyPanelEdits(); return; }
    A.baseline = JSON.stringify(A.config);
    A.dirty = false;
    A.applied = true;
    bump();
    banner('这份预设里没有面板脚本，所以配置先记在这里——点「装进这份预设」把它写进预设，或者用「导出面板脚本 .js」单独带走。', 'warn');
  }

  function downloadPanelJs() {
    let src;
    try {
      /* 走同一条路：标题落成具体的字 + 带上你搭的分组
         （单独带走的面板脚本当然该是你现在看到的这一份）。 */
      src = panelSourceWithEdits();
    } catch (e) {
      banner('生成面板脚本失败：' + e.message, 'err');
      return;
    }
    saveBlob(src, 'fano-panel-外观定制.js', 'text/javascript;charset=utf-8');
    banner('面板脚本已导出（含标题、外观与分组）。贴进酒馆助手的脚本内容里即可。', 'ok');
  }

  /** 按需加载一个本地 <script src>（file:// 下 fetch 会被拦，动态插 script 不会） */
  function loadScriptOnce(src) {
    if (!state._loaded) state._loaded = new Map();
    if (state._loaded.has(src)) return state._loaded.get(src);
    const pr = new Promise((resolve) => {
      const el2 = document.createElement('script');
      el2.src = src;
      el2.onload = () => resolve(true);
      el2.onerror = () => resolve(false);
      document.head.appendChild(el2);
    });
    state._loaded.set(src, pr);
    return pr;
  }

  function downloadPreviewPage() {
    if (!PANEL_DEMO?.source) { banner('没有面板快照，先跑 node tools/build-gui-demo.mjs。', 'err'); return; }
    let panelSrc;
    try { panelSrc = panelSourceWithEdits(); } catch (e) { banner('生成失败：' + e.message, 'err'); return; }
    const build = () => {
      const hostSrc = globalThis.__PREVIEW_HOST_SRC__;
      const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>${presetName()} · 面板外观预览</title>
<style>body{margin:0;min-height:100vh;background:linear-gradient(135deg,#2b2233,#4a3b52 40%,#8a6f7d);font-family:system-ui,sans-serif}
.hint{position:fixed;left:12px;top:10px;z-index:1;color:rgba(255,255,255,.6);font-size:12px;font-family:system-ui,sans-serif}</style>
</head><body>
<div class="hint">这是外观预览页：右下角悬浮球是真的面板本体，点开就是你调好的样子。</div>
${hostSrc ? '<script>' + hostSrc + '<\/script>' : ''}
<script>${panelSrc}<\/script>
</body></html>`;
      saveBlob(html, 'fano-panel-预览.html', 'text/html;charset=utf-8');
      banner(hostSrc
        ? '独立预览页已导出：双击打开就能看到真面板（带你这套配置）。'
        : '预览页已导出（没带假酒馆 API，所以面板里没有条目列表，但外观是真的）。', hostSrc ? 'ok' : 'warn');
    };
    if (globalThis.__PREVIEW_HOST_SRC__) { build(); return; }
    banner('正在准备假酒馆 API（第一次用要加载一下）…', 'ok');
    loadScriptOnce('demo/preview-host-demo.js').then((okLoad) => {
      if (!okLoad) banner('加载假酒馆 API 失败——可以先用「导出面板脚本 .js」。', 'err');
      build();
    });
  }

  function readWallpaper(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { banner('这不是图片文件。', 'err'); return; }
    const A = ensureAppearance();
    const fr = new FileReader();
    fr.onload = () => {
      A.config.wallpaper.url = String(fr.result);
      appearanceMarkDirty();
      bump();
      const kb = Number(fr.result.length) / 1024;
      banner(`壁纸已内嵌（${kb.toFixed(0)} KB）。注意它会写进预设，预设会跟着变大。`, kb > 400 ? 'warn' : 'ok');
    };
    fr.onerror = () => banner('读取图片失败。', 'err');
    fr.readAsDataURL(file);
  }

  function copyText(text, label) {
    const done = () => banner(`${label}已复制到剪贴板。`, 'ok');
    const fail = () => banner('复制被浏览器拦了，可以手动选中复制。', 'warn');
    try {
      if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(text).then(done, fail); return; }
    } catch { /* 落到兜底 */ }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let okDone = false;
    try { okDone = document.execCommand('copy'); } catch { okDone = false; }
    ta.remove();
    if (okDone) done(); else fail();
  }

  /* ── M3 导出动作 ───────────────────────────────────────────────── */
  function saveBlob(text, filename, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function exportJson() {
    const p = preset();
    const e = state.edit;
    if (!p || !e) { banner('先载入一份预设。', 'err'); return; }
    const c = runExportChecks();
    if (c.blocking.length) { banner(`还有 ${c.blocking.length} 项必改没处理（见导出前检查）。`, 'err'); return; }
    const out = PE.applyEdit(p.json, e, p.model);
    const text = JSON.stringify(out);
    saveBlob(text, p.file.replace(/\.json$/i, '') + '-改.json', 'application/json;charset=utf-8');
    banner(`已导出：${out.prompts.length} 条条目，${Math.round(text.length / 1024)} KB。`, 'ok');
  }

  function exportChangeReport() {
    const p = preset();
    const e = state.edit;
    if (!p || !e) { banner('先载入一份预设。', 'err'); return; }
    const c = runExportChecks();
    const intact = PE.verifySourceIntact(p.json, e, p.model, PP.fingerprint);
    const rep = runCheckup();
    const L = [];
    L.push(`# 结构改动报告：${p.file}`, '');
    L.push(`- 改动 ${PE.summary(e, p.model).length} 项`);
    L.push(`- 来源完整性：核对 ${intact.checked} 条来源条目的正文/role/注入位置，`
      + (intact.changed.length ? `异常 ${intact.changed.length} 条：${intact.changed.join('、')}` : '全部一字未改')
      + (intact.removed ? `（另显式删除 ${intact.removed} 条）` : ''), '');
    L.push('## 改动明细', '');
    for (const r of PE.summary(e, p.model)) L.push(`- **${r.kind}**：${r.text}`);
    if (!PE.summary(e, p.model).length) L.push('- （无）');
    L.push('', '## 导出前检查', '');
    for (const [label, list] of [['必改', c.blocking], ['提醒', c.warnings], ['提示', c.notes]]) {
      if (!list.length) continue;
      L.push(`### ${label}`, '');
      for (const x of list) L.push(`- **${x.kind}**：${x.text}`);
      L.push('');
    }
    if (rep) {
      L.push(`## 导出后的体检（必改 ${rep.counts.err} · 建议 ${rep.counts.warn} · 提示 ${rep.counts.info}）`, '');
      for (const it of rep.items) L.push(`- [${PI.LEVEL_LABEL[it.level]}] ${it.title}　→ ${it.fix}`);
      L.push('');
    }
    L.push('> 本工具只改结构（顺序/开关/增删条目/条目名），不代写也不改写任何提示词正文。', '');
    saveBlob(L.join('\n'), p.file.replace(/\.json$/i, '') + '-改动报告.md', 'text/markdown;charset=utf-8');
    banner('改动报告已导出。', 'ok');
  }

  /* ── 导出报告 ─────────────────────────────────────────────────── */
  function exportReport() {
    const m = model();
    if (!m) { banner('先载入一份预设。', 'err'); return; }
    const r = runAssemble();
    const lines = [];
    lines.push(`# 预设解析报告：${m.file}`, '');
    lines.push(`- 条目 ${m.counts.prompts}（在列表 ${m.counts.listed}，开启 ${m.counts.enabled}）`);
    lines.push(`- 开启正文 ${m.counts.enabledChars} 字；拼装合计 ${r.totalChars} 字 ≈ ${r.tokenEstimate} token`);
    lines.push(`- 变量 ${m.variables.length}　标签族 ${m.tagFamilies.length}　正则 ${m.regexes.length}　内嵌脚本 ${m.scripts.length}`, '');
    if (rep) {
      lines.push(`## 体检（必改 ${rep.counts.err} · 建议 ${rep.counts.warn} · 提示 ${rep.counts.info}）`, '');
      for (const level of ['err', 'warn', 'info']) {
        for (const it of rep.items.filter((x) => x.level === level)) {
          lines.push(`- [ ] **${it.title}**`);
          lines.push(`      - 为什么：${it.why}`);
          lines.push(`      - 怎么改：${it.fix}`);
          for (const e of it.evidence) lines.push(`      - 依据：${e}`);
        }
      }
      lines.push('');
    }
    lines.push('## 诊断', '');
    for (const w of m.warnings) lines.push(`- [${w.level}] ${w.kind}：${w.text}`);
    lines.push('', '## 槽位占用', '');
    for (const s of m.slots) lines.push(`- ${s.label}(${s.identifier})：${s.owners.map((o) => `${o.name}[${o.enabled ? '开' : '关'}]`).join('、')}${s.conflict ? ' ← 冲突' : ''}`);
    lines.push('', '## 变量总线', '');
    for (const v of m.variables) lines.push(`- ${v.name}：设 ${v.setBy.length} / 累加 ${v.addBy.length} / 读 ${v.getBy.length}${v.dangling ? ' ← 悬空' : ''}`);
    lines.push('', '## 分组建议', '');
    for (const s of m.suggestions) lines.push(`- [${s.mode}] ${s.id}：${s.reason}`);
    lines.push('', `> 生成时间 ${new Date().toLocaleString()}　指纹仅用于本地比对；"来源原文未改"由 tools/check-preset.mjs 用 sha1 校验。`, '');
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = m.file.replace(/\.json$/i, '') + '-解析报告.md';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    banner('报告已导出。', 'ok');
  }

  /* ── 页面自检（?selftest=1）───────────────────────────────────────
     让 GUI 自己成为可被 headless 浏览器验证的对象：跑一遍解析与拼装，
     把断言结果写进 #verdict，外部用 --dump-dom 取回。 */
  function runSelfTest() {
    const out = [];
    let pass = 0;
    const fails = [];
    const ok = (name, cond, detail) => {
      if (cond) { pass++; out.push('  PASS  ' + name); }
      else { fails.push(name); out.push('  FAIL  ' + name + (detail ? '   → ' + detail : '')); }
    };
    try {
      const demo = globalThis.__DEMO_PRESETS__ || [];
      /* 演示数据在不在，取决于"这份仓库有没有带预设正文"，**不是代码对不对**。
         所以缺了它不算失败，也不算通过，而是打印一行跳过：
         假绿（静默当通过）比红更危险，装红（明明不是错）同样让人白查一场。 */
      if (demo.length) ok('演示数据已载入', true, `${demo.length} 份`);
      else out.push('  SKIP  演示数据已载入 —— 本仓库不随附预设正文（见 NOTICE.md），这一层没有样本');
      /* 没有演示数据 = 有人克隆了公开仓库（或演示数据还没生成）。
         这时只跑与预设无关的那几条，其余明确跳过并说明去哪里补夹具。 */
      if (!demo.length) {
        noFixtureSelfTest(ok);
        out.push('');
        out.push('SKIP  依赖演示数据的全部断言（本层完整套的其余部分）——没有 tools/gui/demo/*.js 就无从跑起。');
        out.push('      想跑全套：按 samples/README.md 放好夹具，再 node tools/build-gui-demo.mjs；');
        out.push('      命令行那几套同理（node tools/test-gui.mjs 等会打印各自的 SKIP 与项数）。');
        return finishSelfTest(out, pass, fails);
      }
      const m = PP.parsePreset(demo[0].json, demo[0].file, demo[0].bytes);
      ok('解析出条目', m.counts.prompts > 100, String(m.counts.prompts));
      ok('解析出槽位占用', m.slots.length > 0, String(m.slots.length));
      ok('解析出变量', m.variables.length > 0, String(m.variables.length));
      ok('识别出标签族', m.tagFamilies.length > 0, String(m.tagFamilies.length));
      ok('给出分组建议', m.suggestions.length > 0, String(m.suggestions.length));
      ok('未修改传入的 json（只读）', demo[0].json.prompts[0] && demo[0].json.prompt_order.length === 1);

      /* 这份演示预设自带面板吗？
         自检里凡是"给一份没有面板的预设装一个面板"的块都按这个分支走——
         开发环境用别人的预设（没有面板），发布包用成品预设（自带面板），两种都要能跑绿。 */
      const demoHasPanel = !!(PE && state.edit && preset()
        && PE.panelScriptViews(state.edit, preset().json, preset().model).length > 0);

      const r = PA.assemble(m, { user: 'Master', char: '测试角色' });
      ok('拼装出分段', r.segments.length > 10, String(r.segments.length));
      ok('拼装出正文', r.totalChars > 1000, String(r.totalChars));
      ok('token 估算为正', r.tokenEstimate > 100, String(r.tokenEstimate));
      ok('记录了变量事件', r.events.length > 0, String(r.events.length));
      ok('注入了 {{user}}', r.segments.some((s) => s.kind === 'prompt' && s.text.includes('Master')));
      ok('注入位显示为占位块', r.segments.some((s) => (s.note || '').includes('注入位')));

      /* 顺序语义：变量初始化必须排在使用它的条目之前 */
      const initIdx = r.events.findIndex((e) => e.op === 'set' && e.value === '' );
      ok('有"清空变量"的初始化动作', initIdx >= 0, String(initIdx));
      const dangling = r.warnings.filter((w) => w.kind === '读了未设置的变量').length;
      ok('拼装诊断可用', Array.isArray(r.warnings), `${r.warnings.length} 条诊断（其中读空变量 ${dangling} 条）`);

      /* M2 体检 */
      const rep = runCheckup();
      ok('体检出结果', !!rep && rep.items.length > 0, rep ? `${rep.items.length} 条` : '没跑出来');
      ok('三档计数与条目数一致', !!rep && rep.counts.err + rep.counts.warn + rep.counts.info === rep.items.length);
      ok('体检条目都带依据与改法', !!rep && rep.items.every((it) => it.title && it.why && it.fix && Array.isArray(it.evidence)));
      ok('体检条目按严重度排序', !!rep && (() => {
        const seq = rep.items.map((i) => ['err', 'warn', 'info'].indexOf(i.level));
        return seq.every((v, i) => i === 0 || seq[i - 1] <= v);
      })());
      const md = PI.toMarkdown(rep, m);
      ok('待办清单能生成 Markdown', /# 预设体检/.test(md) && /必改|建议|提示/.test(md), String(md.length) + ' 字');
      ok('清单里不含提示词正文（只给结构建议）',
        md.includes('不替你写提示词内容') && !md.includes(r.segments.find((s) => s.chars > 200)?.text || '\u0000'));

      /* 切到体检视图，确认它真的渲染出来了（不是空壳） */
      const keepView = state.view;
      state.view = 'checkup';
      renderAll();
      ok('体检视图能渲染', document.getElementById('view').childElementCount >= 2,
        String(document.getElementById('view').childElementCount));
      state.view = keepView;
      renderAll();

      /* M3 框架编辑器：真的改一次结构，看派生模型跟不跟得上、导出前后是不是同一份东西 */
      if (PE && state.edit) {
        const before = model().counts.prompts;
        const baseline = JSON.stringify(PE.applyEdit(preset().json, state.edit, preset().model));
        const added = PE.addEntry(state.edit, preset().model, { name: '自检新增条目', slot: '' });
        state.rev++;
        ok('新增条目后派生模型条目数 +1', model().counts.prompts === before + 1,
          `${before} → ${model().counts.prompts}`);
        ok('新增条目在派生模型里（M0/M1/M2 都能看到）',
          model().entries.some((e) => e.name === '自检新增条目'));
        /* 新条目默认是关的（没写内容就不该生效），所以先打开再看拼装 */
        added.enabled = true;
        state.rev++;
        ok('新增条目在拼装结果里（打开之后）', runAssemble().segments.some((s) => s.name === '自检新增条目'));

        const c1 = runExportChecks();
        ok('待填却开着 → 拦住导出', c1.blocking.some((b) => b.kind === '待填却开着'));
        added.content = '自检写的正文';
        ok('写了内容 → 放行', runExportChecks().blocking.length === 0);
        ok('关掉待填条目后又变成不拦', (() => {
          added.enabled = false; state.rev++;
          const c = runExportChecks();
          const okNow = c.blocking.length === 0;
          added.enabled = true; added.content = PE.FILL_MARK; state.rev++;
          return okNow && runExportChecks().blocking.length > 0;
        })());

        const out = PE.applyEdit(preset().json, state.edit, preset().model);
        ok('导出对象里有新条目', out.prompts.some((p) => p.name === '自检新增条目'));
        ok('导出对象与原文件顶层字段一致', JSON.stringify(Object.keys(out)) === JSON.stringify(Object.keys(preset().json)));
        const intact = PE.verifySourceIntact(preset().json, state.edit, preset().model, PP.fingerprint);
        ok('来源完整性自证无异常', intact.changed.length === 0, intact.changed.join('、'));

        /* 撤销自检改动 */
        PE.deleteAdded(state.edit, added.key);
        state.edit.enabled = new Map();
        state.rev++;
        ok('撤销后回到改动前的字节状态',
          JSON.stringify(PE.applyEdit(preset().json, state.edit, preset().model)) === baseline);
      } else {
        ok('编辑器可用', false, 'PresetEditor 或编辑态没准备好');
      }

      /* M3/M4 视图都切一遍，确认真的渲染出来了 */
      const beforeM3 = state.view;
      for (const v of ['start', 'build', 'editor', 'export', 'new', 'regexedit', 'scriptedit', 'appearance', 'groups']) {
        state.view = v;
        renderAll();
        ok(`「${v}」视图能渲染`, document.getElementById('view').childElementCount >= 2,
          String(document.getElementById('view').childElementCount));
      }
      state.view = beforeM3;
      renderAll();

      /* M4 从零搭一份：生成骨架 → 写正文 → 导出检查 → 再撤回原状 */
      if (PS) {
        const keep = {
          presets: state.presets, active: state.active, edit: state.edit,
          rev: state.rev, view: state.view, draft: state.skeletonDraft,
        };
        state.skeletonDraft = { name: '自检骨架', base: '', modules: ['breach', 'cot'], custom: 1 };
        generateSkeleton();
        ok('生成骨架后它成为当前预设', !!preset() && preset().generated === true);
        ok('骨架的条目正文可编辑（自己写的才可编辑）',
          model().entries.every((e) => PE.canEditContent(state.edit, e.idx)));
        ok('骨架的位置标记正文是空的（和真实预设一样）',
          preset().json.prompts.filter((p) => PS.MARKER_SLOT_IDS.includes(p.identifier)).every((p) => p.content === ''));
        ok('骨架的条目都在提示词列表里', model().counts.listed === model().counts.prompts,
          `${model().counts.listed}/${model().counts.prompts}`);
        const pr = PE.pendingProgress(state.edit, preset().model);
        ok('骨架一开始全是待填（正文等你写）', pr.todo > 0 && pr.done === 0, JSON.stringify(pr));
        ok('主提示没写 → 导出被拦', runExportChecks().blocking.some((b) => b.kind === '主提示还没写'),
          JSON.stringify(runExportChecks().blocking.map((b) => b.kind)));
        const mainE = preset().model.entries.find((e) => e.identifier === 'main');
        state.edit.content.set(mainE.idx, '自检写的主提示，别当真。');
        state.rev++;
        ok('写了主提示 → 导出放行', runExportChecks().blocking.length === 0,
          JSON.stringify(runExportChecks().blocking.map((b) => b.kind)));
        ok('我写的主提示真的进了拼装结果', runAssemble().text.includes('自检写的主提示'),
          String(runAssemble().totalChars));
        ok('骨架体检不再报"主提示是空的"', !runCheckup().items.some((i) => i.id === 'main-empty'));
        ok('骨架的注入位齐全', !runCheckup().items.some((i) => i.id === 'missing-anchors'));

        /* 切预设不该丢改动：编辑态是**每个预设各存一份**的 */
        const genIndex = state.active;
        /* 面板草稿相反：它是"这一份预设的"，换预设必须丢掉——
           留着就会"拿着 A 的分组去改 B"，还会照着 A 的搭建意图去拦 B 的导出。 */
        state.groupsDraft = BO.seedFrom({ groups: [{ id: 'z', label: '甲的区', mode: 'multi', members: [] }], sections: [], thinkingTags: [], display: {} });
        state.groupsDraftKey = preset().file || '';
        ok('换预设前：草稿算这一份的', (() => { const i = panelIntent(); return !!i && i.groups === 1; })());
        state.active = 0; resetEdits();
        ok('切到另一份预设时，用的是它自己的编辑态', state.edit === state.presets[0].edit);
        ok('切到另一份预设时，上一份的面板草稿被丢掉了（不会串到这份上）',
          state.groupsDraft === null && (() => { const i = panelIntent(); return !!i && i.groups === 0; })(),
          JSON.stringify({ draft: !!state.groupsDraft, intent: panelIntent() }));
        state.active = genIndex; resetEdits();
        ok('切回来时我写的正文还在', state.edit.content.get(mainE.idx) === '自检写的主提示，别当真。',
          String(state.edit.content.get(mainE.idx)));

        /* 撤回：自检不该留在界面上骗人 */
        state.presets = keep.presets;
        state.active = keep.active;
        state.edit = keep.edit;
        state.rev = keep.rev + 1;
        state.view = keep.view;
        state.skeletonDraft = keep.draft;
        renderPick(); renderAll();
        ok('自检结束后回到原来的预设', !preset().generated);
      } else {
        ok('骨架生成器可用', false, 'PresetSkeleton 没载入');
      }

      /* M5：正则 / 脚本 / 面板外观 */
      if (PE && PC && state.edit) {
        const p0 = preset();
        const e0 = state.edit;
        /* 正则：空编辑等价 → 改一条 → 只动那一条 → 改回来自动撤销 */
        const baseline = JSON.stringify(PE.applyEdit(p0.json, e0, p0.model));
        ok('正则视图能列出条目', PE.regexViews(e0, p0.json, p0.model).length === p0.model.regexes.length,
          String(PE.regexViews(e0, p0.json, p0.model).length));
        const first = PE.regexViews(e0, p0.json, p0.model)[0];
        PE.setRegexField(e0, p0.json, first.key, 'scriptName', '自检改名');
        state.rev++;
        const after = PE.applyEdit(p0.json, e0, p0.model);
        ok('改正则只动那一条', after.extensions.regex_scripts[0].scriptName === '自检改名'
          && after.extensions.regex_scripts.slice(1).every((r, i) => r === p0.json.extensions.regex_scripts[i + 1]));
        PE.setRegexField(e0, p0.json, first.key, 'scriptName', first.scriptName);
        state.rev++;
        ok('改正则改回原样后回到基线', JSON.stringify(PE.applyEdit(p0.json, e0, p0.model)) === baseline);

        const t = PE.testRegex('/(\\d+)/g', '[$1]', '有 12 和 345');
        ok('正则试跑真的跑出结果', t.ok && t.matches === 2 && t.out === '有 [12] 和 [345]', `${t.matches}｜${t.out}`);
        const badRe = PE.testRegex('/([/', 'x', 'abc');
        ok('写错的正则不会把页面搞崩', badRe.ok === false && !!badRe.error);

        /* 脚本：语法检查 + 改内容 + diff */
        const sv = PE.scriptViews(e0, p0.json, p0.model);
        if (sv.length) {
          ok('脚本视图能拿到 content', sv[0].content.length > 100, String(sv[0].content.length));
          ok('脚本语法检查对成品脚本通过', PE.checkScriptSyntax(sv[0].content).ok === true,
            PE.checkScriptSyntax(sv[0].content).error);
          const before = PE.applyEdit(p0.json, e0, p0.model);
          PE.setScriptField(e0, p0.json, 0, 'content', sv[0].content + '\n/* 自检加的一行 */\n');
          state.rev++;
          const scripted = PE.applyEdit(p0.json, e0, p0.model);
          ok('改脚本进得了导出', scripted.extensions.tavern_helper.scripts[0].content.includes('/* 自检加的一行 */'));
          ok('改脚本不影响条目', JSON.stringify(scripted.prompts) === JSON.stringify(before.prompts));
          PE.setScriptField(e0, p0.json, 0, 'content', sv[0].content);
          state.rev++;
          ok('脚本改回原样后回到基线', JSON.stringify(PE.applyEdit(p0.json, e0, p0.model)) === baseline);
        } else {
          ok('演示预设里应该有内嵌脚本', false, '没找到脚本');
        }

        /* 颜色**真的**生效吗？——必须查浏览器算出来的样式。
           早先这里查的是"CSS 文本里有没有这个颜色"（当然有），结果掩盖了一个大 bug：
           预览压根没把面板 CSS 放进去，改颜色毫无视觉变化。 */
        {
          const keep = state.view;
          state.view = 'appearance';
          setToken('day', '--fp-accent', '#1188ff');
          state.rev++;
          renderAll();
          const ball = document.querySelector('.fp-preview .fp-launch');
          const win = document.querySelector('.fp-preview .fp-win');
          const ballBg = ball ? getComputedStyle(ball).backgroundImage : '';
          ok('改颜色后，浏览器算出来的样式真的变了（查 computed style，不查文本）',
            /rgb\(17,\s*136,\s*255\)|#1188ff/i.test(ballBg), ballBg.slice(0, 90));
          ok('预览加载了**面板自己的 CSS**（窗口拿到真实圆角，不是裸 div）',
            !!win && getComputedStyle(win).borderRadius !== '0px',
            win ? getComputedStyle(win).borderRadius : '预览里没有 .fp-win');
          ok('窗口里有底色层与内容层（面板的真实结构）',
            !!win && !!win.querySelector('.fp-bglayer') && !!win.querySelector('.fp-head'),
            win ? win.children.length + ' 个子元素' : '');
          ok('预览里没有"假装是酒馆页面背景"那类文字混进面板',
            !(win && win.textContent.includes('假装')), win ? win.textContent.slice(0, 40) : '');
          setToken('day', '--fp-accent', '');
          state.appearance = null;
          state.rev++;
          state.view = keep;
          renderAll();
        }

        /* 导入预设后，顶栏的下拉框必须跟着变（早先漏了 renderPick，用户以为导入失败） */
        {
          const fake = {
            prompts: [{ identifier: 'main', name: '另一份的主提示', content: '正文', enabled: true }],
            prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
          };
          addPreset('另一份预设.json', fake, 0);
          const sel = document.getElementById('preset-pick');
          const opts = [...sel.children].map((o) => o.textContent);
          ok('导入后顶栏下拉框加上了这一份', opts.includes('另一份预设.json'), opts.join('、'));
          ok('导入后下拉框选中了刚导入的那一份', sel.value === String(state.presets.length - 1), sel.value);
          ok('导入后底栏统计说的是新预设', document.getElementById('foot-stats').textContent.includes('另一份预设.json'),
            document.getElementById('foot-stats').textContent);
          state.presets.pop();
          state.active = 0;
          resetEdits(true);
          renderPick(); renderAll();
        }

        /* 正则的"渲染出来"：真的把 <details> 渲染了，而不是转义成文本 */
        {
          const html = sanitizeHtml('<details class="fano_thinking"><summary>芳乃祈福中</summary>想法</details>');
          const box = h('div', { html });
          document.body.appendChild(box);
          ok('渲染预览真的产出了可展开的折叠条', !!box.querySelector('details') && !!box.querySelector('summary'));
          ok('渲染前剔掉了会执行的东西', (() => {
            const dirty = sanitizeHtml('<img src=x onerror="alert(1)"><script>alert(2)<\/script><a href="javascript:alert(3)">x</a>');
            return !/onerror/i.test(dirty) && !/<script/i.test(dirty) && !/javascript:/i.test(dirty);
          })());
          ok('EJS 模板在渲染预览里变成看得见的占位',
            sanitizeHtml('<%- getvar("a") %>').includes('ejs-chip'));
          box.remove();
        }

        /* 面板外观 */
        const A = ensureAppearance();
        ok('外观能拿到配置与出厂色', !!A.config && !!A.themes.day['--fp-accent']);
        /* 这份演示预设自带面板吗？两种示例素材都要能跑绿：
           开发环境用的第三方预设没有面板（走"内置模板"），发布包用的成品预设自带面板（走"预设里那份"）。 */
        ok(demoHasPanel ? '演示预设有自己的面板脚本 → 走"预设里那份"这一支'
          : '演示预设里没有带配置块的面板脚本 → 走内置模板',
        demoHasPanel ? A.source === 'preset' : A.source === 'template', A.source);
        ok('预览用的是面板自己的 CSS', A.css.length > 3000, String(A.css.length));
        setToken('day', '--fp-accent', '#00ff88');
        state.rev++;
        const A2 = ensureAppearance();
        ok('改颜色后标记为未应用', A2.dirty === true);
        const pv = buildPreviewDom(A2.config, A2.themes, A2);
        ok('预览 DOM 渲染出来了（球 + 窗 + 底色层）',
          !!pv && pv.children.length >= 3, String(pv?.children?.length));
        const bt = previewStyle(A2.config, A2.themes);
        ok('预览样式里带上了改后的颜色', bt.includes('#00ff88'));
        ok('预览样式里把面板的 fixed 悬浮定位改成了摆位', bt.includes('.fp-preview .fp-win{position:absolute'));
        const v = PC.validateConfig(A2.config, A2.themes);
        ok('配置校验不报错', v.errors.length === 0, JSON.stringify(v.errors));
        setToken('day', '--fp-accent', '');
        state.appearance = null;
        state.rev++;
        ok('清掉颜色后回到出厂值', (globalThis.__FANO_PANEL_DEMO__.themes.day['--fp-accent'] === '#d4577f'));

        /* 面板标题：绝不能留空（留空 = 真面板显示它源码里那句"🌸 芳乃 · 预设面板"，
           装到别的预设上就变成"这个面板自称芳乃"）。画布显示什么，写进脚本就得是什么。 */
        {
          const A3 = ensureAppearance();
          const wantTitle = panelTitle();
          if (demoHasPanel) {
            /* 预设**自带**的面板：它源码里那句兜底文案就是它的名字，画布跟着它才对 */
            ok('预设自带的面板留空 → 用源码里那句兜底标题（画布跟着它，两边不会两样）',
              A3.config.title === '' && wantTitle === PC.extractFallbackTitle(String(A3.content)),
              `title=${JSON.stringify(A3.config.title)}｜panelTitle=${wantTitle}`);
          } else {
            ok('没有面板时，标题留空 = 用这份预设的名字', A3.config.title === '' && wantTitle === presetName(),
              `title=${JSON.stringify(A3.config.title)}｜panelTitle=${wantTitle}｜presetName=${presetName()}`);
          }
          const baked = panelSourceWithEdits();
          const cfgOut = PC.extractConfig(baked);
          ok('写进面板源码的标题不是空的（导出时替你落成具体的字）',
            cfgOut.title === wantTitle && cfgOut.title.length > 0, JSON.stringify(cfgOut.title));
          ok('面板源码里那句芳乃兜底文案不再可能被用到', (() => {
            const block = baked.slice(baked.indexOf('FANO_PANEL_CONFIG_BEGIN'), baked.indexOf('FANO_PANEL_CONFIG_END'));
            return /"title"\s*:\s*"[^"]/.test(block) && !/"title"\s*:\s*""/.test(block);
          })(), '配置块里 title 还是空的');
          ok('画布上那行字与写进脚本的标题一致', (() => {
            const keep = state.view; state.view = 'build'; renderAll();
            const t = document.querySelector('.canvaswrap .fp-title')?.textContent || '';
            state.view = keep; renderAll();
            return t.startsWith(cfgOut.title);
          })());

          /* 自己想改就改：改完落到脚本、导出、以及画布三处一致 */
          A3.config.title = '自检面板题';
          state.rev++;
          const baked2 = panelSourceWithEdits();
          ok('自己填的标题优先（不再用预设名）', PC.extractConfig(baked2).title === '自检面板题',
            JSON.stringify(PC.extractConfig(baked2).title));
          ok('换成自己填的之后，画布也跟着变', panelTitle() === '自检面板题', panelTitle());
          ok('面板脚本里的两处标记块都还在（只换了标题那一段）',
            baked2.includes('FANO_PANEL_CONFIG_BEGIN') && baked2.includes('FANO_PANEL_CONFIG_END')
            && baked2.includes('FANO_PANEL_GROUPS_BEGIN'));
          A3.config.title = '';
          state.rev++;
          appearanceMarkDirty();
        }
        /* 外观视图那张卡得在（以前标题藏在观感最底下，没人找得到） */
        {
          const keep = state.view; state.view = 'appearance'; renderAll();
          const vv = document.getElementById('view');
          ok('外观页有独立的「面板标题」卡', /面板标题/.test(vv.textContent));
          ok('标题卡里报出"现在显示"什么', /现在显示：/.test(vv.textContent), vv.textContent.slice(0, 60));
          ok('标题输入框在，且说明留空会发生什么',
            !![...vv.querySelectorAll('input')].find((i) => /用这份预设的名字/.test(i.placeholder || '')),
            [...vv.querySelectorAll('input')].map((i) => i.placeholder).filter(Boolean).join('｜'));
          state.view = keep; renderAll();
        }
        state.appearance = null;
        state.rev++;
      } else {
        ok('正则/脚本/外观模块可用', false, 'PresetEditor / PresetPanelConfig / 编辑态没准备好');
      }

      /* M6：分组推断 → 装进预设 → 导出（演示预设 Izumi 本来没有面板脚本，正好走这条路） */
      if (GI && PC && PE && state.edit) {
        const p0 = preset();
        const m0 = model();
        const inf = GI.inferGroups(m0, p0.json);
        ok('能按当前预设推断出分组', inf.groups.length > 0, `${inf.groups.length} 个模块`);
        ok('推断结果能通过校验（名字都在预设里）', GI.validateGroups(inf, m0).errors.length === 0,
          GI.validateGroups(inf, m0).errors.slice(0, 3).map((e) => e.text).join('；'));
        ok('推断出的模块都引用了真实条目名',
          inf.groups.every((g) => (g.members || []).every((n) => m0.entries.some((e) => e.name === n))),
          inf.groups.flatMap((g) => (g.members || []).filter((n) => !m0.entries.some((e) => e.name === n))).slice(0, 3).join('、'));
        ok('只读区把注入位收进去了', inf.groups.some((g) => g.mode === 'fixed' && g.id === 'anchors'));

        state.groupsDraft = draftFromInference(inf);
        const ov = normalizeOverride(state.groupsDraft);
        ok('草稿能规范化成面板要的形状（带 sections）',
          ov.groups.length === inf.groups.length && ov.sections.length > 0
          && ov.sections.every((s) => s.groups.every((id) => ov.groups.some((g) => g.id === id))));
        ok('规范化后没有残留内部字段', ov.groups.every((g) => !('__section' in g) && !('__sec' in g)));

        /* 把面板落到预设里：
           · 预设本来没有面板 → attachPanel()（新加一条脚本）
           · 预设自带面板     → applyPanelEdits()（写进已有那条，绝不加第二条） */
        const before = PE.scriptViews(state.edit, p0.json, p0.model).length;
        /* 预设自带面板时，撤回要"改回原文"而不是"删掉脚本"——先把原值与它的下标记下来 */
        const panelRef0 = demoHasPanel ? ensureAppearance().scriptRef : null;
        const panelOrig0 = demoHasPanel
          ? (PE.scriptViews(state.edit, p0.json, p0.model).find((v) => v.ref === panelRef0)?.originalContent ?? '')
          : '';
        let attachedKey = null;
        if (demoHasPanel) {
          const applied = applyPanelEdits();
          ok('预设自带面板时走"应用到面板脚本"，不再加第二条',
            !!applied && PE.scriptViews(state.edit, preset().json, preset().model).length === before,
            `${before} → ${PE.scriptViews(state.edit, preset().json, preset().model).length}`);
        } else {
          const attached = attachPanel();
          attachedKey = attached ? attached.key : null;
          ok('装进预设后多了一条脚本', !!attached && PE.scriptViews(state.edit, preset().json, preset().model).length === before + 1,
            `${before} → ${PE.scriptViews(state.edit, preset().json, preset().model).length}`);
        }
        const exported = PE.applyEdit(preset().json, state.edit, preset().model);
        const sc = exported.extensions.tavern_helper.scripts;
        const mine = sc[sc.length - 1];
        ok('导出的预设里有这条脚本', !!mine && String(mine.content).includes('FANO_PANEL_CONFIG_BEGIN'));
        ok('脚本里带着分组覆盖', String(mine.content).includes('FANO_PANEL_GROUPS_BEGIN')
          && !!PC.extractGroups(String(mine.content)));
        ok('分组覆盖里的模块数与草稿一致',
          PC.extractGroups(String(mine.content)).groups.length === ov.groups.length);
        ok('脚本字段形状和酒馆助手要的一致（type/id/enabled/button/data）',
          mine.type === 'script' && !!mine.id && mine.enabled === true && !!mine.button && !!mine.data);
        ok('装进去之后外观/分组都读得回来', (() => {
          const A2 = ensureAppearance();
          return A2.source === 'preset' && !!PC.extractConfig(A2.content) && !!PC.extractGroups(A2.content);
        })());

        /* 标题：写进**别人的**预设时，绝不能带着面板自带那句"芳乃"。
           留空 = 用这份预设的名字——而且必须真的落进脚本配置里，不是只显示在画布上。 */
        {
          const A3 = ensureAppearance();
          const want = panelTitle();
          ok('写进脚本的标题是具体的字，不是空串',
            PC.extractConfig(String(mine.content)).title === want && want.length > 0,
            `脚本里=${JSON.stringify(PC.extractConfig(String(mine.content)).title)}｜画布=${want}`);
          ok('脚本配置里的 title 不是空的（真面板因此不会显示芳乃那句）',
            /"title"\s*:\s*"[^"]/.test(String(mine.content).slice(String(mine.content).indexOf('FANO_PANEL_CONFIG_BEGIN'),
              String(mine.content).indexOf('FANO_PANEL_CONFIG_END'))));
          ok('外观页读回来的标题与脚本里的一致（输入框不会显示空白）',
            A3.config.title === want, JSON.stringify(A3.config.title));
          ok('画布、外观页、脚本三处说的是同一句话',
            panelTitle() === want && PC.extractConfig(String(mine.content)).title === panelTitle(),
            `${panelTitle()} vs ${PC.extractConfig(String(mine.content)).title}`);
          if (!demoHasPanel) {
            ok('新装进去的面板不认"面板自带"那句兜底标题（那是芳乃的，不是这份预设的）',
              A3.sourceFallbackTitle === '' && want === presetName(), JSON.stringify(A3.sourceFallbackTitle));
          }

          /* 改标题：改完落到脚本、导出、画布三处一致 */
          A3.config.title = '演练面板';
          state.rev++;
          applyPanelEdits();
          const mine2 = PE.applyEdit(preset().json, state.edit, preset().model)
            .extensions.tavern_helper.scripts.slice(-1)[0];
          ok('自己填的标题写进了面板脚本',
            PC.extractConfig(String(mine2.content)).title === '演练面板',
            JSON.stringify(PC.extractConfig(String(mine2.content)).title));
          ok('改标题之后画布也跟着改口', panelTitle() === '演练面板', panelTitle());
          ok('分组覆盖没被改标题顺手丢掉',
            PC.extractGroups(String(mine2.content)).groups.length === ov.groups.length);
          A3.config.title = '';
          state.rev++;
        }

        /* 撤回：别把自检结果留在界面上。
           注意必须**重画**——上面 applyPanelEdits()/attachPanel() 内部 bump() 过，
           DOM 里还留着"已装面板"的样子，只清状态不重画的话，后面 dump 出来的就是过期的界面。 */
        if (demoHasPanel) PE.setScriptField(state.edit, preset().json, panelRef0, 'content', panelOrig0);
        else if (attachedKey) PE.deleteScript(state.edit, attachedKey);
        state.groupsDraft = null;
        state.appearance = null;
        state.rev++;
        renderAll();
        ok('撤回后脚本数回到原样', PE.scriptViews(state.edit, preset().json, preset().model).length === before);
        ok(demoHasPanel ? '撤回后预设自带的那条面板脚本回到原文'
          : '撤回后外观视图回到"没有面板脚本"这一支',
        demoHasPanel
          ? PE.applyEdit(preset().json, state.edit, preset().model).extensions.tavern_helper.scripts
            .every((s, i) => JSON.stringify(s) === JSON.stringify(p0.json.extensions.tavern_helper.scripts[i]))
          : ensureAppearance().source === 'template',
        `source=${ensureAppearance().source}｜脚本 ${PE.scriptViews(state.edit, preset().json, preset().model).map((v) => v.name + (v.changed ? '(改过)' : '')).join('、')}`);
        ok('撤回后界面上真的没有"已装面板"的痕迹了',
          !document.getElementById('view').textContent.includes('已应用'), '');
      } else {
        ok('分组推断模块可用', false, 'PresetGroupInfer / PresetPanelConfig / PresetEditor 没准备好');
      }

      /* 面板搭建：看渲染 + 搭预设是同一条路——加功能区/功能项/选项都要真的落到预设里 */
      if (BO && PE && PC && state.edit) {
        const p0 = preset();
        const before = JSON.stringify(PE.applyEdit(p0.json, state.edit, p0.model));
        state.groupsDraft = null;
        state.buildSel = { kind: 'none' };
        const view0 = state.view;
        state.view = 'build';
        renderAll();
        const canvas = document.querySelector('.canvaswrap .fp-root');
        ok('画布用面板真样式渲染了（能找到 .fp-win / .fp-mod）',
          !!canvas && !!canvas.querySelector('.fp-win') && !!canvas.querySelector('.fp-mod'),
          canvas ? `${canvas.querySelectorAll('.fp-mod').length} 个功能区` : '没有画布');
        ok('没编辑时显示的是面板自带的 25 个功能区（只读展示）',
          canvas && canvas.querySelectorAll('.fp-mod').length >= 20,
          canvas ? String(canvas.querySelectorAll('.fp-mod').length) : '');

        /* 加一个功能区 → 应该落到草稿里，并复制成可编辑草稿 */
        const g = buildAddGroup('自检分区');
        ok('加功能区后进入草稿模式', !!state.groupsDraft && state.groupsDraft.groups.some((x) => x.id === g.id),
          `草稿 ${state.groupsDraft ? state.groupsDraft.groups.length : 0} 个功能区`);
        ok('新功能区落在指定的分节里', g.__section === '自检分区', g.__section);

        /* 加功能项 = 新建条目 + 挂进功能区。注意数量要看**派生模型**（原模型是导入时那份） */
        const nBefore = model().counts.prompts;
        const item = buildAddItem(g.id, false);
        ok('加功能项会真的新建一个条目', model().counts.prompts === nBefore + 1,
          `${nBefore} → ${model().counts.prompts}`);
        ok('新条目的正文是留空待填的', PE.isPending(item.content) === true, String(item.content).slice(0, 40));
        ok('新条目默认关着（没写内容就不该生效）', item.enabled === false);
        ok('新条目已经挂进这个功能区', BO.members(state.groupsDraft, g.id).includes(item.name),
          BO.members(state.groupsDraft, g.id).join('、'));

        /* 加功能选项：同样是新建条目 */
        const opt = buildAddItem(g.id, true);
        ok('加功能选项也是新建条目并挂进去', BO.members(state.groupsDraft, g.id).length === 2
          && BO.members(state.groupsDraft, g.id).includes(opt.name), BO.members(state.groupsDraft, g.id).join('、'));

        /* 导出：新条目 + 新的分组覆盖都要在里面 */
        const out = PE.applyEdit(p0.json, state.edit, p0.model);
        ok('导出的预设里有新条目', out.prompts.some((x) => x.name === item.name));
        const ov = BO.toOverride(state.groupsDraft);
        ok('分组覆盖的形状对（sections 与 groups 对得上）',
          ov.groups.length === state.groupsDraft.groups.length
          && ov.sections.every((s) => s.groups.every((id) => ov.groups.some((x) => x.id === id))));
        ok('新功能区在覆盖里', ov.groups.some((x) => x.id === g.id));
        ok('覆盖里没有残留内部字段', ov.groups.every((x) => !('__section' in x) && !('__sec' in x)));
        ok('其它条目一个字节没动（只多了两条新的）', (() => {
          const oldOnes = JSON.parse(before).prompts;
          return out.prompts.slice(0, oldOnes.length).every((x, i) => JSON.stringify(x) === JSON.stringify(oldOnes[i]));
        })());

        /* 写进面板脚本后仍然读得回来 */
        const patched = PC.patchGroups(PC.patchConfig(PANEL_DEMO.source, ensureAppearance().config), ov);
        ok('把这份分组写进面板脚本后能读回来',
          PC.extractGroups(patched).groups.some((x) => x.id === g.id));

        /* 撤回 */
        PE.deleteAdded(state.edit, item.key);
        PE.deleteAdded(state.edit, opt.key);
        state.groupsDraft = null;
        state.buildSel = { kind: 'none' };
        state.rev++;
        state.view = view0;
        renderAll();
        ok('撤回后回到原状', JSON.stringify(PE.applyEdit(p0.json, state.edit, p0.model)) === before);
      } else {
        ok('面板搭建模块可用', false, 'PresetBuildOps / 编辑器没准备好');
      }

      /* 面板搭建 → 导出：补一个真实踩过的坑。
         在画布上搭了面板就直接点导出，文件里没有面板脚本、屏幕上也没有任何提示。
         面板是**脚本**、条目是 prompts，两条不同的路，导出前必须问清楚。 */
      if (BO && PE && PC && state.edit) {
        const p0 = preset();
        const view0 = state.view;
        state.groupsDraft = null;
        state.appearance = null;
        state.panelIgnored = null;
        state.view = 'build';
        renderAll();
        /* 预设自带面板时，撤回想"改回原文"，得先记下它原来的内容与下标 */
        const panelView0b = demoHasPanel
          ? PE.scriptViews(state.edit, p0.json, p0.model).find((v) => v.content.includes(PC.BEGIN))
          : null;
        const panelRef0b = panelView0b ? panelView0b.ref : null;
        const panelOrig0b = panelView0b ? panelView0b.originalContent : '';

        const g = buildAddGroup('自检导出分区');
        ok('自检：先在画布上搭一个功能区', !!state.groupsDraft && state.groupsDraft.groups.some((x) => x.id === g.id));
        ok(demoHasPanel ? '自检：这份演示预设自带面板脚本' : '自检：这份演示预设本来就没有面板脚本',
          PE.panelScriptViews(state.edit, p0.json, p0.model).length === (demoHasPanel ? 1 : 0));

        const intent1 = panelIntent();
        ok('意图判定读得出"这一轮搭过面板"', !!intent1 && intent1.groups > 0 && intent1.appearance === false,
          JSON.stringify(intent1));
        const wantKind = demoHasPanel ? '面板改动还没应用' : '面板没装进预设';
        const c1 = runExportChecks();
        ok(demoHasPanel ? '改了分组却没应用 → 导出被拦住' : '搭了面板却没装进预设 → 导出被拦住（不再静默把面板丢掉）',
          c1.blocking.some((b) => b.kind === wantKind), JSON.stringify(c1.blocking.map((b) => b.kind)));

        /* 导出这一屏要把这件事摆在最上面，并且给一键补救 */
        state.view = 'export';
        renderAll();
        const nv = document.getElementById('view');
        ok('导出这一屏有「面板脚本」这张卡', nv.textContent.includes('面板脚本'));
        ok(demoHasPanel ? '卡里点名"界面上的改动还没应用"' : '卡里点名"还没装进预设"',
          demoHasPanel ? nv.textContent.includes('界面上的改动还没应用') : nv.textContent.includes('还没装进预设'));
        const fixBtn = [...nv.querySelectorAll('button')].find((b) => /装进这份预设/.test(b.textContent));
        ok('卡里有可点的一键补救按钮', !!fixBtn, [...nv.querySelectorAll('button')].map((b) => b.textContent).join('｜'));
        ok('这时导出按钮是禁用的（拦住的是真按钮，不只是文字）', (() => {
          /* 被拦住时按钮文字会变成「有必改项，先处理」——按文字找要把两种都算上 */
          const b = [...nv.querySelectorAll('button')].find((x) => /导出新预设 JSON|有必改项/.test(x.textContent));
          return !!b && b.disabled === true;
        })(), [...nv.querySelectorAll('button')].map((b) => b.textContent + (b.disabled ? '(禁)' : '')).join('｜'));

        /* 点它 → 面板/改动真的落进预设，拦截消失，导出的文件里带着脚本 */
        fixBtn.click();
        const s2 = PE.panelScriptViews(state.edit, preset().json, preset().model);
        ok(demoHasPanel ? '一键补救：没加第二条面板脚本（写进了已有那条）' : '一键补救：面板脚本进了这份预设的扩展',
          demoHasPanel ? s2.length === 1 : s2.length === 1, JSON.stringify(s2.map((x) => x.name)));
        ok('一键补救：脚本带着分组覆盖（而且只有一份）',
          !!s2[0] && String(s2[0].content).includes('FANO_PANEL_GROUPS_BEGIN'));
        ok('一键补救之后不再拦导出', runExportChecks().blocking.length === 0,
          JSON.stringify(runExportChecks().blocking.map((b) => b.kind)));
        const out2 = PE.applyEdit(preset().json, state.edit, preset().model);
        ok('导出的文件里真的有面板脚本（那个坑的正解）',
          (out2.extensions.tavern_helper.scripts ?? []).some((x) => String(x.content).includes('FANO_PANEL_CONFIG_BEGIN')));
        ok('这时卡改口说"已装进这份预设"',
          document.getElementById('view').textContent.includes('已装进这份预设'));

        /* ── 面板能力：预设里那份面板会不会"长按条目改正文" ──────────────
           分寸（照 tool-guardrails 的三问）：
             · 是我们这套面板、但缺能力标记 → 拦住（导出的就是他要的那份面板，
               缺能力＝没达到目的），并给一键补救「换成新版面板」＋一条活路
               「就带这个旧面板导出」（按 revision 记账，动一下会重新问）。
             · 是**别人的**面板（没有我们的分组块）→ 只说一句，不拦、也不提供替换。 */
        {
          const capKey = PE.PANEL_CAP_MARKS.longPressEdit;
          const now = PE.panelScriptViews(state.edit, preset().json, preset().model)[0];
          ok('自检：面板脚本里带着"长按改正文"的能力标记', String(now.content).includes(capKey));
          ok('自检：认得出这是我们这套面板（有分组块）', PE.panelSupport(now.content).ours === true,
            JSON.stringify(PE.panelSupport(now.content)));
          const titleBefore = PC.extractConfig(now.content).title;

          /* 把它伪装成旧面板：抽掉能力标记（真实世界里旧版面板就长这样） */
          PE.setScriptField(state.edit, preset().json, now.ref, 'content',
            String(now.content).replace(capKey, 'FANO_PANEL_CAP_RETIRED'));
          state.rev++;
          state.view = 'export';
          renderAll();
          ok('旧版面板 → 导出被拦住，并点明原因',
            runExportChecks().blocking.some((b) => b.kind === '面板是旧版：不能长按改正文'),
            JSON.stringify(runExportChecks().blocking.map((b) => b.kind)));
          const upBtn = [...document.getElementById('view').querySelectorAll('button')]
            .find((b) => /换成新版面板/.test(b.textContent));
          ok('卡里有「换成新版面板」这条一键补救', !!upBtn,
            [...document.getElementById('view').querySelectorAll('button')].map((b) => b.textContent).join('｜'));
          upBtn.click();
          const up = PE.panelScriptViews(state.edit, preset().json, preset().model)[0];
          ok('一键换新：能力标记回来了', String(up.content).includes(capKey));
          ok('一键换新：你改过的外观带过去了（标题还是原来那个）',
            PC.extractConfig(up.content).title === titleBefore,
            `${JSON.stringify(titleBefore)} → ${JSON.stringify(PC.extractConfig(up.content).title)}`);
          ok('一键换新：分组块也还在', String(up.content).includes('FANO_PANEL_GROUPS_BEGIN'));
          ok('换新之后不再拦导出', runExportChecks().blocking.length === 0,
            JSON.stringify(runExportChecks().blocking.map((b) => b.kind)));

          /* 活路：就想带着这个旧面板导出 */
          PE.setScriptField(state.edit, preset().json, up.ref, 'content',
            String(up.content).replace(capKey, 'FANO_PANEL_CAP_RETIRED'));
          state.rev++;
          renderAll();
          ok('又变回拦住（不能靠一次点掉就永远闭嘴）',
            runExportChecks().blocking.some((b) => b.kind === '面板是旧版：不能长按改正文'));
          const keepBtn = [...document.getElementById('view').querySelectorAll('button')]
            .find((b) => /就带这个旧面板导出/.test(b.textContent));
          ok('卡里有活路「就带这个旧面板导出」', !!keepBtn,
            [...document.getElementById('view').querySelectorAll('button')].map((b) => b.textContent).join('｜'));
          keepBtn.click();
          ok('说了"就带旧的"→ 放行', runExportChecks().blocking.length === 0,
            JSON.stringify(runExportChecks().blocking.map((b) => b.kind)));
          ok('放行之后仍留一条提示（免得以为长按能用）',
            runExportChecks().warnings.some((w) => w.kind === '带着旧版面板导出'));

          /* 别人的面板：只提醒，不拦、不给替换按钮 */
          const foreign = String(up.content).replace('FANO_PANEL_GROUPS_BEGIN', 'SOMEONE_ELSE_PANEL');
          PE.setScriptField(state.edit, preset().json, up.ref, 'content', foreign);
          state.rev++;
          renderAll();
          ok('不是我们的面板 → 不拦，只提醒',
            runExportChecks().blocking.length === 0
            && runExportChecks().warnings.some((w) => w.kind === '面板不是这套'),
            JSON.stringify({ blocking: runExportChecks().blocking.map((b) => b.kind), warn: runExportChecks().warnings.map((w) => w.kind) }));
          ok('别人的面板不给"换成新版面板"（不把人家的面板整段换掉）',
            ![...document.getElementById('view').querySelectorAll('button')].some((b) => /换成新版面板/.test(b.textContent)));

          /* 收尾：换回新版面板，别影响后面的自检 */
          PE.setScriptField(state.edit, preset().json, up.ref, 'content', PE.upgradePanelContent(foreign, PANEL_DEMO.source));
          state.rev++;
          state.panelStaleIgnored = null;
          renderAll();
          ok('收尾：换回新版面板，导出不再被拦',
            runExportChecks().blocking.length === 0,
            JSON.stringify(runExportChecks().blocking.map((b) => b.kind)));
        }

        /* ── 老面板的 CONFIG 里没有新键 → 打开「面板外观」不能崩 ─────────────
           真实报错（导入一份自带旧面板的预设之后）：
             Uncaught TypeError: Cannot read properties of undefined (reading 'longPress')
           那份面板的 CONFIG 块是旧版，没有 edit / antitrunc / button 这些后来才加的键，
           而外观页直接读 cfg.edit.longPress。
           修法：ensureAppearance() 读配置时一律 mergeConfig(DEFAULT_CONFIG, 读到的)，
           界面就能安全地直接取字段。这条断言钉住它。 */
        {
          const cur = PE.panelScriptViews(state.edit, preset().json, preset().model)[0];
          const oldCfg = { ...PC.extractConfig(cur.content) };
          delete oldCfg.edit; delete oldCfg.antitrunc; delete oldCfg.button;
          PE.setScriptField(state.edit, preset().json, cur.ref, 'content', PC.patchBlock(cur.content, 'CONFIG', oldCfg));
          state.appearance = null;
          state.rev++;
          const nowCfg = PC.extractConfig(PE.panelScriptViews(state.edit, preset().json, preset().model)[0].content);
          ok('自检：把面板 CONFIG 掏成"老面板"（没有 edit / antitrunc / button）',
            !('edit' in nowCfg) && !('button' in nowCfg), JSON.stringify(Object.keys(nowCfg)));

          state.view = 'appearance';
          let threw = null;
          try { renderAll(); } catch (e) { threw = e; }
          ok('老面板打开「面板外观」不抛异常（这一条以前整页白掉）', !threw,
            threw ? String(threw && threw.message) : '');
          const av = document.getElementById('view');
          ok('外观页照常渲染出「交互」那张卡', /长按改正文/.test(av.textContent) && /长按时长/.test(av.textContent));
          const msField = [...av.querySelectorAll('label.numfield')].find((l) => /长按时长/.test(l.textContent));
          ok('长按毫秒显示的是补齐后的默认值 500',
            !!msField && msField.querySelector('input').value === '500',
            msField ? msField.querySelector('input').value : '没找到这个字段');

          /* 在外观页按一次「应用到面板脚本」→ 老面板的 CONFIG 被补齐（含 edit） */
          const applyBtn = [...av.querySelectorAll('button')].find((b) => /应用到面板脚本|记下配置/.test(b.textContent));
          ok('外观页有可点的应用按钮', !!applyBtn,
            [...av.querySelectorAll('button')].map((b) => b.textContent).join('｜'));
          applyBtn.click();
          const fixed = PC.extractConfig(PE.panelScriptViews(state.edit, preset().json, preset().model)[0].content);
          ok('应用一次之后老面板被补齐：edit.longPress 进来了',
            !!fixed.edit && fixed.edit.longPress.enabled === true && fixed.edit.longPress.ms === 500,
            JSON.stringify(fixed.edit));
          ok('补齐时没把他原来的设置冲掉（球大小还是原来那个）',
            fixed.ball.size === oldCfg.ball.size, `${oldCfg.ball.size} → ${fixed.ball.size}`);
          ok('补齐后长按能力标记也在（脚本里那份是新代码）',
            PE.panelSupport(PE.panelScriptViews(state.edit, preset().json, preset().model)[0].content).ours === true);

          state.view = 'export';
          state.rev++;
          renderAll();
        }

        if (!demoHasPanel) {
          /* 「这份预设就是不要面板」也要是条活路：不能把人堵死在导出前 */
          PE.deleteScript(state.edit, s2[0].key);
          state.rev++;
          renderAll();
          ok('删掉脚本后又变成拦住', runExportChecks().blocking.some((b) => b.kind === '面板没装进预设'));
          const ignBtn = [...document.getElementById('view').querySelectorAll('button')]
            .find((b) => /不要面板/.test(b.textContent));
          ok('卡里有「这份预设就是不要面板」这条活路', !!ignBtn);
          ignBtn.click();
          ok('明确说不要面板 → 放行', runExportChecks().blocking.length === 0,
            JSON.stringify(runExportChecks().blocking.map((b) => b.kind)));
          ok('放行之后仍然留一条提示（免得以为搭的东西在里面）',
            runExportChecks().notes.some((n) => n.kind === '面板' && /不要面板/.test(n.text)));
        } else {
          /* 预设自带面板：没有任何"活路"按钮，因为面板本来就在，不存在"丢掉"这回事 */
          ok('预设自带面板时，卡里不提供"不要面板"（面板是它自带的，不该被这一句话抹掉）',
            !/不要面板/.test(document.getElementById('view').textContent));
          ok('预设自带面板时，导出被拦的原因说清了是"改动还没应用"',
            runExportChecks().blocking.length === 0);
        }

        /* 撤回：把面板脚本改回原文、清掉草稿与意图 */
        PE.setScriptField(state.edit, preset().json, demoHasPanel ? panelRef0b : s2[0].ref, 'content', panelOrig0b);
        state.panelIgnored = null;
        state.groupsDraft = null;
        state.appearance = null;
        state.buildSel = { kind: 'none' };
        state.rev++;
        state.view = view0;
        renderAll();
        ok(demoHasPanel ? '撤回后预设自带的那条面板脚本回到原文'
          : '撤回后这份预设里还是没有面板脚本（自检没留下东西）',
        demoHasPanel
          ? !PE.scriptViews(state.edit, preset().json, preset().model).some((v) => v.changed)
          : PE.panelScriptViews(state.edit, preset().json, preset().model).length === 0);
      } else {
        ok('面板搭建 → 导出检查可用', false, 'PresetBuildOps / 编辑器没准备好');
      }

      /* 就地改正文 + 面板质检 + 分节操作：搭建这条路的收尾 */
      if (BO && PE && state.edit) {
        const p0 = preset();
        const m0 = model();
        const before = JSON.stringify(PE.applyEdit(p0.json, state.edit, p0.model));
        const view0 = state.view;
        state.view = 'build';
        state.groupsDraft = null;
        renderAll();

        /* 找一条**导入来的**条目（不是自己写的），在面板里直接改它的正文 */
        const target = m0.entries.find((e) => e.listed && e.name && e.chars > 20 && !PE.isOwnContent(state.edit, e.idx));
        ok('能找到一条导入来的条目用来试改正文', !!target, target ? target.name : '没有');
        if (target) {
          ok('导入的正文现在也允许编辑（以前是只读）', PE.canEditContent(state.edit, target.idx) === true);
          const orig = PE.contentOf(state.edit, p0.json, target.idx);
          ok('读出来的是原文', orig === target.content);
          PE.setContent(state.edit, p0.json, target.idx, orig + '\n（自检追加一行）');
          state.rev++;
          const out1 = PE.applyEdit(p0.json, state.edit, p0.model);
          const wrote = out1.prompts.find((x) => x.name === target.name);
          ok('改动进了导出', String(wrote.content).includes('（自检追加一行）'));
          ok('没改的条目一个字节没动（自证仍在）',
            PE.verifySourceIntact(p0.json, state.edit, p0.model, PP.fingerprint).changed.length === 0);
          ok('自证里把"你改过的那条"单独算了', PE.verifySourceIntact(p0.json, state.edit, p0.model, PP.fingerprint).edited === 1,
            JSON.stringify(PE.verifySourceIntact(p0.json, state.edit, p0.model, PP.fingerprint)));
          PE.setContent(state.edit, p0.json, target.idx, orig);
          state.rev++;
          ok('改回原文后补丁自动撤销', !state.edit.content.has(target.idx));
        }

        /* 面板质检：造一个"挂着不存在的条目"的功能区，它必须报出来 */
        const d = BO.seedFrom({ groups: [{ id: 'x', label: '自检区', mode: 'multi', members: ['这个条目不存在'] }], sections: [{ title: 'S', groups: ['x'] }], thinkingTags: [], display: {} });
        const audit1 = BO.auditPanel(d, m0, state.edit);
        ok('质检报出"条目不存在"', audit1.some((x) => x.kind === '条目不存在'), JSON.stringify(audit1.map((x) => x.kind)));
        const d2 = BO.seedFrom({ groups: [{ id: 'y', label: '空功能区', mode: 'multi', members: [] }], sections: [{ title: 'S', groups: ['y'] }], thinkingTags: [], display: {} });
        ok('质检报出"空功能区"', BO.auditPanel(d2, m0, state.edit).some((x) => x.kind === '空功能区'));
        ok('质检报出"空面板"', BO.auditPanel(BO.seedFrom({}), m0, state.edit).some((x) => x.kind === '空面板'));
        /* 开着却没内容：新建一条（待填）+ 默认开 */
        {
          const d3 = BO.seedFrom({});
          const g = BO.addGroup(d3, { section: 'S', mode: 'multi', label: 'G' });
          const a = PE.addEntry(state.edit, p0.model, { name: '自检待填条目', slot: '' });
          BO.addMember(d3, g.id, a.name);
          PE.setEnabledByName(state.edit, model(), a.name, true);
          state.rev++;
          const audit2 = BO.auditPanel(d3, model(), state.edit);
          ok('质检报出"开着但没内容"', audit2.some((x) => x.kind === '开着但没内容'), JSON.stringify(audit2.map((x) => x.kind)));
          ok('默认开关的两种存法都能读到（新增条目 vs 导入条目）',
            PE.enabledByName(state.edit, model(), a.name) === true
            && PE.setEnabledByName(state.edit, model(), a.name, false) === true,
            `${PE.enabledByName(state.edit, model(), a.name)}`);
          PE.deleteAdded(state.edit, a.key);
          state.rev++;
        }

        /* 分节操作 */
        {
          const d4 = BO.seedFrom({ groups: [
            { id: 'a', label: 'A', mode: 'multi', members: [] },
            { id: 'b', label: 'B', mode: 'multi', members: [] },
          ], sections: [{ title: '甲', groups: ['a'] }, { title: '乙', groups: ['b'] }], thinkingTags: [], display: {} });
          ok('分节顺序读得出来', BO.sectionsOf(d4).join() === '甲,乙');
          BO.renameSection(d4, '甲', '甲改');
          ok('分节可以改名', BO.sectionsOf(d4).join() === '甲改,乙');
          BO.moveSection(d4, '乙', -1);
          ok('分节可以换序', BO.sectionsOf(d4).join() === '乙,甲改', BO.sectionsOf(d4).join());
          BO.removeSection(d4, '乙');
          ok('删分节不会顺手删掉里面的功能区', BO.groupOf(d4, 'b') && BO.sectionsOf(d4).length === 1,
            `${BO.sectionsOf(d4).join()}｜功能区 ${d4.groups.length} 个`);
        }

        state.groupsDraft = null;
        state.buildSel = { kind: 'none' };
        state.rev++;
        state.view = view0;
        renderAll();
        ok('搭建收尾后回到原状', JSON.stringify(PE.applyEdit(p0.json, state.edit, p0.model)) === before);
      } else {
        ok('搭建收尾模块可用', false, 'PresetBuildOps / 编辑器没准备好');
      }

      /* 顺手改掉的一处"管得太宽"：**光看一眼不算搭**。
         导入一份没有我们面板的预设、只是点开「面板搭建」看一眼，工具会自动推断一版草稿——
         以前这份草稿会被当成"你在搭面板"，于是导出被拦住。看一眼不该拦人。 */
      if (BO && PE && PC && state.edit) {
        const view0 = state.view;
        state.groupsDraft = null;
        state.groupsDraftBaseline = null;
        state.appearance = null;
        state.panelIgnored = null;
        state.rev++;
        /* 只"打开画布看了一眼"：走 canvasState() 的自动推断（或兜底草稿），不碰它 */
        state.view = 'build';
        renderAll();
        const seen = state.groupsDraft;
        const cs = canvasState();
        /* 注意：**会不会**摆出草稿取决于"面板自带分组跟这份预设对得上多少"——
           对得上就用面板自带那套（不建草稿），对不上才自动推断一版。两种都正常，
           所以要断的是"看一眼不会变成意图"，不是"一定会建草稿"。 */
        ok('只是看一眼 → 不算"你在搭面板"（导出不会被拦）',
          panelIntent().groups === 0 && runExportChecks().blocking.every((b) => b.kind !== '面板没装进预设'
            && b.kind !== '面板改动还没应用'),
          JSON.stringify({ intent: panelIntent(), blocking: runExportChecks().blocking.map((b) => b.kind),
            有没有草稿: !!seen, defaultsCount: cs.defaultsCount, auto: !!cs.auto }));
        ok('看一眼时若摆出了草稿，那份草稿被记成"你没动过"',
          !seen || draftTouched() === false,
          JSON.stringify({ 有草稿: !!seen, 算动过: seen ? draftTouched() : null }));

        /* 真的动手了：加一个功能区 → 这才算搭 */
        const g2 = buildAddGroup('自检只看一眼分区');
        ok('真加了一个功能区之后才算"在搭面板"',
          panelIntent().groups > 0 && !!g2, JSON.stringify(panelIntent()));

        /* 撤回 */
        state.groupsDraft = null;
        state.groupsDraftBaseline = null;
        state.buildSel = { kind: 'none' };
        state.rev++;
        state.view = view0;
        renderAll();
      }

      /* 这一轮用户报的四个问题的回归断言 */
      {
        /* 1. 顶栏「导出预设 JSON」的字必须看得见（曾经粉底粉字 = 隐形） */
        const btn = document.getElementById('btn-export-preset');
        const cs = btn ? getComputedStyle(btn) : null;
        const lum = (rgb) => {
          const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb || '');
          if (!m) return null;
          return (0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3])) / 255;
        };
        const fg = cs ? lum(cs.color) : null;
        const bg = cs ? lum(cs.backgroundColor) : null;
        ok('顶栏「导出预设 JSON」的字与底色对比够（不是粉底粉字）',
          fg !== null && bg !== null && Math.abs(fg - bg) > 0.25,
          `字 ${cs?.color} / 底 ${cs?.backgroundColor}`);

        /* 2a. 编辑器界面外壳里不该出现写死的预设名。
              注意：外壳里出现**当前预设自己的名字**是数据（顶栏下拉框、页面标题都会写它），
              同理面板自带的兜底标题也是面板这个产物自己的名字——都不算"编辑器写死"。
              所以先把这两样从文本里去掉，再看还有没有"芳乃"。 */
        const chrome = [document.querySelector('.top'), document.getElementById('nav'), document.querySelector('.content .viewtitle'), document.querySelector('.content .viewdesc')]
          .filter(Boolean).map((n) => n.textContent).join(' ');
        const chromeNoData = chrome.split(presetName()).join('')
          .split(PC.extractFallbackTitle(PANEL_DEMO.source)).join('')
          .split(PC.extractFallbackTitle(String(ensureAppearance().content || ''))).join('');
        ok('编辑器界面外壳里没有写死"芳乃"（当前预设自己的名字与面板自带的标题不算）',
          !chromeNoData.includes('芳乃'),
          (chromeNoData.match(/.{0,14}芳乃.{0,14}/) || [''])[0] || `外壳：${chrome.slice(0, 60)}`);

        /* 2b. 更强的证据：把当前预设换成一个**我们自己生成的**骨架（名字里没有"芳乃"），
              外壳这时也不该冒出"芳乃"来——这才叫"没写死任何一个预设名"。 */
        {
          const keepP = state.presets, keepI = state.active, keepV = state.view;
          const gen = PS.buildSkeleton({ name: '自检骨架', moduleIds: ['core'] });
          state.presets = [{ file: '自检骨架.json', json: gen.json, model: PP.parsePreset(gen.json, '自检骨架.json'), generated: true }];
          state.active = 0;
          resetEdits();
          state.view = 'overview';
          renderPick();            // 顶栏那个下拉框也要重画，否则它里面还挂着上一份预设的名字
          renderAll();
          const chrome2 = [document.querySelector('.top'), document.getElementById('nav'), document.querySelector('.content .viewtitle')]
            .filter(Boolean).map((n) => n.textContent).join(' ');
          ok('换成自检骨架当预设时，外壳里也不出现"芳乃"（不是写死某一个预设名）',
            !chrome2.includes('芳乃'), (chrome2.match(/.{0,14}芳乃.{0,14}/) || [''])[0]);
          state.presets = keepP; state.active = keepI; state.view = keepV;
          resetEdits();
          renderPick();
          renderAll();
        }

        /* 3. 画布必须真的能滚（面板 CSS 的 flex+overflow 不能被覆盖压没） */
        const view0 = state.view;
        state.view = 'build';
        state.buildSel = { kind: 'none' };
        state.groupsDraft = null;
        renderAll();
        const bodyEl = document.querySelector('.canvaswrap .fp-body');
        ok('画布里的面板正文区存在', !!bodyEl);
        /* 画布上的面板元素必须真的拿到你调的颜色变量——否则"输入框底色改了没反应"。
           查的是**浏览器算出来的背景色**，不是样式文本。 */
        ok('画布拿到了面板的颜色变量（不是一片没有 --fp-* 的裸元素）', (() => {
          const el2 = document.querySelector('.canvaswrap .fp-select') || document.querySelector('.canvaswrap .fp-textarea');
          if (!el2) return false;
          const rgb = getComputedStyle(el2).backgroundColor;
          const day = globalThis.__FANO_PANEL_DEMO__.themes.day['--fp-input-bg'];
          const want = /^#(..)(..)(..)$/.exec(day).slice(1).map((h) => parseInt(h, 16)).join(', ');
          return rgb === `rgb(${want})`;
        })(), (() => {
          const el2 = document.querySelector('.canvaswrap .fp-select') || document.querySelector('.canvaswrap .fp-textarea');
          return el2 ? `算出来=${getComputedStyle(el2).backgroundColor}｜应该=${globalThis.__FANO_PANEL_DEMO__.themes.day['--fp-input-bg']}` : '画布里没有输入框';
        })());
        ok('画布里的输入框用的是**面板自己的**输入框样式',
          !!document.querySelector('.canvaswrap .fp-textarea') || !!document.querySelector('.canvaswrap .fp-select'),
          String(document.querySelectorAll('.canvaswrap .fp-textarea, .canvaswrap .fp-select').length));
        ok('画布标题用的是这份面板的标题（不是写死的）',
          (() => {
            const t = document.querySelector('.canvaswrap .fp-title');
            return !!t && !!panelTitle() && t.textContent.includes(panelTitle());
          })(), `画布=${document.querySelector('.canvaswrap .fp-title')?.textContent?.slice(0, 30)}｜panelTitle=${panelTitle()}`);
        if (bodyEl) {
          const style = getComputedStyle(bodyEl);
          ok('画布正文区是可滚的（overflow-y 不是 visible/hidden）',
            ['auto', 'scroll'].includes(style.overflowY), style.overflowY);
          bodyEl.scrollTop = 120;
          ok('画布真的滚得动（scrollTop 能设进去）',
            bodyEl.scrollHeight > bodyEl.clientHeight ? bodyEl.scrollTop > 0 : true,
            `scrollHeight ${bodyEl.scrollHeight} / clientHeight ${bodyEl.clientHeight} / scrollTop ${bodyEl.scrollTop}`);
          ok('画布内容比可视区高（25 个功能区确实需要滚）', bodyEl.scrollHeight > bodyEl.clientHeight,
            `${bodyEl.scrollHeight} > ${bodyEl.clientHeight}`);
        }
        /* 4. 字号倍率只动 font-size */
        ok('字号倍率只乘 font-size，不动间距',
          PC.scaleFontCss('.x{font-size:13px;padding:7px 14px}', 1.3) === '.x{font-size:16.9px;padding:7px 14px}',
          PC.scaleFontCss('.x{font-size:13px;padding:7px 14px}', 1.3));
        /* 5. 窗口底色与"内容底色"的键位没标反（面板背景用的是 --fp-overlay） */
        const ovIdx = PC.TOKEN_SPEC.findIndex((x) => x.key === '--fp-overlay');
        const bgIdx = PC.TOKEN_SPEC.findIndex((x) => x.key === '--fp-bg');
        ok('"窗口底色"排在颜色表最前面且指向 --fp-overlay', ovIdx === 0 && bgIdx === 1,
          `overlay@${ovIdx} bg@${bgIdx}`);
        state.view = view0;
        renderAll();
      }

        /* 6. 用户报的三件体验事：改东西不该跳回顶部、背景色要能选色、预览要跟着滚 */
        {
          const view0 = state.view;
          state.view = 'editor';
          renderAll();
          const content = document.querySelector('.content');
          content.scrollTop = 260;
          const before = content.scrollTop;
          bump();                                  /* 触发一次全量重画 */
          ok('重画后不会跳回页面最上方（滚动位置被保住）',
            content.scrollTop === before && content.scrollTop > 0,
            `${before} → ${content.scrollTop}`);

          state.view = 'appearance';
          renderAll();
          const firstRow = document.querySelector('#view table tbody tr');
          ok('颜色表第一行就是"窗口底色"（面板背景就是它）',
            !!firstRow && firstRow.textContent.includes('窗口底色'), firstRow ? firstRow.textContent.slice(0, 24) : '没有表');
          ok('窗口底色这一项**有取色器**（不只是一行文字）',
            !!firstRow && !!firstRow.querySelector('input[type="color"]'));
          ok('带透明度的色还有透明度滑杆',
            !!firstRow && !!firstRow.querySelector('input[type="range"]'));
          const rail = document.querySelector('.previewrail');
          /* 窄屏（手机）是上下堆叠，这时 static 才是对的；宽屏必须是 sticky */
          const narrow = window.innerWidth <= 1180;
          const railPos = rail ? getComputedStyle(rail).position : 'none';
          ok('预览在右侧一条粘性栏里（宽屏跟着滚；窄屏堆叠）',
            !!rail && (narrow ? railPos === 'static' : railPos === 'sticky'),
            `${railPos}（视口 ${window.innerWidth}）`);
          ok('预览栏里有预览框', !!rail && !!rail.querySelector('.fp-preview'));
          state.view = view0;
          content.scrollTop = 0;
          renderAll();
        }

        /* 7. 输入框必须真的显示内容：textarea 的 value 属性是无效的，
              曾经整页 textarea 都是空的（"编辑了文本但界面上不显示"就是这个） */
        {
          const ta = h('textarea', { value: '这是一段测试文本' });
          document.body.appendChild(ta);
          ok('textarea 的 value 真的显示出来了（不是靠属性）', ta.value === '这是一段测试文本', ta.value);
          const inp = h('input', { type: 'text', value: '输入框也要' });
          document.body.appendChild(inp);
          ok('input 的 value 也照旧正常', inp.value === '输入框也要', inp.value);
          ta.remove(); inp.remove();
          /* 真实页面上的每个 textarea 都不该是"有内容却显示空" */
          const view0b = state.view;
          state.view = 'regexedit';
          renderAll();
          const boxes = [...document.querySelectorAll('#view textarea')];
          const filled = boxes.filter((b) => b.value && b.value.length > 3).length;
          ok('正则编辑页里的 find/替换框真的有内容', boxes.length > 4 && filled >= 4,
            `${filled}/${boxes.length} 个输入框有内容`);
          state.view = view0b;
          renderAll();
        }

        /* 8. ⟳ 软刷新：重挂当前这一屏解卡，但输入、预设、草稿一样都不许少。
              盯的是用户报过的那类体验——"打了字还没失焦就去点刷新，字还在不在"。 */
        {
          const view0 = state.view;
          const presetBefore = preset();
          const keysBefore = state.presets.length;
          state.view = 'regexedit';
          renderAll();

          const btnR = document.getElementById('btn-refresh');
          ok('顶栏有 ⟳ 刷新 按钮（就在「导入预设…」那一组里）',
            !!(btnR && btnR.closest('.top-actions')), btnR ? btnR.textContent.trim() : '没有 #btn-refresh');

          const box = document.querySelector('#view textarea');
          if (box) box.value = '软刷新自检：这段字不能丢';
          const nodeBefore = document.querySelector('#view .viewtitle');
          const scrollBox = document.querySelector('.content');
          scrollBox.scrollTop = 180;
          const scrollBefore = scrollBox.scrollTop;

          const r = runSoftRefresh();

          ok('打了一半、还没失焦提交的字也被保住了',
            !box || document.querySelector('#view textarea')?.value === '软刷新自检：这段字不能丢',
            box ? `现在=${String(document.querySelector('#view textarea')?.value).slice(0, 24)}` : '这一屏没有 textarea');
          ok('视图是**重挂**的（节点是新建的，界面残渣才会跟着没）',
            !!nodeBefore && document.querySelector('#view .viewtitle') !== nodeBefore,
            `填回 ${r.fields} 个输入框`);
          ok('滚动位置也还回去了（刷新不等于弹回最上面）', scrollBox.scrollTop === scrollBefore,
            `${scrollBefore} → ${scrollBox.scrollTop}`);
          ok('预设还在，而且**还是同一个对象**（没被重新解析或重新导入）',
            state.presets.length === keysBefore && preset() === presetBefore && state.view === 'regexedit',
            `份数 ${keysBefore}→${state.presets.length}｜视图 ${state.view}`);
          ok('上一轮的横幅被清掉了（刷新之后不残留旧消息）',
            document.getElementById('banner').hidden, document.getElementById('banner').textContent.slice(0, 30));

          if (btnR) {
            btnR.click();
            ok('点 ⟳ 刷新 立刻置忙（先把按钮画出来再干重活，不是点了没反应）',
              btnR.disabled === true, `disabled=${btnR.disabled}`);
          }
          state.view = view0;
          renderAll();
        }

      /* UI 也真的渲染出来了 */
      ok(demoHasPanel ? '自检结束后界面回到干净状态（预设自带的那条面板脚本没被改过）'
        : '自检结束后界面回到干净状态（外观视图不该还认为有面板脚本）',
      demoHasPanel
        ? !PE.scriptViews(state.edit, preset().json, preset().model).some((v) => v.changed)
        : ensureAppearance().source === 'template',
      demoHasPanel ? `脚本 ${PE.scriptViews(state.edit, preset().json, preset().model).map((v) => v.name + (v.changed ? '(改过)' : '')).join('、')}`
        : ensureAppearance().source);
      ok('自检结束后编辑态里没有残留脚本', state.edit.scripts.added.length === 0,
        String(state.edit.scripts.added.length));
      ok('左侧导航已渲染', document.getElementById('nav').childElementCount > 0);
      ok('主视图已渲染', document.getElementById('view').childElementCount > 0);
      ok('底栏统计已更新', /条目/.test(document.getElementById('foot-stats').textContent || ''));
    } catch (e) {
      fails.push('抛出异常：' + e.message);
      out.push('  FAIL  抛出异常：' + (e && e.stack || e));
    }
    finishSelfTest(out, pass, fails);
  }

  /** 收尾：写 #verdict 与页面标题。抽出来是为了"没有演示数据"那条早退路径也用同一套收尾 */
  function finishSelfTest(out, pass, fails) {
    out.push('', `通过 ${pass} 项，失败 ${fails.length} 项`);
    if (fails.length) out.push('失败项：' + fails.join(' ／ '));
    const v = document.getElementById('verdict');
    v.hidden = false;
    v.textContent = out.join('\n');
    document.title = fails.length ? 'GUI-SELFTEST-FAIL' : 'GUI-SELFTEST-OK';
  }

  /**
   * 没有演示数据时能跑的那几条：只断言与"有没有预设"无关的事——
   * 库加载、外壳渲染、以及 ⟳ 软刷新在空页面下也不炸。
   * 这几条正是公开仓库（克隆下来没有预设）唯一能自证的东西，别写成空的。
   */
  function noFixtureSelfTest(ok) {
    ok('8 个库都加载了', !!(PP && PA && PI && PE && PS && PC && GI && BO));
    ok('左侧导航已渲染（空状态也画得出来）', document.getElementById('nav').childElementCount > 0);
    ok('主视图已渲染（显示"还没有载入预设"那张卡）', document.getElementById('view').childElementCount > 0);
    ok('空状态确实在说"还没有载入预设"，不是白屏',
      document.getElementById('view').textContent.includes('还没有载入预设'));
    const btnR = document.getElementById('btn-refresh');
    ok('顶栏有 ⟳ 刷新 按钮', !!(btnR && btnR.closest('.top-actions')));

    let threw = null;
    try { runSoftRefresh(); } catch (e) { threw = e && e.message; }
    ok('没有预设时 ⟳ 软刷新也不会炸', threw === null, String(threw));
    ok('刷新之后视图还在（不是把页面刷没了）', document.getElementById('view').childElementCount > 0);
    ok('刷新顺带清掉横幅（刷新后不残留旧消息）', document.getElementById('banner').hidden);
  }

  /* ── 事件接线 ─────────────────────────────────────────────────── */
  function boot() {
    $('file-input').addEventListener('change', (ev) => { readFiles(ev.target.files); ev.target.value = ''; });
    $('preset-pick').addEventListener('change', (ev) => { state.active = Number(ev.target.value) || 0; resetEdits(); renderAll(); });
    $('opt-user').addEventListener('input', (ev) => { state.user = ev.target.value || '用户'; renderAll(); });
    $('opt-char').addEventListener('input', (ev) => { state.char = ev.target.value || '角色'; renderAll(); });
    $('btn-export').addEventListener('click', exportReport);
    /* 顶栏的 ⟳ 刷新：只重挂当前这一屏解卡，绝不重载文档（见 softRefresh 的注释）。 */
    const refreshBtn = $('btn-refresh');
    if (refreshBtn) refreshBtn.addEventListener('click', softRefresh);
    /* 顶栏的「导出预设 JSON」：这是最常找的东西，必须一眼可见。
       有拦不住的必改项就先跳到导出页说明原因，别静默失败。 */
    $('btn-export-preset').addEventListener('click', () => {
      const p = preset();
      if (!p) { banner('先导入一份预设（或点左栏「从零搭一份」）。', 'err'); return; }
      const c = runExportChecks();
      if (c.blocking.length) {
        state.view = 'export';
        renderAll();
        banner(`有 ${c.blocking.length} 项必须先处理（见本页「导出前检查」）。`, 'err');
        return;
      }
      state.view = 'export';
      renderAll();
      exportJson();
    });

    /* 拖拽导入 */
    document.addEventListener('dragover', (e) => { e.preventDefault(); });
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer?.files?.length) readFiles(e.dataTransfer.files);
    });

    if (!state.presets.length) loadDemo();
    renderPick();

    /* 视图深链：index.html?view=checkup 或 index.html#checkup
       给使用者的用处是"收藏某个视图"；给自动化测试的用处是让 dump 出来的 DOM
       正好停在想验证的那一屏（否则只能验到默认的概览）。 */
    const wantView = new URLSearchParams(location.search).get('view') || location.hash.replace(/^#/, '');
    if (wantView && VIEW_RENDER[wantView]) state.view = wantView;

    renderAll();

    if (/[?&]selftest=1/.test(location.search)) runSelfTest();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
