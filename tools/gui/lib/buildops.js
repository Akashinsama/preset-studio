/**
 * 「面板搭建」的操作层（纯函数）——按面板的三层结构增删改。
 *
 * 三层对应关系（这是整个工具的核心概念，写清楚）：
 *
 *   分节 sections   = 面板上的大标题（"文风"、"人称与叙事"…）
 *   功能区 group    = 一个模块（"破甲（按模型分流）"…），有模式：
 *                     single 选一 · multi 可多选 · fixed 只读 · editable 可填 · bundle 骨架+档位
 *   功能项 member   = 一个**条目**（预设里真实存在的 prompt）
 *   功能选项        = 选一型功能区里的另一个条目（每一项天然就是一个选项）
 *
 * 所以"加功能项/加功能选项"在预设层面是同一件事：**新建一个空条目并挂进这个功能区**。
 * 条目本身由 editor.js 的 addEntry 建（正文留空标「待填」、默认关），这里只管面板结构。
 *
 * 所有函数都**就地改**传入的草稿，并且只改草稿 —— 面板自带的那份分组不会被碰。
 */
(function (root) {
  'use strict';

  const clone = (x) => JSON.parse(JSON.stringify(x));

  /** 把面板自带的分组复制成可编辑草稿（第一次编辑动作时调用） */
  function seedFrom(defaults) {
    const sectionOf = new Map();
    for (const s of defaults.sections || []) for (const id of s.groups || []) sectionOf.set(id, s.title);
    return {
      groups: (defaults.groups || []).map((g) => ({ ...clone(g), __section: sectionOf.get(g.id) || '未分节' })),
      sections: [],            // 由 __section 在导出时重建，这里留空避免两份真相
      thinkingTags: clone(defaults.thinkingTags || []),
      display: clone(defaults.display || {}),
      source: 'seeded',
    };
  }

  const sectionsOf = (draft) => {
    const out = [];
    for (const g of draft.groups) {
      const t = g.__section || '未分节';
      if (!out.includes(t)) out.push(t);
    }
    return out;
  };

  const groupOf = (draft, id) => draft.groups.find((g) => g.id === id) || null;

  function newGroupId(draft) {
    let n = 1;
    while (groupOf(draft, 'g' + n)) n++;
    return 'g' + n;
  }

  /** editable 映射跟着 members 走：面板靠它渲染输入框与提示语 */
  function syncEditable(g) {
    if (!g || g.mode !== 'editable') return;
    const map = { ...(g.editable || {}) };
    const keep = {};
    for (const n of g.members || []) keep[n] = map[n] || { hint: '这条要你填内容。' };
    g.editable = keep;
  }

  function addSection(draft, title) {
    const t = String(title || '').trim() || '新分区';
    if (!sectionsOf(draft).includes(t)) {
      /* 分节是从功能区反推出来的，所以"新建分区"必然同时给它一个空功能区——
         对使用者来说也正好：新建完就能往里加功能项。 */
      draft.groups.push({ id: newGroupId(draft), label: '新功能区', mode: 'multi', note: '', members: [], __section: t });
    }
    return t;
  }

  /** 加一个功能区（默认落在指定分节的末尾） */
  function addGroup(draft, { section = '未分节', mode = 'multi', label = '新功能区', note = '' } = {}) {
    const g = { id: newGroupId(draft), label, mode, note, members: [], __section: section };
    if (mode === 'editable') g.editable = {};
    draft.groups.push(g);
    return g;
  }

  function removeGroup(draft, id) {
    const i = draft.groups.findIndex((g) => g.id === id);
    if (i < 0) return false;
    draft.groups.splice(i, 1);
    return true;
  }

  function renameGroup(draft, id, label) {
    const g = groupOf(draft, id);
    if (!g) return false;
    g.label = String(label || '').trim() || g.label;
    return true;
  }

  function setMode(draft, id, mode) {
    const g = groupOf(draft, id);
    if (!g) return false;
    g.mode = mode;
    if (mode === 'editable') { g.editable = g.editable || {}; syncEditable(g); }
    else delete g.editable;
    return true;
  }

  function setNote(draft, id, note) {
    const g = groupOf(draft, id);
    if (!g) return false;
    g.note = String(note || '');
    return true;
  }

  /** 在草稿里挪动功能区（delta = -1/+1，只在同一个分节内换序） */
  function moveGroup(draft, id, delta) {
    const g = groupOf(draft, id);
    if (!g) return false;
    const same = draft.groups.filter((x) => (x.__section || '未分节') === (g.__section || '未分节'));
    const at = same.indexOf(g);
    const to = at + delta;
    if (to < 0 || to >= same.length) return false;
    const all = draft.groups;
    const from = all.indexOf(g);
    const target = all.indexOf(same[to]);
    all.splice(from, 1);
    all.splice(target, 0, g);
    return true;
  }

  /** 把功能区挪到另一个分节 */
  function moveGroupToSection(draft, id, section) {
    const g = groupOf(draft, id);
    if (!g) return false;
    g.__section = section || '未分节';
    /* 挪到该分节的末尾，顺序符合直觉 */
    draft.groups.splice(draft.groups.indexOf(g), 1);
    let last = -1;
    draft.groups.forEach((x, i) => { if ((x.__section || '未分节') === g.__section) last = i; });
    draft.groups.splice(last + 1, 0, g);
    return true;
  }

  function members(draft, id) {
    const g = groupOf(draft, id);
    return g ? (g.members = g.members || []) : [];
  }

  /** 把条目挂进功能区（功能项 = 一个条目名）；选一型就是"再加一个选项" */
  function addMember(draft, id, name) {
    const g = groupOf(draft, id);
    if (!g || !name) return false;
    g.members = g.members || [];
    if (g.members.includes(name)) return false;
    g.members.push(name);
    syncEditable(g);
    return true;
  }

  function removeMember(draft, id, name) {
    const g = groupOf(draft, id);
    if (!g) return false;
    const before = (g.members || []).length;
    g.members = (g.members || []).filter((m) => m !== name);
    if (g.editable) delete g.editable[name];
    return g.members.length !== before;
  }

  function moveMember(draft, id, name, delta) {
    const g = groupOf(draft, id);
    if (!g) return false;
    const at = (g.members || []).indexOf(name);
    const to = at + delta;
    if (at < 0 || to < 0 || to >= g.members.length) return false;
    g.members.splice(at, 1);
    g.members.splice(to, 0, name);
    return true;
  }

  /** 同一条目在两个功能区之间搬家 */
  function moveMemberToGroup(draft, fromId, toId, name) {
    if (fromId === toId) return false;
    if (!removeMember(draft, fromId, name)) return false;
    addMember(draft, toId, name);
    return true;
  }

  /** 把分区改名（连同里面所有功能区的 __section 一起改） */
  function renameSection(draft, from, to) {
    const a = String(from ?? '');
    const b = String(to ?? '').trim();
    if (!b || b === a) return false;
    let hit = 0;
    for (const g of draft.groups) if ((g.__section || '未分节') === a) { g.__section = b; hit++; }
    return hit > 0;
  }

  /**
   * 删掉一个分区。**不删条目**：把里面的功能区挪到第一个还在的分区去
   * （没有别的分区就落到「未分节」）——分区只是面板上的排版，删掉不该顺手把东西丢了。
   */
  function removeSection(draft, title) {
    const t = String(title ?? '');
    const inside = draft.groups.filter((g) => (g.__section || '未分节') === t);
    if (!inside.length) return false;
    const others = sectionsOf(draft).filter((s) => s !== t);
    const to = others.length ? others[0] : '未分节';
    for (const g of inside) g.__section = to;
    return true;
  }

  /** 挪动分区的先后（按它在草稿里第一次出现的位置） */
  function moveSection(draft, title, delta) {
    const order = sectionsOf(draft);
    const at = order.indexOf(title);
    const to = at + delta;
    if (at < 0 || to < 0 || to >= order.length) return false;
    const next = order.slice();
    next.splice(at, 1);
    next.splice(to, 0, title);
    /* 按新顺序把 groups 重排（sectionsOf 是按 groups 顺序推的，所以重排 groups 就行） */
    const sorted = [];
    for (const t of next) sorted.push(...draft.groups.filter((g) => (g.__section || '未分节') === t));
    draft.groups = sorted;
    return true;
  }

  /**
   * 面板质检：找出"导进酒馆之后点了没反应 / 打开也没用"的地方。
   * 判据全部来自草稿 + 预设模型 + 编辑态，不猜。
   */
  function auditPanel(draft, model, edit) {
    const items = [];
    const byName = new Map();
    for (const e of model?.entries ?? []) {
      const n = String(e.name ?? '');
      if (!n) continue;
      if (!byName.has(n)) byName.set(n, []);
      byName.get(n).push(e);
    }
    const isPending = (text) => {
      const t = String(text ?? '').trim();
      return !t || /^\{\{\/\/[\s\S]*\}\}$/.test(t);
    };
    const contentOf = (e) => (edit?.content?.has?.(e.idx) ? edit.content.get(e.idx) : e.content);
    const enabledOf = (e) => (edit?.enabled?.has?.(e.idx) ? edit.enabled.get(e.idx) : e.enabled);

    let managed = 0;
    const seenIn = new Map();
    for (const g of draft.groups) {
      const members = g.mode === 'bundle'
        ? (g.options || []).flatMap((o) => [...(o.members || []), ...(o.tunables || []).flatMap((t) => t.members || [])])
        : (g.members || []);
      if (g.mode !== 'fixed') managed += members.length;

      if (!members.length) {
        items.push({ level: 'warn', kind: '空功能区', text: `「${g.label}」里一条条目都没有——面板上会是个空壳。`, fix: '往里加功能项，或者删掉它。' });
      }
      for (const n of members) {
        const hits = byName.get(n) || [];
        if (!hits.length) {
          items.push({ level: 'err', kind: '条目不存在', text: `「${g.label}」里挂着「${n}」，但预设里没有这个条目——面板上点它不会有任何反应，只会标成"缺失"。`, fix: '改名对上预设，或者从功能区移除。' });
          continue;
        }
        if (hits.length > 1) {
          items.push({ level: 'err', kind: '条目重名', text: `「${n}」在预设里有 ${hits.length} 条同名条目——面板按名字匹配，点开一个可能动到另一个。`, fix: '把重名的条目改个名。' });
          continue;
        }
        const e = hits[0];
        if (!seenIn.has(n)) seenIn.set(n, []);
        seenIn.get(n).push({ id: g.id, mode: g.mode, label: g.label });

        if (g.mode === 'fixed') continue;
        const pending = isPending(contentOf(e));
        if (pending && enabledOf(e)) {
          items.push({ level: 'err', kind: '开着但没内容', text: `「${n}」在「${g.label}」里默认是**开**的，正文却还是空的（或只有待填标记）——面板上打开它等于白开。`, fix: '要么写内容，要么让它默认关着。', entry: n });
        } else if (pending) {
          items.push({ level: 'info', kind: '还没写内容', text: `「${n}」正文还是空的——面板上能看到它，但要等你写内容才有用。`, fix: '在右边「正文」里写，或去「框架编辑 → 你写的正文」。', entry: n });
        }
      }
    }

    /* 同一条目落在两个"选一"功能区里：面板的互斥逻辑会互相打架 */
    for (const [n, list] of seenIn) {
      const singles = list.filter((x) => x.mode === 'single');
      if (singles.length > 1) {
        items.push({ level: 'warn', kind: '同一条目属于多个选一区', text: `「${n}」同时在 ${singles.length} 个"选一"功能区里（${singles.map((x) => x.label).join('、')}）——开一个会关掉另一个，容易打架。`, fix: '只留在一个选一功能区里。', entry: n });
      }
    }
    if (!draft.groups.length) {
      items.push({ level: 'info', kind: '空面板', text: '这个面板还没搭：面板上什么都不会有。', fix: '点「＋新建分区」开始。' });
    } else if (!managed) {
      items.push({ level: 'warn', kind: '面板管不到条目', text: '面板里没有可开关的条目（只有只读区或空功能区）——装上也管不了什么。', fix: '把要管的条目挂进功能区。' });
    }
    return items;
  }

  function toOverride(draft) {
    const groups = draft.groups.map((g) => {
      const c = clone(g);
      const sec = c.__section;
      delete c.__section;
      if (c.mode === 'editable') {
        const map = {};
        for (const n of c.members || []) map[n] = (c.editable || {})[n] || { hint: '这条要你填内容。' };
        c.editable = map;
      } else delete c.editable;
      c.__sec = sec;
      return c;
    });
    const sections = [];
    for (const g of groups) {
      const title = g.__sec || '未分节';
      let s = sections.find((x) => x.title === title);
      if (!s) { s = { title, groups: [] }; sections.push(s); }
      s.groups.push(g.id);
    }
    for (const g of groups) delete g.__sec;
    return { groups, sections, thinkingTags: clone(draft.thinkingTags || []), display: clone(draft.display || {}) };
  }

  /** 统计：面板上会有几个功能区、管多少条目、哪些条目名在这份预设里找不到 */
  function stats(draft, model) {
    const names = new Set((model?.entries ?? []).map((e) => e.name).filter(Boolean));
    const dup = new Map();
    for (const e of model?.entries ?? []) if (e.name) dup.set(e.name, (dup.get(e.name) || 0) + 1);
    let managed = 0;
    const missing = [];
    const duplicated = [];
    for (const g of draft.groups) {
      if (g.mode === 'hidden') continue;
      const members = g.mode === 'bundle'
        ? (g.options || []).flatMap((o) => [...(o.members || []), ...(o.tunables || []).flatMap((t) => t.members || [])])
        : (g.members || []);
      if (g.mode !== 'fixed') managed += members.length;
      for (const n of members) {
        if (!names.has(n)) missing.push({ group: g.label, name: n });
        else if ((dup.get(n) || 0) > 1) duplicated.push({ group: g.label, name: n });
      }
    }
    return { groups: draft.groups.length, sections: sectionsOf(draft).length, managed, missing, duplicated };
  }

  root.PresetBuildOps = {
    seedFrom, sectionsOf, groupOf, newGroupId, addSection, addGroup, removeGroup,
    renameGroup, setMode, setNote, moveGroup, moveGroupToSection,
    renameSection, removeSection, moveSection, auditPanel,
    members, addMember, removeMember, moveMember, moveMemberToGroup,
    toOverride, stats,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
