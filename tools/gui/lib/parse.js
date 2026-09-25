/**
 * M0 解析器 —— 把一份酒馆预设 JSON 解析成结构化模型。
 *
 * 设计约束：
 *   · 纯函数、零 DOM、零依赖。浏览器与 Node 都能用（挂在 globalThis 上，不用 ES module
 *     —— file:// 页面加载 ES module 会被 CORS 拦掉）。
 *   · **只读**：绝不修改传入的 json。
 *   · 输出尽量自解释：每条结论都带 reason/依据，便于人工复核与自动化对比。
 */
(function (root) {
  'use strict';

  /* ── 酒馆内置槽位 ─────────────────────────────────────────────── */
  const SLOT_LABELS = {
    main: '主提示',
    nsfw: '辅助提示',
    jailbreak: '历史后置指令',
    chatHistory: '聊天记录',
    dialogueExamples: '示例对话',
    charDescription: '角色卡·描述',
    charPersonality: '角色卡·性格',
    worldInfoBefore: '世界书·前',
    worldInfoAfter: '世界书·后',
    personaDescription: '用户人设',
    scenario: '场景',
    enhanceDefinitions: '角色增强',
    agentSystemPrompt: 'Agent 系统提示',
    agentTask: 'Agent 任务',
    agentResults: 'Agent 结果',
  };
  /** 这些槽位在预设里通常只是"占位标记"，本身没有正文，内容由酒馆注入。 */
  const INJECTED_SLOTS = new Set([
    'chatHistory', 'dialogueExamples', 'charDescription', 'charPersonality',
    'worldInfoBefore', 'worldInfoAfter', 'personaDescription', 'scenario',
  ]);

  /* ── 标签族：用来发现"两套互斥的机制被同时打开" ────────────────── */
  const TAG_FAMILIES = [
    { id: 'think', label: '思维链 <think/thinking>', re: /<\s*\/?\s*(?:think|thinking)\s*>/i, role: '思维链标签' },
    { id: 'konatan', label: '思维链 konatan_planning~', re: /konatan_planning~/i, role: '思维链标签' },
    { id: 'interleaving', label: '交错思考 <Interleaving>', re: /<\s*\/?\s*Interleaving\s*>/i, role: '思维链结构' },
    { id: 'mvu', label: 'MVU 变量更新', re: /<UpdateVariable>|JSONPatch/i, role: '变量更新' },
    { id: 'event', label: '事件块 <current_event>', re: /<current_event>/i, role: '摘要/事件' },
    { id: 'progress', label: '进度块 <progress>', re: /<progress>/i, role: '摘要/进度' },
    { id: 'summary', label: '摘要 <details>摘要', re: /<summary>\s*摘要\s*<\/summary>/i, role: '摘要' },
    { id: 'tucao', label: '吐槽 <tucao>', re: /<tucao>/i, role: '吐槽' },
    { id: 'dream', label: '梦鲸 DREAM_PLOT 协议', re: /<dream_plot>|DREAM_PLOT/i, role: '输出协议' },
    { id: 'clear', label: '清屏 </clear>', re: /<\s*\/\s*clear\s*>/i, role: '破甲手段' },
    { id: 'ejs', label: 'EJS 模板（提示词模板扩展）', re: /<%[-_=]?[\s\S]*?[-_]?%>/, role: '外部渲染' },
  ];

  /** 用于猜"这条大概需要用户自己填内容" */
  const FILL_PATTERNS = [
    /自定义/, /自填/, /自改/, /可改/, /此处/, /点进去看/, /想玩就开/,
    /按格式填写/, /请填/, /填写你/, /粘贴/, /自己写/,
  ];

  /**
   * EJS 模板块（提示词模板 / ST-Prompt-Template 扩展用的 `<% … %>`）。
   * 为什么要认它：那类内容**不是给模型看的文本**，而是"发送前先被渲染掉的代码"。
   * 没装那个扩展时，`<% … %>` 会原样进上下文——既浪费 token 又会迷惑模型。
   * 所以解析时就把它标出来，拼装/渲染预览里才不会把它当正文。
   */
  const EJS_RE = /<%[-_=]?([\s\S]*?)[-_]?%>/g;

  /** 酒馆原生宏（其余一律视为外部依赖，需要插件提供） */
  const NATIVE_MACROS = new Set([
    'user', 'char', 'description', 'personality', 'scenario', 'persona', 'time', 'date', 'weekday',
    'isotime', 'isodate', 'input', 'lastMessage', 'lastUserMessage', 'lastCharMessage',
    'firstMessage', 'original', 'model', 'maxPrompt', 'maxContext', 'maxResponse',
    'mesExamples', 'mesExamplesRaw', 'jailbreak', 'charPrompt', 'charInstruction',
    'charFirstMessage', 'systemPrompt', 'main', 'nsfw', 'chatHistory', 'dialogueExamples',
    'summary', 'personaDescription', 'charDescription', 'charPersonality',
    'worldInfoBefore', 'worldInfoAfter', 'enhanceDefinitions', 'bias', 'group',
    'groupNotMuted', 'notChar', 'random', 'pick', 'roll', 'trim', 'noop', 'newline',
    'space', 'reverse', 'banned', 'idle_duration', 'allChatRange', 'outlet',
    // ST 变量族
    'setvar', 'getvar', 'addvar', 'setglobalvar', 'getglobalvar', 'addglobalvar',
    'incvar', 'decvar', 'deletevar', 'incglobalvar', 'decglobalvar', 'hasvar', 'hasglobalvar',
    'deleteglobalvar', 'charIfNotGroup', 'chatStart', 'reasoningPrefix', 'reasoningSuffix',
    'reasoningSeparator', 'charPrefix', 'charNegativePrefix', 'agentSystemPrompt',
    'agentTask', 'agentResults',
  ]);

  /* ── 小工具 ───────────────────────────────────────────────────── */
  const chars = (s) => (s ? [...s].length : 0);
  const oneLine = (s, n = 90) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

  /**
   * 同步指纹（FNV-1a 32 位 + 长度）。
   * 只用于本地比对/去重，**不是**安全哈希；"来源原文未改"的权威校验由
   * tools/check-preset.mjs 用 sha1 完成。用同步实现是因为浏览器端的 crypto.subtle 是异步的。
   */
  function fingerprint(s) {
    const str = s ?? '';
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(16).padStart(8, '0') + '-' + str.length;
  }

  /** 扫一条正文：它设/读/累加了哪些变量，引用了哪些宏与标签 */
  function scanContent(content) {
    const sets = [];
    const adds = [];
    const gets = [];
    const macros = new Set();
    const families = new Set();
    const text = content ?? '';

    for (const m of text.matchAll(/\{\{setvar::([A-Za-z0-9_\u4e00-\u9fff]+)::/g)) sets.push(m[1]);
    for (const m of text.matchAll(/\{\{addvar::([A-Za-z0-9_\u4e00-\u9fff]+)::/g)) adds.push(m[1]);
    for (const m of text.matchAll(/\{\{getvar::([A-Za-z0-9_\u4e00-\u9fff]+)\}\}/g)) gets.push(m[1]);
    for (const m of text.matchAll(/\{\{([^:{}]{1,40}?)(?:::|\}\})/g)) {
      const name = m[1].trim();
      if (!name || name.startsWith('//')) continue;
      if (name === 'setvar' || name === 'getvar' || name === 'addvar') continue;
      if (!NATIVE_MACROS.has(name)) macros.add(name);
    }
    for (const f of TAG_FAMILIES) if (f.re.test(text)) families.add(f.id);
    /* EJS 模板（提示词模板扩展）：记下有几块、最长那块长什么样 */
    const ejs = [...text.matchAll(EJS_RE)].map((m) => m[1].trim());
    if (ejs.length) families.add('ejs');

    return {
      sets: [...new Set(sets)],
      adds: [...new Set(adds)],
      gets: [...new Set(gets)],
      macros: [...macros],
      families: [...families],
      ejsCount: ejs.length,
      ejsHead: ejs[0] ? oneLine(ejs[0], 60) : '',
      // 疑似"只用来设一个变量"的开关条目：正文几乎就是一句 setvar
      pureSetter: sets.length > 0 && text.replace(/\{\{[^}]*\}\}/g, '').trim().length < 40,
      /* 初始化/清空型：绝大多数 setvar 的值都是空白。
         这类条目（"初始化变量（别动）" 92 个里 91 个空白、Kemini 的 `🔗` 20/20）
         会把一大堆变量重置掉，它们**不是**"选一"的候选——必须排除，
         否则每一组互斥族都会被它们污染成"同时开了两个"。
         注意：值可能是**一个空格**而不是空串（`{{setvar::x:: }}`），所以用 \s*；
         也不能要求"全都是空白"——初始化条目里常常夹着一两个默认值。 */
      clearer: (() => {
        const all = (text.match(/\{\{setvar::/g) || []).length;
        if (all < 3) return false;
        const blank = (text.match(/\{\{setvar::[^:{}]+::\s*\}\}/g) || []).length;
        return blank >= all * 0.8;
      })(),
      fill: FILL_PATTERNS.some((re) => re.test(text)),
    };
  }

  /* ── 主解析 ───────────────────────────────────────────────────── */
  /**
   * @param {object} json  预设 JSON（不会被修改）
   * @param {string} file  文件名，用于展示
   * @param {number} bytes 原始字节数（可选）
   */
  function parsePreset(json, file = '(未命名)', bytes = 0) {
    const prompts = Array.isArray(json.prompts) ? json.prompts : [];
    const orderArr = Array.isArray(json.prompt_order) ? (json.prompt_order[0]?.order ?? []) : [];
    const orderIdx = new Map();
    const orderOn = new Map();
    orderArr.forEach((o, i) => { orderIdx.set(o.identifier, i); orderOn.set(o.identifier, !!o.enabled); });

    /* 1. 条目 */
    const entries = prompts.map((p, idx) => {
      const content = p.content ?? '';
      const scan = scanContent(content);
      const identifier = p.identifier ?? '';
      const listed = orderIdx.has(identifier);
      const enabled = listed ? orderOn.get(identifier) : !!p.enabled;
      return {
        idx,
        name: p.name ?? '',
        /* 正文原样保留：M1 拼装模拟器要靠它做有状态的宏展开。
           解析器本身只读，不改这份字符串。 */
        content,
        identifier,
        slot: SLOT_LABELS[identifier] ? identifier : null,
        slotLabel: SLOT_LABELS[identifier] ?? null,
        injected: INJECTED_SLOTS.has(identifier),
        role: p.role ?? '',
        systemPrompt: !!p.system_prompt,
        marker: !!p.marker,
        injPos: p.injection_position ?? 0,
        injDepth: p.injection_depth ?? null,
        listed,
        orderIndex: listed ? orderIdx.get(identifier) : -1,
        enabled,
        chars: chars(content),
        fp: fingerprint(p.name + '\u0000' + content),
        head: oneLine(content),
        sets: scan.sets,
        adds: scan.adds,
        gets: scan.gets,
        macros: scan.macros,
        families: scan.families,
        ejsCount: scan.ejsCount,
        ejsHead: scan.ejsHead,
        pureSetter: scan.pureSetter,
        clearer: scan.clearer,
        fill: scan.fill,
      };
    });
    entries.sort((a, b) => {
      if (a.listed !== b.listed) return a.listed ? -1 : 1;
      if (a.listed && b.listed && a.orderIndex !== b.orderIndex) return a.orderIndex - b.orderIndex;
      return a.idx - b.idx;
    });

    /* 2. 槽位占用 */
    const slots = [];
    for (const id of Object.keys(SLOT_LABELS)) {
      const users = entries.filter((e) => e.identifier === id);
      if (!users.length) continue;
      slots.push({
        identifier: id,
        label: SLOT_LABELS[id],
        injected: INJECTED_SLOTS.has(id),
        owners: users.map((e) => ({ idx: e.idx, name: e.name || '(无名)', chars: e.chars, enabled: e.enabled })),
        conflict: users.length > 1,
      });
    }

    /* 3. 变量总线 */
    const varMap = new Map();
    const touch = (name) => {
      if (!varMap.has(name)) varMap.set(name, { name, setBy: [], addBy: [], getBy: [] });
      return varMap.get(name);
    };
    for (const e of entries) {
      for (const v of e.sets) if (!touch(v).setBy.includes(e.idx)) touch(v).setBy.push(e.idx);
      for (const v of e.adds) if (!touch(v).addBy.includes(e.idx)) touch(v).addBy.push(e.idx);
      for (const v of e.gets) if (!touch(v).getBy.includes(e.idx)) touch(v).getBy.push(e.idx);
    }
    const clearerIdx = new Set(entries.filter((e) => e.clearer).map((e) => e.idx));
    const realSetters = (v) => v.setBy.filter((i) => !clearerIdx.has(i));
    const variables = [...varMap.values()].map((v) => ({
      ...v,
      defined: v.setBy.length + v.addBy.length > 0,
      dangling: v.setBy.length + v.addBy.length === 0 && v.getBy.length > 0,
      /** 被多条**非清空型**条目设置 = 天然的互斥族候选（清空型是初始化，不参与"选一"） */
      exclusive: new Set(realSetters(v)).size > 1,
      realSetBy: realSetters(v),
      nameOf: (i) => entries.find((e) => e.idx === i)?.name ?? '',
    }));

    /* 4. 条目级依赖：谁给谁供数 */
    const deps = [];
    for (const v of variables) {
      for (const from of v.setBy.concat(v.addBy)) {
        for (const to of v.getBy) deps.push({ from, to, variable: v.name });
      }
    }

    /* 5. 标签族 */
    const tagFamilies = TAG_FAMILIES.map((f) => ({
      id: f.id,
      label: f.label,
      role: f.role,
      members: entries.filter((e) => e.families.includes(f.id)).map((e) => ({ idx: e.idx, name: e.name || '(无名)', enabled: e.enabled })),
    })).filter((f) => f.members.length);

    /* 6. 外部依赖 */
    const extMacros = new Map();
    for (const e of entries) for (const m of e.macros) {
      if (!extMacros.has(m)) extMacros.set(m, []);
      extMacros.get(m).push(e.name || '(无名)');
    }
    const regexes = (json.extensions?.regex_scripts ?? []).map((r) => ({
      name: r.scriptName ?? '(无名)',
      disabled: !!r.disabled,
      placement: r.placement ?? [],
      markdownOnly: !!r.markdownOnly,
      promptOnly: !!r.promptOnly,
      find: String(r.findRegex ?? ''),
      replaceChars: chars(r.replaceString),
      cdn: /fonts\.googleapis|fonts\.gstatic|jsdelivr|unpkg|cdn\./i.test(String(r.findRegex) + String(r.replaceString)),
    }));
    const scripts = (json.extensions?.tavern_helper?.scripts ?? []).map((s) => {
      const c = String(s.content ?? '');
      return {
        name: s.name ?? '(无名)',
        enabled: !!s.enabled,
        type: s.type ?? '',
        chars: chars(c),
        buttons: (s.button?.buttons ?? []).map((b) => b.name),
        hasData: !!s.data && Object.keys(s.data).length > 0,
        cdn: /jsdelivr|unpkg|cdn\.|https?:\/\//i.test(c.slice(0, 4000)),
      };
    });

    /* 7. 警告 */
    const warnings = [];
    for (const s of slots) {
      if (s.conflict) {
        warnings.push({
          level: 'err',
          kind: '槽位冲突',
          text: `槽位「${s.label}」(${s.identifier}) 有 ${s.owners.length} 个候选：${s.owners.map((o) => o.name).join('、')}——酒馆里这个槽位只能有一个主人。`,
        });
      }
    }
    for (const v of variables) {
      if (v.dangling) {
        warnings.push({
          level: 'warn',
          kind: '悬空变量',
          text: `变量「${v.name}」被 ${v.getBy.length} 条引用，但没有任何条目设置它——展开后是空字符串。`,
        });
      }
    }
    const enabledByFamily = tagFamilies.filter((f) => f.members.some((m) => m.enabled) && f.role === '思维链标签');
    if (enabledByFamily.length > 1) {
      warnings.push({
        level: 'err',
        kind: '思维链标签冲突',
        text: `同时启用了 ${enabledByFamily.length} 套思维链标签：${enabledByFamily.map((f) => f.label).join('、')}——模型可能同时吐出两种结构的思考。`,
      });
    }
    const enabledFills = entries.filter((e) => e.fill && e.enabled);
    if (enabledFills.length) {
      warnings.push({
        level: 'warn',
        kind: '疑似待填',
        text: `有 ${enabledFills.length} 条"看起来要你自己填内容"的条目处于开启状态：${enabledFills.slice(0, 5).map((e) => e.name).join('、')}${enabledFills.length > 5 ? ' 等' : ''}。`,
      });
    }
    if (!orderArr.length) {
      warnings.push({ level: 'err', kind: '结构缺失', text: '这份预设没有 prompt_order——酒馆靠它决定条目的顺序与开关。' });
    }

    /* 8. 分组建议（带依据；推断永远可被人工覆盖） */
    const suggestions = [];
    for (const v of variables) {
      if (v.realSetBy.length > 1 && v.getBy.length) {
        suggestions.push({
          id: 'excl:' + v.name,
          mode: 'single',
          reason: `变量「${v.name}」被 ${v.realSetBy.length} 条设置、又被 ${v.getBy.length} 条读取 → 天然互斥，适合做「选一」下拉框。`,
          members: v.realSetBy.map((i) => entries.find((e) => e.idx === i).name),
        });
      }
    }
    for (const v of variables) {
      if (v.addBy.length > 1 && v.getBy.length) {
        suggestions.push({
          id: 'acc:' + v.name,
          mode: 'multi',
          reason: `变量「${v.name}」被 ${v.addBy.length} 条累加（addvar）→ 可以叠加，适合做开关排。`,
          members: v.addBy.map((i) => entries.find((e) => e.idx === i).name),
        });
      }
    }
    for (const f of tagFamilies) {
      if (f.members.length > 1 && f.role === '思维链标签') {
        suggestions.push({
          id: 'tag:' + f.id,
          mode: 'single',
          reason: `同属「${f.label}」的有 ${f.members.length} 条 → 通常只该开一条。`,
          members: f.members.map((m) => m.name),
        });
      }
    }

    const enabledEntries = entries.filter((e) => e.listed && e.enabled);
    return {
      file,
      bytes,
      name: json.name ?? '',
      counts: {
        prompts: entries.length,
        listed: entries.filter((e) => e.listed).length,
        enabled: enabledEntries.length,
        enabledChars: enabledEntries.reduce((a, e) => a + e.chars, 0),
        totalChars: entries.reduce((a, e) => a + e.chars, 0),
      },
      entries,
      slots,
      variables: variables.map(({ nameOf, ...rest }) => rest),
      deps,
      tagFamilies,
      external: {
        macros: [...extMacros.entries()].map(([name, by]) => ({ name, by })),
        cdn: [
          ...regexes.filter((r) => r.cdn).map((r) => `正则「${r.name}」`),
          ...scripts.filter((s) => s.cdn).map((s) => `脚本「${s.name}」`),
        ],
      },
      regexes,
      scripts,
      suggestions,
      warnings,
    };
  }

  root.PresetParse = {
    parsePreset,
    scanContent,
    fingerprint,
    SLOT_LABELS,
    INJECTED_SLOTS,
    TAG_FAMILIES,
    NATIVE_MACROS,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
