/**
 * M3 框架编辑器 —— 只改**结构**，不碰别人的正文。
 *
 * 硬约束（整个工程的底线）：
 *   1. 来源预设的条目正文 / 名字 / role 一律不许被改写。applyEdit 对没动过的条目
 *      **复用原对象**（不是深拷贝再写回），所以逐条 sha1 必然相等；改名是用户显式动作。
 *   2. 新增条目的正文一律留空标「待填」，由使用者自己写。工具不代写一个字。
 *   3. 纯函数：applyEdit 不修改传入的 json / model / edit。
 *
 * 输出是**一份完整的新预设对象**（可直接 JSON.stringify 存盘），而不是补丁 ——
 * 因为酒馆要的是一整个文件，而且这样"导出的东西 = 预览的东西"最容易验证。
 */
(function (root) {
  'use strict';

  /** 新增条目的初始正文：一条注释宏，展开后是空的，所以在酒馆里看得见、喂给模型时不存在 */
  const FILL_MARK = '{{//待填：在这里写这条的内容}}';

  /** 内置槽位（占住酒馆的注入位；全局唯一，一个槽位只能有一个主人） */
  const SLOT_CHOICES = [
    { id: '', label: '（普通条目，不占槽位）' },
    { id: 'main', label: '主提示 main' },
    { id: 'nsfw', label: '辅助提示 nsfw' },
    { id: 'jailbreak', label: '历史后置指令 jailbreak' },
    { id: 'worldInfoBefore', label: '世界书·前 worldInfoBefore' },
    { id: 'worldInfoAfter', label: '世界书·后 worldInfoAfter' },
    { id: 'charDescription', label: '角色卡·描述 charDescription' },
    { id: 'charPersonality', label: '角色卡·性格 charPersonality' },
    { id: 'personaDescription', label: '用户人设 personaDescription' },
    { id: 'scenario', label: '场景 scenario' },
    { id: 'dialogueExamples', label: '示例对话 dialogueExamples' },
    { id: 'chatHistory', label: '聊天记录 chatHistory' },
    { id: 'enhanceDefinitions', label: '角色增强 enhanceDefinitions' },
  ];

  /* ── 小工具 ───────────────────────────────────────────────────── */

  const keyOf = (entry) => 'e' + entry.idx;

  /**
   * 「待填」判定：空，或者整条正文只包着一句注释宏（就是我们的占位标记）。
   * 用注释宏而不是空字符串，是因为在酒馆的小铅笔里能看到"这里要填"，
   * 而 {{//…}} 展开后是空的，所以它不会真的进模型（体检器也按展开后判，不会误报）。
   */
  function isPending(content) {
    const t = (content ?? '').trim();
    if (!t) return true;
    return /^\{\{\/\/[\s\S]*\}\}$/.test(t);
  }

  function uuid() {
    const c = root.crypto;
    if (c && typeof c.randomUUID === 'function') {
      try { return c.randomUUID(); } catch { /* 某些环境下 file:// 会抛，落到手写实现 */ }
    }
    const hex = (n) => [...Array(n)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
    return `${hex(8)}-${hex(4)}-4${hex(3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${hex(3)}-${hex(12)}`;
  }

  /** 生成一个不撞车的 identifier（普通条目用 uuid，占槽位就用槽位名） */
  function newIdentifier(model, slotId) {
    const used = new Set((model?.entries ?? []).map((e) => e.identifier));
    if (slotId) return slotId;
    let id = uuid();
    while (used.has(id)) id = uuid();
    return id;
  }

  /* ── 编辑态 ───────────────────────────────────────────────────── */

  /**
   * @param {object} model 原始预设的解析结果（parsePreset 的产物）
   * @param {string[]} anchors 不能删的槽位 id（由界面从体检器的 ANCHORS 传进来，避免两处定义）
   */
  /**
   * @param {object} model 原始预设的解析结果（parsePreset 的产物）
   * @param {string[]} anchors 不能删的槽位 id（由界面从体检器的 ANCHORS 传进来，避免两处定义）
   * @param {object} [opts]
   *   ownIdxs  这些 idx 的正文是**使用者自己的**（工具生成的骨架），可以编辑 ——
   *            导入的预设不传，于是来源正文一律只读。
   *   markerIdxs 其中哪些是纯位置标记（正文本来就该为空）
   *   generated  这份预设是不是工具生成出来的
   */
  function emptyEdit(model, anchors, opts = {}) {
    const order = (model?.entries ?? []).filter((e) => e.listed).map(keyOf);
    return {
      order,
      enabled: new Map(),   // idx -> bool（用户改过的开关）
      names: new Map(),     // idx -> 新名字（用户改过的名字）
      content: new Map(),   // idx -> 正文（只允许 own 里的 idx）
      own: new Set(opts.ownIdxs ?? []),
      markerIdxs: new Set(opts.markerIdxs ?? []),
      generated: !!opts.generated,
      deleted: new Set(),   // idx
      added: [],            // { key, identifier, name, slot, role, enabled, content, marker }
      anchors: anchors ?? [],
      /* 正则与脚本（extensions 里的东西）。键 r<idx> = 原来第 idx 条，a:<uuid> = 新增 */
      regex: {
        order: (model?.regexes ?? []).map((_, i) => regexKey(i)),
        baseOrder: (model?.regexes ?? []).map((_, i) => regexKey(i)),
        patches: new Map(),   // idx -> { scriptName?, findRegex?, replaceString?, disabled?, placement?, markdownOnly?, promptOnly? }
        added: [],            // { key, scriptName, findRegex, replaceString, placement, disabled, ... }
        deleted: new Set(),
      },
      scripts: {
        patches: new Map(),   // idx -> { name?, enabled?, content? }
        added: [],            // { key, name, id, content, enabled, ... }（把面板装进"本来没有脚本"的预设）
        deleted: new Set(),   // idx：用户显式删除的**原有**脚本（导出时跳过；可反悔）
      },
    };
  }

  /** 正则：新增/删除/排序/字段读写（键 r<idx> = 原有，a:<uuid> = 新增） */
  const regexKey = (i) => 'r' + i;

  /** 建一条新的空正则（默认作用在 AI 输出上，和 ST 默认一致） */
  function addRegex(edit, { scriptName = '新正则', findRegex = '', replaceString = '' } = {}) {
    const r = {
      key: 'a:' + uuid(),
      scriptName,
      findRegex,
      replaceString,
      disabled: false,
      runOnEdit: false,
      trimStrings: [],
      placement: [2],
      substituteRegex: 0,
      markdownOnly: false,
      promptOnly: false,
      id: '',
    };
    edit.regex.added.push(r);
    edit.regex.order.push(r.key);
    return r;
  }

  function deleteRegex(edit, key) {
    if (key.startsWith('a:')) edit.regex.added = edit.regex.added.filter((x) => x.key !== key);
    else edit.regex.deleted.add(Number(key.slice(1)));
    edit.regex.order = edit.regex.order.filter((k) => k !== key);
  }

  function moveRegex(edit, key, delta) {
    const i = edit.regex.order.indexOf(key);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= edit.regex.order.length) return false;
    const next = edit.regex.order.slice();
    next.splice(i, 1);
    next.splice(j, 0, key);
    edit.regex.order = next;
    return true;
  }

  /**
   * 正则的"当前值"列表（界面上照着渲染）。
   * 必须读**原始 json**：解析出来的模型把字段名归一化过
   * （scriptName→name、findRegex→find、replaceString→replaceChars），
   * 拿它做"有没有改回原样"的判断会永远判成"改过"。
   */
  function regexList(json, model) {
    const src = Array.isArray(json?.extensions?.regex_scripts) ? json.extensions.regex_scripts : [];
    const parsed = model?.regexes ?? [];
    return src.map((r, idx) => ({
      key: regexKey(idx), idx, isNew: false, changed: false,
      cdn: !!parsed[idx]?.cdn, raw: r,
      scriptName: r.scriptName ?? '', findRegex: r.findRegex ?? '', replaceString: r.replaceString ?? '',
      disabled: !!r.disabled, placement: r.placement ?? [], markdownOnly: !!r.markdownOnly, promptOnly: !!r.promptOnly,
    }));
  }

  /** 把补丁叠上去，并按 edit.regex.order 排（顺序 = 应用顺序） */
  function regexViews(edit, json, model) {
    const out = regexList(json, model)
      .filter((r) => !edit.regex.deleted.has(r.idx))
      .map((r) => {
        const patch = edit.regex.patches.get(r.idx);
        return patch ? { ...r, ...patch, changed: true } : r;
      });
    for (const a of edit.regex.added) {
      out.push({
        key: a.key, idx: -1, isNew: true, changed: true, raw: null, cdn: false,
        scriptName: a.scriptName, findRegex: a.findRegex, replaceString: a.replaceString,
        disabled: !!a.disabled, placement: a.placement ?? [2], markdownOnly: !!a.markdownOnly, promptOnly: !!a.promptOnly,
      });
    }
    const byKey = new Map(out.map((r) => [r.key, r]));
    const ordered = edit.regex.order.map((k) => byKey.get(k)).filter(Boolean);
    for (const r of out) if (!edit.regex.order.includes(r.key)) ordered.push(r);
    return ordered;
  }

  const REGEX_SOURCE_FIELDS = ['scriptName', 'findRegex', 'replaceString', 'disabled', 'placement', 'markdownOnly', 'promptOnly'];

  function setRegexField(edit, json, key, field, value) {
    if (!REGEX_SOURCE_FIELDS.includes(field)) throw new Error('不支持改这个字段：' + field);
    if (key.startsWith('a:')) {
      const a = edit.regex.added.find((x) => x.key === key);
      if (a) a[field] = value;
      return;
    }
    const idx = Number(key.slice(1));
    const src = Array.isArray(json?.extensions?.regex_scripts) ? json.extensions.regex_scripts : [];
    const orig = src[idx] ?? {};
    const patch = edit.regex.patches.get(idx) ?? {};
    /* 和**原始值**比：改回原样就把补丁撤掉，不留无用改动 */
    const same = JSON.stringify(orig[field] ?? null) === JSON.stringify(value ?? null);
    if (same) delete patch[field]; else patch[field] = value;
    if (Object.keys(patch).length) edit.regex.patches.set(idx, patch); else edit.regex.patches.delete(idx);
  }

  const REGEX_FIELD_LABEL = {
    scriptName: '名字', findRegex: 'find 表达式', replaceString: '替换为',
    disabled: '启停', placement: '作用面', markdownOnly: '仅改显示', promptOnly: '仅改发送',
  };
  const regexFieldLabel = (f) => REGEX_FIELD_LABEL[f] ?? f;

  /**
   * 正则试跑：按酒馆的写法解析 `/pattern/flags` 再执行替换。
   *
   * 酒馆的替换串支持三种写法，这里都认（早先只支持第一种，于是"我自己的正则渲染不出来"）：
   *   · `$1` / `$2` / `$<名字>`  —— 正则分组引用
   *   · `{{match}}`             —— 整个匹配
   *   · 普通文本
   * 另外：pattern 没写成 `/…/flags` 也照样当正则用（酒馆里手填的人不少）。
   * 只做**本地字符串运算**，不 eval 任何东西。
   */
  function testRegex(findRegex, replaceString, sample, opts = {}) {
    const src = String(findRegex ?? '');
    if (!src) return { ok: false, error: 'find 是空的', matches: 0, out: String(sample ?? '') };
    let re;
    let patternForm = 'slash';
    try {
      const m = /^\/([\s\S]*)\/([gimsuy]*)$/.exec(src);
      if (m) re = new RegExp(m[1], m[2]);
      else { patternForm = 'plain'; re = new RegExp(src, opts.global === false ? '' : 'g'); }
    } catch (e) {
      return { ok: false, error: '正则写错了：' + e.message, matches: 0, out: String(sample ?? ''), patternForm };
    }
    const text = String(sample ?? '');
    let matches = 0;
    try {
      const found = text.match(re);
      matches = found ? found.length : 0;
    } catch (e) {
      return { ok: false, error: '匹配时出错：' + e.message, matches: 0, out: text, patternForm };
    }

    /* {{match}} 要在替换里展开成整个匹配：先把 find 复制一份带 g，逐段拼 */
    const repl = String(replaceString ?? '');
    const usesMatch = /\{\{\s*match\s*\}\}/.test(repl);
    let out = text;
    try {
      if (usesMatch) {
        const g = re.global ? re : new RegExp(re.source, re.flags + 'g');
        out = text.replace(g, (...args) => {
          const whole = args[0];
          /* 分组可能以数组或命名对象的形式排在后面，酒馆只认 $1 与 {{match}}，够用 */
          return repl.replace(/\{\{\s*match\s*\}\}/g, whole);
        });
      } else {
        out = text.replace(re, repl);
      }
    } catch (e) {
      return { ok: false, error: '替换表达式出错：' + e.message, matches, out: text, patternForm };
    }

    /* 讲清"为什么看起来没反应"——这是最常被问的一句 */
    const reasons = [];
    if (!matches) reasons.push('这段样例文本一处都没匹配到——换一段和正则内容对得上的样例（可以贴你自己的消息）。');
    else if (out === text) reasons.push('匹配到了，但替换后文本没变化（替换内容可能和原文一样，或者只在别的部分生效）。');
    if (matches && !re.global) reasons.push('这个正则没有 g 标志，只会替换第一处匹配。');
    if (usesMatch) reasons.push('替换里用了 {{match}}，已按"整个匹配"展开。');
    if (patternForm === 'plain') reasons.push('这条 find 没写成 /…/flags —— 按普通正则跑了（酒馆里手填也是这个行为）。');
    /* $1 却没有分组：JS（和酒馆）都会把 $1 原样留下，看着就像"没渲染" */
    if (/\$\d/.test(repl) && !/\((?!\?)/.test(re.source)) {
      reasons.push('替换里写了 $1，但 find 里没有捕获分组（括号）——$1 会被原样打进正文里。要么给 find 加括号，要么把 $1 改成 {{match}}。');
    }
    return {
      ok: true, error: '', matches, out, reasons,
      global: re.global,
      changed: out !== text,
      patternForm,
      warns: (() => {
        const w = [];
        if (matches && !re.global) w.push('这个正则没有 g 标志，只会替换第一处匹配。');
        return w;
      })(),
    };
  }

  /** 把一串正则按顺序作用到样例文本上（看它们合起来的效果） */
  function runRegexChain(list, sample) {
    let text = String(sample ?? '');
    const steps = [];
    for (const r of list) {
      if (r.disabled) { steps.push({ name: r.scriptName, skipped: true, matches: 0 }); continue; }
      const res = testRegex(r.findRegex, r.replaceString, text);
      steps.push({ name: r.scriptName, ok: res.ok, error: res.error, matches: res.matches, warns: res.warns });
      if (res.ok) text = res.out;
    }
    return { text, steps };
  }

  /** 脚本语法检查：只**编译**不执行（new Function 只解析，跑不起来） */
  function checkScriptSyntax(content) {
    const text = String(content ?? '');
    if (!text.trim()) return { ok: true, error: '', empty: true };
    try {
      // eslint-disable-next-line no-new-func
      new Function(text);
      return { ok: true, error: '' };
    } catch (e) {
      const line = /<anonymous>:(\d+)/.exec(e.stack || '')?.[1];
      return { ok: false, error: e.message, line: line ? Number(line) : null };
    }
  }

  /**
   * 行级 diff（**粗略**：按行的多重集合算，不做 LCS 对齐）。
   * 用途只是告诉使用者"改了多少行、哪些行号不一样"，不是给 patch 用的。
   */
  function lineDiff(before, after) {
    const a = String(before ?? '').split('\n');
    const b = String(after ?? '').split('\n');
    const count = (arr) => {
      const m = new Map();
      for (const l of arr) m.set(l, (m.get(l) ?? 0) + 1);
      return m;
    };
    const ca = count(a);
    const cb = count(b);
    const removed = [];
    const added = [];
    const seenA = new Map();
    a.forEach((l, i) => {
      const n = seenA.get(l) ?? 0;
      seenA.set(l, n + 1);
      if ((cb.get(l) ?? 0) <= n) removed.push(i + 1);
    });
    const seenB = new Map();
    b.forEach((l, i) => {
      const n = seenB.get(l) ?? 0;
      seenB.set(l, n + 1);
      if ((ca.get(l) ?? 0) <= n) added.push(i + 1);
    });
    return {
      beforeLines: a.length,
      afterLines: b.length,
      removedLines: removed,
      addedLines: added,
      changed: removed.length + added.length,
      sample: removed.slice(0, 5).map((n) => '-' + n).concat(added.slice(0, 5).map((n) => '+' + n)),
    };
  }

  /** 改脚本（只改文本字段；工具不会去"理解"别人的 JS） */
  /**
   * 改脚本（只改文本字段；工具不会去"理解"别人的 JS）。
   * @param {number|string} ref 原有脚本用下标，**新增的**用它的 key（'a:uuid'）——
   *   装进预设的面板属于后者，必须支持，否则"应用外观"会写到不存在的下标上。
   */
  function setScriptField(edit, json, ref, field, value) {
    if (typeof ref === 'string' && ref.startsWith('a:')) {
      const a = edit.scripts.added.find((x) => x.key === ref);
      if (a) a[field] = value;
      return;
    }
    const idx = Number(ref);
    const src = Array.isArray(json?.extensions?.tavern_helper?.scripts) ? json.extensions.tavern_helper.scripts : [];
    const orig = src[idx] ?? {};
    const patch = edit.scripts.patches.get(idx) ?? {};
    if (String(orig[field] ?? '') === String(value ?? '')) delete patch[field]; else patch[field] = value;
    if (Object.keys(patch).length) edit.scripts.patches.set(idx, patch); else edit.scripts.patches.delete(idx);
  }

  /* ── 面板脚本 ──────────────────────────────────────────────────────
     面板是**脚本**（extensions.tavern_helper.scripts），条目是 prompts ——
     两条完全不同的路。搭面板时改的是脚本，而"导出预设"导出的是整份文件。
     所以"这份预设里到底有没有面板"必须能单独问出来，不能靠人自己记得。 */
  const PANEL_MARKS = ['FANO_PANEL_CONFIG_BEGIN', '__FANO_PANEL__'];
  /* 怎么认出"这是我们这套面板"：认**分组块**（FANO_PANEL_GROUPS_BEGIN）。
     为什么不用 CONFIG 标记：适配器（tools/adapt-panel.mjs）也给**别人的**面板注入了
     CONFIG 块，拿它会把那支面板误当成我们的，然后"一键换新版"把人家的面板整段换掉——
     那是破坏性的。认错的方向也是挑过的：万一遇到更老的、还没有分组块的那份我们的面板，
     会被当成"别人的面板"→ 只提醒、不拦、也不提供替换，坏结果最小。
     （实测：panel/fano-panel.js 有 1 处；芳乃预设_v2.8.1-适配.json 里 0 处。） */
  const PANEL_IDENTITY_MARK = 'FANO_PANEL_GROUPS_BEGIN';
  /* 面板"会什么"的能力标记：面板源码里写死的常量名（见 panel/src/panel-core.js）。
     靠它判断"这份预设里的面板脚本是不是新版"，比看版本号稳——
     版本号会被手改，能力标记是代码的一部分，缺了就是真缺。 */
  const PANEL_CAP_MARKS = {
    longPressEdit: 'FANO_PANEL_CAP_LONGPRESS_EDIT',
    /* 0.6.0 起：顶部按钮=整块隐藏 / 壁纸开关 + 纯色底 / 小方案长按改名 */
    controlsV06: 'FANO_PANEL_CAP_CONTROLS_V06',
  };

  /**
   * 这份面板脚本是不是我们这套、会哪些能力。
   * 导出前检查与界面上的面板卡都用它，免得两处各判一套。
   */
  function panelSupport(content) {
    const src = String(content ?? '');
    const ours = src.includes(PANEL_IDENTITY_MARK);
    const caps = {};
    for (const [k, mk] of Object.entries(PANEL_CAP_MARKS)) caps[k] = src.includes(mk);
    return { ours, caps, missing: Object.keys(caps).filter((k) => !caps[k]) };
  }

  /**
   * 把预设里那份**旧面板**换成新版面板源码，并把你改过的东西带过去。
   *
   * 能带过去的只有"你的设置"：CONFIG（外观，含标题）与 GROUPS_OVERRIDE（分组覆盖）。
   * 代码本身整段换新——旧代码没法逐行升级，那是另一版实现。
   * 只对**我们这套面板**用（见 PANEL_IDENTITY_MARK）。
   */
  function upgradePanelContent(oldContent, newSource, opts = {}) {
    const PC = root.PresetPanelConfig;
    let next = String(newSource ?? '');
    if (!next || !PC) return next;           // 面板配置模块没载入：至少把新代码换上
    try {
      const old = PC.extractConfig(oldContent);
      if (old) next = PC.patchConfig(next, opts.title ? { ...old, title: opts.title } : old);
    } catch { /* 旧配置读不出来就用新面板的默认值，不阻断 */ }
    try {
      const ov = PC.extractGroups(oldContent);
      if (ov) next = PC.patchGroups(next, ov);
    } catch { /* 同上 */ }
    return next;
  }

  /** 一段脚本正文像不像浮动面板 */
  const looksLikePanel = (content) =>
    typeof content === 'string' && PANEL_MARKS.some((mk) => content.includes(mk));

  /** 当前编辑态下，这份预设里带着的浮动面板脚本 */
  function panelScriptViews(edit, json, model) {
    return scriptViews(edit, json, model)
      .filter((v) => looksLikePanel(v.content))
      .map((v) => ({ key: v.key, ref: v.ref, name: v.name || '(无名脚本)', enabled: !!v.enabled,
        bytes: v.content.length, isNew: !!v.isNew, content: v.content }));
  }

  function scriptViews(edit, json, model) {
    const src = Array.isArray(json?.extensions?.tavern_helper?.scripts) ? json.extensions.tavern_helper.scripts : [];
    const parsed = model?.scripts ?? [];
    const rows = src.map((s, idx) => {
      const patch = edit.scripts.patches.get(idx) ?? {};
      return {
        idx,
        key: scriptKeyOf(idx),
        ref: idx,
        isNew: false,
        name: patch.name ?? s.name ?? '',
        enabled: 'enabled' in patch ? !!patch.enabled : !!s.enabled,
        content: 'content' in patch ? String(patch.content) : String(s.content ?? ''),
        originalContent: String(s.content ?? ''),
        type: s.type ?? '', id: s.id ?? '',
        buttons: parsed[idx]?.buttons ?? [],
        changed: Object.keys(patch).length > 0,
        changedFields: Object.keys(patch),
      };
    });
    /* 新增的（比如"把面板装进这份预设"）：和原有一视同仁地显示 */
    for (const a of edit.scripts.added) {
      rows.push({
        idx: -1,
        key: a.key,
        ref: a.key,
        isNew: true,
        name: a.name,
        enabled: !!a.enabled,
        content: String(a.content ?? ''),
        originalContent: '',
        type: 'script', id: a.id,
        buttons: [],
        changed: true,
        changedFields: ['新增'],
      });
    }
    return rows;
  }

  /**
   * 往预设里加一条酒馆助手脚本（把面板装进"本来没有脚本"的预设）。
   * 字段形状照抄真实预设里既有的脚本条目，别自己发明。
   */
  function addScript(edit, json, { name = '面板', content = '', id = '' } = {}) {
    const src = Array.isArray(json?.extensions?.tavern_helper?.scripts) ? json.extensions.tavern_helper.scripts : [];
    /* 撞车检查要把**本次已新增的**也算上：只比对源文件里的 id，
       连加两条同 id 的脚本会静默撞车。 */
    const usedIds = new Set(src.map((s) => s.id).filter(Boolean).concat(edit.scripts.added.map((s) => s.id).filter(Boolean)));
    let sid = id || 'fano-panel';
    while (usedIds.has(sid)) sid = sid + '-' + Math.random().toString(36).slice(2, 6);
    const entry = {
      key: 'a:' + uuid(),
      type: 'script',
      enabled: true,
      name,
      id: sid,
      content,
      info: '由预设生成器的「面板外观 / 面板分组」写入。',
      button: { enabled: false, buttons: [] },
      data: {},
      export_with: { data: false, button: true },
    };
    edit.scripts.added.push(entry);
    return entry;
  }

  function deleteScript(edit, key) {
    if (key.startsWith('a:')) {
      edit.scripts.added = edit.scripts.added.filter((x) => x.key !== key);
      return true;
    }
    /* 's<idx>' = 预设里**原有**的脚本。以前这里直接 return false——也就是"别人的脚本删不掉"。
       现在记进 deleted，导出时跳过；想反悔用 undeleteScript，别偷偷丢东西。 */
    const m = /^s(\d+)$/.exec(key);
    if (m) { edit.scripts.deleted.add(Number(m[1])); return true; }
    return false;
  }

  /** 取消删除（导出时照旧带上它） */
  function undeleteScript(edit, key) {
    const m = /^s(\d+)$/.exec(String(key));
    if (!m) return false;
    return edit.scripts.deleted.delete(Number(m[1]));
  }

  const scriptKeyOf = (idx) => 's' + idx;

  /**
   * 某个 idx 的正文能不能编辑。
   * **任何条目都能改**（这是使用者的预设，搭建时就得能改正文）；
   * 但"来源正文"改过之后会被记下来：导出界面会说明"哪几条是你改的"，
   * 没改过的照旧逐条 sha1 对得上——自证不会因为放开编辑而失效。
   */
  function canEditContent(edit, idx) {
    return !!edit && Number.isInteger(idx) && idx >= 0;
  }

  /** 这条正文是不是"我自己写的"（生成的骨架 / 新增的条目），而不是导入来的别人的原文 */
  const isOwnContent = (edit, idx) => !!edit && edit.own.has(idx);

  /**
   * 按**条目名**改默认开关。为什么要这个helper：
   * 新增条目（edit.added）的开关在它自己身上，导入条目（edit.enabled）按下标存——
   * 界面上两者看起来一样，混着用就会出现"点了默认打开却没用"。
   */
  function setEnabledByName(edit, model, name, on) {
    const added = edit.added.find((a) => a.name === name);
    if (added) { added.enabled = !!on; return true; }
    const e = (model?.entries ?? []).find((x) => x.name === name);
    if (!e) return false;
    edit.enabled.set(e.idx, !!on);
    return true;
  }

  /** 某条条目当前的默认开关（同样要照顾"新增的"与"导入的"两种存法） */
  function enabledByName(edit, model, name) {
    const added = edit.added.find((a) => a.name === name);
    if (added) return !!added.enabled;
    const e = (model?.entries ?? []).find((x) => x.name === name);
    if (!e) return false;
    return edit.enabled.has(e.idx) ? edit.enabled.get(e.idx) : !!e.enabled;
  }

  /** 改正文；改回和原文一模一样时自动撤销改动，不留无用补丁 */
  function setContent(edit, json, idx, text) {
    if (!edit || !Number.isInteger(idx)) return false;
    const src = Array.isArray(json?.prompts) ? json.prompts : [];
    const orig = src[idx];
    if (!orig) return false;
    const before = edit.content.has(idx) ? edit.content.get(idx) : orig.content;
    if (String(before ?? '') === String(text ?? '')) return false;
    if (String(orig.content ?? '') === String(text ?? '')) edit.content.delete(idx);
    else edit.content.set(idx, String(text ?? ''));
    return true;
  }

  const contentOf = (edit, json, idx) => {
    if (edit?.content?.has?.(idx)) return edit.content.get(idx);
    return (json?.prompts ?? [])[idx]?.content ?? '';
  };

  /** 改回导入时的原文 */
  function revertContent(edit, json, idx) {
    if (!edit?.content?.has?.(idx)) return false;
    edit.content.delete(idx);
    return true;
  }

  /** marker = 纯注入位标记：正文为空是对的，而且必须开着 */
  function isMarker(edit, idx, model) {
    if (!edit) return false;
    if (edit.markerIdxs.has(idx)) return true;
    return MARKER_SLOTS.includes(model?.entries?.find((e) => e.idx === idx)?.identifier);
  }
  const MARKER_SLOTS = ['worldInfoBefore', 'worldInfoAfter', 'charDescription', 'charPersonality',
    'personaDescription', 'scenario', 'dialogueExamples', 'chatHistory'];

  function isDirty(edit) {
    return !!edit && (edit.enabled.size > 0 || edit.names.size > 0 || edit.content.size > 0
      || edit.deleted.size > 0 || edit.added.length > 0
      || edit.regex.patches.size > 0 || edit.regex.added.length > 0 || edit.regex.deleted.size > 0
      || edit.regex.order.join() !== (edit.regex.baseOrder ?? []).join()
      || edit.scripts.patches.size > 0);
  }

  /** 结构上动过没有（不含开关与写正文）——用来决定要不要在标题上标"已改" */
  function structuralDirty(edit) {
    return !!edit && (edit.names.size > 0 || edit.deleted.size > 0 || edit.added.length > 0
      || edit.regex.added.length > 0 || edit.regex.deleted.size > 0);
  }

  /** "你自己写的条目"（新增的 + 生成的）——用来算待填进度 */
  function ownEntries(edit, model) {
    const rows = [];
    for (const idx of edit.own) {
      const e = (model?.entries ?? []).find((x) => x.idx === idx);
      if (!e || edit.deleted.has(idx)) continue;
      const content = edit.content.has(idx) ? edit.content.get(idx) : e.content;
      rows.push({
        kind: 'own', idx, identifier: e.identifier, role: e.role,
        name: edit.names.get(idx) ?? e.name, content,
        enabled: edit.enabled.has(idx) ? edit.enabled.get(idx) : e.enabled,
        marker: isMarker(edit, idx, model),
      });
    }
    for (const a of edit.added) {
      rows.push({
        kind: 'added', key: a.key, identifier: a.identifier, role: a.role || 'system',
        name: a.name, content: a.content ?? FILL_MARK,
        enabled: !!a.enabled, marker: !!a.marker || MARKER_SLOTS.includes(a.identifier),
      });
    }
    return rows;
  }

  /** 待填进度（给生成出来的骨架用的） */
  function pendingProgress(edit, model) {
    const own = ownEntries(edit, model);
    const todo = own.filter((r) => !r.marker && isPending(r.content));
    const done = own.filter((r) => !r.marker && !isPending(r.content));
    const markers = own.filter((r) => r.marker);
    return { total: own.length, todo: todo.length, done: done.length, markers: markers.length, todoNames: todo.map((r) => r.name) };
  }

  /* ── 编辑动作（都返回新值，不改入参）──────────────────────────── */

  function addEntry(edit, model, { name, slot = '', role = 'system' } = {}) {
    const identifier = newIdentifier(model, slot);
    if (slot && MARKER_SLOTS.includes(slot)) {
      /* 选了注入位槽位 = 这是个位置标记：正文为空是对的，而且要开着才有用 */
      edit.added.push({
        key: 'a:' + uuid(), identifier, name: (name ?? '').trim() || '⟨位置标记⟩',
        slot, role, enabled: true, marker: true, content: '',
        injPos: 0, injDepth: 4, injOrder: 100,
      });
      const back = edit.added[edit.added.length - 1];
      edit.order.push(back.key);
      return back;
    }
    const entry = {
      key: 'a:' + uuid(),
      identifier,
      name: (name ?? '').trim() || '新条目（待填名字）',
      slot,
      role,
      enabled: false,               // 新条目一律默认关：没写内容就不该生效
      content: FILL_MARK,
      injPos: 0,
      injDepth: 4,
      injOrder: 100,
    };
    edit.added.push(entry);
    edit.order.push(entry.key);      // 追加到列表末尾：位置由用户自己拖
    return entry;
  }

  function deleteAdded(edit, key) {
    edit.added = edit.added.filter((a) => a.key !== key);
    edit.order = edit.order.filter((k) => k !== key);
  }

  /** 在 order 里挪动一个 key（delta = -1 / +1） */
  function moveKey(edit, key, delta) {
    const i = edit.order.indexOf(key);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= edit.order.length) return false;
    const next = edit.order.slice();
    next.splice(i, 1);
    next.splice(j, 0, key);
    edit.order = next;
    return true;
  }

  function removeFromOrder(edit, key) {
    edit.order = edit.order.filter((k) => k !== key);
  }

  function appendToOrder(edit, key) {
    if (!edit.order.includes(key)) edit.order = edit.order.concat([key]);
  }

  /* ── 生成新预设 ───────────────────────────────────────────────── */

  function orderIndexOf(json) {
    const arr = Array.isArray(json.prompt_order) ? json.prompt_order : [];
    const i = arr.findIndex((o) => o && o.character_id === 100001);
    return i >= 0 ? i : (arr.length ? 0 : -1);
  }

  /**
   * 把编辑态应用到原 json 上，返回**新对象**（原 json 一个字节都不动）。
   * @param {object} json 原始预设
   * @param {object} edit
   * @param {object} model 原始解析结果
   */
  function applyEdit(json, edit, model) {
    const prompts = Array.isArray(json.prompts) ? json.prompts : [];
    const oi = orderIndexOf(json);
    const origOrder = oi >= 0 ? (json.prompt_order[oi].order ?? []) : [];
    const origEnabled = new Map(origOrder.map((o) => [o.identifier, !!o.enabled]));

    /* 1. 条目：没动过的原样复用（保证"来源一字未改"是可验证的事实，而不是承诺） */
    const out = [];
    const newIndexOf = new Map();          // idx -> 新数组下标
    prompts.forEach((p, idx) => {
      if (edit.deleted.has(idx)) return;
      newIndexOf.set(idx, out.length);
      const name = edit.names.has(idx) ? edit.names.get(idx) : p.name;
      const content = edit.content.has(idx) ? edit.content.get(idx) : p.content;
      const enabled = edit.enabled.has(idx) ? edit.enabled.get(idx) : p.enabled;
      /* 只有真的动过才换对象 —— 这样"没动过的条目引用不变"本身就说明了问题 */
      if (name === p.name && content === p.content && enabled === p.enabled) { out.push(p); return; }
      out.push({ ...p, name, content, enabled });
    });

    /* 2. 新增条目 */
    for (const a of edit.added) {
      newIndexOf.set(a.key, out.length);
      out.push({
        identifier: a.identifier,
        name: a.name,
        enabled: !!a.enabled,
        injection_position: a.injPos ?? 0,
        injection_depth: a.injDepth ?? 4,
        injection_order: a.injOrder ?? 100,
        role: a.role || 'system',
        content: a.content ?? FILL_MARK,
        system_prompt: false,
        marker: false,
        forbid_overrides: false,
      });
    }

    /* 3. 条目开关的"生效值"：列表里的看 order 的开关（酒馆就是这么读的），
          没列过列表的看条目自己的。只把**用户改过**的写回去。 */
    const effective = (p, idx) => {
      if (edit.enabled.has(idx)) return edit.enabled.get(idx);
      if (origEnabled.has(p.identifier)) return origEnabled.get(p.identifier);
      return !!p.enabled;
    };

    /* 4. prompt_order：按 order 数组重排 */
    const newOrder = [];
    const produced = new Set();
    for (const key of edit.order) {
      if (key.startsWith('a:')) {
        const a = edit.added.find((x) => x.key === key);
        if (!a) continue;
        newOrder.push({ identifier: a.identifier, enabled: !!a.enabled });
        produced.add(a.identifier);
        continue;
      }
      const idx = Number(key.slice(1));
      if (edit.deleted.has(idx)) continue;
      const p = prompts[idx];
      if (!p) continue;
      const on = effective(p, idx);
      newOrder.push({ identifier: p.identifier, enabled: on });
      produced.add(p.identifier);
      /* 酒馆有两处 enabled：条目自己的、以及 prompt_order 里的。
         用户显式改过的，两边都写成一致（未改过的保持原样，不去"顺手归一化"）。 */
      if (edit.enabled.has(idx)) {
        const at = newIndexOf.get(idx);
        out[at] = out[at] === p ? { ...p, enabled: on } : { ...out[at], enabled: on };
      }
    }
    /* 5. 原列表里我们没产出的（孤儿条目）原样保留，绝不悄悄丢掉 */
    for (const o of origOrder) {
      if (!produced.has(o.identifier)) newOrder.push({ identifier: o.identifier, enabled: !!o.enabled });
    }
    for (const a of edit.added) {
      if (!produced.has(a.identifier)) newOrder.push({ identifier: a.identifier, enabled: !!a.enabled });
    }

    /* 6. 组新对象：只换 prompts 与那一条 prompt_order，其余字段连引用都不换 */
    const next = { ...json, prompts: out };
    if (oi >= 0) {
      next.prompt_order = json.prompt_order.map((o, i) => (i === oi ? { ...o, order: newOrder } : o));
    } else {
      next.prompt_order = Array.isArray(json.prompt_order) ? json.prompt_order.concat([{ character_id: 100001, order: newOrder }])
        : [{ character_id: 100001, order: newOrder }];
    }

    /* 7. extensions：正则与脚本。
       同样守"没动过的原样复用"——正则是一串按顺序作用于消息文本的规则，
       顺序本身有意义，所以这里按 edit.regex.order 重建数组。 */
    const regexChanged = edit.regex.patches.size || edit.regex.added.length || edit.regex.deleted.size
      || edit.regex.order.join() !== (edit.regex.baseOrder ?? []).join();
    const scriptChanged = edit.scripts.patches.size > 0 || edit.scripts.added.length > 0 || edit.scripts.deleted.size > 0;
    if (regexChanged || scriptChanged) {
      const ext = { ...(json.extensions ?? {}) };
      if (regexChanged) {
        const src = Array.isArray(ext.regex_scripts) ? ext.regex_scripts : [];
        const outR = [];
        const produced = new Set();
        for (const key of edit.regex.order) {
          if (key.startsWith('a:')) {
            const a = edit.regex.added.find((x) => x.key === key);
            if (!a) continue;
            const { key: _k, ...fields } = a;
            void _k;
            outR.push({ disabled: false, runOnEdit: false, trimStrings: [], placement: [2], substituteRegex: 0, ...fields });
            produced.add(key);
            continue;
          }
          const idx = Number(key.slice(1));
          if (edit.regex.deleted.has(idx)) continue;
          const r = src[idx];
          if (!r) continue;
          const patch = edit.regex.patches.get(idx);
          outR.push(patch ? { ...r, ...patch } : r);
          produced.add(key);
        }
        /* 没在 order 里出现的原有正则（理论上不会有）也保留，绝不悄悄丢 */
        src.forEach((r, idx) => { if (!produced.has(regexKey(idx)) && !edit.regex.deleted.has(idx)) outR.push(r); });
        ext.regex_scripts = outR;
      }
      if (scriptChanged) {
        const src = Array.isArray(ext.tavern_helper?.scripts) ? ext.tavern_helper.scripts : [];
        const outS = src.map((s, i) => {
          /* 用户显式删掉的那几条跳过（与正则那边的 edit.regex.deleted 同一个写法） */
          if (edit.scripts.deleted.has(i)) return null;
          const patch = edit.scripts.patches.get(i);
          return patch ? { ...s, ...patch } : s;
        }).filter(Boolean);
        for (const a of edit.scripts.added) {
          const { key: _k, ...fields } = a;
          void _k;
          outS.push(fields);
        }
        ext.tavern_helper = { ...(ext.tavern_helper ?? {}), scripts: outS };
      }
      next.extensions = ext;
    }
    return next;
  }

  /* ── 改动摘要 ─────────────────────────────────────────────────── */

  function summary(edit, model) {
    const rows = [];
    const byIdx = new Map((model?.entries ?? []).map((e) => [e.idx, e]));
    const nameOf = (idx) => byIdx.get(idx)?.name ?? `#${idx}`;

    for (const idx of edit.deleted) rows.push({ kind: '删除条目', text: `删掉「${nameOf(idx)}」` });
    for (const a of edit.added) {
      rows.push({
        kind: '新增条目',
        text: `新增「${a.name}」${a.slot ? `（占槽位 ${a.slot}）` : '（普通条目）'}`
          + `　正文${isPending(a.content) ? '留空待填' : '已填'}　${a.enabled ? '开启' : '默认关'}`,
      });
    }
    for (const [idx, name] of edit.names) {
      if (name === byIdx.get(idx)?.name) continue;
      rows.push({ kind: '改名', text: `「${nameOf(idx)}」→「${name}」（按名字匹配的面板/正则会跟着失效）` });
    }
    /* 写正文（只可能是自己的条目） */
    let wroteCount = 0;
    let wroteChars = 0;
    for (const [idx, text] of edit.content) {
      const e = byIdx.get(idx);
      if (!e || text === e.content) continue;
      wroteCount++;
      wroteChars += [...text].length;
    }
    if (wroteCount) rows.push({ kind: '写正文', text: `给 ${wroteCount} 条条目写了正文（共 ${wroteChars} 字）` });

    /* 正则改动 */
    for (const idx of edit.regex.deleted) {
      rows.push({ kind: '删除正则', text: `删掉正则「${(model?.regexes ?? [])[idx]?.name ?? '#' + idx}」` });
    }
    for (const [idx, patch] of edit.regex.patches) {
      const name = patch.scriptName ?? (model?.regexes ?? [])[idx]?.name ?? '#' + idx;
      rows.push({ kind: '改正则', text: `改了「${name}」：${Object.keys(patch).map(regexFieldLabel).join('、')}` });
    }
    for (const a of edit.regex.added) {
      rows.push({ kind: '新增正则', text: `新增「${a.scriptName}」${a.findRegex ? '' : '（find 还是空的）'}` });
    }
    if (edit.regex.order.join() !== (edit.regex.baseOrder ?? []).join()) {
      rows.push({ kind: '正则顺序', text: '调整了正则的应用顺序（它们是按顺序依次作用的）' });
    }
    /* 脚本改动 */
    for (const [idx, patch] of edit.scripts.patches) {
      const name = patch.name ?? (model?.scripts ?? [])[idx]?.name ?? '#' + idx;
      const bits = [];
      if ('content' in patch) bits.push('代码');
      if ('name' in patch) bits.push('名字');
      if ('enabled' in patch) bits.push(patch.enabled ? '启用' : '停用');
      rows.push({ kind: '改脚本', text: `改了「${name}」的${bits.join('、')}` });
    }
    for (const a of edit.scripts.added) {
      rows.push({ kind: '新增脚本', text: `往预设里装了一条脚本「${a.name}」（${(String(a.content ?? '').length / 1024).toFixed(1)} KB，${a.enabled ? '启用' : '停用'}）` });
    }
    const origOrder = (model?.entries ?? []).filter((e) => e.listed).map(keyOf);
    if (edit.order.join() !== origOrder.join()) {
      const moved = edit.order.filter((k, i) => origOrder[i] !== k).length;
      rows.push({ kind: '排序', text: `调整了提示词顺序（${moved} 个位置与原来不同）` });
    }
    for (const [idx, on] of edit.enabled) {
      const was = byIdx.get(idx)?.enabled;
      if (!!was === !!on) continue;
      rows.push({ kind: '开关', text: `${on ? '打开' : '关闭'}「${nameOf(idx)}」` });
    }
    const origListed = new Set(origOrder);
    for (const idx of edit.deleted) origListed.delete(keyOf(byIdx.get(idx) ?? {}));
    const nowListed = new Set(edit.order);
    for (const e of model?.entries ?? []) {
      const k = keyOf(e);
      if (edit.deleted.has(e.idx)) continue;
      if (!origListed.has(k) && nowListed.has(k)) rows.push({ kind: '入列', text: `把「${e.name}」加进提示词列表（原来永远不会生效）` });
      if (origListed.has(k) && !nowListed.has(k)) rows.push({ kind: '出列', text: `把「${e.name}」移出提示词列表（不再进入上下文）` });
    }
    return rows;
  }

  /* ── 导出前检查 ───────────────────────────────────────────────── */

  /**
   * @returns {{blocking: object[], warnings: object[], notes: object[]}}
   */
  function exportChecks(json, edit, model, opts = {}) {
    const blocking = [];
    const warnings = [];
    const notes = [];

    /* 自己写的条目（新增的 + 工具生成的骨架）：正文没写就不许开着。
       位置标记是唯一的例外 —— 它们的正文本来就该是空的，但必须开着。 */
    const own = ownEntries(edit, model);
    for (const r of own) {
      if (r.marker) {
        if (!r.enabled) {
          warnings.push({
            kind: '位置标记被关掉',
            text: `「${r.name}」是酒馆注入位标记，关掉之后对应的世界书/角色卡/聊天记录进不了上下文。它的正文为空是正确的。`,
          });
        }
        continue;
      }
      if (!isPending(r.content) || !r.enabled) continue;
      const isMain = r.identifier === 'main';
      blocking.push({
        kind: isMain ? '主提示还没写' : '待填却开着',
        text: isMain
          ? `「${r.name}」占着主提示（main）槽位，正文还是空的——导出的预设没有任何核心指令。写进去，或者先把它关掉。`
          : `「${r.name}」正文还是空的（或只有待填标记），却设成开启——工具不替你写内容，请先写，或者先关掉。`,
      });
    }

    /* 新增条目的标识/槽位问题 */
    const usedIdentifiers = new Map();
    for (const e of model?.entries ?? []) {
      if (edit.deleted.has(e.idx)) continue;
      if (edit.own.has(e.idx)) continue;               // 自己生成的条目自己清楚
      if (!usedIdentifiers.has(e.identifier)) usedIdentifiers.set(e.identifier, e.name);
    }
    for (const a of edit.added) {
      if (usedIdentifiers.has(a.identifier)) {
        blocking.push({
          kind: '标识冲突',
          text: `新增的「${a.name}」用了已经被「${usedIdentifiers.get(a.identifier)}」占着的标识/槽位（${a.identifier}）——酒馆里一个槽位只能有一个主人。`,
        });
      }
      if (!a.name || !a.name.trim()) blocking.push({ kind: '无名条目', text: '有一条新增条目没有名字，先起个名字。' });
      if (a.slot && !(opts.slotIds ?? SLOT_CHOICES.map((s) => s.id)).includes(a.slot)) {
        warnings.push({ kind: '未知槽位', text: `「${a.name}」用的槽位 ${a.slot} 不在酒馆内置槽位表里。` });
      }
    }

    /* 删掉注入位 = 那类内容从此进不了上下文 */
    const anchors = opts.anchorIds ?? edit.anchors ?? [];
    const deletedAnchorNames = [];
    for (const idx of edit.deleted) {
      const e = (model?.entries ?? []).find((x) => x.idx === idx);
      if (e && anchors.includes(e.identifier)) deletedAnchorNames.push(`${e.name}（${e.identifier}）`);
    }
    if (deletedAnchorNames.length) {
      blocking.push({
        kind: '删掉了注入位',
        text: `这些条目是酒馆注入世界书/角色卡/聊天记录的位置标记，删掉之后对应内容不会进上下文：${deletedAnchorNames.join('、')}。`
          + '如果只是不想要它的正文，请把正文清空而不是删条目。',
      });
    }

    /* 改名会让按名字匹配的东西失效 */
    const renamed = [...edit.names.entries()].filter(([idx, n]) => n !== (model?.entries ?? []).find((e) => e.idx === idx)?.name);
    if (renamed.length) {
      warnings.push({
        kind: '改了名字',
        text: `有 ${renamed.length} 条条目被改名。面板分组、正则脚本常常是按**条目名**匹配的，改名会让它们找不到目标。`,
      });
    }
    /* 同名条目：酒馆允许，但你会分不清 */
    const dupNames = new Map();
    for (const e of model?.entries ?? []) {
      const n = edit.names.get(e.idx) ?? e.name;
      if (edit.deleted.has(e.idx)) continue;
      if (!dupNames.has(n)) dupNames.set(n, 0);
      dupNames.set(n, dupNames.get(n) + 1);
    }
    for (const a of edit.added) dupNames.set(a.name, (dupNames.get(a.name) ?? 0) + 1);
    const dups = [...dupNames.entries()].filter(([, n]) => n > 1).map(([n]) => n);
    if (dups.length) {
      warnings.push({ kind: '重名', text: `有 ${dups.length} 个名字被多条条目共用：${dups.slice(0, 5).join('、')}${dups.length > 5 ? ' 等' : ''}。` });
    }
    /* 出列的条目 */
    const nowListed = new Set(edit.order);
    const outListed = (model?.entries ?? []).filter((e) => e.listed && !nowListed.has(keyOf(e)) && !edit.deleted.has(e.idx));
    if (outListed.length) {
      warnings.push({
        kind: '移出列表',
        text: `有 ${outListed.length} 条条目被移出提示词列表，它们不会再进入上下文：${outListed.slice(0, 5).map((e) => e.name).join('、')}${outListed.length > 5 ? ' 等' : ''}。`,
      });
    }

    /* ── 面板脚本 ────────────────────────────────────────────────────
       这一条是补上一个真实踩过的坑：在画布上搭了面板（新建功能区/功能项，
       或者调了外观），然后直接点「导出预设」——文件看着完全正常，但里面
       **没有面板脚本**，装进酒馆什么都不会发生，而且屏幕上没有任何提示。
       所以：只要这一轮搭过面板，就一定要说清它到底有没有进这个文件。
       opts.panel 由界面给出这一轮的搭建意图：
         { groups: 功能区个数, appearance: 是否动过外观, unapplied: 脚本在但改动没写进, ignored: 明确说不要面板 } */
    const pi = opts.panel ?? null;
    const panels = panelScriptViews(edit, json, model);
    const wantsPanel = !!pi && (pi.groups > 0 || pi.appearance === true);
    if (panels.length) {
      notes.push({
        kind: '面板脚本',
        text: `导出的预设里带着 ${panels.length} 个浮动面板脚本：${panels.map((s) => `${s.name}（${Math.round(s.bytes / 1024)}KB）`).join('、')}`
          + '——酒馆助手会在打开聊天时自动执行它。',
      });
      const off = panels.filter((s) => !s.enabled);
      if (off.length) {
        warnings.push({
          kind: '面板脚本被关着',
          text: `面板脚本「${off.map((s) => s.name).join('、')}」的 enabled 是关的——酒馆助手不会执行被关掉的脚本，悬浮球不会出现。`
            + '去「脚本编辑」把它打开。',
        });
      }
      if (wantsPanel && pi.unapplied && !pi.ignored) {
        blocking.push({
          kind: '面板改动还没应用',
          text: '你在「面板搭建 / 面板外观」里改了东西，但还没写进面板脚本——现在导出，面板还是改之前的样子。'
            + '点「装进这份预设」把它写进去（只替换配置与分组那两段，面板代码一行不动），再导出。',
        });
      }

      /* 面板能力：预设里带的这份面板会不会"长按条目改正文"（面板 0.5.0 起）。
         分级处理，别一把拦死：
           · 是我们这套面板、但缺这个能力 → **拦住**：导出的就是他要的那份面板，
             缺能力等于没达到目的；给一键补救「换成新版面板」，再给一条活路
             「就带这个旧面板导出」（按 revision 记账，动一下就会重新问）。
           · 是**别人的**面板（没有我们的分组块）→ 只说一句，不拦：
             人家预设里本来就有个脚本，很正常，也没义务换成我们的。 */
      const sup = panels.map((s) => ({ s, ...panelSupport(s.content) }));
      const ours = sup.filter((x) => x.ours);
      /* 每个能力一条拦截，各有各的 kind（老面板缺哪个就说哪个）。
         两条的"活路"共用同一个 staleIgnored——说一次"就带旧的"就够了，别问两遍。 */
      const CAP_TEXT = {
        longPressEdit: {
          kind: '面板是旧版：不能长按改正文',
          what: '**长按条目改正文**',
        },
        controlsV06: {
          kind: '面板是旧版：没有隐藏按钮 / 壁纸开关 / 小方案改名',
          what: '**顶部隐藏按钮、壁纸开关 + 纯色底、小方案长按改名**',
        },
      };
      const stale = ours.filter((x) => x.missing.length > 0);
      if (stale.length && !pi?.staleIgnored) {
        for (const [cap, info] of Object.entries(CAP_TEXT)) {
          const hit = stale.filter((x) => x.missing.includes(cap));
          if (!hit.length) continue;
          blocking.push({
            kind: info.kind,
            text: `这份预设里的面板脚本「${hit.map((x) => x.s.name).join('、')}」是旧版——`
              + info.what + '这些能力它没有，导出去以后在酒馆里点了不会有反应。'
              + '点「换成新版面板」一键换成新版（你在「面板外观 / 面板分组」里改过的设置会带过去）；'
              + '要是就想带着这个旧面板导出，点「就带这个旧面板导出」。',
          });
        }
      } else if (stale.length) {
        warnings.push({
          kind: '带着旧版面板导出',
          text: '你说了"就带这个旧面板导出"——那么长按条目改正文、顶部隐藏按钮、壁纸开关、'
            + '小方案改名这些都不会有。改动一下别的地方，它会再问你一次。',
        });
      } else if (panels.length && !ours.length) {
        warnings.push({
          kind: '面板不是这套',
          text: `这份预设自带的面板脚本「${panels.map((s) => s.name).join('、')}」不是本工具这套面板`
            + '（没有我们的分组块），所以"长按条目改正文"这类能力跟着它走。'
            + '想让这份预设也有，去「面板外观」页点「装进这份预设」。',
        });
      }
    } else if (wantsPanel && !pi.ignored) {
      blocking.push({
        kind: '面板没装进预设',
        text: `你在搭建面板（${[pi.groups > 0 ? `${pi.groups} 个功能区` : '', pi.appearance ? '外观配置' : ''].filter(Boolean).join(' + ')}），`
          + '但这份预设里没有任何面板脚本——现在导出的是一个**没有面板**的预设。'
          + '点「装进这份预设」把它写进 extensions.tavern_helper.scripts 之后再导出；'
          + '如果这份预设本来就不该带面板，点「这份预设就是不要面板」。',
      });
    } else if (pi && pi.ignored && (pi.groups > 0 || pi.appearance)) {
      notes.push({ kind: '面板', text: '你选了「这份预设就是不要面板」——搭的东西不会进这个文件（改动还留在界面上，随时可以改主意）。' });
    }

    if (!isDirty(edit)) notes.push({ kind: '无改动', text: '还没有做任何改动——导出的文件会和原文件逐字节等价。' });
    const pendingCount = edit.added.filter((a) => isPending(a.content)).length;
    if (pendingCount) {
      notes.push({ kind: '待填', text: `有 ${pendingCount} 条新增条目等你写内容（写完后它才会变成"已填"）。工具不会代写。` });
    }
    return { blocking, warnings, notes };
  }

  /* ── 来源完整性自证 ───────────────────────────────────────────── */

  /**
   * 逐条比对"没动过的来源条目"是否一个字节都没变。
   *
   * 比的是**正文与注入位置这一类"别人的东西"**，故意排除 `name` 与 `enabled`
   * ——那两个是使用者有权改的结构字段（改名、开关），不是来源正文。
   *
   * 用指纹（parse.js 的 FNV-1a）而不是安全哈希：这里只需要发现"被改过"，不需要抗碰撞；
   * Node 侧的测试用 sha1 做权威校验。
   */
  const PROSE_FIELDS = ['identifier', 'content', 'role', 'system_prompt',
    'injection_position', 'injection_depth', 'injection_order', 'marker', 'forbid_overrides'];
  const proseOf = (p) => JSON.stringify(PROSE_FIELDS.map((k) => [k, p[k]]));

  function verifySourceIntact(json, edit, model, fingerprintFn) {
    const fp = fingerprintFn ?? ((s) => s);
    const after = applyEdit(json, edit, model);
    const pool = new Map();                       // 正文指纹 -> 还剩几条没用掉
    for (const p of after.prompts ?? []) {
      const k = fp(proseOf(p));
      pool.set(k, (pool.get(k) ?? 0) + 1);
    }
    const changed = [];
    let checked = 0;
    let removed = 0;
    let own = 0;
    let editedCount = 0;
    for (const e of model.entries) {
      const orig = (json.prompts ?? [])[e.idx];
      if (!orig) continue;
      if (edit.own.has(e.idx)) { own++; continue; }              // 自己写的条目，不算"别人的正文"
      if (edit.deleted.has(e.idx)) { removed++; continue; }      // 删除是显式动作，不算"被改写"
      if (edit.content.has(e.idx)) { editedCount++; continue; }  // 你**显式改过**这条正文
      const k = fp(proseOf(orig));
      const left = pool.get(k) ?? 0;
      if (left > 0) { pool.set(k, left - 1); checked++; } else changed.push(e.name);
    }
    return { checked, changed, removed, own, edited: editedCount };
  }

  root.PresetEditor = {
    FILL_MARK, SLOT_CHOICES, MARKER_SLOTS, REGEX_FIELD_LABEL, regexKey,
    emptyEdit, isDirty, structuralDirty, canEditContent, isMarker,
    isOwnContent, setContent, contentOf, revertContent, setEnabledByName, enabledByName,
    ownEntries, pendingProgress,
    addEntry, deleteAdded, moveKey, removeFromOrder, appendToOrder,
    addRegex, deleteRegex, moveRegex, regexList, regexViews, setRegexField,
    scriptViews, setScriptField, addScript, deleteScript, scriptKeyOf,
    testRegex, runRegexChain, checkScriptSyntax, lineDiff,
    applyEdit, summary, exportChecks, verifySourceIntact,
    looksLikePanel, panelScriptViews, PANEL_MARKS, PANEL_CAP_MARKS, PANEL_IDENTITY_MARK,
    panelSupport, upgradePanelContent,
    deleteScript, undeleteScript,
    isPending, newIdentifier, keyOf, orderIndexOf, PROSE_FIELDS, proseOf,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
