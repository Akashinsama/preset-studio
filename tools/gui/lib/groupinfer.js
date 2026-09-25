/**
 * 按一份预设**推断面板分组**。
 *
 * 为什么需要它：面板不只是外观，它还得知道"管哪些条目"。我们那份面板的模块列表是
 * 给芳乃这一套条目写死的（`spec/groups.json` 25 个子集 + 10 个分节标题），
 * 装到别人的预设上只会列出一堆找不到的条目。这个文件就是"把任意预设读成模块表"。
 *
 * 推断依据全部来自解析结果里**可验证的事实**，不猜语义：
 *   · 同一变量被多条**非清空型**条目设置 → 那是"选一"（作者写成互斥了）
 *   · 同一变量被多条 addvar 累加       → 那是"可多选"
 *   · 注入位槽位条目                    → 只读区（面板不碰，关掉会丢上下文）
 *   · 清空型初始化条目                  → 只读区（面板不碰，关掉会让一批变量失去初值）
 *   · 思维链标签族                      → 强制互斥的"思考方式（选一）"
 *   · 正文里写着"此处自定义/点进去看"    → 可填输入框
 *   · 剩下没被覆盖的                    → 兜底一个"其余条目"，保证没有条目够不着
 *
 * 输出形状 = 面板 GROUPS/SECTIONS/THINKING_TAGS 的形状（见 panel-core.js 的
 * FANO_PANEL_GROUPS 注释）。**一律按条目名匹配**，所以重名条目会被跳过并记进 notes——
 * 名字歧义会让面板点开一个关掉另一个。
 *
 * 纯函数、零 DOM、零依赖；只读。
 */
(function (root) {
  'use strict';

  /** 注入位槽位（面板不碰）：关掉它们，世界书/角色卡/聊天记录就进不了上下文 */
  const SLOT_IDS = ['main', 'nsfw', 'jailbreak', 'chatHistory', 'dialogueExamples',
    'charDescription', 'charPersonality', 'worldInfoBefore', 'worldInfoAfter',
    'personaDescription', 'scenario', 'enhanceDefinitions'];

  const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const short = (s, n = 46) => {
    const t = clean(s);
    return t.length > n ? t.slice(0, n) + '…' : t;
  };
  /** 条目名 → 稳定 id（面板用 id 做 DOM 与 localStorage 的键，不能有怪字符） */
  const slug = (s) => 'g_' + [...String(s ?? '')].reduce((a, c) => a + (c.codePointAt(0).toString(36)), '')
    .slice(0, 24).replace(/[^a-z0-9]/gi, '');

  /**
   * 名字前缀：作者自己就爱用 `👤人称-` / `✔️文风-` / `⚠️难度：` 这种写法分组。
   * 切到第一个分隔符为止；没有分隔符就取前 3 个字。
   * 纯启发式——所以推出来的模块会标"不准就自己改"，而且只在**变量关系推不出来**的条目上用。
   */
  const DELIM = /[-－—–:：·、,，。;；/|｜(（[【{｛\s　]/;
  function prefixKey(name) {
    const n = clean(name);
    if (!n) return '';
    /* 纯英文开头的（DeepSeek禁词 / nsfw-体型差…）：取整个英文词，别切成 "Dee" */
    const ascii = /^[A-Za-z][A-Za-z0-9]*/.exec(n);
    if (ascii) return ascii[0].length >= 3 ? ascii[0] : '';
    const i = n.search(DELIM);
    let head = i > 0 ? n.slice(0, i) : [...n].slice(0, 3).join('');
    head = head.replace(/[\d０-９]+$/g, '').trim();
    /* 前缀太短（只剩个符号）就没意义 */
    return [...head].length >= 2 ? head : '';
  }

  /** 集合相似度：并集里有多少是交集（用来合并"其实是同一组"的互斥族） */
  function jaccard(a, b) {
    const A = new Set(a);
    const B = new Set(b);
    let inter = 0;
    for (const x of A) if (B.has(x)) inter++;
    const uni = new Set([...A, ...B]).size;
    return uni ? inter / uni : 0;
  }

  /** 合并高度重叠的集合，并丢掉"完全被别人包住"的小集合 */
  function mergeSets(entries, threshold = 0.6) {
    let list = entries.map((e) => ({ ...e, members: [...e.members], variables: [...e.variables] }));
    let changed = true;
    while (changed) {
      changed = false;
      outer:
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          if (jaccard(list[i].members, list[j].members) >= threshold) {
            const merged = {
              members: [...new Set([...list[i].members, ...list[j].members])].sort((a, b) => a.localeCompare(b, 'zh')),
              variables: [...new Set([...list[i].variables, ...list[j].variables])],
            };
            list = list.filter((_, k) => k !== i && k !== j).concat([merged]);
            changed = true;
            break outer;
          }
        }
      }
    }
    /* 丢掉真子集：它已经在更大的那组里了 */
    const kept = list.filter((g) => !list.some((o) => o !== g && g.members.every((m) => o.members.includes(m)) && o.members.length > g.members.length));
    return kept;
  }

  /**
   * @param {object} model parsePreset 的结果
   * @param {object} json  原始预设（读 extensions 用；可省略）
   * @param {object} opts  { includeDisabled: 是否把关闭的条目也纳入模块（默认 true） }
   */
  function inferGroups(model, json, opts = {}) {
    const notes = [];
    if (!model || !model.entries || !model.entries.length) {
      return { groups: [], sections: [], thinkingTags: [], display: {}, notes: [{ level: 'err', text: '没有条目，无法推断分组。' }], stats: {} };
    }

    /* 面板按**条目名**匹配，所以先把名字整理干净：
       没有名字的、重名的都不能进模块（否则点开会关错条目）。 */
    const listed = model.entries.filter((e) => (opts.includeDisabled === false ? (e.listed && e.enabled) : e.listed));
    const nameCount = new Map();
    for (const e of listed) {
      const n = clean(e.name);
      nameCount.set(n, (nameCount.get(n) || 0) + 1);
    }
    const dupNames = [...nameCount.entries()].filter(([n, c]) => c > 1 && n).map(([n]) => n);
    const usable = listed.filter((e) => {
      const n = clean(e.name);
      return n && nameCount.get(n) === 1;
    });
    const nameOf = (e) => clean(e.name);
    const usableNames = new Set(usable.map(nameOf));

    if (dupNames.length) {
      notes.push({
        level: 'warn',
        text: `有 ${dupNames.length} 个条目名出现了不止一次（${dupNames.slice(0, 5).join('、')}${dupNames.length > 5 ? ' 等' : ''}），`
          + '面板是按**名字**匹配条目的，重名会让它点开一个却关掉另一个——这些条目被排除在模块外，请先改名。',
      });
    }
    const unnamed = listed.filter((e) => !clean(e.name)).length;
    if (unnamed) notes.push({ level: 'warn', text: `有 ${unnamed} 条条目没有名字，无法进模块。` });

    /* ── 1. 只读区：注入位 + 清空型初始化 ────────────────────────── */
    const slotEntries = usable.filter((e) => SLOT_IDS.includes(e.identifier));
    const initEntries = usable.filter((e) => e.clearer && !SLOT_IDS.includes(e.identifier));

    /* ── 2. 选一：按"设置者集合"聚成模块（同一个集合 = 同一组互斥选项）── */
    const fixedNames = new Set([...slotEntries, ...initEntries].map(nameOf));
    const setName = new Map();          // 变量名 -> 条目名
    for (const e of usable) for (const n of e.name ? [nameOf(e)] : []) setName.set(n, e);

    const singleSets = new Map();       // key: 设置者名字集合 -> { members, variables }
    for (const v of model.variables) {
      if (!v.exclusive) continue;
      const setters = (v.realSetBy ?? v.setBy).map((i) => model.entries.find((e) => e.idx === i)).filter(Boolean)
        .map(nameOf).filter((n) => usableNames.has(n) && !fixedNames.has(n));
      const uniq = [...new Set(setters)];
      if (uniq.length < 2) continue;
      const readers = v.getBy.map((i) => model.entries.find((e) => e.idx === i)).filter(Boolean).length;
      if (!readers) continue;           // 没人读 → 不是"选项"，只是一堆没人用的开关
      const key = uniq.slice().sort().join('\u0000');
      if (!singleSets.has(key)) singleSets.set(key, { members: uniq.slice().sort((a, b) => a.localeCompare(b, 'zh')), variables: [] });
      singleSets.get(key).variables.push(v.name);
    }

    /* ── 3. 可多选：按"累加者集合"聚成模块 ───────────────────────── */
    const multiSets = new Map();
    for (const v of model.variables) {
      if (v.addBy.length < 2) continue;
      const adders = v.addBy.map((i) => model.entries.find((e) => e.idx === i)).filter(Boolean)
        .map(nameOf).filter((n) => usableNames.has(n) && !fixedNames.has(n));
      const uniq = [...new Set(adders)];
      if (uniq.length < 2) continue;
      if (!v.getBy.length) continue;
      const key = uniq.slice().sort().join('\u0000');
      if (!multiSets.has(key)) multiSets.set(key, { members: uniq.slice().sort((a, b) => a.localeCompare(b, 'zh')), variables: [] });
      multiSets.get(key).variables.push(v.name);
    }

    /* ── 4. 思考方式：标签族 → 强制互斥 ─────────────────────────── */
    /* 两件事要分开：
       · thinkingTags（互斥**执行**）用族的**全量**成员——面板靠它"开了一条就关掉另一族"，
         成员多没关系，多一个名字就多一条保险。
       · 但**模块**不能拿全量成员（实测 konatan 族有 25 条，里面大半只是"提到"这个标签的
         格式示例）——那样做出来的开关排没法用。所以模块只收**名字看起来就是一条思考链**的。 */
    const thinkingTags = [];
    const thinkingGroups = [];
    const CHAIN_NAME = /思维链|思考|thinking|ICOT|COT|konatan/i;
    for (const f of model.tagFamilies) {
      if (f.role !== '思维链标签') continue;
      const all = f.members.map((m) => clean(m.name)).filter((n) => usableNames.has(n));
      if (all.length < 2) continue;
      thinkingTags.push({ id: f.id, label: f.label, note: `同属「${f.label}」的条目通常只该开一条。`, members: all });
      const byName = all.filter((n) => CHAIN_NAME.test(n));
      if (byName.length >= 2 && byName.length <= 12) {
        thinkingGroups.push({
          id: 'thinking_' + f.id,
          label: f.label,
          mode: 'single',
          note: '面板会强制互斥：开了一条，同族其它条自动关掉。',
          members: byName,
        });
      } else if (byName.length > 12) {
        notes.push({
          level: 'warn',
          text: `「${f.label}」这一族有 ${all.length} 条条目提到这个标签（其中 ${byName.length} 条名字像思考链），`
            + '没法自动圈出一个干净的"思考方式"模块——请在界面上自己挑。互斥本身仍然生效。',
        });
      }
    }

    /* ── 5. 自定义内容：正文里写着"要你自己填"的 ─────────────────── */
    const editableEntries = usable.filter((e) => e.fill && !fixedNames.has(e.name));
    let editableGroup = null;
    if (editableEntries.length) {
      const editable = {};
      for (const e of editableEntries) {
        editable[nameOf(e)] = {
          hint: short(e.head || e.content) || '这条要你填内容。',
          locked: e.pureSetter !== true && e.chars > 0 && !e.sets.length ? true : undefined,
        };
      }
      editableGroup = {
        id: 'editable',
        label: '要你自己填的条目',
        mode: 'editable',
        note: '正文里写着"此处自定义 / 点进去看"之类的话——推断出来的，可能不全，请核对。',
        editable,
        members: editableEntries.map(nameOf),
      };
    }

    /* ── 6. 兜底：剩下没被任何模块覆盖的 ─────────────────────────── */
    /* 注意：`covered` 只登记**真的进了某个模块**的条目。
       早先这里把 thinkingTags 的**全量**成员都算成"已覆盖"，结果族的成员里
       那些没进模块的条目既不在模块里、也不在兜底里 —— 变得在面板上根本点不到。
       族的全量成员只用于"互斥执行"，不用于"已覆盖"。 */
    const covered = new Set([...fixedNames]);
    for (const s of singleSets.values()) for (const m of s.members) covered.add(m);
    for (const s of multiSets.values()) for (const m of s.members) covered.add(m);
    for (const g of thinkingGroups) for (const m of g.members) covered.add(m);
    if (editableGroup) for (const m of editableGroup.members) covered.add(m);

    const rest = usable.filter((e) => !covered.has(nameOf(e)));
    /* 再按名字前缀聚一次：作者自己爱用 `👤人称-` / `✔️文风-` 这种写法。
       只在"变量关系推不出来"的条目上做，而且要求 ≥2 条——纯粹为了少留一堆散条目。 */
    const prefixBuckets = new Map();
    for (const e of rest) {
      const k = prefixKey(nameOf(e));
      if (!k) continue;
      if (!prefixBuckets.has(k)) prefixBuckets.set(k, []);
      prefixBuckets.get(k).push(e);
    }
    const prefixGroups = [];
    for (const [key, list] of prefixBuckets) {
      if (list.length < 2 || list.length > 40) continue;
      const members = list.map(nameOf);
      for (const m of members) covered.add(m);
      prefixGroups.push({ id: slug('prefix' + key + prefixGroups.length), label: '按名字前缀：' + key, mode: 'multi', note: `名字都以「${key}」开头的条目（推断，不准就自己改）。`, members });
    }
    const restAfterPrefix = rest.filter((e) => !covered.has(nameOf(e)));
    /* 正文 0 字且不是槽位的（多半是分隔/标记条目）单独放，免得混进开关排 */
    const emptyOnes = restAfterPrefix.filter((e) => !e.chars);
    const realRest = restAfterPrefix.filter((e) => e.chars > 0);

    /* ── 7. 组装 groups / sections ───────────────────────────────── */
    const groups = [];
    const push = (g) => { g.id = g.id || slug(g.label + groups.length); groups.push(g); return g; };

    if (slotEntries.length) {
      push({
        id: 'anchors', label: '酒馆注入位（只读）', mode: 'fixed',
        note: '这些条目占着世界书 / 角色卡 / 用户人设 / 聊天记录的注入位。面板不碰它们——关掉会直接丢上下文。',
        members: slotEntries.map(nameOf),
      });
    }
    if (initEntries.length) {
      push({
        id: 'initializers', label: '初始化条目（只读）', mode: 'fixed',
        note: '这些条目的正文几乎全是 setvar，用来给变量置初值。面板不碰——关掉会让一批变量失去初值。',
        members: initEntries.map(nameOf),
      });
    }
    let n = 0;
    for (const { members, variables } of mergeSets([...singleSets.values()])) {
      n++;
      push({
        id: 'choice' + n,
        label: '选一 · 第 ' + n + ' 组',
        mode: 'single',
        note: `推断依据：变量 ${variables.slice(0, 4).join('、')}${variables.length > 4 ? ' 等' : ''} 被这几条分别设置——作者写成了互斥。名字请自己改成看得懂的。`,
        members,
      });
    }
    n = 0;
    for (const { members, variables } of mergeSets([...multiSets.values()])) {
      n++;
      push({
        id: 'stack' + n,
        label: '可多选 · 第 ' + n + ' 组',
        mode: 'multi',
        note: `推断依据：变量 ${variables.slice(0, 4).join('、')}${variables.length > 4 ? ' 等' : ''} 被这几条累加（addvar），可以叠加。`,
        members,
      });
    }
    for (const g of thinkingGroups) push(g);
    if (editableGroup) push(editableGroup);
    for (const g of prefixGroups) push(g);
    if (realRest.length) {
      push({
        id: 'rest', label: '其余条目', mode: 'multi',
        note: '没被上面任何模块覆盖的条目都在这里——兜底用，保证没有条目够不着。可以自己拆成更细的模块。',
        members: realRest.map(nameOf),
      });
    }
    if (emptyOnes.length) {
      push({
        id: 'markers', label: '空条目 / 分隔标记', mode: 'multi',
        note: '正文是 0 字的条目（多半是分隔或标记）。',
        members: emptyOnes.map(nameOf),
      });
    }

    const sections = [];
    const secOf = (id) => groups.find((g) => g.id === id);
    const addSec = (title, ids) => {
      const gs = ids.filter((id) => secOf(id));
      if (gs.length) sections.push({ title, groups: gs });
    };
    addSec('要你自己填的', editableGroup ? ['editable'] : []);
    addSec('选一（互斥）', groups.filter((g) => g.mode === 'single' && !g.id.startsWith('thinking_')).map((g) => g.id));
    addSec('思考方式（强制互斥）', thinkingGroups.map((g) => g.id));
    addSec('可多选', groups.filter((g) => g.mode === 'multi' && g.id !== 'rest' && g.id !== 'markers' && !g.id.startsWith('prefix') && !g.label.startsWith('按名字前缀')).map((g) => g.id));
    addSec('按名字前缀分组（推断，不准就改）', prefixGroups.map((g) => g.id));
    addSec('其余条目', ['rest', 'markers']);
    addSec('只读（面板不碰）', ['anchors', 'initializers']);

    /* ── 8. 统计与"我不确定"的地方 ───────────────────────────────── */
    const managed = groups.filter((g) => g.mode !== 'fixed').reduce((a, g) => a + (g.members?.length || 0), 0);
    /* 注意统计要按**前缀分组之后**的剩余量算，否则会报一个偏大的数 */
    const leftover = realRest.length + emptyOnes.length;
    if (leftover > 6) {
      notes.push({
        level: 'info',
        text: `还有 ${leftover} 条条目没被推断出模块关系，都放进了「其余条目」。`
          + '它们多半是彼此独立的功能条目——想分组就自己在界面上拆。',
      });
    }
    if (prefixGroups.length) {
      notes.push({
        level: 'info',
        text: `按名字前缀猜出了 ${prefixGroups.length} 组（${prefixGroups.slice(0, 4).map((g) => g.label.replace('按名字前缀：', '')).join('、')}${prefixGroups.length > 4 ? ' 等' : ''}）——纯启发式，名字不合你意就自己改。`,
      });
    }
    if (!singleSets.size && !multiSets.size) {
      notes.push({ level: 'warn', text: '这份预设里没有发现"变量互斥/累加"结构，所以推不出选一或可多选模块——按功能自己分组吧。' });
    }
    notes.push({
      level: 'info',
      text: `推断结果：${groups.length} 个模块（其中只读 ${groups.filter((g) => g.mode === 'fixed').length} 个）`
        + `，管理 ${managed} 条条目；思维链标签组 ${thinkingTags.length} 个。`,
    });

    return {
      groups, sections, thinkingTags, display: {},
      notes,
      stats: {
        groups: groups.length, managed, fixed: fixedNames.size, usable: usable.length,
        skippedDuplicates: dupNames.length, unnamed,
      },
    };
  }

  /** 把推断结果对着预设核一遍：名字在不在、有没有互斥模块同时开着 */
  function validateGroups(override, model) {
    const errors = [];
    const warnings = [];
    if (!override || !Array.isArray(override.groups)) {
      return { errors: [{ kind: '结构', text: '分组数据不是数组。' }], warnings };
    }
    const byName = new Map();
    for (const e of model?.entries ?? []) {
      const n = clean(e.name);
      if (!n) continue;
      if (!byName.has(n)) byName.set(n, []);
      byName.get(n).push(e);
    }
    const seenGroupIds = new Set();
    const seenMembers = new Map();
    for (const g of override.groups) {
      if (!g.id) errors.push({ kind: '缺 id', text: `模块「${g.label ?? '?'}」没有 id（面板用它做 DOM 与状态的键）。` });
      else if (seenGroupIds.has(g.id)) errors.push({ kind: 'id 重复', text: `模块 id「${g.id}」重复了。` });
      seenGroupIds.add(g.id);

      const modes = ['fixed', 'single', 'multi', 'editable', 'bundle', 'hidden'];
      if (!modes.includes(g.mode)) errors.push({ kind: 'mode 不合法', text: `模块「${g.label}」的 mode=${g.mode} 不在 ${modes.join('/')} 里。` });
      if (g.mode === 'bundle' && !(g.options || []).length) errors.push({ kind: 'bundle 缺选项', text: `模块「${g.label}」是 bundle 但没有 options。` });
      if (g.mode === 'editable' && !g.editable) errors.push({ kind: 'editable 缺内容', text: `模块「${g.label}」是 editable 但没写 editable 映射。` });

      const members = g.mode === 'bundle'
        ? (g.options || []).flatMap((o) => [...(o.members || []), ...(o.tunables || []).flatMap((t) => t.members || [])])
        : (g.members || []);
      for (const name of members) {
        const hits = byName.get(name);
        if (!hits) { errors.push({ kind: '条目不存在', text: `模块「${g.label}」里的「${name}」在这份预设里找不到——面板会把它标成"缺失"。` }); continue; }
        if (hits.length > 1) warnings.push({ kind: '重名条目', text: `「${name}」在预设里有 ${hits.length} 条同名条目，面板按名字匹配会歧义。` });
        if (!seenMembers.has(name)) seenMembers.set(name, []);
        seenMembers.get(name).push(g.id);
      }
      if ((g.mode === 'single' || g.mode === 'multi') && (g.members || []).length < 2 && g.mode !== 'editable') {
        warnings.push({ kind: '模块只有一条', text: `模块「${g.label}」只有 ${(g.members || []).length} 条条目，做成开关排有点空。` });
      }
    }
    /* 分节引用的 group id 必须存在 */
    for (const s of override.sections ?? []) {
      for (const id of s.groups ?? []) {
        if (!seenGroupIds.has(id)) errors.push({ kind: '分节引用了不存在的模块', text: `分节「${s.title}」引用了 ${id}，但没有这个模块。` });
      }
    }
    /* 同一条目出现在多个"选一"模块里 → 面板可能同时开两条 */
    for (const [name, ids] of seenMembers) {
      const singles = ids.filter((id) => override.groups.find((g) => g.id === id)?.mode === 'single');
      if (singles.length > 1) {
        warnings.push({ kind: '同一条目属于多个互斥模块', text: `「${name}」同时出现在 ${singles.length} 个"选一"模块里，面板的互斥逻辑会互相打架。` });
      }
    }
    return { errors, warnings };
  }

  root.PresetGroupInfer = { inferGroups, validateGroups, SLOT_IDS, slug };
})(typeof globalThis !== 'undefined' ? globalThis : this);
