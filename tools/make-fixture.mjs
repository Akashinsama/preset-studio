#!/usr/bin/env node
/**
 * 合成夹具生成器（synthetic fixtures）
 *
 *   node tools/make-fixture.mjs                  # 缺谁补谁（已有文件一律不动）
 *   node tools/make-fixture.mjs --force          # 只覆盖"自己生成的"合成夹具
 *   node tools/make-fixture.mjs --force-real     # 连真实预设也覆盖（危险，必须显式写）
 *
 * ── 为什么有这个文件 ────────────────────────────────────────────────
 * 这套工具链原来必须喂三份**别人的**预设（Izumi / Kemini / 梦鲸思客）才能转起来。
 * 公开仓库不随附任何预设正文，于是链子空转、上千项断言只能 SKIP。
 * 这个生成器按 spec/ 里**已经进库**的结构信息自己造三份结构等价的夹具：
 *
 *   · 条目名 / 槽位主人 / 顺序 / 初始开关 —— 与真实成品同一套结构（来自 spec/groups.json
 *     与 spec/slot-owner.json，它们本来就是这份预设的结构规格）
 *   · 正文一律是「【合成夹具】…」占位，**一个字节的第三方文本都没有**
 *   · 顶层带 __synthFixture 标记，测试据此分辨"真夹具 / 合成夹具"并分叉断言
 *     （真实规模类断言在合成夹具下会打印跳过，而不是假装通过）
 *
 * 于是克隆下来跑一句 `node tools/make-fixture.mjs`，构建链与测试就全活了。
 *
 * ── 三条规矩 ───────────────────────────────────────────────────────
 * 1. **真实夹具优先**：目标文件已存在且没有 __synthFixture 标记 = 那是真预设，绝不动它。
 * 2. **确定性**：同一个 spec 生成的结果逐字节相同（内容是名字/index 推导出来的，
 *    不用随机数、不写时间戳）——否则每次构建都会"改动"成品，哈希断言全乱。
 * 3. 生成物落在仓库根、与工具链一直用的文件名一致，并且**被 .gitignore 挡着**，不进库。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.cwd();
const P = (...a) => path.join(ROOT, ...a);
const FORCE = process.argv.includes('--force');
const FORCE_REAL = process.argv.includes('--force-real');

const read = (rel) => JSON.parse(fs.readFileSync(P(rel), 'utf8'));
const groupsSpec = read(path.join('spec', 'groups.json'));
const slotOwner = read(path.join('spec', 'slot-owner.json'));
delete slotOwner.$comment;
const ownNames = new Set(
  ['fano-layer.json', 'mvu-layer.json']
    .flatMap((f) => read(path.join('spec', f)).entries.map((e) => e.name)),
);

/** groups.json 里 option.source 的写法 → 三个来源键（与 build-preset 的 SOURCE_ALIAS 一致） */
const SOURCE_ALIAS = { Izumi: 'Izumi', Kemini: 'Kemini', 梦鲸思客V4: '梦鲸', 梦鲸: '梦鲸' };
const FILES = {
  Izumi: 'Izumi_0914.json',
  Kemini: 'Kemini_Dramatron_v3.1.json',
  梦鲸: '梦鲸思客V4-0915.json',
};

const detUuid = (seed) => {
  const h = crypto.createHash('sha1').update('synth::' + seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

/**
 * 结构孪生：这两个名字在真实源预设里**占着内置槽位但不是主人**，组装时会被降级成普通条目
 * （check-preset 专门验这条路径："💾主提示 不再是 main"、"短对话模式 不再是 jailbreak"）。
 * 夹具要能把这条路走出来，所以故意给它们安排会撞槽的 identifier。
 * 名字不存在时（换了 spec）自然不生效，不会报错。
 */
const TWIN_SLOT = { '💾主提示': 'main', '短对话模式': 'jailbreak' };
const slotOf = (sourceKey, name) =>
  Object.keys(slotOwner).find((slot) => slotOwner[slot] === `${sourceKey}:${name}`) ?? null;

/* ── 1. 名字 → 来源、以及初始开关 ─────────────────────────────────── */
const want = new Map();     // name -> { source, slot, enabled }
const JB = groupsSpec.groups.find((g) => g.id === 'jailbreak');
const THINKING = groupsSpec.thinkingTags ?? [];
const THINKING_ALL = new Set(THINKING.flatMap((t) => t.members));
const THINKING_DEFAULT = '📽️ICOT（三段）';
const SUMMARY = new Set(groupsSpec.groups.find((g) => g.id === 'summary')?.members ?? []);

/* 1a. 内置槽位主人：结构型条目，必须有（否则成品缺槽位） */
for (const [slot, who] of Object.entries(slotOwner)) {
  const [source, name] = [who.slice(0, who.indexOf(':')), who.slice(who.indexOf(':') + 1)];
  want.set(name, { source, slot, enabled: true });
}
/* 1b. 破甲骨架：按 option 声明的来源归位 */
for (const o of JB?.options ?? []) {
  const key = SOURCE_ALIAS[o.source];
  for (const n of o.members ?? []) want.set(n, { source: key, slot: slotOf(key, n), enabled: true });
  for (const t of o.tunables ?? []) {
    for (const n of t.members ?? []) {
      /* 只有 km_cot 这类"选一档位"的默认项开着，其余档位默认关 */
      const on = t.mode === 'single' && t.default === n;
      want.set(n, { source: key, slot: slotOf(key, n), enabled: on });
    }
  }
}
/* 1c. 其余各组的成员：默认归 Izumi（与 build-preset 的判定一致），
       但"自有层"条目由 spec/*-layer.json 提供，不搬。 */
for (const g of groupsSpec.groups) {
  if (g.id === 'jailbreak' || g.id === 'fano') continue;
  for (const n of g.members ?? []) {
    if (ownNames.has(n) || want.has(n)) continue;
    const on = g.mode === 'fixed' ? true
      : THINKING_ALL.has(n) ? n === THINKING_DEFAULT
        : SUMMARY.has(n) ? false
          : g.mode === 'editable' ? false
            : g.mode === 'single' ? (g.members ?? [])[0] === n
              : true;
    want.set(n, { source: 'Izumi', slot: slotOf('Izumi', n), enabled: on });
  }
}
const missingAnchors = (groupsSpec.anchors ?? []).filter((n) => !want.has(n));
for (const n of missingAnchors) want.set(n, { source: 'Izumi', slot: null, enabled: true });

/* 1d. 开关状态后处理：**每个"选一"模块最多留一个开着**。
   同一条目会被好几个模块列进去（custom 这种"视图"会重复列），先写后写互相覆盖，
   于是夹具里冒出"12 组选一同时开着"——真实预设不会这样，体检会（正确地）报错。
   锚点与内置槽位主人不在此列：它们必须开。 */
const protectedNames = new Set(Object.values(slotOwner).map((who) => who.slice(who.indexOf(':') + 1)));
for (const n of groupsSpec.anchors ?? []) protectedNames.add(n);
for (const g of groupsSpec.groups) {
  if (g.mode !== 'single') continue;
  (g.members ?? []).forEach((n, idx) => {
    const m = want.get(n);
    if (!m || protectedNames.has(n)) return;
    m.enabled = idx === 0;
  });
}

/** "初始化 / 清空型"条目：真实预设里就靠它们把一批变量置成空格。
    测试点名要认出来（Kemini 的 🔗、Izumi 的"初始化变量（别动）"），所以照名字认。 */
const INIT_LIKE = new Set(['🔗', '初始化变量（别动）']);
const isInitLike = (name) => INIT_LIKE.has(name) || /初始化|清空/.test(name);

/**
 * 每条条目属于哪个"选一"模块（没有就是 null）。
 *
 * 用途是把"互斥候选"变量摆在**同一个模块内部**：同一个模块的成员共用一个变量，
 * 于是解析器判它 exclusive（≥2 条设置 → 一条"选一"建议），而体检那边看到的是
 * "这个模块只有一个成员开着"（因为开关后处理保证了这点）→ 不会报"互斥族同时开"。
 * 早先把变量撒给跨模块的条目，这两个断言就互相打架。
 */
const singleGroupOf = new Map();
for (const g of groupsSpec.groups) {
  if (g.mode !== 'single') continue;
  for (const n of g.members ?? []) if (!singleGroupOf.has(n)) singleGroupOf.set(n, g.id);
}

/* ── 2. 占位正文 ──────────────────────────────────────────────────   每一段都是合成的，长度控制在几百字：太短撑不起"规模验证"，太长没必要。
   功能钩子（变量 / 标签族 / EJS / CDN / <format> / <options>）按名字与下标确定性注入，
   好让解析、变量总线、标签族、外部依赖、防截断、选项栏这些测试都有东西可测。 */
const SYNTH = '【合成夹具】';

function body(name, i, srcKey) {
  /* 每 5 条里有 1 条是"开关型"：正文**只有宏**、展开后一个字符都不剩。
     真实预设里有几十条这种条目（开=生效、关=不生效，本身不产出正文），
     拼装器把它们识别成"展开后为空"是**正确行为**——所以这里绝不能写任何说明文字，
     一写就不空了（第一版就是这么错的：前缀那句占位文案把"空"撑满了）。
     但**有专门角色的条目不能这么处理**（ICOT/COT、选项栏、防截断、初始化型…）：
     它们的正文本身就是断言的对象，被吃成空宏等于把被测内容删掉了。 */
  const special = isInitLike(name) || THINKING_ALL.has(name) || /选项|防截断|禁词|自定义/.test(name)
    || i === izumiInitIdx;
  if (i % 5 === 3 && !special) return `{{setvar::synth_flag_${i}::on}}`;

  const out = [];
  out.push(`${SYNTH}${name}`);
  out.push(`这一条由 tools/make-fixture.mjs 生成，用来给工具链提供**结构**：条目名、槽位、顺序、开关都是真的，`
    + `正文是占位的。它不含任何真实预设的原文——真实预设属于各自的作者，不随本仓库分发。`);
  out.push(`占位正文第 ${i + 1} 段：解析器要能读出角色、槽位、注入位与顺序；拼装器要能按顺序把它接起来；`
    + `体检器要能对整份预设给出结论。`);
  /* {{user}} / {{char}} 要真的出现在正文里，拼装的"宏替换"才有对象 */
  if (i % 6 === 0) out.push(`这一条写给 {{user}} 看，签名是 {{char}}。`);

  /* 思维链：形态由所属标签族决定（Kemini 用 <thinking>，Izumi 用 konatan_planning~）。
     两条具体文案是**测试在查的东西**：ICOT 必须说"分为三段"，COT 必须只有 <thinking>
     而不能说三段——它们决定折叠成哪种形态，所以夹具要能把这两条路径都演出来。 */
  if (THINKING_ALL.has(name)) {
    const kemini = THINKING.some((t) => t.id === 'kemini' && t.members.includes(name));
    if (/ICOT/.test(name)) {
      out.push('思考方式：把输出**分为三段**，每段都是"先思考再正文"，思考用 <thinking>…</thinking> 包住。');
    } else if (/COT/.test(name)) {
      out.push('思考方式：只思考一次，用 <thinking>…</thinking> 包住，不分段。');
    } else if (kemini) {
      out.push('思考方式：用 <thinking>…</thinking> 包住思考。');
    } else {
      out.push('思考方式：用 <konatan_planning~>…</konatan_planning~> 包住思考，通常只有一块。');
    }
  }
  /* 摘要组：这些条目会吐事件文本，配套正则没搬齐时必须默认关 */
  if (SUMMARY.has(name)) {
    out.push(`摘要模式：把当前主线写进 <current_event> 里，并在末尾维护一行 Progress。`);
  }
  /* 防截断条目：面板的脚本层防截断靠 <format> 当锚点 */
  if (/防截断/.test(name)) {
    out.push(`防截断：正文必须完整，不得中途收尾；输出以 <format> 作为格式锚点。`);
  }
  /* 选项栏：给"模型输出 <options> 块"的显示层正则提供样本 */
  if (/选项/.test(name)) {
    out.push('在正文后给用户四个可选行动，用 <options> 标签包裹：\n'
      + '<options>\n>选项一：[一个莫名其妙但好玩的行动]\n>选项二：[一个主动推进任务的行动]\n'
      + '>选项三：[一个侧重人际互动的行动]\n>选项四：[一个更亲密些的行动]\n</options>');
  }
  /* 需要用户自己填内容的条目 */
  if (/禁词|自定义/.test(name)) {
    out.push('【要你自己填】这里放你自己的清单；留空不影响其它功能。');
  }

  /* ── 变量总线：需要**两套独立的"清空型"家族**，因为两条断言看的不是同一份文件 ──
     · 家族 A（synth_blank_*）：只在 Izumi 文件内部自给自足——第一段测试是拿
       **Izumi 单文件**跑的，它要能自己演"初始化条目把变量置空 + 后面有人读"；
       写的人固定取 Izumi 的第一条（保证在成品里排在所有读者之前，不会"先读后设"）。
     · 家族 B（synth_km_*）：`🔗`（Kemini 的初始化条目）写，Izumi/梦鲸 的条目读。
       成品体检那条"关掉初始化条目 → 没有开启的条目给这些变量设值"就靠它——
       家族 A 在 Izumi 里还有自己的写手，关 🔗 拦不到它。 */
  if (i === izumiInitIdx) {
    out.push(Array.from({ length: 30 }, (_, k) => `{{setvar::synth_blank_${k}::}}`).join(''));
    out.push('（以上把 30 个变量置成空格，演"初始化 / 清空型条目"。）');
  }
  if (name === '🔗') {
    out.push(Array.from({ length: 20 }, (_, k) => `{{setvar::synth_km_${k}::}}`).join(''));
    /* 顺手也把家族 C 的变量置成空：体检那条"先读后设"只在**没有任何清空型条目设过它**时才报。
       家族 C 的写手是个默认关着的普通条目（用来演 switch-off），要是没有清空型兜底，
       关掉 🔗 之后那些读者就会被冤枉成"顺序错"——而真实预设里恰恰有这层兜底。 */
    out.push(Array.from({ length: 3 }, (_, k) => `{{setvar::synth_sw_${k}::}}`).join(''));
    out.push('（以上把变量置成空格，演"初始化 / 清空型条目"。）');
  } else if (isInitLike(name)) {
    out.push(Array.from({ length: 20 }, (_, k) => `{{setvar::synth_alt_${k}::}}`).join(''));
  }
  /* 家族 C 的写手：一条普通的、默认关着的条目 */
  if (i === swWriterIdx) out.push(Array.from({ length: 3 }, (_, k) => `{{setvar::synth_sw_${k}::on}}`).join(''));
  /* 读者都排在写手之后：家族 A 在 Izumi 内部（第一条之后），家族 B/C 靠成品顺序
     OWN → Kemini → Izumi → 梦鲸 保证晚于各自的写手 */
  if (readerIdx.has(i)) {
    /* 一条读者读两个槽位：30 个空变量要都能被读到（读一个的话只能覆盖一半，
       明细就凑不够"几十条"） */
    out.push('当前状态：'
      + `{{getvar::synth_blank_${(2 * i) % 30}}}／{{getvar::synth_blank_${(2 * i + 1) % 30}}}`
      + `／{{getvar::synth_km_${i % 20}}}／{{getvar::synth_sw_${i % 3}}}`);
  }
  if (srcKey === '梦鲸' && i % 2 === 0) out.push(`渠道初始化：{{getvar::synth_km_${i % 20}}}`);
  const g = singleGroupOf.get(name);
  if (g) out.push(`{{setvar::synth_excl_${g}::on}}{{getvar::synth_excl_${g}}}`);
  if (i % 7 === 0) out.push(`{{addvar::synth_acc_${i % 8}::1}}{{getvar::synth_acc_${i % 8}}}`);
  out.push(`{{setvar::synth_uniq_${i}::v${i}}}`);
  /* ⑤ 悬空变量：只读不设。**只让"关闭的"条目去读它**——
     解析器照样把它判成悬空（源级别的 getBy 不管开关），但成品里没有任何启用条目读它，
     体检就不会把"读到没设过的变量"算成"先读后设"（那是误报，真实预设的"必改"是 0）。 */
  if (i === danglingIdx) out.push('{{getvar::synth_dangling}}');
  /* 标签族：让"标签族"这一视图有内容 */
  if (i % 13 === 0) out.push(`<tucao>${SYNTH}用来撑起标签族的行内吐槽</tucao>`);
  if (i % 17 === 0) out.push(`<konatan_chat>${SYNTH}用来撑起现实闲聊卡片</konatan_chat>`);
  /* EJS（提示词模板扩展）：让"认得出 EJS"这条提醒有对象 */
  if (i % 19 === 0) out.push('<% if (typeof getvar === \'function\' && getvar(\'synth_affection\') > 3) { %>\n'
    + `${SYNTH}EJS 分支里的内容\n<% } %>`);
  /* CDN 依赖：让"外部依赖"能报出来 */
  if (i % 23 === 0) out.push('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC&display=swap">');

  out.push(`${SYNTH}结尾占位：这一段没有语义，只用来保证每条正文长度接近真实条目。`);
  return out.join('\n\n');
}

/* ── 3. 三份夹具的骨架 ────────────────────────────────────────────── */

/** 酒馆 completion preset 的顶层形状（数值都是我们自己的默认值，不抄任何人的） */
const topLevel = (name) => ({
  name,
  temperature: 1,
  frequency_penalty: 0,
  presence_penalty: 0,
  top_p: 0.95,
  top_k: 0,
  max_tokens_second: 0,
  openai_max_context: 2000000,
  openai_max_tokens: 32000,
  wrap_in_quotes: false,
  names_behavior: 0,
  send_if_empty: '',
  impersonation_prompt: '',
  new_chat_prompt: '',
  new_group_chat_prompt: '',
  new_example_chat_prompt: '',
  continue_nudge_prompt: '',
  bias_preset_selected: 'Default',
  streaming: true,
  max_context_unlocked: false,
  wi_format: '{0}',
  scenario_format: '{{scenario}}',
  personality_format: '{{personality}}',
  group_nudge_prompt: '',
  assistant_prefill: '',
  assistant_impersonation: '',
  continue_prefill: false,
  squash_system_messages: false,
  extensions: {},
});

/** 生成一条 prompt（结构字段是真的，正文是占位） */
function promptFor(name, meta, i, srcKey) {
  const markerSlot = ['chatHistory', 'dialogueExamples', 'worldInfoBefore', 'worldInfoAfter',
    'charDescription', 'charPersonality', 'personaDescription', 'scenario'];
  const isMarker = meta.slot && markerSlot.includes(meta.slot);
  const p = {
    identifier: meta.slot ?? TWIN_SLOT[name] ?? detUuid(name),
    name,
    system_prompt: false,
    role: 'system',
    content: isMarker ? '' : body(name, i, srcKey),
    injection_position: 0,
    injection_depth: 4,
  };
  if (isMarker) { p.marker = true; p.content = ''; }
  /* 注入锚点这一类：靠 in-chat 注入占住世界书/角色卡的位置 */
  if (/^💠</.test(name) || /^💠<\/?/.test(name)) {
    p.injection_position = 1;
    p.injection_depth = 0;
  }
  return p;
}

const bySource = { Izumi: [], Kemini: [], 梦鲸: [] };
let i = 0;
for (const [name, meta] of want) {
  bySource[meta.source].push({ name, meta, idx: i++ });
}
/** 挑一条**关闭的** Izumi 条目来读悬空变量（见 body() 第 ⑤ 条） */
const danglingIdx = (bySource.Izumi.find((x) => !x.meta.enabled) ?? bySource.Izumi[0])?.idx;
/** 家族 A 的写手：Izumi 的第一条（保证它在成品里排在所有 Izumi 读者之前） */
const izumiInitIdx = bySource.Izumi[0]?.idx;
/**
 * 读者只能挑**开启的**条目：关闭的条目在拼装里根本不执行，
 * 它们的 getvar 既不会让变量进"空变量明细"，也不会让体检看到"有人在读却没人写"。
 * 第一版按 i % 4 撒，结果一大堆读者落在关闭条目上 → 明细只剩 4 条、switch-off 也不触发。
 */
const readerIdx = new Set(
  bySource.Izumi.filter((x) => x.meta.enabled && x.idx > izumiInitIdx).slice(0, 30).map((x) => x.idx),
);
/**
 * 家族 C：**由一条关闭的、非清空型条目**写、由开启的条目读。
 * 体检那条"没有开启的条目给这些变量设值"报的就是这种形态：清空型写手（🔗、初始化变量）
 * 会被解析器排除在"真正的写手"之外（它们只是重置），所以拿它们演不出来——
 * 必须用一个普通条目当写手，再把它的开关关掉。
 *
 * 写手必须排在读者**前面**（否则体检会同时报"先读后设"）：所以优先挑 Kemini 里
 * 关闭的条目（成品顺序 OWN → Kemini → Izumi → 梦鲸，它天然在 Izumi 读者之前）。
 */
const minReaderIdx = readerIdx.size ? Math.min(...readerIdx) : Infinity;
const swWriterIdx = (bySource.Kemini.find((x) => !x.meta.enabled && !isInitLike(x.name))
  ?? bySource.Izumi.find((x) => !x.meta.enabled && !isInitLike(x.name) && x.idx < minReaderIdx))?.idx;

function buildFixture(key, extra = {}) {
  const list = bySource[key];
  const prompts = list.map((x) => promptFor(x.name, x.meta, x.idx, key));
  /* 条目自身也写一份 enabled，并且**与 prompt_order 一致**。
     真实预设两处都有值；早先夹具只在 prompt_order 里写，于是"prompt.enabled 与
     prompt_order.enabled 不一致"的条数从 134 变 133（编辑器顺手归一化了一个），
     那条"不去顺手归一化原文件里本来就矛盾的开关"的断言就是这么被冤枉的。

     另外每 13 条留 1 条**不进 prompt_order**：真实预设里总有一批"没列进列表"的条目
     （边缘条目），编辑器的"加回列表 / 移出去"就是冲它们来的——第一版夹具把条目全列进去了，
     "把一条未列入的条目加进列表"那段断言直接没对象可挑。 */
  const isListed = (idx) => idx % 13 !== 0;
  prompts.forEach((p, k) => { p.enabled = isListed(list[k].idx) && !!list[k].meta.enabled; });
  const order = list.filter((x) => isListed(x.idx)).map((x) => ({
    identifier: prompts[list.indexOf(x)].identifier,
    enabled: !!x.meta.enabled,
  }));
  return {
    ...topLevel(FILES[key].replace(/\.json$/, '')),
    ...extra,
    prompts,
    prompt_order: [{ character_id: 100001, order }],
    extensions: {
      tavern_helper: { scripts: SYNTH_SCRIPTS.map((s) => ({ ...s })), variables: {} },
      ...(extra.extensions ?? {}),
    },
    __synthFixture: {
      by: 'tools/make-fixture.mjs',
      what: `${SYNTH}结构等价、正文占位的合成预设（不是任何人的真预设）`,
      entries: prompts.length,
      note: '要换成你自己的真预设：删掉这个文件，把你那份放成同名即可；生成器不会覆盖没有本标记的文件。',
    },
  };
}

/* ── 4. 两个"思维链模板"：build-regex 要从源里抽出它们 ─────────────
   内容是我们自己写的极简折叠 HTML；Kemini 那份必须带 st_custom_reasoning（会被改成
   自己的类名）与 $1；两份都要有 <summary>，因为折叠文案统一改写在 <summary> 上生效。 */
const KEMINI_FOLD = `<details class="st_custom_reasoning" style="margin:8px 0;border:1px solid rgba(0,0,0,.12);border-radius:6px;padding:6px 10px">
  <summary style="cursor:pointer;list-style:none"><span>思考中</span></summary>
  <div class="synth-reasoning" style="white-space:pre-wrap;opacity:.85">$1</div>
</details>`;

const IZUMI_CARD = `<div class="konata-thinking-details" style="margin:10px 0;padding:10px 12px;border-radius:14px;border:1px solid rgba(122,92,196,.25);background:linear-gradient(160deg,#f7f2ff,#efe6ff)">
  <summary style="cursor:pointer;list-style:none"><span>思考中</span></summary>
  <div class="synth-think-card-b" style="white-space:pre-wrap">$1</div>
</div>`;

/* 两个类名是有讲究的，别顺手改：
   · Kemini 形态靠 class="st_custom_reasoning"（build-regex 会把它改成自己的类名 fano_thinking，
     后面那条"多块末块"的正则又靠 class="fano_thinking" 当前瞻锚点）
   · Izumi 形态靠 class="konata-thinking-details"，而且必须是**这一个类、原样**——
     test-regex / check-preset 就是数 `class="konata-thinking-details"` 来判断形态的。
   <summary> 也不能省：折叠文案统一改写在 <summary> 上生效。 */

/** 合成预设里塞一条占位酒馆助手脚本：让"预设带脚本"这条结构成立（有的测试会按它有来取） */
const SYNTH_SCRIPTS = [{
  type: 'script',
  enabled: true,
  name: '合成夹具 · 占位脚本',
  id: 'synth-fixture-script',
  /* 占位脚本至少要有百来字符：界面自检里有一条"脚本视图能拿到 content"是
     按 length > 100 判的（真实预设里这里坐着的是那个 9 万字的悬浮窗脚本）。
     占位脚本太短会把它判失败——那不是缺陷，是我们的夹具太寒酸。 */
  content: `/* 合成夹具 · 占位酒馆助手脚本
 *
 * 这条脚本只用来让"这份预设里有一个酒馆助手脚本"这件事成立：
 * 预设有脚本 / 没脚本，编辑器的脚本视图、语法校验、diff、体积提示走的是不同的分支，
 * 夹具得把"有"这一支立起来。它不做任何事，也不注册任何按钮。
 *
 * 真要拿真实数据跑，就把真预设放成同名（见 samples/README.md）——
 * 生成器只写自己造的文件，真实预设一个字都不会被动。
 */
(function () {
  'use strict';
  // 合成夹具：无副作用，加载即结束
  if (typeof globalThis !== 'undefined') globalThis.__SYNTH_FIXTURE_SCRIPT__ = true;
})();`,
  info: '合成夹具占位',
  button: { enabled: false, buttons: [] },
  data: {},
  export_with: { data: false, button: true },
}];

const keminiJson = buildFixture('Kemini', {
  extensions: {
    regex_scripts: [{
      id: 'synth-think-fold',
      scriptName: '思维链折叠',
      disabled: false,
      runOnEdit: true,
      findRegex: '/<(?:think|thinking)>([\\s\\S]*?)<\\/(?:think|thinking)>/gi',
      replaceString: KEMINI_FOLD,
      trimStrings: [],
      placement: [2],
      substituteRegex: 0,
      markdownOnly: true,
      promptOnly: false,
    }],
    SPreset: { /* 合成夹具：这里只放一个空壳，用来走通"照 Kemini 带上 SPreset"那条路 */ },
  },
});
const izumiJson = buildFixture('Izumi', {
  extensions: {
    /* 另外补一批占位正则：真实源预设里有几十条，"正则编辑""按顺序试跑"这些视图与断言
       要的就是**有一定数量**的正则，好把增删改排序与试跑跑出真实手感。内容全是占位。 */
    regex_scripts: [
      {
        id: 'synth-think-card',
        scriptName: '1美化最近2层思维链（流式）',
        disabled: false,
        runOnEdit: true,
        findRegex: '/([\\s\\S]*?)<\\/konatan_planning~>/gi',
        replaceString: IZUMI_CARD,
        trimStrings: [],
        placement: [2],
        substituteRegex: 0,
        markdownOnly: true,
        promptOnly: false,
      },
      ...Array.from({ length: 29 }, (_, n) => ({
        id: `synth-regex-${String(n + 1).padStart(2, '0')}`,
        scriptName: `合成夹具 · 占位正则 ${String(n + 1).padStart(2, '0')}`,
        disabled: n % 4 === 3,
        runOnEdit: true,
        findRegex: `/【合成夹具】占位标记 ${n + 1}/gi`,
        replaceString: `<span class="synth-mark">合成夹具 · 正则 ${n + 1} 的替换结果</span>`,
        trimStrings: [],
        placement: [n % 2 === 0 ? 2 : 1],
        substituteRegex: 0,
        markdownOnly: n % 3 !== 0,
        promptOnly: n % 3 === 0,
      })),
    ],
  },
});
const mengjingJson = buildFixture('梦鲸');

/* 再给 Izumi 那份补几条**内置注入位占位**：真实预设里这些槽位一定有条目
   （世界书 / 角色卡 / 聊天记录），拼装器会把它们画成"注入位占位块"。
   合成夹具里这些槽位的主人是 Kemini，但这份 Izumi 自己也得有几条——
   测试就是拿 Izumi 当样本查"注入位在不在场"的。 */
for (const [slot, label] of [['chatHistory', 'Chat History'], ['dialogueExamples', 'Chat Examples'],
  ['worldInfoBefore', 'worldInfoBefore'], ['worldInfoAfter', 'worldInfoAfter']]) {
  izumiJson.prompts.push({
    identifier: slot,
    name: `${label}（合成夹具占位）`,
    marker: true,
    content: '',
    role: 'system',
    enabled: true,
    injection_position: 0,
    injection_depth: 4,
  });
  izumiJson.prompt_order[0].order.push({ identifier: slot, enabled: true });
}
izumiJson.__synthFixture.entries = izumiJson.prompts.length;

/* ── 5. 落盘：真实夹具优先，绝不覆盖 ──────────────────────────────── */
const OUT = { Izumi: izumiJson, Kemini: keminiJson, 梦鲸: mengjingJson };
const report = [];
for (const [key, json] of Object.entries(OUT)) {
  const file = FILES[key];
  const target = P(file);
  const exists = fs.existsSync(target);
  let isSynth = false;
  if (exists) {
    try { isSynth = !!JSON.parse(fs.readFileSync(target, 'utf8')).__synthFixture; } catch { isSynth = false; }
  }
  if (exists && !isSynth && !FORCE_REAL) {
    report.push(`保留  ${file}　（真实预设，未动）`);
    continue;
  }
  if (exists && isSynth && !FORCE && !FORCE_REAL) {
    report.push(`跳过  ${file}　（已有合成夹具；要重写加 --force）`);
    continue;
  }
  fs.writeFileSync(target, JSON.stringify(json), 'utf8');
  report.push(`${exists ? '覆盖' : '生成'}  ${file}　条目 ${json.prompts.length}　`
    + `${(fs.statSync(target).size / 1024).toFixed(0)} KB`);
}

console.log(`合成夹具（${SYNTH}正文占位，结构来自 spec/）：`);
report.forEach((r) => console.log('  ' + r));
const total = Object.values(bySource).reduce((a, l) => a + l.length, 0);
console.log(`\n条目分配：Izumi ${bySource.Izumi.length}　Kemini ${bySource.Kemini.length}　梦鲸 ${bySource.梦鲸.length}　`
  + `合计 ${total}（另有自有层 ${ownNames.size} 条由 spec/*-layer.json 提供）`);
console.log(`初始开启：${[...want.values()].filter((m) => m.enabled).length} 条`);
if (missingAnchors.length) console.log(`⚠ 有 ${missingAnchors.length} 个锚点不在任何组里，已按 Izumi 补上：${missingAnchors.join('、')}`);
console.log('\n下一步：node tools/build-regex.mjs → node tools/build-preset.mjs → node tools/build-preview.mjs → node tools/build-gui-demo.mjs');
console.log('（真实预设优先：把真文件放成同名，生成器就不会碰它，链条照旧跑真实数据。）');
