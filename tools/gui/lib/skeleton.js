/**
 * M4 从零生成一份预设的**骨架**。
 *
 * 这条边界必须说清楚：
 *   工具生成的是**结构**——条目名、槽位、顺序、开关，以及"这条该写什么"的注释提示。
 *   **正文一个字都不代写**：每条新条目的正文都是 `{{//待填：…}}`（注释宏，展开后是空的，
 *   所以既不会进模型，也不会被体检器误报成"你把占位话术发给模型了"）。
 *
 * 骨架的形状不是拍脑袋定的，是照着真实预设来的（见 tools/diag-order.mjs 的实测）：
 *   注入位的顺序是 main → worldInfoBefore → personaDescription → charDescription →
 *   charPersonality → scenario → worldInfoAfter → dialogueExamples → chatHistory → jailbreak；
 *   其中除 main / nsfw / jailbreak 外，其余槽位条目的正文**本来就是 0 字**——
 *   它们只是"酒馆往这儿塞东西"的位置标记（marker）。所以骨架里这些条目
 *   是**开着且正文为空**，这不是漏填。
 */
(function (root) {
  'use strict';

  /** 纯位置标记：正文必须为空，且必须开着，否则世界书/角色卡/聊天记录进不来 */
  const MARKER_SLOTS = [
    { slot: 'worldInfoBefore', name: '⟨世界书·前⟩', hint: '这是酒馆塞"世界书·前"的位置标记，正文保持为空，不要写东西' },
    { slot: 'personaDescription', name: '⟨用户人设⟩', hint: '这是酒馆塞"用户人设"的位置标记，正文保持为空' },
    { slot: 'charDescription', name: '⟨角色卡·描述⟩', hint: '这是酒馆塞"角色卡描述"的位置标记，正文保持为空' },
    { slot: 'charPersonality', name: '⟨角色卡·性格⟩', hint: '这是酒馆塞"角色卡性格"的位置标记，正文保持为空' },
    { slot: 'scenario', name: '⟨场景⟩', hint: '这是酒馆塞"场景"的位置标记，正文保持为空' },
    { slot: 'worldInfoAfter', name: '⟨世界书·后⟩', hint: '这是酒馆塞"世界书·后"的位置标记，正文保持为空' },
    { slot: 'dialogueExamples', name: '⟨示例对话⟩', hint: '这是酒馆塞"角色卡示例对话"的位置标记，正文保持为空' },
    { slot: 'chatHistory', name: '⟨聊天记录⟩', hint: '这是酒馆塞"聊天记录"的位置标记，正文保持为空' },
  ];

  const MARKER_SLOT_IDS = MARKER_SLOTS.map((m) => m.slot);
  /** 顺序照真实预设排 */
  const MARKER_HEAD = ['worldInfoBefore', 'personaDescription', 'charDescription', 'charPersonality', 'scenario', 'worldInfoAfter'];
  const MARKER_TAIL = ['dialogueExamples', 'chatHistory'];

  /**
   * 可勾选的模块。每个模块 = 几条空条目 + 一句"这条该写什么"的注释提示。
   * note 用来表达"这几条是选一关系 / 必须成对开关"这类结构约束。
   */
  const MODULES = [
    {
      id: 'core',
      required: true,
      label: '核心（必需）',
      note: '主提示 + 两个内容槽位；位置标记由工具自动补齐。',
      entries: [
        { slot: 'main', name: '💾主提示', enabled: true, hint: '写你的核心指令：你是谁、怎么说话、守什么规矩。这是模型最当真的那一段' },
        { slot: 'jailbreak', name: '💠历史后置指令', enabled: false, hint: '排在聊天记录之后的那段指令（很多预设用它收尾、或做预填充）。写完再打开它' },
        { slot: 'nsfw', name: '💠辅助提示', enabled: false, hint: '辅助 / NSFW 段。不需要就让它关着' },
      ],
    },
    {
      id: 'breach',
      required: false,
      label: '破甲（按模型分流，选一）',
      note: '不同渠道认的破甲词不一样，所以留成互相独立的空条目：用哪个开哪个。',
      entries: [
        { name: '🛡️破甲 · Gemini', hint: '贴你自己实测过的 Gemini 破甲词（别用公共文本，早被人用烂了）' },
        { name: '🛡️破甲 · DeepSeek / GLM', hint: '贴你自己实测过的 DeepSeek / GLM 破甲词' },
        { name: '🛡️破甲 · 其他模型', hint: '贴你自己实测过的其他渠道破甲词' },
      ],
    },
    {
      id: 'cot',
      required: false,
      label: '思考方式（选一）',
      note: '两套互斥的思考格式同时开，模型会把两种结构都吐出来——所以做成选一。',
      entries: [
        { name: '📽️思考 · 分段交错', hint: '要求模型把输出分成几段、每段边想边写（例如交错思考）' },
        { name: '📽️思考 · 单块', hint: '要求模型先给一段思考、再给正文' },
      ],
    },
    {
      id: 'style',
      required: false,
      label: '文风（选一）',
      note: '文风类条目一般是"设一个变量，再由指南条目去读"，所以是选一关系。',
      entries: [
        { name: '🎨文风 · 甲', hint: '第一种文风的具体要求（句子长短、用词、节奏…）' },
        { name: '🎨文风 · 乙', hint: '第二种文风的具体要求' },
      ],
    },
    {
      id: 'guard',
      required: false,
      label: '守则 / 禁止项',
      note: '你最常吐槽模型的那几件事：不写清楚，它会一直犯。',
      entries: [
        { name: '⛔️禁止项', hint: '你最讨厌的输出习惯，一条一行写清楚' },
        { name: '✅必须项', hint: '你希望它每次都做到的事' },
      ],
    },
    {
      id: 'mvu',
      required: false,
      label: '变量更新（MVU）',
      note: '生产者（要求模型吐变量更新块）和消费者（说明块长什么样）要**成对**开，只开一边等于没开。',
      entries: [
        { name: '🔧变量更新 · 生产者', hint: '要求模型在回复末尾输出变量更新块的那段指令' },
        { name: '🔧变量更新 · 消费者', hint: '变量更新块长什么样的格式说明（和生产者成对开关）' },
      ],
    },
    {
      id: 'summary',
      required: false,
      label: '摘要 / 进度',
      note: '摘要通常还要配正则（把摘要从发送内容里摘出去 / 美化），正则得你自己在酒馆里加。',
      entries: [
        { name: '🗒️摘要', hint: '让模型定期输出摘要 / 进度的指令' },
      ],
    },
    {
      id: 'prefill',
      required: false,
      label: '预填充尾（assistant 开场）',
      note: 'assistant 角色的条目相当于"模型已经说了半句"。很多破甲与思维链靠它起手。',
      entries: [
        { name: '💠预填充尾', role: 'assistant', hint: '你想让模型"刚好说出口"的开头（例如开始思考的标签）' },
      ],
    },
  ];

  /** 生成时的初始正文：一条注释宏。展开后是空的 → 不进模型；在酒馆里看得见 → 知道要填 */
  const fillFor = (hint) => `{{//待填：${hint || '在这里写这条的内容'}}}`;

  const TOP_EXCLUDE = ['prompts', 'prompt_order', 'extensions', 'name'];

  /** 从基底预设抄顶层设置（采样参数之类），但不抄条目、不抄 extensions（它们绑死原预设的条目） */
  function topLevelFrom(base) {
    if (!base || !base.json) return {};
    const out = {};
    for (const [k, v] of Object.entries(base.json)) if (!TOP_EXCLUDE.includes(k)) out[k] = v;
    return out;
  }

  function uuid() {
    const c = root.crypto;
    if (c && typeof c.randomUUID === 'function') {
      try { return c.randomUUID(); } catch { /* file:// 下可能抛，落到手写实现 */ }
    }
    const hex = (n) => [...Array(n)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
    return `${hex(8)}-${hex(4)}-4${hex(3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${hex(3)}-${hex(12)}`;
  }

  /** 新条目与 ST 既有条目同形（键名与顺序都对齐真实预设） */
  const entryOf = ({ identifier, name, role, enabled, hint, slot }) => {
    const isMarker = !!slot && MARKER_SLOT_IDS.includes(slot);
    return {
      identifier,
      name,
      enabled: !!enabled,
      injection_position: 0,
      injection_depth: 4,
      injection_order: 100,
      role: role === 'user' || role === 'assistant' ? role : 'system',
      /* 位置标记的正文**真的是空的**（和真实预设一样，0 字）——
         这样 M1 拼装视图才会把它显示成"⟨世界书·前⟩ 酒馆在这儿注入"，
         而不是一段展开后什么都没剩下的注释。其余条目放待填注释。 */
      content: isMarker ? '' : fillFor(hint),
      system_prompt: false,
      marker: false,                 // ST 里 marker 是"分隔符"语义，这里不用
      forbid_overrides: false,
      __slot: slot || '',            // 只给生成器自己用，不会写进文件
      __marker: isMarker,
    };
  };

  /**
   * 生成一份骨架预设。
   * @param {object} opts
   *   name        预设名（也写进顶层 name）
   *   base        { file, json } 或 null —— 取它的顶层采样设置
   *   moduleIds   勾选的模块 id（core 恒有）
   *   customCount 额外要几条自定义空条目
   */
  function buildSkeleton(opts = {}) {
    const name = (opts.name || '').trim() || '我的预设';
    const moduleIds = new Set(['core'].concat(opts.moduleIds || []));
    const customCount = Math.max(0, Math.min(20, Number(opts.customCount) || 0));

    const prompts = [];
    const order = [];
    const markers = [];
    const push = (e) => {
      const clean = { ...e };
      delete clean.__slot; delete clean.__marker;
      prompts.push(clean);
      order.push({ identifier: e.identifier, enabled: !!e.enabled });
      if (e.__marker) markers.push(e.name);
    };

    const coreMod = MODULES.find((m) => m.id === 'core');
    const coreBySlot = new Map(coreMod.entries.map((e) => [e.slot, e]));
    const contentEntry = (slot) => {
      const e = coreBySlot.get(slot);
      return e ? entryOf({ identifier: e.slot, name: e.name, enabled: e.enabled, hint: e.hint, slot: e.slot }) : null;
    };
    const markerEntry = (slot) => {
      const m = MARKER_SLOTS.find((x) => x.slot === slot);
      return entryOf({ identifier: m.slot, name: m.name, enabled: true, hint: m.hint, slot: m.slot });
    };

    const moduleEntries = [];
    for (const mod of MODULES) {
      if (mod.required || !moduleIds.has(mod.id)) continue;
      for (const e of mod.entries) {
        moduleEntries.push(entryOf({ identifier: uuid(), name: e.name, role: e.role, enabled: false, hint: e.hint }));
      }
    }
    for (let i = 1; i <= customCount; i++) {
      moduleEntries.push(entryOf({ identifier: uuid(), name: `📝自定义 ${i}`, enabled: false, hint: '这条是你自己加的，写你想写的要求' }));
    }

    /* 顺序照真实预设：main → 角色卡/世界书标记 → 你的内容条目 → 示例/聊天记录 → 收尾指令 */
    const seq = [
      contentEntry('main'),
      ...MARKER_HEAD.map(markerEntry),
      ...moduleEntries,
      ...MARKER_TAIL.map(markerEntry),
      contentEntry('jailbreak'),
      contentEntry('nsfw'),
    ].filter(Boolean);
    for (const e of seq) push(e);

    const json = {
      ...topLevelFrom(opts.base),
      name,
      prompts,
      prompt_order: [{ character_id: 100001, order }],
    };
    const markerSet = new Set(prompts.filter((p) => MARKER_SLOT_IDS.includes(p.identifier)).map((p) => p.identifier));
    return {
      json,
      name,
      markers,
      markerSlots: MARKER_SLOT_IDS,
      counts: {
        prompts: prompts.length,
        enabled: prompts.filter((p) => p.enabled).length,
        pending: prompts.filter((p) => /^\{\{\/\/[\s\S]*\}\}$/.test((p.content || '').trim())).length,
        markers: markerSet.size,
      },
      plan: describe(opts),
    };
  }

  /** 给界面看的"将要生成什么" */
  function describe(opts = {}) {
    const moduleIds = new Set(['core'].concat(opts.moduleIds || []));
    const rows = [];
    rows.push({ kind: '位置标记', text: `${MARKER_SLOTS.length} 个注入位（世界书 / 角色卡 / 人设 / 场景 / 示例 / 聊天记录）——开着、正文为空，这是对的` });
    for (const mod of MODULES) {
      if (!moduleIds.has(mod.id)) continue;
      rows.push({
        kind: mod.required ? '必需' : '模块',
        text: `${mod.label}：${mod.entries.length} 条` + (mod.note ? `　（${mod.note}）` : ''),
      });
    }
    const n = Math.max(0, Math.min(20, Number(opts.customCount) || 0));
    if (n) rows.push({ kind: '自定义', text: `${n} 条你自己的空条目` });
    rows.push({ kind: '正文', text: '所有条目正文都是注释形式的「待填」，由你自己写；工具一个字都不代写' });
    return rows;
  }

  root.PresetSkeleton = {
    buildSkeleton, describe, MODULES, MARKER_SLOTS, MARKER_SLOT_IDS,
    MARKER_HEAD, MARKER_TAIL, fillFor, topLevelFrom, TOP_EXCLUDE,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
