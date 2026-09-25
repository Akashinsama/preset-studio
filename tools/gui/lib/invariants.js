/**
 * M2 体检 / 计划器 —— 对**任何**导入的预设做通用不变式检查。
 *
 * 和 M0/M1 的分工：
 *   M0 解析    ：把结构摊开（事实）
 *   M1 拼装    ：按顺序真跑一遍（事实）
 *   M2 体检    ：把事实对照"这份预设应该满足的规矩"，给出**必改 / 建议 / 提示**三档清单，
 *                每条都带依据、修法、涉及哪些条目 —— 这就是"计划"：拿着清单去改。
 *
 * 这些不变式不是凭空定的，全部来自本次工程真实踩过的坑（切模型丢上下文、
 * 两套思维链同开、MVU 只开生产者、变量被清空、槽位被两条占……）。
 * 但判据本身是**通用的**：任何酒馆预设都该满足。
 *
 * 纯函数、零 DOM、零依赖；只读，不修改传入的 model / result。
 */
(function (root) {
  'use strict';

  const LEVEL_LABEL = { err: '必改', warn: '建议', info: '提示' };

  /** 酒馆里决定"上下文能不能注入进来"的位置标记。缺任何一个，对应的东西就消失。 */
  const ANCHORS = [
    { id: 'main', tier: 'must', why: '主提示（系统的核心指令）' },
    { id: 'chatHistory', tier: 'must', why: '聊天记录' },
    { id: 'charDescription', tier: 'must', why: '角色卡·描述' },
    { id: 'charPersonality', tier: 'must', why: '角色卡·性格' },
    { id: 'worldInfoBefore', tier: 'must', why: '世界书·前' },
    { id: 'worldInfoAfter', tier: 'must', why: '世界书·后' },
    { id: 'personaDescription', tier: 'must', why: '用户人设' },
    { id: 'scenario', tier: 'must', why: '场景' },
    { id: 'dialogueExamples', tier: 'must', why: '角色卡示例对话' },
    { id: 'jailbreak', tier: 'opt', why: '历史后置指令（排在聊天记录之后的那段。有人靠深度注入代替它，所以缺了只提示不报错）' },
  ];

  /** 正文"看起来要你自己填"却没填时，不该开着（开了就是把占位话术喂给模型） */
  const FILL_RE = /自定义|自填|自改|此处|点进去看|想玩就开|按格式填写|请填|填写你|粘贴|自己写/;

  function check(m, r, opts = {}) {
    const items = [];
    if (!m) return { items, counts: { err: 0, warn: 0, info: 0 }, levelLabel: LEVEL_LABEL };

    const byIdx = new Map(m.entries.map((e) => [e.idx, e]));
    const entryOf = (i) => byIdx.get(i);
    const nameOf = (i) => entryOf(i)?.name || `#${i}`;
    /** 生效状态：默认取预设里的 enabled；界面上的交互覆盖用 isOn 传进来，保证和 M1 看到的一致 */
    const isOn = opts.isOn || ((i) => !!entryOf(i)?.enabled);
    const onEntry = (e) => !!e && e.listed && isOn(e.idx);

    /* 拼装之后的正文（没有拼装结果时退回原文）。
       为什么重要：源预设里有大量"给人看的"条目是包在 {{//……}} 注释里的，
       展开后是空的 —— 拿原文判断会误报"你把占位话术喂给模型了"。 */
    const segByIdx = new Map(((r && r.segments) || []).map((s) => [s.idx, s]));
    const finalText = (e) => (segByIdx.has(e.idx) ? (segByIdx.get(e.idx).text || '') : (e.content || ''));

    const add = (level, id, title, why, fix, evidence, entries) => {
      items.push({
        id, level, title, why, fix,
        evidence: (evidence || []).filter(Boolean),
        entries: (entries || []).filter((x) => Number.isInteger(x)),
      });
    };

    /* ── 1. prompt_order：没有它，开关和顺序都不存在 ───────────────── */
    if (!m.entries.some((e) => e.listed) && m.entries.length) {
      add('err', 'no-order', '没有 prompt_order，这份预设的开关与顺序都不存在',
        '酒馆靠 prompt_order 决定哪些条目进上下文、按什么顺序排。没有它，条目一律不生效。',
        '在酒馆里打开这份预设并按一次"保存"，酒馆会自动补上 prompt_order。',
        [`共 ${m.entries.length} 条条目，全都不在 prompt_order 里`]);
    }

    /* ── 2. 注入位齐全（切模型丢上下文的形状）───────────────────────── */
    const enabledSlots = new Set(m.entries.filter(onEntry).map((e) => e.identifier));
    const listedSlots = new Set(m.entries.filter((e) => e.listed).map((e) => e.identifier));
    const absent = ANCHORS.filter((a) => !enabledSlots.has(a.id));
    const missing = absent.filter((a) => a.tier === 'must');
    if (missing.length && m.entries.length) {
      add('err', 'missing-anchors', `有 ${missing.length} 个酒馆注入位不在生效条目里`,
        '这些位置标记是酒馆把世界书、角色卡、用户人设、聊天记录塞进提示词的地方。缺了它们，对应的内容根本不会进上下文——表现就是"切了模型之后角色卡/世界书全没了"。',
        '把占这些槽位的条目找出来并打开（它们通常正文为空，只是个标记）。',
        missing.map((a) => `${a.id}（${a.why}）`));
    }
    /* 可选的注入位：只要条目**在列表里**就不吵——它只是关着，那是有意为之。
       完全没有才提示一句。 */
    const optMissing = absent.filter((a) => a.tier === 'opt' && !listedSlots.has(a.id));
    if (optMissing.length && m.entries.length) {
      add('info', 'missing-optional-anchor', `没有 ${optMissing.length} 个可选注入位`,
        '这些位置不是每份预设都会用。缺了不代表坏，只是那类内容进不来。',
        '确认这是有意的（比如你用深度注入代替了它），否则补一个空条目占位。',
        optMissing.map((a) => `${a.id}（${a.why}）`));
    }

    /* ── 3. 槽位只能有一个主人 ─────────────────────────────────────── */
    for (const s of m.slots) {
      if (!s.conflict) continue;
      const on = s.owners.filter((o) => onEntry(entryOf(o.idx)));
      add(on.length > 1 ? 'err' : 'warn', 'slot-conflict:' + s.identifier,
        `槽位「${s.label}」被 ${s.owners.length} 条条目占着`,
        '酒馆里一个槽位只有一个主人，其余同 identifier 的条目等于没写进去。',
        '只保留一条；其余的把 identifier 改掉（变成普通条目），或者关掉。',
        s.owners.map((o) => `${o.name}（${o.chars} 字，${entryOf(o.idx)?.enabled ? '开' : '关'}）`),
        s.owners.map((o) => o.idx));
    }

    /* ── 4. 主提示空着 ─────────────────────────────────────────────── */
    /* 按**展开后**的内容判断，不看原文长度：
       骨架里的 main 正文是一句 {{//待填…}} 注释（43 字），展开后是空的 ——
       只看字数会以为"写了"，于是体检说没问题、导出却被拦住，两边打架。 */
    const mainEntry = m.entries.find((e) => e.identifier === 'main');
    const mainText = mainEntry
      ? ((r && r.textByIdx && r.textByIdx.has(mainEntry.idx)) ? (r.textByIdx.get(mainEntry.idx) ?? '') : (mainEntry.content ?? ''))
      : '';
    if (mainEntry && ![...mainText.trim()].length) {
      add('err', 'main-empty', '主提示（main）展开之后是空的',
        'main 是模型最当真的那一段系统指令。空着的话，整份预设只剩一堆零散功能条目——'
          + '（如果它正文里只有一句"待填"注释，展开后同样是空的，不算写了。）',
        '往 main 里写核心指令，或者确认你确实把主提示放在别的槽位里了。',
        [`「${mainEntry.name}」原文 ${mainEntry.chars} 字，展开后 ${[...mainText.trim()].length} 字`]);
    }

    /* ── 5. 两套思维链标签不许同开 ─────────────────────────────────── */
    const onMembers = (f) => f.members.filter((x) => entryOf(x.idx) && onEntry(entryOf(x.idx)));
    const thinkFams = m.tagFamilies.filter((f) => f.role === '思维链标签' && onMembers(f).length);
    if (thinkFams.length > 1) {
      add('err', 'thinking-conflict', `同时开了 ${thinkFams.length} 套思维链标签`,
        '两套互斥的思考格式同时下指令，模型会把两种结构都吐出来（比如一段 <thinking> 加一段别的），显示层就乱了。',
        '只留一套：把另一套的条目全部关掉，或者在面板/分组里做成"选一"。',
        thinkFams.map((f) => `${f.label}：${onMembers(f).map((x) => x.name).join('、')}`),
        thinkFams.flatMap((f) => onMembers(f).map((x) => x.idx)));
    }

    /* ── 6. 互斥族被同时打开 ───────────────────────────────────────── */
    /* 清空型条目（"初始化变量（别动）"、`🔗`）不在候选里：它只是把变量重置，
       不是"选项"。不排除它的话，每一组都会被误报成"同时开了两个"。 */
    const mutex = [];
    for (const v of m.variables) {
      if (!v.exclusive) continue;
      const real = v.realSetBy ?? v.setBy.filter((i) => !entryOf(i)?.clearer);
      const onSetters = real.filter((i) => onEntry(entryOf(i)));
      if (onSetters.length > 1) mutex.push({ v, onSetters, offCount: real.length - onSetters.length });
    }
    if (mutex.length) {
      add('warn', 'mutex-on', `有 ${mutex.length} 组"选一"的条目被同时打开`,
        '同一个变量被多条条目设置，说明它们本来是"选一个"的关系（文风、破甲档位、输出语言之类）。同时开会互相覆盖，最终值取决于谁排在后面。',
        '每组只留一条开着；如果确实要叠加，把后面那些改成 addvar 累加。',
        mutex.slice(0, 10).map(({ v, onSetters }) => `${v.name}：${onSetters.map(nameOf).join('、')}`),
        mutex.flatMap(({ onSetters }) => onSetters));
    }

    /* ── 7. 开关没开导致变量是空的（点名到底该开哪一个）────────────── */
    /* 只看"真正会给值"的条目（非清空型）：清空型开着不算"有人设了"。
       这就是"M VU 只开生产者没开消费者""功能没生效"的那种形状，
       但汇报方式反过来：这里点名的是**该开而没开的那一个**。 */
    const switchOff = [];
    for (const v of m.variables) {
      const writers = (v.realSetBy ?? v.setBy.filter((i) => !entryOf(i)?.clearer)).concat(v.addBy);
      if (!writers.length) continue;                                     // 那是"悬空变量"，第 8 条管
      const onWriters = writers.filter((i) => onEntry(entryOf(i)));
      if (onWriters.length) continue;                                    // 有人设，值就不是空的
      const onReaders = v.getBy.filter((i) => onEntry(entryOf(i)));
      if (!onReaders.length) continue;                                   // 没人读，无所谓
      switchOff.push({ v, offWriters: writers.filter((i) => entryOf(i)), onReaders });
    }
    if (switchOff.length) {
      add('warn', 'switch-off', `有 ${switchOff.length} 个变量没有开启的条目去设值，但有人在读`,
        '读它的条目本轮只会展开成空字符串——看起来"功能没生效"，其实只是对应的开关条目没开。'
          + '（默认关着的可选模块会大量命中这一条，如果你本来就打算关着它们，可以整体忽略。）',
        '打开清单里点名的那些条目，或者把读它的条目一起关掉。',
        switchOff.slice(0, 10).map(({ v, offWriters, onReaders }) =>
          `${v.name}：设它的是「${offWriters.map(nameOf).join('、')}」（关着），读它的是「${onReaders.map(nameOf).join('、')}」（开着）`),
        switchOff.flatMap(({ offWriters }) => offWriters));
    }

    /* ── 8. 悬空变量：谁都设不了 ───────────────────────────────────── */
    const dangling = m.variables.filter((v) => v.dangling);
    if (dangling.length) {
      add('warn', 'dangling-var', `有 ${dangling.length} 个变量被读却没人设置`,
        '这些变量在整份预设里找不到 setvar/addvar，展开永远是空字符串。多半是漏搬了设置它的条目，或者变量名拼错了。',
        '补上设置它的条目（丢掉的开关），或者把读它的地方删掉。',
        dangling.slice(0, 12).map((v) => `${v.name}（${v.getBy.length} 条在读：${v.getBy.slice(0, 3).map(nameOf).join('、')}）`));
    }

    /* ── 9. 读了还没设的变量（顺序陷阱，来自 M1 的真实展开）────────── */
    /* 这条最容易误报，判据写清楚：
       · 必须有**会给值的**写入者排在后面（addvar，或非清空型且非空的 setvar）
         —— 否则"读到空"就是这一轮的常态，属于第 7 条"开关没开"的范畴；
       · 而且这份预设里**不存在**初始化这个变量的"清空型"条目。
         因为有初始化条目时，"某个读者读到空、值由后面某条设置"本身就是作者的写法
         （典型的"开关条目设值 + 指南条目读值"结构，读的那条本来就可能读到空）。
         拿它报"顺序错"会把正常设计全报成红色。

       2026-09 的 M3 端到端测试就是被这条绊住的：把 Kemini 的 `🔗`（清空型初始化）
       关掉之后，17 个变量变成"读时未定义"，但逐个查下来 16 个根本没有会给值的写入者，
       剩下一个（抢话开关）在设计的流程里读到的**同样是空**——两种状态下行为一模一样。 */
    if (r && Array.isArray(r.events)) {
      const hasClearer = (name) => m.entries.some((e) => e.clearer && e.sets.includes(name));
      const laterRealSet = (name, at) => r.events.slice(at + 1).some((x) => {
        if (x.op === 'add') return true;
        if (x.op !== 'set') return false;
        if (String(x.value ?? '').trim() === '') return false;
        return !entryOf(x.idx)?.clearer;
      });
      const bad = r.events
        .map((e, i) => ({ e, i }))
        .filter(({ e, i }) => e.op === 'get' && e.defined === false
          && !hasClearer(e.name) && laterRealSet(e.name, i));
      if (bad.length) {
        const byVar = new Map();
        for (const { e } of bad) {
          if (!byVar.has(e.name)) byVar.set(e.name, new Set());
          byVar.get(e.name).add(e.by);
        }
        add('err', 'read-before-set', `有 ${bad.length} 处"先读后设"：读的时候变量还没有值，而设它的条目排在后面`,
          '变量展开是**按顺序**算的。读的那一条排在设它那一条前面，读到的就是空字符串——不是"值不对"，是"根本还没写"。',
          '把设置它的条目排到它前面（在 prompt_order 里往上拖），或者在更前面加一条 {{setvar::名字::}} 兜底。',
          [...byVar.entries()].slice(0, 10).map(([n, by]) => `${n}：被「${[...by].join('、')}」读在前面`));
      }
    }

    /* ── 10. 变量最终是空的（既成事实，和上一条互不替代）───────────── */
    if (r && Array.isArray(r.emptyVars) && r.emptyVars.length) {
      const onlySwitchOff = new Set(switchOff.map((s) => s.v.name));
      const rest = r.emptyVars.filter((v) => !onlySwitchOff.has(v.name));
      if (rest.length) {
        add('warn', 'empty-final', `有 ${rest.length} 个变量拼完之后是空的，却还被读取`,
          '这些变量有人设置，但最后一次写入就是空字符串（多半是"初始化/清空"那条），读到它们的条目最终拿到空值。',
          '检查这些变量的"清空"条目与"赋值"条目是不是顺序反了，或者赋值条目根本没开。',
          rest.slice(0, 12).map((v) => `${v.name}（最后写入来自「${v.lastBy}」，${v.reads} 处在读）`));
      }
    }

    /* ── 11. 不在 prompt_order 里的条目：永远不会生效 ──────────────── */
    const unlisted = m.entries.filter((e) => !e.listed);
    if (unlisted.length) {
      add('warn', 'unlisted', `有 ${unlisted.length} 条条目不在 prompt_order 里`,
        '这些条目永远不会被送进模型。如果它们本该生效（比如是从别处搬过来但漏了），那就是"功能凭空消失"；如果是有意留档，可以忽略。',
        '确认每一条：要用的加进 prompt_order（在酒馆里会显示为条目列表的一员），不要的删掉。',
        unlisted.slice(0, 12).map((e) => `${e.name || '(无名)'}（${e.chars} 字）`),
        unlisted.map((e) => e.idx));
    }

    /* ── 12. 待填条目却开着（按**展开后**的正文判，注释掉的说明不算）── */
    const fillOn = m.entries
      .filter((e) => onEntry(e) && FILL_RE.test(finalText(e)))
      .map((e) => ({ e, t: finalText(e) }));
    if (fillOn.length) {
      add('warn', 'fill-on', `有 ${fillOn.length} 条"看起来要你自己填内容"的条目正开着`,
        '这些条目展开之后仍然带着"此处自定义""点进去看"之类的话术——你要是没填，模型就会被要求照着占位话术办事。',
        '要么把内容填上，要么先关掉，等要用的时候再开。',
        fillOn.slice(0, 10).map(({ e, t }) => `${e.name}（展开后 ${[...t].length} 字）`),
        fillOn.map(({ e }) => e.idx));
    }

    /* ── 13. 两条开着的条目**展开后**正文一模一样（重复注入）───────── */
    const fpMap = new Map();
    for (const e of m.entries) {
      if (!onEntry(e)) continue;
      const key = finalText(e);
      if ([...key].length < 40) continue;             // 空的和极短的（比如只有 setvar）不算
      if (!fpMap.has(key)) fpMap.set(key, []);
      fpMap.get(key).push(e);
    }
    const dups = [...fpMap.values()].filter((g) => g.length > 1);
    if (dups.length) {
      add('warn', 'dup-content', `有 ${dups.length} 组开着的条目正文完全一样`,
        '同一段正文被重复注入，既浪费上下文，也可能让模型以为你要强调两遍（指令类条目重复尤其危险）。',
        '每组只留一条。',
        dups.slice(0, 8).map((g) => `${g.map((e) => e.name).join(' ＝ ')}（各 ${g[0].chars} 字）`),
        dups.flatMap((g) => g.map((e) => e.idx)));
    }

    /* ── 14. 注入到具体楼层却没写深度 ─────────────────────────────── */
    const depthBad = m.entries.filter((e) => onEntry(e) && Number(e.injPos) === 1 && (e.injDepth === null || e.injDepth === undefined));
    if (depthBad.length) {
      add('warn', 'depth-missing', `有 ${depthBad.length} 条设了"注入到聊天深度"但没写深度`,
        '酒馆需要知道插到倒数第几层；没写的话行为会由酒馆的默认值决定，容易和你的预期不一致。',
        '给这些条目补上 injection_depth。',
        depthBad.map((e) => e.name), depthBad.map((e) => e.idx));
    }

    /* ── 15. 外部依赖：宏 / CDN ───────────────────────────────────── */
    if (m.external.macros.length) {
      add('info', 'ext-macro', `用到了 ${m.external.macros.length} 个非酒馆原生宏`,
        '这些宏要由插件（酒馆助手脚本之类）提供。没装那个插件时，它们会被原样留着或者展开成占位符。',
        '装好对应插件；或者把用到这些宏的条目关掉。',
        m.external.macros.slice(0, 12).map((x) => `{{${x.name}}} ← ${x.by.slice(0, 3).join('、')}`));
    }
    if (m.external.cdn.length) {
      add('warn', 'cdn', `有 ${m.external.cdn.length} 处依赖外部 CDN`,
        'CDN 不通（断网、被墙、离线）时这些正则/脚本就失效——而且它会把"你的提示词"和"别人的服务器"绑在一起。',
        '把字体/图片/库换成本地文件或内联。',
        m.external.cdn);
    }

    /* ── 15b. EJS 模板（提示词模板扩展）─────────────────────────────
       这类内容不是"给模型看的文本"，而是发送前要被渲染掉的代码。
       没装扩展时它原样进上下文：白烧 token，还可能让模型跟着写代码。 */
    const ejsEntries = m.entries.filter((e) => onEntry(e) && e.ejsCount);
    if (ejsEntries.length) {
      const total = ejsEntries.reduce((a, e) => a + e.ejsCount, 0);
      add('warn', 'ejs-template', `有 ${ejsEntries.length} 条开着的条目里用了 EJS 模板（共 ${total} 处 \`<% … %>\`）`,
        '这类内容要靠**提示词模板（ST-Prompt-Template）**扩展在发送前渲染掉。'
          + '没装、或那个扩展没启用时，`<% … %>` 会**原样进上下文**——白烧 token，还可能让模型跟着写代码。'
          + '（提示词模板还能反过来渲染 AI 回复里的模板，那是它的能力，这里只管提示。）',
        '要么装上并启用提示词模板扩展；要么把这几条关掉。',
        ejsEntries.slice(0, 8).map((e) => `${e.name}（${e.ejsCount} 处，例：${e.ejsHead}）`),
        ejsEntries.map((e) => e.idx));
    }

    /* ── 16. 带脚本却全都没启用（面板装不上）──────────────────────── */
    if (m.scripts.length && m.scripts.every((s) => !s.enabled)) {
      add('warn', 'script-off', `预设里带了 ${m.scripts.length} 个内嵌脚本，但都是关的`,
        '内嵌面板/辅助脚本只有在启用时才会跑。关着的话，你导入预设后什么都不会出现。',
        '在酒馆助手的脚本列表里把该脚本打开。',
        m.scripts.map((s) => s.name));
    }

    /* ── 17. 上下文占用（事实陈述，够大才升级为警告）───────────────── */
    if (r && typeof r.tokenEstimate === 'number') {
      const big = r.tokenEstimate > 12000;
      add(big ? 'warn' : 'info', 'budget',
        `这一套开着的时候，预设正文约占 ${r.tokenEstimate} token（${r.bodyChars ?? r.totalChars} 字）`,
        '这是你"每次都要付"的固定开销，剩下的上下文才留给聊天记录和历史。'
          + '注意：别拿"开启条目的原文合计"当占用——开关型条目（正文几乎全是 setvar）不产出文本，'
          + '注入位占位块也不算（酒馆注入的是世界书/角色卡本身）。',
        r.tokenEstimate === 0
          ? '现在是 0：开着的东西都还没写正文。'
          : (big ? '预设正文偏重，考虑关掉用不上的模块，或把长条目挪进世界书按需触发。' : '正常范围。'),
        [`原文合计 ${m.counts.enabledChars} 字 → 展开后 ${r.totalChars} 字 → 去掉注入位占位后 ${r.bodyChars ?? '?'} 字`]);
    }

    const counts = { err: 0, warn: 0, info: 0 };
    for (const it of items) counts[it.level]++;
    items.sort((a, b) => (['err', 'warn', 'info'].indexOf(a.level) - ['err', 'warn', 'info'].indexOf(b.level)));
    return { items, counts, levelLabel: LEVEL_LABEL };
  }

  /** 把体检结果变成一份能直接贴进待办的 Markdown 清单 */
  function toMarkdown(report, m) {
    const L = [];
    L.push(`# 预设体检：${m?.file ?? '(未命名)'}`);
    L.push('', `必改 ${report.counts.err} 项 · 建议 ${report.counts.warn} 项 · 提示 ${report.counts.info} 项`, '');
    for (const level of ['err', 'warn', 'info']) {
      const group = report.items.filter((x) => x.level === level);
      if (!group.length) continue;
      L.push(`## ${LEVEL_LABEL[level]}（${group.length}）`, '');
      for (const it of group) {
        L.push(`- [ ] **${it.title}**`);
        L.push(`      - 为什么：${it.why}`);
        L.push(`      - 怎么改：${it.fix}`);
        for (const e of it.evidence) L.push(`      - 依据：${e}`);
      }
      L.push('');
    }
    L.push('> 本清单由预设解析器（M2 体检）生成：只读、只给结构建议，不替你写提示词内容。', '');
    return L.join('\n');
  }

  root.PresetInvariants = { check, toMarkdown, LEVEL_LABEL, ANCHORS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
