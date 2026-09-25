#!/usr/bin/env node
/**
 * 子集定义生成 + 覆盖率校验（只读源预设）
 *
 *   node tools/build-groups.mjs
 *
 * 用规则表把 Izumi 的 226 条分进子集，产出 spec/groups.json。
 * 校验：计数对得上、无重名归属冲突、catchAll 收容项逐条打印供人工复核。
 */
import fs from 'node:fs';
import path from 'node:path';
import { need } from './lib/fixtures.mjs';

/* 夹具守卫：本仓库不随附任何预设正文（见 NOTICE.md / samples/README.md）。
   缺了就打印 SKIP 并正常退出；DSH_REQUIRE_FIXTURES=1 时视为失败。 */
need('Izumi_0914.json', '分组规格生成（拿它当样本推断模块）');

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'spec');
fs.mkdirSync(OUT, { recursive: true });

const SRC = 'Izumi_0914.json';
const json = JSON.parse(fs.readFileSync(path.join(ROOT, SRC), 'utf8'));
const prompts = json.prompts ?? [];

/* ── 规则表（自上而下，首个命中生效） ─────────────────────────────── */
const RULES = [
  { id: 'markers', label: '区段标记', mode: 'hidden', marker: true, maxLen: 160, re: /开始|结束|↓|↑|——/,
    note: '源预设的分节标题，新预设里由子集本身替代，不搬运' },

  { id: 'slot_dupes', label: '内置槽位重复占位（丢弃）', mode: 'hidden', slotDupes: true,
    note: '这些是 Izumi 的空内置占位，组装时槽位归 Kemini/Kemini 标记条目，它们必然被丢弃，所以规格里不声明、面板里也不显示。',
    names: ['用户设定描述', '角色描述', '角色定义之前', '角色性格', '场景', '角色定义之后',
      'Chat Examples', 'Chat History'] },

  { id: 'core', label: '核心（固定，不上面板）', mode: 'fixed',
    ids: ['main', 'nsfw', 'jailbreak', 'chatHistory', 'dialogueExamples', 'charDescription',
      'charPersonality', 'worldInfoBefore', 'worldInfoAfter', 'personaDescription', 'scenario',
      'enhanceDefinitions', 'agentSystemPrompt', 'agentTask', 'agentResults'],
    names: ['📋说明（点小铅笔看）', '哦对了，贩子死妈', '初始化变量（别动）', '别动', '角色',
      'user', '/user', '/角色', '格式要求结束', '接', '创意加强1（会发癫）', '创意加强2（癫）',
      '过渡', '飞二楼'] },

  { id: 'jb_gemini', label: '破甲 · Gemini', mode: 'single', external: 'kemini',
    note: '从 Kemini 搬：💠CLEAR / 🎬ROLE AND GUIDE / 💠BEGIN / 💠FAKE / 💠continue / 两根防截断 / 💠雪融雪降',
    names: [] },

  { id: 'jb_dsglm', label: '破甲 · DeepSeek / GLM', mode: 'single', external: '梦鲸思客V4',
    note: '从梦鲸搬 6 条',
    names: ['梦境思客', 'V4Pro神秘小指令', 'Deepseek官方', '硅基流动或其他', 'DeepSeek禁词', 'Glm/Gemini禁词'] },

  { id: 'jb_izumi', label: '破甲 · 其他模型', mode: 'single',
    note: 'Izumi 的破甲与防截断组件，作为最后兜底',
    names: ['✓头部破甲', 'flash破甲', '🐱基米flash适配', '破甲1-Claude',
      '😤破甲1（基米别开！！！）', '😤破甲2（基米别开！！！）',
      '不用开', '基米flash尾部', '基米flash尾部1', '非预填充尾部', '卡思维链（K）',
      'kemini防截断(强)', '超长防截断（k,mygo）', '⚡️防机器人（数据化就开）'] },

  { id: 'style_main', label: '主文风（选一）', mode: 'single',
    names: ['🚢文风-顺眼舒服', '🎆文风-自适应叙事', '🎆文风-紙芝居', '🎆文风-日轻小说', '🎆中文-小此爽写',
      '🎆日语-小此爽写', '🌟中文-小此说故事', '🚢文风-武侠', '✍🏻文风-质感写作@黛岚', '🚢文风-英式幽默',
      '🚢文风-民国物哀', '文风-少年漫', '🎆小此散文-Eula', '✔️小此音声Plus', '🚢文风-网文',
      '✔️小此漫改', '古风-视觉小说'] },

  { id: 'style_third', label: '第三人称追加文风', mode: 'multi',
    names: ['✔️多人称文风-鲁迅', '✔️文风-Eula闲谈式主提示', '闲谈第三人称（示例可替）', '闲谈第二人称（示例可替）',
      '闲谈第一人称（示例可替）', '✔️文风-日日日', '✔️文风-意识流（第三人称）', '✔️文风-节奏大师（能杀八股）',
      '✔️文风-异世界战斗-Elainades', '✔️哥杀卡专用文风', '✔️文风-舞台剧2.0'] },

  { id: 'style_first', label: '第一人称追加文风', mode: 'multi',
    names: ['✔️文风-意识流2.0', '✔️文风-入间人间', '✔️文风-伏见司（能杀八股）', '✔️多人称文风：江南'] },

  { id: 'style_nsfw', label: '可写 NSFW 文风', mode: 'multi',
    names: ['nsfw-体型差色色', 'nsfw-木珠', '✔️多人称文风-王小波', '🎆实验-nsfw', '🎇NSFW-本子-实验',
      '🎇实验-ASMR', '❄️男性向-直白色情', '❄️NSFW-谷崎润一郎', '✔️文风-广播剧（点进去）',
      '广播剧nsfw配件', '✔️文风-男性视觉（感谢k一串）'] },

  { id: 'style_lib', label: '备选文风库（默认不在列表）', mode: 'multi', parked: true,
    names: ['✔️文风-金庸（关锚定）', '✔️文风-古龙（关锚定）', '✔️文风-川端康成（日式古风）',
      '✔️文风-麻枝准（忧郁美好）', '✔️文风-镰池和马（战斗）', '✔️GL文风-邱妙津（锐痛自白）',
      '❄️女性向-第一人称', '🥳文风-自用'] },

  { id: 'person', label: '人称（选一）', mode: 'single', re: /^👤人称-/ },
  { id: 'dialogue_amt', label: '对白量（选一）', mode: 'single', re: /^👤对白量/ },
  { id: 'difficulty', label: '难度（选一）', mode: 'single', re: /^⚠️难度/ },
  { id: 'cot_lang', label: '思维链语言（选一）', mode: 'single', re: /^⭐️思维链语言-/ },

  { id: 'cot', label: '思维链（选一）', mode: 'single',
    names: ['思维链-注重人设', '思维链-注重流畅性', '思维链-注重剧情', '思维链-均衡', '思维链-简洁',
      '思维链-哥杀卡专用', '思维链-自定义', '思维链-Roland(测试)', '思维链-防机器人',
      '快速思维链', '不要思维链了'] },

  { id: 'mvu', label: 'MVU 变量更新（选一）', mode: 'single', own: true,
    note: '一键开关：选一条就够，不需要再开别的模块。它自带输出位，不经过 {{getvar::mvu}} 那条老链路。'
      + '想彻底关掉就选「不使用」。',
    names: [] },

  { id: 'length', label: '字数（选一）', mode: 'single', names: ['🤖自定义（字数）', '⚡️字数加强'] },

  { id: 'summary', label: '摘要（选一）', mode: 'single',
    names: ['🏷摘要-Ny', '🏷新摘要', '大总结-关破甲（K）', '新摘要大总结-关破甲'] },

  { id: 'out_mode', label: '输出模式（四选一）', mode: 'single',
    names: ['🔴创作思路', '🔴吐槽', '🔵小此对话', '🥰情感陪伴'] },

  { id: 'format', label: '格式示例（选一）', mode: 'single',
    names: ['🔵吐槽版格式示例', '🔴其它格式示例', '🥚克劳德格式示例', '🔵吐槽（普通）', '吐槽思维链尾'] },

  { id: 'nsfw', label: 'NSFW 指导与加强', mode: 'multi',
    names: ['😍NSFW指导-黑森森', '😍三选一开-NSFW指南-582', '❤️NSFW指导-真实', '🔴NSFW加强',
      '🔵NSFW加强（温柔）', '💕开启心理描写', '禁词表NSFW配件', '实验禁词表'] },

  { id: 'guard', label: '叙事与防护开关', mode: 'multi',
    names: ['防429', '☑️防转折', '✅允许转折', '✅反直觉', '✅剧情彻底疯狂', '⚡️防发情（nsfw卡才开）',
      '⚡️防不发情', '⚡️防情绪化、油腻', '⚡️慢推剧情', '⚡️推剧情', '⚡️客观叙事', '⚡️转述', '⚡️防转述',
      '⚡️防神化（能用了）', '⚡️防绝望', '⚡️抢话', '⚡️防抢话', '😭防小此乱入', '🎭不只看user',
      '⛔️不许狂暴色色', '⛔️防揣测加强', '⛔️不许语气描写', '⛔️防过度描写', '😡防叛逆', '😍涩涩加速',
      '🔴防重复上文', '防媚user', '🤓高上下文选开', '😇小巧思',
      '⚡️防全知低', '⚡️防全知中', '⚡️防全知高'] },

  { id: 'mvu_old', label: '旧 MVU 变量条目（不搬运）', mode: 'hidden', mvuOld: true,
    note: 'Izumi 那两条把骨架塞进 {{setvar::mvu::}} 变量、再由「格式示例」里的 {{getvar::mvu}} 展开。生产者与消费者分散在两个模块，只开一半就等于没开。已被「MVU 变量更新」模块的两条字面骨架条目取代，所以不搬运——留着会形成第二套竞争机制。',
    names: ['✅MVU Zod兼容', '✅MVU兼容（用再开）'] },

  { id: 'adapter', label: '适配开关', mode: 'multi',
    names: ['♀️女性向适配开关', '⭕️Claude适配开关', '🤔同人增强-二选一', '🤔事实增强-二选一'] },

  { id: 'ui', label: '前端与美化', mode: 'multi',
    names: ['🌻前端生成-NyPigment', '⏩选项栏', '⚡️平行事件（和摘要冲突）', '弹幕小剧场（GAL）'] },

  { id: 'custom', label: '自定义内容（自己填）', mode: 'editable', editable: true,
    names: ['🔴指南（可改）', '🤖自定义（字数）', '思维链-自定义', '🧐用户画像（点进去看）',
      '☀️自定义缝合处', '自定义禁词'] },

  { id: 'fano', label: '芳乃主体层（本预设新增）', mode: 'multi', own: true,
    note: '只由本预设新增的三条。来源预设的提示词一字未改；芳乃靠这三条实现。默认关闭。',
    names: [] },

  { id: 'anchors', label: '锚点（固定开启，不上面板）', mode: 'fixed',
    note: '占住酒馆的内置槽位：世界书、角色卡、用户人设、主提示与预填充都靠它们的位置注入。不可开关——关掉就会在切换模型后整体丢上下文。',
    names: [] },

  { id: 'misc', label: '其他实验项', mode: 'multi', catchAll: true,
    names: ['🔵概念锚定', '🔵性格标签（有适配再开）', '小说模式user',
      '⚡️双语对话', '🦕正文中文加强（出外语开）', '👤扩写输入', '增强输入（不读再开）', '拷打模式',
      '聊天模式1', '头脑风暴', '发散！（测试中，感觉不行）', '没用', '暂时别用', '💾通用主提示',
      '泉此方人设（想玩就开）', '指南（闲聊小说才开）', '额外要求过渡', '😨千万别点开'] },
];

/* ── 归类 ─────────────────────────────────────────────────────────── */
const groups = RULES.map((r) => ({
  id: r.id, label: r.label, mode: r.mode,
  ...(r.note ? { note: r.note } : {}),
  ...(r.external ? { external: r.external } : {}),
  ...(r.parked ? { parked: true } : {}),
  ...(r.catchAll ? { catchAll: true } : {}),
  members: [],
  _seen: new Set(),
}));

function classify(p) {
  const name = p.name ?? '';
  const len = (p.content ?? '').length;
  for (const r of RULES) {
    if (r.marker) { if (r.re.test(name) && len < r.maxLen) return r; continue; }
    if (r.ids?.includes(p.identifier)) return r;
    if (r.names?.includes(name)) return r;
    if (r.re?.test(name)) return r;
  }
  return RULES.find((r) => r.catchAll);
}

const owner = new Map();      // name -> groupId（用于发现重名/冲突）
const duplicates = [];
for (const p of prompts) {
  const r = classify(p);
  const g = groups.find((x) => x.id === r.id);
  const name = p.name ?? '';
  if (owner.has(name) && owner.get(name) !== r.id) duplicates.push(`${name}: ${owner.get(name)} vs ${r.id}`);
  owner.set(name, r.id);
  if (g._seen.has(name)) { g.members.find((m) => m.name === name).dupes = true; continue; }
  g._seen.add(name);
  g.members.push({ name, identifier: p.identifier, chars: (p.content ?? '').length });
}

/* ── 来源提示词一律不改名 ─────────────────────────────────────────── */
/* 用户约束：三份源预设的提示词正文与原作者角色名（泉此方 / 小此 / Konata）
   必须原样保留、不得改写。因此面板显示名 == 源条目名，这里不再生成显示名映射。
   芳乃只通过新增的主体层条目实现（见 spec/fano-layer.json）。 */

/* ── 注入锚点：绝不属于任何破甲分支，永远开启 ─────────────────────
   这些条目的作用是"占住酒馆的内置槽位"，酒馆靠它们的位置把世界书、
   角色卡、用户人设、聊天记录插进提示词。一旦跟着破甲分支被关掉，
   切模型之后上下文就整体丢失（世界书不注入、角色卡不见）。
   所以它们必须是分支中立的，面板不给开关。 */
const ANCHOR_NAMES = [
  '💠CLEAR',            // main 主提示位
  '💠continue',         // jailbreak 预填充位
  '💠↑Char',            // worldInfoBefore 世界书前段
  '💠↓Char',            // worldInfoAfter  世界书后段
  '💠Char Description', // charDescription 角色卡
  '💠Char Personality', // charPersonality 角色性格
  '💠Persona Description', // personaDescription 用户人设
  '💠Scenario',         // scenario 场景
  '💠<DATA>', '💠</DATA>',        // Kemini 的设定包裹结构
  '💠<HISTORY>', '💠</HISTORY>',  // Kemini 的历史包裹结构
];

/* ── 破甲分流组：bundle（骨架，整组互斥）+ tunables（档位，玩家自己选） ── */
const JAILBREAK = [
  {
    id: 'gemini', label: 'Gemini', source: 'Kemini',
    pool: [
      '🔗', '🎬ROLE AND GUIDE',
      '⚙️SETTING', '🎬ROLEPLAY GUIDE', '💠BEGIN', '💠FAKE',
      '💗NSFW',
      '📐牢大防截断', '💿普通防截断',
      '💠雪融雪降！（build渠道等过不去外审开）',
    ],
    tunables: [
      {
        id: 'km_defense', label: '防截断档位', mode: 'single', optional: true,
        members: ['📐牢大防截断', '💿普通防截断'],
        note: '两者互补而非强弱：输出侧审查上效果差不多，牢大的区别是能防某些渠道的输入审查。用不上却开着是反效果，所以默认两个都不开；出现空回时换另一个试。',
      },
      {
        id: 'km_nsfw', label: 'NSFW 加强', mode: 'multi',
        members: ['💗NSFW'],
        note: '只在角色卡本身自带 NSFW 内容时才有强化作用。',
      },
      {
        id: 'km_fire', label: '雪融雪降填充文本', mode: 'text',
        members: ['💠雪融雪降！（build渠道等过不去外审开）'],
        note: '必须换成你自己的、≥7000 token 的私有小说段落（是 token 不是字数）。不要用黄文，也不要用别人也会拿来换的段落。不换会秒截断。',
      },
    ],
  },
  {
    id: 'dsglm', label: 'DeepSeek / GLM', source: '梦鲸思客V4',
    pool: ['梦境思客', 'V4Pro神秘小指令', 'Deepseek官方', '硅基流动或其他',
      'DeepSeek禁词', 'Glm/Gemini禁词', 'KimiK3思考', '自定义禁词'],
    tunables: [
      {
        id: 'mj_channel', label: '渠道 / 思考标签', mode: 'single', ensureOne: true,
        default: 'Deepseek官方',
        members: ['Deepseek官方', '硅基流动或其他', 'KimiK3思考'],
        note: '决定思维链用哪个标签开：DeepSeek 官方渠道是 <｜begin▁of▁thinking｜>，硅基流动等第三方是 <think>。选错会导致思维链不生效。',
      },
      {
        id: 'mj_banword', label: '模型禁词', mode: 'multi',
        members: ['DeepSeek禁词', 'Glm/Gemini禁词', '自定义禁词'],
        note: '按渠道选。可以并存。',
      },
      {
        id: 'mj_v4pro', label: 'V4Pro 神秘小指令', mode: 'multi',
        members: ['V4Pro神秘小指令'],
        note: '给 DeepSeek V4 Pro 的额外小指令。非 V4Pro 别开。',
      },
    ],
  },
  {
    id: 'izumi', label: '其他模型', source: 'Izumi',
    pool: ['✓头部破甲', 'flash破甲', '🐱基米flash适配', '⚡️防机器人（数据化就开）',
      'kemini防截断(强)', '超长防截断（k,mygo）',
      '破甲1-Claude', '😤破甲1（基米别开！！！）', '😤破甲2（基米别开！！！）', '不用开',
      '非预填充尾部', '基米flash尾部', '基米flash尾部1', '卡思维链（K）'],
    tunables: [
      {
        id: 'iz_defense', label: '防截断档位', mode: 'multi',
        members: ['kemini防截断(强)', '超长防截断（k,mygo）'],
        note: '两条都很大。按需开一条，一般不要同时开。',
      },
      {
        id: 'iz_jb', label: '破甲强度', mode: 'multi',
        members: ['破甲1-Claude', '😤破甲1（基米别开！！！）', '😤破甲2（基米别开！！！）', '不用开'],
        note: '带「基米别开」的两条是给 Claude / 一般模型用的，Gemini 开了是反效果。',
      },
      {
        id: 'iz_tail', label: '尾部 / 预填充', mode: 'multi',
        members: ['非预填充尾部', '基米flash尾部', '基米flash尾部1', '卡思维链（K）'],
        note: '按渠道选一条。预填充不被支持的渠道要选「非预填充尾部」。',
      },
    ],
  },
  { id: 'manual', label: '手动', source: '', pool: [], tunables: [] },
];

const tunableNames = new Set(JAILBREAK.flatMap((o) => o.tunables.flatMap((t) => t.members)));
const jailbreak = {
  id: 'jailbreak',
  label: '破甲（按模型分流）',
  mode: 'bundle',
  note: '先选模型决定用哪套破甲骨架（三选一互斥），再在下面调这套骨架的档位。档位不会被切换模型清掉。',
  options: JAILBREAK.map((o) => ({
    id: o.id, label: o.label, source: o.source,
    members: o.pool.filter((m) => !tunableNames.has(m)),
    poolSize: o.pool.length,
    tunables: o.tunables,
  })),
};

/* ── 可编辑条目：需要用户自己敲内容的 ─────────────────────────────── */
const EDITABLE_INFO = {
  '🔴指南（可改）': {
    hint: '创作规则的聚合条目。作者原话：不需要写复杂功能，想要什么效果直接塞到这里就能做到——投一句就见效。',
    locked: true,
  },
  '🤖自定义（字数）': { hint: '在「字数」模块里选中「自定义（字数）」这一档时才生效。填你要的字数要求。' },
  '思维链-自定义': { hint: '在「思维链」模块里选中「思维链-自定义」这一档时才生效。填你想让模型怎么思考。' },
  '🧐用户画像（点进去看）': { hint: '把测出来的用户画像粘进来，然后打开这一条。作者用法：开一张空卡输入「开始测试」，十几轮问答后让 AI 生成画像，重复测三次再总结。' },
  '☀️自定义缝合处': { hint: '自定义缝合内容，会插在破甲区后面。', locked: true },
  '自定义禁词': { hint: '按条目里的格式加你想禁的词，可以和模型禁词并存。' },
  '🌸芳乃 · 称呼': { hint: '改这里决定芳乃怎么称呼你。默认「你」。' },
};

/* ── 本预设自己新增的条目（来源预设里没有） ───────────────────────── */
/* fano-layer = 芳乃主体层；mvu-layer = MVU 一键开关用的字面骨架条目。
   两者都不是来源条目，所以不走分类，成员由各自的清单显式给出。 */
const FANO_LAYER = JSON.parse(fs.readFileSync(path.join(OUT, 'fano-layer.json'), 'utf8'));
const MVU_LAYER = JSON.parse(fs.readFileSync(path.join(OUT, 'mvu-layer.json'), 'utf8'));
const FANO_NAMES = FANO_LAYER.entries.map((e) => e.name);
const MVU_NAMES = MVU_LAYER.entries.map((e) => e.name);
const OWN_NAMES = [...FANO_NAMES, ...MVU_NAMES];
const fanoRule = RULES.find((r) => r.id === 'fano');
if (fanoRule) fanoRule.names = FANO_NAMES;
const mvuRule = RULES.find((r) => r.id === 'mvu');
if (mvuRule) mvuRule.names = MVU_NAMES;

/* ── 思维链标签互斥 ───────────────────────────────────────────────
   踩过的坑：Kemini 的 ICOT/COT 要求用 <thinking> 思考（ICOT 还是"三段"，
   模型会吐 3 个思考块），Izumi 的思维链条目要求用 konatan_planning~。
   两套同时开着时模型会把两种都吐出来，折叠后就变成"一个 izumi 形态 +
   好几个 kemini 形态"混在一起。所以按标签分两组，面板保证同一时刻只开一组。
   组内可共存（例如 Izumi 的思维链 + 基米flash尾部 本来就要配对用）。 */
const THINKING_TAGS = [
  {
    id: 'kemini',
    label: 'Kemini（<thinking>，ICOT 为三段交错）',
    note: 'ICOT 会把输出分成三段、每段"思考+正文"，模型因此吐出 3 个思考块。',
    members: ['📽️ICOT（三段）', '📽️COT（格式友好型）'],
  },
  {
    id: 'izumi',
    label: 'Izumi（konatan_planning~，单块）',
    note: 'Izumi 系全部用 konatan_planning~ 包裹思考，通常只有一块。',
    members: [
      '思维链-注重人设', '思维链-注重流畅性', '思维链-注重剧情', '思维链-均衡', '思维链-简洁',
      '思维链-哥杀卡专用', '思维链-自定义', '思维链-Roland(测试)', '思维链-防机器人',
      '快速思维链', '不要思维链了',
      '卡思维链（K）', '非预填充尾部', '基米flash尾部', '基米flash尾部1',
    ],
  },
];

/* ── 显示名：按替换表生成 ─────────────────────────────────────────── */
const allNames = new Set();
for (const g of groups) for (const m of g.members) allNames.add(m.name);
for (const o of jailbreak.options) {
  for (const m of o.members) allNames.add(m);
  for (const t of o.tunables || []) for (const m of t.members) allNames.add(m);
}
const display = {};   /* 来源提示词一律不改名，显示名即源条目名 */

/* ── 输出 ─────────────────────────────────────────────────────────── */
const visible = groups.filter((g) => g.mode !== 'hidden' && !g.id.startsWith('jb_'));

/* 自定义内容模块：成员以 EDITABLE_INFO 为唯一真相，而不是靠分类。
   因为其中三条已被各自的模块当选项拿走（字数/思维链/禁词），一条来自梦鲸而非 Izumi。
   它们是"视图"：在这里改和在原模块里改，写的是同一个条目。 */
const customGroup = {
  id: 'custom',
  label: '自定义内容（自己填）',
  mode: 'editable',
  note: '这些条目要你自己敲内容。标「固定开启」的只改内容，其余可以先开关再填。',
  members: Object.keys(EDITABLE_INFO).map((name) => ({ name, identifier: '', chars: 0 })),
  editable: true,
};
const outputGroups = [...visible];
const customIdx = outputGroups.findIndex((g) => g.id === 'custom');
if (customIdx >= 0) outputGroups[customIdx] = customGroup;
else outputGroups.push(customGroup);

/* 芳乃主体层：成员不来自任何源预设，直接由 spec/fano-layer.json 提供。 */
const fanoIdx = outputGroups.findIndex((g) => g.id === 'fano');
if (fanoIdx >= 0) {
  outputGroups[fanoIdx] = {
    ...outputGroups[fanoIdx],
    members: FANO_NAMES.map((name) => ({ name, identifier: '', chars: 0 })),
    owned: true,
  };
}

/* MVU 模块：成员来自 spec/mvu-layer.json 的两条字面骨架条目。 */
const mvuIdx = outputGroups.findIndex((g) => g.id === 'mvu');
if (mvuIdx >= 0) {
  outputGroups[mvuIdx] = {
    ...outputGroups[mvuIdx],
    members: MVU_NAMES.map((name) => ({ name, identifier: '', chars: 0 })),
    owned: true,
  };
}

/* 锚点模块：成员来自 ANCHOR_NAMES（Kemini 的内置槽位条目 + 包裹结构）。 */
const anchorsIdx = outputGroups.findIndex((g) => g.id === 'anchors');
if (anchorsIdx >= 0) {
  outputGroups[anchorsIdx] = {
    ...outputGroups[anchorsIdx],
    members: ANCHOR_NAMES.map((name) => ({ name, identifier: '', chars: 0 })),
  };
}
/* 锚点必须能在源预设里找到，否则面板会显示"缺失" */
const ghostAnchors = ANCHOR_NAMES.filter((n) => {
  for (const f of ['Izumi_0914.json', 'Kemini_Dramatron_v3.1.json', '梦鲸思客V4-0915.json']) {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    if ((j.prompts ?? []).some((p) => p.name === n)) return false;
  }
  return true;
});

/* 思维链模块：把 Kemini 的 ICOT/COT 也并进来，让"思考方式"只有一个入口。
   它们不是 Izumi 的条目、不走分类，所以显式前置。 */
const cotIdx = outputGroups.findIndex((g) => g.id === 'cot');
if (cotIdx >= 0) {
  const keminiThink = THINKING_TAGS.find((t) => t.id === 'kemini').members;
  outputGroups[cotIdx] = {
    ...outputGroups[cotIdx],
    label: '思维链 / 思考方式（选一）',
    note: '思考方式只有一个入口：Kemini 的 ICOT / COT 和 Izumi 的思维链都在这儿。'
      + 'ICOT 是三段交错思考（模型会吐 3 个思考块，折叠成 Kemini 形态）；'
      + 'COT 与 Izumi 系都是单块（折叠成 Izumi 形态）。开一个会自动关掉另一套标签的条目。',
    members: [
      ...keminiThink.map((name) => ({ name, identifier: '', chars: 0 })),
      ...outputGroups[cotIdx].members,
    ],
  };
}
const report = [];
report.push(`源：${SRC}　条目 ${prompts.length} 条　归类 ${groups.reduce((a, g) => a + g.members.length, 0)} 条`);
report.push('');
report.push('子集 id'.padEnd(18) + '模式'.padEnd(8) + '条数'.padEnd(6) + '标签');
report.push('-'.repeat(64));
for (const g of outputGroups) {
  report.push(g.id.padEnd(18) + g.mode.padEnd(8) + String(g.members.length).padEnd(6) + g.label);
}
report.push('');
report.push(`子集 ${visible.length + 1} 个（含 1 个破甲分流组、${groups.filter((g) => g.mode === 'hidden').length} 个隐藏标记组）`);
report.push('破甲分流组 jailbreak（bundle + tunables）：');
for (const o of jailbreak.options) {
  report.push(`  · ${o.label}（${o.source || '—'}）骨架 ${o.members.length} 条 / 全池 ${o.poolSize} 条`);
  for (const t of o.tunables) {
    report.push(`      └ 档位「${t.label}」[${t.mode}${t.ensureOne ? ' 必选一' : ''}${t.optional ? ' 可全关' : ''}] ${t.members.length} 条：${t.members.join('、')}`);
  }
}
report.push(`单选子集（下拉框）：${visible.filter((g) => g.mode === 'single').map((g) => g.id).join(', ')}`);
report.push(`多选子集（开关排）：${visible.filter((g) => g.mode === 'multi').map((g) => g.id).join(', ')}`);
report.push(`固定子集：${visible.filter((g) => g.mode === 'fixed').map((g) => g.id).join(', ')}`);
report.push(`可编辑子集：${visible.filter((g) => g.mode === 'editable').map((g) => g.id).join(', ')}`);
const customG = customGroup;
if (customG) {
  report.push('');
  report.push(`需要用户自己敲内容的条目（${customG.members.length} 条，面板里给输入框）：`);
  for (const m of customG.members) {
    const info = EDITABLE_INFO[m.name] || {};
    report.push(`  · ${m.name}　${info.locked ? '［固定开启，只改内容］' : '［可开关 + 改内容］'}`);
    report.push(`      ${info.hint || '⚠ 还没写提示文案'}`);
  }
}
report.push('');
report.push('来源提示词命名：一律不改动（泉此方 / 小此 / Konata 原文保留）；芳乃只由新增主体层承担。');
report.push('');
report.push(`注入锚点 ${ANCHOR_NAMES.length} 条（属 fixed，面板不给开关，组装时强制开启）：`);
for (const n of ANCHOR_NAMES) report.push(`  · ${n}`);
if (ghostAnchors.length) report.push(`⚠ 锚点里有 ${ghostAnchors.length} 条在源预设里找不到：${ghostAnchors.join('、')}`);
report.push('');
report.push('思维链标签互斥组（面板保证同组共存、跨组互斥）：');
for (const t of THINKING_TAGS) report.push(`  · ${t.id}：${t.members.length} 条　${t.label}`);

/* ── 幽灵名字校验：声明了但源预设里根本没有的名字 ─────────────────── */
const UNIVERSES = ['Izumi_0914.json', 'Kemini_Dramatron_v3.1.json', '梦鲸思客V4-0915.json'];
const sourceNames = new Set();
for (const f of UNIVERSES) {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  for (const p of j.prompts ?? []) if (p.name) sourceNames.add(p.name);
}
const ghost = [...allNames].filter((n) => !sourceNames.has(n) && !OWN_NAMES.includes(n)).sort();
report.push('');
if (OWN_NAMES.length) {
  report.push(`本预设新增条目 ${OWN_NAMES.length} 条（不计入幽灵校验）：`);
  for (const n of FANO_NAMES) report.push(`  · 芳乃主体层：${n}`);
  for (const n of MVU_NAMES) report.push(`  · MVU 骨架：${n}`);
}
const mvuOldNames = (RULES.find((r) => r.mvuOld) || {}).names || [];
report.push('');
report.push(`不搬运的旧 MVU 变量条目 ${mvuOldNames.length} 条（已被新模块取代）：${mvuOldNames.join('、')}`);
if (ghost.length) {
  report.push(`⚠ 幽灵名字 ${ghost.length} 个（声明了但三份源预设里都不存在，面板会永远显示「缺失」）：`);
  for (const n of ghost) report.push(`  · ${JSON.stringify(n)}`);
} else {
  report.push('✓ 幽灵名字校验：通过（所有声明的名字都能在三份源预设里找到）');
}
const dupes = groups.flatMap((g) => g.members.filter((m) => m.dupes).map((m) => `${g.id}/${m.name}`));
if (dupes.length) report.push(`同名重复条目（源预设里就重复，按一条处理）：${dupes.join(' | ')}`);
if (duplicates.length) report.push('⚠ 归属冲突：' + duplicates.join(' | '));

const specOut = {
  $comment: '由 tools/build-groups.mjs 生成。bundle=按模型分流的整组互斥骨架，其 tunables=该骨架下玩家可调的档位；single=下拉框互斥；multi=开关排；fixed=固定不暴露；hidden=不搬运；editable=需要用户自己敲内容的条目。display 恒为空对象：来源提示词一律不改名，芳乃由新增主体层承担。',
  source: SRC,
  generatedAt: new Date().toISOString(),
  display,
  /* 注入锚点：绝不属于任何破甲分支，组装时必须强制开启。 */
  anchors: ANCHOR_NAMES,
  /* 思维链标签互斥组：同一时刻只能有一组处于活动状态（面板负责强制）。 */
  thinkingTags: THINKING_TAGS,
  groups: [
    { id: jailbreak.id, label: jailbreak.label, mode: jailbreak.mode, note: jailbreak.note,
      options: jailbreak.options },
    ...outputGroups.map((g) => ({
      id: g.id, label: g.label, mode: g.mode,
      ...(g.note ? { note: g.note } : {}),
      ...(g.external ? { external: g.external } : {}),
      ...(g.parked ? { parked: true } : {}),
      ...(g.editable ? {
        editable: Object.fromEntries(g.members.map((m) => [m.name, EDITABLE_INFO[m.name] || {}])),
      } : {}),
      members: g.members.map((m) => m.name),
    })),
  ],
};

fs.writeFileSync(path.join(OUT, 'groups.json'), JSON.stringify(specOut, null, 2), 'utf8');
fs.writeFileSync(path.join(OUT, 'groups-report.txt'), report.join('\n') + '\n', 'utf8');

console.log(report.join('\n'));
const misc = groups.find((g) => g.catchAll);
console.log(`\nmisc（catchAll）实际收容 ${misc.members.length} 条，逐条核对有无分错：`);
for (const m of misc.members) console.log(`  - ${m.name}  (${m.chars})`);
console.log(`\n已写出 spec/groups.json　${specOut.groups.length} 个子集`);
