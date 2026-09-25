/**
 * M1 拼装模拟器 —— 按 prompt_order 顺序模拟酒馆把提示词拼起来的过程。
 *
 * 为什么这块最值钱：本次工程踩的坑（切模型丢世界书、两套思维链同时生效、
 * MVU 只开生产者、摘要漏文本、变量被清空）**全都能在这里一眼看出来**。
 *
 * 关键点：**变量展开是有状态的顺序计算**。
 * `{{setvar}}` / `{{addvar}}` 按出现顺序写入，`{{getvar}}` 读的是"当时"的值——
 * 所以能检出「getvar 跑在 setvar 之前」「变量被初始化清空后没人再设」这类问题。
 *
 * 纯函数、零 DOM、零依赖；只读，不修改传入的 model。
 */
(function (root) {
  'use strict';

  const chars = (s) => (s ? [...s].length : 0);

  /** 粗略 token 估算：中日韩字符按 1 字≈1 token，其余按 4 字符≈1 token。仅作量级参考。 */
  function estimateTokens(s) {
    let cjk = 0;
    let other = 0;
    for (const ch of (s || '')) {
      if (/[\u3000-\u9fff\uff00-\uffef]/.test(ch)) cjk++;
      else other++;
    }
    return Math.round(cjk + other / 4);
  }

  /** 统计一组记录里出现最多的来源名（用来指出"是谁把它们清空的"） */
  function topBy(list) {
    const c = new Map();
    for (const v of list) c.set(v.lastBy, (c.get(v.lastBy) || 0) + 1);
    let best = '';
    let n = -1;
    for (const [k, v] of c) if (v > n) { best = k; n = v; }
    return best;
  }

  const SLOT_PLACEHOLDER = {
    chatHistory: '⟨聊天记录（本处由酒馆注入历史消息）⟩',
    dialogueExamples: '⟨示例对话（本处由酒馆注入角色卡示例）⟩',
    charDescription: '⟨角色卡·描述（本处由酒馆注入）⟩',
    charPersonality: '⟨角色卡·性格（本处由酒馆注入）⟩',
    worldInfoBefore: '⟨世界书·前（本处由酒馆注入命中的条目）⟩',
    worldInfoAfter: '⟨世界书·后（本处由酒馆注入命中的条目）⟩',
    personaDescription: '⟨用户人设（本处由酒馆注入）⟩',
    scenario: '⟨场景（本处由酒馆注入）⟩',
  };

  /**
   * 展开一条正文里的宏，并记录变量事件。
   * @param {string} text
   * @param {Map<string,string>} vars  当前变量表（会被就地修改）
   * @param {object} ctx  { user, char, entryName, entryIdx, events, undefinedReads }
   */
  function expand(text, vars, ctx) {
    const src = text ?? '';
    let out = '';
    let i = 0;

    const readValue = (n) => {
      if (!vars.has(n)) {
        ctx.undefinedReads.push({ name: n, by: ctx.entryName });
        return '';
      }
      return vars.get(n);
    };

    while (i < src.length) {
      const open = src.indexOf('{{', i);
      if (open < 0) { out += src.slice(i); break; }
      out += src.slice(i, open);

      /* 找到与 {{ 配对的 }}，要处理嵌套的 {{}} */
      let depth = 1;
      let j = open + 2;
      while (j < src.length && depth > 0) {
        if (src.startsWith('{{', j)) { depth++; j += 2; continue; }
        if (src.startsWith('}}', j)) { depth--; j += 2; continue; }
        j++;
      }
      if (depth > 0) { out += src.slice(open); break; }   // 没闭合，原样保留
      const inner = src.slice(open + 2, j - 2);

      /* 变量操作 */
      let m;
      if ((m = /^setvar::([A-Za-z0-9_\u4e00-\u9fff]+)::([\s\S]*)$/.exec(inner))) {
        const name = m[1];
        const value = expand(m[2], vars, ctx);          // 值里也可能嵌宏
        const before = vars.has(name) ? vars.get(name) : null;
        vars.set(name, value);
        ctx.events.push({ op: 'set', name, value, before, by: ctx.entryName, idx: ctx.entryIdx });
        out += '';
        i = j; continue;
      }
      if ((m = /^addvar::([A-Za-z0-9_\u4e00-\u9fff]+)::([\s\S]*)$/.exec(inner))) {
        const name = m[1];
        const value = expand(m[2], vars, ctx);
        const before = vars.has(name) ? vars.get(name) : '';
        const after = (before || '') + value;
        vars.set(name, after);
        ctx.events.push({ op: 'add', name, value, before, after, by: ctx.entryName, idx: ctx.entryIdx });
        out += '';
        i = j; continue;
      }
      if ((m = /^getvar::([A-Za-z0-9_\u4e00-\u9fff]+)$/.exec(inner))) {
        const name = m[1];
        const value = readValue(name);
        ctx.events.push({ op: 'get', name, value, defined: vars.has(name), by: ctx.entryName, idx: ctx.entryIdx });
        out += value;
        i = j; continue;
      }
      /* 其它原生宏 */
      if (inner === 'trim' || inner === 'noop' || inner.startsWith('//')) { i = j; continue; }
      if (inner === 'user') { out += ctx.user; i = j; continue; }
      if (inner === 'char') { out += ctx.char; i = j; continue; }
      if (inner === 'newline') { out += '\n'; i = j; continue; }
      if (inner === 'space') { out += ' '; i = j; continue; }

      /* 认不出来的：留个可读标记，并记进"外部宏"清单 */
      const name = inner.split('::')[0].trim();
      if (name && !/^setvar|getvar|addvar/.test(name)) ctx.unknownMacros.add(name);
      out += `⟨宏:${name || '?'}⟩`;
      i = j;
    }
    return out;
  }

  /**
   * 按 prompt_order 拼装。
   * @param {object} model  PresetParse.parsePreset 的结果
   * @param {object} opts   { user, char, includeDisabled, expandVars }
   */
  function assemble(model, opts = {}) {
    const o = {
      user: opts.user ?? '用户',
      char: opts.char ?? '角色',
      includeDisabled: !!opts.includeDisabled,
      expandVars: opts.expandVars !== false,
    };
    const vars = new Map();
    const events = [];
    const undefinedReads = [];
    const unknownMacros = new Set();
    const segments = [];
    const skipped = [];

    /* 只拼 prompt_order 里列出的条目（酒馆就是这样），按它的顺序 */
    const listed = model.entries.filter((e) => e.listed).sort((a, b) => a.orderIndex - b.orderIndex);
    const unlisted = model.entries.filter((e) => !e.listed);

    for (const e of listed) {
      if (!e.enabled && !o.includeDisabled) {
        skipped.push({ idx: e.idx, name: e.name || '(无名)', why: '已关闭' });
        continue;
      }
      if (e.injPos === 1) {
        /* 注入到聊天深度：不在主提示里，单独列出，避免误读 */
        segments.push({
          idx: e.idx, name: e.name || '(无名)', identifier: e.identifier, slot: e.slot, slotLabel: e.slotLabel,
          kind: 'injected-at-depth',
          depth: e.injDepth,
          text: '',
          chars: 0,
          note: `注入到聊天第 ${e.injDepth ?? '?'} 层（不在主提示里）`,
        });
        continue;
      }
      const ctx = { user: o.user, char: o.char, entryName: e.name || '(无名)', entryIdx: e.idx, events, undefinedReads, unknownMacros };
      let text = '';
      let note = '';

      if (e.injected && !e.chars) {
        text = SLOT_PLACEHOLDER[e.identifier] ?? `⟨${e.slotLabel ?? e.identifier}⟩`;
        note = '酒馆注入位（本条目只占位，内容由酒馆填）';
      } else {
        text = o.expandVars ? expand(e.content ?? '', vars, ctx) : (e.content ?? '');
        if (e.injected) note = '注：这同时是一个酒馆注入位';
      }

      segments.push({
        idx: e.idx,
        name: e.name || '(无名)',
        identifier: e.identifier,
        slot: e.slot,
        slotLabel: e.slotLabel,
        kind: 'prompt',
        role: e.role,
        text,
        chars: chars(text),
        note,
      });
    }

    const text = segments.filter((s) => s.kind === 'prompt').map((s) => s.text).join('\n\n');
    /* token 估算只算**真会进模型的东西**：注入位占位块（⟨世界书·前⟩ 之类）是我们画给人看的，
       酒馆真正注入的是世界书/角色卡本身，不该算进"你的预设占了多少"。 */
    const bodyText = segments
      .filter((s) => s.kind === 'prompt' && !(s.note || '').includes('注入位'))
      .map((s) => s.text).join('\n\n');

    /* 诊断 */
    const warnings = [];
    for (const u of undefinedReads) {
      warnings.push({
        level: 'warn',
        kind: '读了未设置的变量',
        text: `「${u.by}」读变量「${u.name}」时它还没有值（展开为空字符串）。`,
      });
    }
    /* 变量最终是空的、却有人在读 —— 本次事故的典型形状。
       注意判据是"最后一次写入之后的最终值"，而不是"有没有人读"：
       读了但读到空值，照样是事故（使用者拿到的是空字符串）。 */
    const finalValue = new Map();
    const lastWriter = new Map();
    for (const ev of events) {
      if (ev.op === 'set') { finalValue.set(ev.name, ev.value); lastWriter.set(ev.name, ev); }
      else if (ev.op === 'add') { finalValue.set(ev.name, ev.after); lastWriter.set(ev.name, ev); }
    }
    const readCount = new Map();
    for (const ev of events) if (ev.op === 'get') readCount.set(ev.name, (readCount.get(ev.name) || 0) + 1);
    const emptyVars = [];
    for (const [name, value] of finalValue) {
      if (value !== '') continue;
      const reads = readCount.get(name) || 0;
      if (!reads) continue;
      const ev = lastWriter.get(name);
      emptyVars.push({ name, reads, lastBy: ev.by, lastOp: ev.op });
    }
    if (emptyVars.length) {
      /* 汇总成一条：真实预设里这常常是几十个（"初始化变量"把所有开关置空，
         而对应的开关条目没开），逐条列会把警告区刷爆。 */
      warnings.push({
        level: 'warn',
        kind: '变量最终为空',
        text: `有 ${emptyVars.length} 个变量最终是空字符串，却还被读取——读到它们的条目本轮会展开成空值。`
          + `多半是"开关条目没开"（写入方里出现最多的是「${topBy(emptyVars)}」）。`
          + `前几个：${emptyVars.slice(0, 8).map((v) => v.name).join('、')}${emptyVars.length > 8 ? ' 等' : ''}。`,
      });
    }
    /* 锚点体检：把"注入位是否在场"直接摆出来——这正是切模型丢上下文的事故点 */
    const slotPresent = new Set(segments.filter((s) => s.slot).map((s) => s.slot));
    const missingSlots = [];
    for (const id of ['main', 'jailbreak', 'chatHistory', 'dialogueExamples', 'charDescription',
      'charPersonality', 'worldInfoBefore', 'worldInfoAfter', 'personaDescription', 'scenario']) {
      if (!slotPresent.has(id)) missingSlots.push(id);
    }
    if (missingSlots.length) {
      warnings.push({
        level: 'err',
        kind: '注入位缺失',
        text: `有 ${missingSlots.length} 个酒馆注入位不在拼装结果里：${missingSlots.join('、')}`
          + '——世界书/角色卡/聊天记录会因此注入不进去。',
      });
    }
    const famsOn = model.tagFamilies
      .filter((f) => f.role === '思维链标签' && f.members.some((m) => m.enabled));
    if (famsOn.length > 1) {
      warnings.push({
        level: 'err',
        kind: '思维链标签冲突',
        text: `同时启用了 ${famsOn.length} 套思维链标签：${famsOn.map((f) => f.label).join('、')}。`,
      });
    }
    for (const m of unknownMacros) {
      warnings.push({
        level: 'warn',
        kind: '外部宏',
        text: `用到了宏「${m}」——它由插件提供，没装的话会展开成占位符。`,
      });
    }

    return {
      user: o.user,
      char: o.char,
      segments,
      skipped,
      unlisted: unlisted.map((e) => ({ idx: e.idx, name: e.name || '(无名)' })),
      text,
      totalChars: chars(text),
      /** 去掉注入位占位块之后的正文（token 估算按这个算） */
      bodyChars: chars(bodyText),
      /** 拼装结果里每条"会进模型"的正文按条目名索引，供体检器按**展开后**的内容判断 */
      textByIdx: new Map(segments.filter((s) => s.kind === 'prompt').map((s) => [s.idx, s.text])),
      tokenEstimate: estimateTokens(bodyText),
      events,
      /** 最终为空却被读取的变量（结构化版本，给界面列表用） */
      emptyVars,
      vars: [...vars.entries()].map(([name, value]) => ({ name, value })),
      warnings,
    };
  }

  root.PresetAssemble = { assemble, expand, estimateTokens, SLOT_PLACEHOLDER };
})(typeof globalThis !== 'undefined' ? globalThis : this);
