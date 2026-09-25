/**
 * 芳乃 · 预设面板　（自动生成，请勿直接改这个文件）
 * 源：panel/src/panel-core.js + panel/src/antitrunc.js + spec/groups.json
 * 构建：node tools/build-panel.mjs
 * 子集：25 个　显示名映射：0 条　思维链标签互斥组：2 个
 */
/**
 * 芳乃 · 预设面板　v0.1.0
 * ---------------------------------------------------------------------------
 * 用途：酒馆助手（JS-Slash-Runner）脚本。一个悬浮窗，把当前酒馆预设里的条目
 *       按"子集"重新组织：单选子集渲染成下拉框（选一个自动关掉同组其他），
 *       多选子集渲染成开关排，破甲按模型分流作为一个整组互斥的 bundle。
 *
 * 不依赖任何 CDN。读写预设只用酒馆助手 API：
 *   读  getPreset('in_use')
 *   写  updatePresetWith('in_use', updater, { render: 'immediate' })
 *   兜底 replacePreset('in_use', preset)
 *
 * 注意（来自 Izumi 面板的实地结论）：酒馆助手的 Preset API **不暴露 prompt_order**，
 * 开关状态直接落在 prompts[i].enabled 上，prompt_order 是酒馆原始存储细节，不要碰。
 */

(async function fanoPresetPanel() {
  'use strict';

  /* ══ FANO_PANEL_GROUPS_BEGIN ══════════════════════════════════════════
     分组覆盖：这一段是**给预设生成器（tools/gui）的「面板分组」编辑器读写**的。

     null  = 用面板自带的、按 `spec/groups.json` 注入的那套分组（默认，芳乃这套预设用的）
     对象  = 用这里的：可以把这份面板装到**别的预设**上，让模块列表对上那份预设的条目名

     形状（都是按**条目名**匹配，所以名字必须和预设里的完全一致）：
       {
         groups: [ { id, label, mode: 'fixed'|'single'|'multi'|'editable'|'bundle'|'hidden',
                     note?, members?: [名字…], editable?: { 名字: { hint, locked? } },
                     options?: [ { id, label, members, tunables? } ] } ],
         sections: [ { title, groups: [组 id…] } ],
         thinkingTags: [ { id, label, note?, members: [名字…] } ]
       }
     ═══════════════════════════════════════════════════════════════════ */
  const GROUPS_OVERRIDE = null;
  /* ══ FANO_PANEL_GROUPS_END ════════════════════════════════════════════ */

  /* 面板**自带**的分组（构建期由 spec/groups.json 注入）。
     单独起个名字是为了让编辑器能把它读出来当搭建起点——
     生成器的「面板搭建」需要知道"这块面板本来长什么样"。 */
  const GROUPS_DEFAULT = [
    {
      "id": "jailbreak",
      "label": "破甲（按模型分流）",
      "mode": "bundle",
      "note": "先选模型决定用哪套破甲骨架（三选一互斥），再在下面调这套骨架的档位。档位不会被切换模型清掉。",
      "options": [
        {
          "id": "gemini",
          "label": "Gemini",
          "source": "Kemini",
          "members": [
            "🔗",
            "🎬ROLE AND GUIDE",
            "⚙️SETTING",
            "🎬ROLEPLAY GUIDE",
            "💠BEGIN",
            "💠FAKE"
          ],
          "poolSize": 10,
          "tunables": [
            {
              "id": "km_defense",
              "label": "防截断档位",
              "mode": "single",
              "optional": true,
              "members": [
                "📐牢大防截断",
                "💿普通防截断"
              ],
              "note": "两者互补而非强弱：输出侧审查上效果差不多，牢大的区别是能防某些渠道的输入审查。用不上却开着是反效果，所以默认两个都不开；出现空回时换另一个试。"
            },
            {
              "id": "km_nsfw",
              "label": "NSFW 加强",
              "mode": "multi",
              "members": [
                "💗NSFW"
              ],
              "note": "只在角色卡本身自带 NSFW 内容时才有强化作用。"
            },
            {
              "id": "km_fire",
              "label": "雪融雪降填充文本",
              "mode": "text",
              "members": [
                "💠雪融雪降！（build渠道等过不去外审开）"
              ],
              "note": "必须换成你自己的、≥7000 token 的私有小说段落（是 token 不是字数）。不要用黄文，也不要用别人也会拿来换的段落。不换会秒截断。"
            }
          ]
        },
        {
          "id": "dsglm",
          "label": "DeepSeek / GLM",
          "source": "梦鲸思客V4",
          "members": [
            "梦境思客"
          ],
          "poolSize": 8,
          "tunables": [
            {
              "id": "mj_channel",
              "label": "渠道 / 思考标签",
              "mode": "single",
              "ensureOne": true,
              "default": "Deepseek官方",
              "members": [
                "Deepseek官方",
                "硅基流动或其他",
                "KimiK3思考"
              ],
              "note": "决定思维链用哪个标签开：DeepSeek 官方渠道是 <｜begin▁of▁thinking｜>，硅基流动等第三方是 <think>。选错会导致思维链不生效。"
            },
            {
              "id": "mj_banword",
              "label": "模型禁词",
              "mode": "multi",
              "members": [
                "DeepSeek禁词",
                "Glm/Gemini禁词",
                "自定义禁词"
              ],
              "note": "按渠道选。可以并存。"
            },
            {
              "id": "mj_v4pro",
              "label": "V4Pro 神秘小指令",
              "mode": "multi",
              "members": [
                "V4Pro神秘小指令"
              ],
              "note": "给 DeepSeek V4 Pro 的额外小指令。非 V4Pro 别开。"
            }
          ]
        },
        {
          "id": "izumi",
          "label": "其他模型",
          "source": "Izumi",
          "members": [
            "✓头部破甲",
            "flash破甲",
            "🐱基米flash适配",
            "⚡️防机器人（数据化就开）"
          ],
          "poolSize": 14,
          "tunables": [
            {
              "id": "iz_defense",
              "label": "防截断档位",
              "mode": "multi",
              "members": [
                "kemini防截断(强)",
                "超长防截断（k,mygo）"
              ],
              "note": "两条都很大。按需开一条，一般不要同时开。"
            },
            {
              "id": "iz_jb",
              "label": "破甲强度",
              "mode": "multi",
              "members": [
                "破甲1-Claude",
                "😤破甲1（基米别开！！！）",
                "😤破甲2（基米别开！！！）",
                "不用开"
              ],
              "note": "带「基米别开」的两条是给 Claude / 一般模型用的，Gemini 开了是反效果。"
            },
            {
              "id": "iz_tail",
              "label": "尾部 / 预填充",
              "mode": "multi",
              "members": [
                "非预填充尾部",
                "基米flash尾部",
                "基米flash尾部1",
                "卡思维链（K）"
              ],
              "note": "按渠道选一条。预填充不被支持的渠道要选「非预填充尾部」。"
            }
          ]
        },
        {
          "id": "manual",
          "label": "手动",
          "source": "",
          "members": [],
          "poolSize": 0,
          "tunables": []
        }
      ]
    },
    {
      "id": "core",
      "label": "核心（固定，不上面板）",
      "mode": "fixed",
      "members": [
        "📋说明（点小铅笔看）",
        "哦对了，贩子死妈",
        "初始化变量（别动）",
        "💾主提示",
        "接",
        "创意加强1（会发癫）",
        "创意加强2（癫）",
        "别动",
        "角色",
        "user",
        "/user",
        "🤔同人增强-二选一",
        "/角色",
        "信息结束",
        "短对话模式",
        "过渡",
        "飞二楼"
      ]
    },
    {
      "id": "style_main",
      "label": "主文风（选一）",
      "mode": "single",
      "members": [
        "🚢文风-顺眼舒服",
        "🎆文风-自适应叙事",
        "🎆文风-紙芝居",
        "🎆文风-日轻小说",
        "🎆中文-小此爽写",
        "🎆日语-小此爽写",
        "🌟中文-小此说故事",
        "🚢文风-武侠",
        "✍🏻文风-质感写作@黛岚",
        "🚢文风-英式幽默",
        "🚢文风-民国物哀",
        "文风-少年漫",
        "🎆小此散文-Eula",
        "✔️小此音声Plus",
        "🚢文风-网文",
        "✔️小此漫改",
        "古风-视觉小说"
      ]
    },
    {
      "id": "style_third",
      "label": "第三人称追加文风",
      "mode": "multi",
      "members": [
        "✔️多人称文风-鲁迅",
        "✔️文风-Eula闲谈式主提示",
        "闲谈第三人称（示例可替）",
        "闲谈第二人称（示例可替）",
        "闲谈第一人称（示例可替）",
        "✔️文风-日日日",
        "✔️文风-意识流（第三人称）",
        "✔️文风-节奏大师（能杀八股）",
        "✔️文风-异世界战斗-Elainades",
        "✔️哥杀卡专用文风",
        "✔️文风-舞台剧2.0"
      ]
    },
    {
      "id": "style_first",
      "label": "第一人称追加文风",
      "mode": "multi",
      "members": [
        "✔️文风-意识流2.0",
        "✔️文风-入间人间",
        "✔️文风-伏见司（能杀八股）",
        "✔️多人称文风：江南"
      ]
    },
    {
      "id": "style_nsfw",
      "label": "可写 NSFW 文风",
      "mode": "multi",
      "members": [
        "nsfw-体型差色色",
        "nsfw-木珠",
        "✔️多人称文风-王小波",
        "🎆实验-nsfw",
        "🎇NSFW-本子-实验",
        "🎇实验-ASMR",
        "❄️男性向-直白色情",
        "❄️NSFW-谷崎润一郎",
        "✔️文风-广播剧（点进去）",
        "广播剧nsfw配件",
        "✔️文风-男性视觉（感谢k一串）"
      ]
    },
    {
      "id": "style_lib",
      "label": "备选文风库（默认不在列表）",
      "mode": "multi",
      "parked": true,
      "members": [
        "✔️文风-金庸（关锚定）",
        "✔️文风-古龙（关锚定）",
        "✔️文风-川端康成（日式古风）",
        "✔️文风-麻枝准（忧郁美好）",
        "✔️文风-镰池和马（战斗）",
        "✔️GL文风-邱妙津（锐痛自白）",
        "❄️女性向-第一人称",
        "🥳文风-自用"
      ]
    },
    {
      "id": "person",
      "label": "人称（选一）",
      "mode": "single",
      "members": [
        "👤人称-第三人称",
        "👤人称-第二人称",
        "👤人称-User第一人称",
        "👤人称-Char第一人称"
      ]
    },
    {
      "id": "dialogue_amt",
      "label": "对白量（选一）",
      "mode": "single",
      "members": [
        "👤对白量：少",
        "👤对白量：中",
        "👤对白量：多",
        "👤对白量：100%"
      ]
    },
    {
      "id": "difficulty",
      "label": "难度（选一）",
      "mode": "single",
      "members": [
        "⚠️难度：你是神",
        "⚠️难度：你是普通人",
        "⚠️难度：你被一脚踢死"
      ]
    },
    {
      "id": "cot_lang",
      "label": "思维链语言（选一）",
      "mode": "single",
      "members": [
        "⭐️思维链语言-中文",
        "⭐️思维链语言-法语",
        "⭐️思维链语言-日语",
        "⭐️思维链语言-俄语",
        "⭐️思维链语言-德语",
        "⭐️思维链语言-西班牙语",
        "⭐️思维链语言-意大利语"
      ]
    },
    {
      "id": "cot",
      "label": "思维链 / 思考方式（选一）",
      "mode": "single",
      "note": "思考方式只有一个入口：Kemini 的 ICOT / COT 和 Izumi 的思维链都在这儿。ICOT 是三段交错思考（模型会吐 3 个思考块，折叠成 Kemini 形态）；COT 与 Izumi 系都是单块（折叠成 Izumi 形态）。开一个会自动关掉另一套标签的条目。",
      "members": [
        "📽️ICOT（三段）",
        "📽️COT（格式友好型）",
        "思维链-注重人设",
        "思维链-注重流畅性",
        "思维链-注重剧情",
        "思维链-均衡",
        "思维链-简洁",
        "思维链-哥杀卡专用",
        "思维链-自定义",
        "快速思维链",
        "不要思维链了",
        "思维链-Roland(测试)",
        "思维链-防机器人"
      ]
    },
    {
      "id": "mvu",
      "label": "MVU 变量更新（选一）",
      "mode": "single",
      "note": "一键开关：选一条就够，不需要再开别的模块。它自带输出位，不经过 {{getvar::mvu}} 那条老链路。想彻底关掉就选「不使用」。",
      "members": [
        "🔧MVU · 变量更新（普通）",
        "🔧MVU · 变量更新（Zod / JSONPatch）"
      ]
    },
    {
      "id": "length",
      "label": "字数（选一）",
      "mode": "single",
      "members": [
        "⚡️字数加强",
        "🤖自定义（字数）"
      ]
    },
    {
      "id": "summary",
      "label": "摘要（选一）",
      "mode": "single",
      "members": [
        "🏷摘要-Ny",
        "🏷新摘要",
        "大总结-关破甲（K）",
        "新摘要大总结-关破甲"
      ]
    },
    {
      "id": "out_mode",
      "label": "输出模式（四选一）",
      "mode": "single",
      "members": [
        "🔴创作思路",
        "🔴吐槽",
        "🔵小此对话",
        "🥰情感陪伴"
      ]
    },
    {
      "id": "format",
      "label": "格式示例（选一）",
      "mode": "single",
      "members": [
        "🔵吐槽版格式示例",
        "🔴其它格式示例",
        "🥚克劳德格式示例",
        "🔵吐槽（普通）",
        "吐槽思维链尾"
      ]
    },
    {
      "id": "nsfw",
      "label": "NSFW 指导与加强",
      "mode": "multi",
      "members": [
        "😍NSFW指导-黑森森",
        "😍三选一开-NSFW指南-582",
        "🔴NSFW加强",
        "🔵NSFW加强（温柔）",
        "💕开启心理描写",
        "禁词表NSFW配件",
        "实验禁词表",
        "❤️NSFW指导-真实"
      ]
    },
    {
      "id": "guard",
      "label": "叙事与防护开关",
      "mode": "multi",
      "members": [
        "防429",
        "☑️防转折",
        "✅允许转折",
        "✅反直觉",
        "✅剧情彻底疯狂",
        "⚡️防发情（nsfw卡才开）",
        "⚡️防不发情",
        "⚡️防情绪化、油腻",
        "⚡️慢推剧情",
        "⚡️推剧情",
        "⚡️客观叙事",
        "⚡️转述",
        "⚡️防转述",
        "⚡️防神化（能用了）",
        "⚡️防绝望",
        "⚡️抢话",
        "⚡️防抢话",
        "😭防小此乱入",
        "🎭不只看user",
        "⛔️不许狂暴色色",
        "⛔️防揣测加强",
        "⛔️不许语气描写",
        "⛔️防过度描写",
        "防媚user",
        "🤓高上下文选开",
        "😇小巧思",
        "😡防叛逆",
        "😍涩涩加速",
        "🔴防重复上文",
        "⚡️防全知低",
        "⚡️防全知中",
        "⚡️防全知高"
      ]
    },
    {
      "id": "adapter",
      "label": "适配开关",
      "mode": "multi",
      "members": [
        "♀️女性向适配开关",
        "⭕️Claude适配开关",
        "🤔事实增强-二选一"
      ]
    },
    {
      "id": "ui",
      "label": "前端与美化",
      "mode": "multi",
      "members": [
        "🌻前端生成-NyPigment",
        "⏩选项栏",
        "⚡️平行事件（和摘要冲突）",
        "弹幕小剧场（GAL）"
      ]
    },
    {
      "id": "custom",
      "label": "自定义内容（自己填）",
      "mode": "editable",
      "note": "这些条目要你自己敲内容。标「固定开启」的只改内容，其余可以先开关再填。",
      "editable": {
        "🔴指南（可改）": {
          "hint": "创作规则的聚合条目。作者原话：不需要写复杂功能，想要什么效果直接塞到这里就能做到——投一句就见效。",
          "locked": true
        },
        "🤖自定义（字数）": {
          "hint": "在「字数」模块里选中「自定义（字数）」这一档时才生效。填你要的字数要求。"
        },
        "思维链-自定义": {
          "hint": "在「思维链」模块里选中「思维链-自定义」这一档时才生效。填你想让模型怎么思考。"
        },
        "🧐用户画像（点进去看）": {
          "hint": "把测出来的用户画像粘进来，然后打开这一条。作者用法：开一张空卡输入「开始测试」，十几轮问答后让 AI 生成画像，重复测三次再总结。"
        },
        "☀️自定义缝合处": {
          "hint": "自定义缝合内容，会插在破甲区后面。",
          "locked": true
        },
        "自定义禁词": {
          "hint": "按条目里的格式加你想禁的词，可以和模型禁词并存。"
        },
        "🌸芳乃 · 称呼": {
          "hint": "改这里决定芳乃怎么称呼你。默认「你」。"
        }
      },
      "members": [
        "🔴指南（可改）",
        "🤖自定义（字数）",
        "思维链-自定义",
        "🧐用户画像（点进去看）",
        "☀️自定义缝合处",
        "自定义禁词",
        "🌸芳乃 · 称呼"
      ]
    },
    {
      "id": "fano",
      "label": "芳乃主体层（本预设新增）",
      "mode": "multi",
      "note": "只由本预设新增的三条。来源预设的提示词一字未改；芳乃靠这三条实现。默认关闭。",
      "members": [
        "🌸芳乃 · 助手主体",
        "🌸芳乃 · 称呼",
        "🌸芳乃 · 祈福口癖"
      ]
    },
    {
      "id": "anchors",
      "label": "锚点（固定开启，不上面板）",
      "mode": "fixed",
      "note": "占住酒馆的内置槽位：世界书、角色卡、用户人设、主提示与预填充都靠它们的位置注入。不可开关——关掉就会在切换模型后整体丢上下文。",
      "members": [
        "💠CLEAR",
        "💠continue",
        "💠↑Char",
        "💠↓Char",
        "💠Char Description",
        "💠Char Personality",
        "💠Persona Description",
        "💠Scenario",
        "💠<DATA>",
        "💠</DATA>",
        "💠<HISTORY>",
        "💠</HISTORY>"
      ]
    },
    {
      "id": "misc",
      "label": "其他实验项",
      "mode": "multi",
      "members": [
        "😨千万别点开",
        "🔵概念锚定",
        "🔵性格标签（有适配再开）",
        "小说模式user",
        "👤扩写输入",
        "⚡️双语对话",
        "🦕正文中文加强（出外语开）",
        "增强输入（不读再开）",
        "拷打模式",
        "聊天模式1",
        "头脑风暴",
        "💾通用主提示",
        "泉此方人设（想玩就开）",
        "指南（闲聊小说才开）",
        "发散！（测试中，感觉不行）",
        "没用",
        "暂时别用",
        "额外要求过渡"
      ]
    }
  ];
  const DISPLAY_DEFAULT = {};
  const THINKING_TAGS_DEFAULT = [
    {
      "id": "kemini",
      "label": "Kemini（<thinking>，ICOT 为三段交错）",
      "note": "ICOT 会把输出分成三段、每段\"思考+正文\"，模型因此吐出 3 个思考块。",
      "members": [
        "📽️ICOT（三段）",
        "📽️COT（格式友好型）"
      ]
    },
    {
      "id": "izumi",
      "label": "Izumi（konatan_planning~，单块）",
      "note": "Izumi 系全部用 konatan_planning~ 包裹思考，通常只有一块。",
      "members": [
        "思维链-注重人设",
        "思维链-注重流畅性",
        "思维链-注重剧情",
        "思维链-均衡",
        "思维链-简洁",
        "思维链-哥杀卡专用",
        "思维链-自定义",
        "思维链-Roland(测试)",
        "思维链-防机器人",
        "快速思维链",
        "不要思维链了",
        "卡思维链（K）",
        "非预填充尾部",
        "基米flash尾部",
        "基米flash尾部1"
      ]
    }
  ];

  const GROUPS = (GROUPS_OVERRIDE && Array.isArray(GROUPS_OVERRIDE.groups) && GROUPS_OVERRIDE.groups.length)
    ? GROUPS_OVERRIDE.groups
    : GROUPS_DEFAULT;
  const DISPLAY = (GROUPS_OVERRIDE && GROUPS_OVERRIDE.display) || DISPLAY_DEFAULT;
  /** 思维链标签互斥组：同一时刻只能有一套标签的条目处于开启状态。 */
  const THINKING_TAGS = (GROUPS_OVERRIDE && Array.isArray(GROUPS_OVERRIDE.thinkingTags) && GROUPS_OVERRIDE.thinkingTags.length)
    ? GROUPS_OVERRIDE.thinkingTags
    : THINKING_TAGS_DEFAULT;

  /** 源条目名 → 显示名（角色名替换表）。匹配预设仍用源名字，显示用这个名字。 */
  const LBL = (n) => DISPLAY[n] || n;

  /** 需要用户自己敲内容的条目 → { hint, locked }。取自 custom 模块，是全局面板行为的数据源。 */
  const EDITABLE = ((GROUPS.find((g) => g.mode === 'editable') || {}).editable) || {};

  const ID = 'fano-preset-panel-v1';
  const VERSION = '0.5.0';
  const LS = {
    open: ID + '_open_v1',
    night: ID + '_night_v1',
    pos: ID + '_pos_v1',
    size: ID + '_size_v1',
    /* 悬浮球自己的坐标（球是能拖的，跟窗口坐标分开记） */
    ball: ID + '_ball_v1',
    /* 整块隐藏：默认**不落盘**（刷新必然回来）；显式 persistHidden(true) 才写 */
    hidden: ID + '_hidden_v1',
    /* 脚本层防截断的开关。键**故意不跟 ID 走**：沿用 v2.8.1 那边已有的 fano-antitrunc-v1，
       这样从那一支换过来时，用户原来的开关状态不会丢。 */
    antitrunc: 'fano-antitrunc-v1',
    plans: ID + '_plans_v1',
    collapsed: ID + '_collapsed_v1',
    expanded: ID + '_expanded_v1',
    bundle: ID + '_bundle_v1',
  };

  /* ── 宿主文档：酒馆助手脚本跑在 iframe 里，窗口必须挂到最外层能拿到的页面上 ───
     只往上看一层是不够的：手机上酒馆助手可能是嵌套 iframe，挂到中间层就会渲染在
     看不见的框里（表现就是"手机上打不开面板"）。这里一路走到最顶层同源窗口。

     注意：**不要求对方的 body 已经就绪**。早先这里会检查 `document.body`，
     而脚本执行时机只要稍早于父文档解析完，body 就是 null —— 于是静默退回本地文档，
     面板被挂进看不见的 iframe。桌面/手机加载时序不同，这条能造成"桌面好、手机坏"。 */
  const HOST = (() => {
    const local = { win: window, doc: document, depth: 0, fellBack: false };
    try {
      let w = window;
      let depth = 0;
      while (w.parent && w.parent !== w) {
        const next = w.parent;
        void next.document;              // 跨域在这里就会抛
        w = next;
        depth++;
        if (depth > 10) break;            // 防御：不正常的嵌套
      }
      if (w !== window && w.document) return { win: w, doc: w.document, depth, fellBack: false };
      return local;
    } catch {
      /* 拿不到更外层（跨域）：退回本地文档。这时面板可能渲染在不可见的 iframe 里，
         所以标记出来，让面板自己提示一句。 */
      return { ...local, fellBack: true };
    }
  })();

  /** 宿主文档的 body 未必已就绪；没就绪就等一下，绝不抛异常把整个面板带崩。 */
  function whenHostReady() {
    if (HOST.doc.body) return Promise.resolve(true);
    return new Promise((resolve) => {
      let done = false;
      const finish = (okFlag) => { if (!done) { done = true; resolve(okFlag); } };
      try {
        HOST.doc.addEventListener('DOMContentLoaded', () => finish(!!HOST.doc.body), { once: true });
      } catch { /* 不支持就靠轮询 */ }
      let tries = 0;
      const poll = () => {
        if (done) return;
        if (HOST.doc.body) return finish(true);
        if (++tries > 100) return finish(false);   // 约 5 秒
        setTimeout(poll, 50);
      };
      setTimeout(poll, 50);
    });
  }

  /* ── 展示分区（纯表现层）───────────────────────────────────────────
     默认是芳乃这套预设的排法；装了分组覆盖（GROUPS_OVERRIDE.sections）就用覆盖的。 */
  const SECTIONS_DEFAULT = [
    { title: '芳乃主体层（本预设新增）', groups: ['fano'] },
    { title: '破甲（按模型分流）', groups: ['jailbreak'] },
    { title: '自定义内容（自己填）', groups: ['custom'] },
    { title: '文风', groups: ['style_main', 'style_third', 'style_first', 'style_nsfw', 'style_lib'] },
    { title: '人称与叙事', groups: ['person', 'dialogue_amt', 'difficulty', 'guard'] },
    { title: '思维链', groups: ['cot', 'cot_lang'] },
    { title: 'MVU 变量更新', groups: ['mvu'] },
    { title: 'NSFW', groups: ['nsfw'] },
    { title: '输出与格式', groups: ['out_mode', 'format', 'summary', 'length'] },
    { title: '适配与美化', groups: ['adapter', 'ui'] },
    { title: '其他', groups: ['misc'] },
    { title: '锚点（固定开启，切换模型也不会动）', groups: ['anchors'] },
    { title: '核心（面板不碰）', groups: ['core'] },
  ];
  const SECTIONS = (GROUPS_OVERRIDE && Array.isArray(GROUPS_OVERRIDE.sections) && GROUPS_OVERRIDE.sections.length)
    ? GROUPS_OVERRIDE.sections
    : SECTIONS_DEFAULT;

  /* ══ FANO_PANEL_CONFIG_BEGIN ══════════════════════════════════════════
     这一段是**给预设生成器（tools/gui）的「面板外观」编辑器读写的**：
     它只替换这中间的内容，别处代码一行都不动。

     改完的生效方式：面板启动时读它，把 tokens 合并到下面的 THEMES 上，
     尺寸/圆角/缩放/不透明度/壁纸都从这里取。想手改也行 —— 就是普通 JSON。

     注意 wallpaper.url 只支持 http(s) 链接或 data: 图片；
     用 data: 会把图片塞进预设 JSON（1MB 的图 ≈ 1.4MB base64），体积自己掂量。
     ═══════════════════════════════════════════════════════════════════ */
  const CONFIG = {
    version: 1,
    /* 窗口标题（换一份预设就改成那套的名字；留空用面板自带的） */
    title: '',
    /* 颜色：按主题覆盖（只写你想改的那几个键就行，其余用内置芳乃配色） */
    tokens: {
      day: {},
      night: {},
    },
    /* 悬浮球：大小 / 形状 / 内容是字还是图。
       shape：circle 圆 · square 方 · rounded 圆角方 · diamond 菱形 · triangle 三角 · hexagon 六边
       content.kind='image' 时用 content.image（**只能是 http(s) 外链或 data: 图片**——
       面板跑在酒馆页面里，本机路径那种 C:\… 在那边加载不到）。
       图片为空字符串时自动退回文字。 */
    ball: {
      size: 46,
      glyph: '芳',
      shape: 'circle',
      content: { kind: 'text', image: '' },
    },
    /* 窗口：默认尺寸、以及可拖动的上下限（都在这里改） */
    window: { w: 380, h: 620, minW: 260, minH: 200, maxW: 0, maxH: 0 },
    /* 整体观感 */
    layout: {
      radius: 14,        // 窗口圆角 px
      scale: 1,          // 整体缩放（对面板 CSS 里的 px 生效，1 = 原始大小）
      fontScale: 1,      // 字号倍率（只乘 font-size，不动间距；1 = 原始大小）
      opacity: 1,        // 窗口底色层不透明度（1 = 不透明，0.6 就能透出后面的酒馆界面）
      blur: 14,          // 窗口底色层的背景模糊 px（磨砂感）
    },
    /* 壁纸：只作用于**面板自己**，不动酒馆页面 */
    wallpaper: {
      url: '',           // 空 = 不用壁纸
      fit: 'cover',      // cover / contain / repeat
      opacity: 0.35,
      blur: 0,
      dim: 0.15,         // 压暗层：壁纸太花时把文字压回可读
      dimColor: '#000000',
    },
    /* 脚本层防截断（拦截 generate 请求，让正文走函数调用回传；实现见
       panel/src/antitrunc.js）。这里只是**这份预设出厂时的开关**：
       真正记状态的是 localStorage 的 fano-antitrunc-v1（顶部「🛡 防截断」按钮
       写的就是它）。所以 enabled=false 表示"这份预设出厂不带防护"，
       用户点过按钮之后就以他点的为准。 */
    antitrunc: { enabled: true },
    /* 顶部脚本按钮（酒馆助手）。名字必须和预设里**静态声明**的那两个一致，
       否则酒馆渲染的是静态名字、面板去接另一个名字，按钮就成了摆设——
       tools/build-preset.mjs 写 button.buttons 时读的正是这里，改完重新构建即可。
       enabled=false = 不声明也不接线（那份预设不带顶部按钮）。 */
    button: { enabled: true, panel: '⚙ 芳乃', antitrunc: '🛡 防截断' },
    /* 长按条目改正文：按住 longPress.ms 毫秒，就打开那一条的正文编辑器。
       enabled=false 就关掉这个手势（面板上不会提"长按"两个字）。
       改的是**预设里那一条的正文**，保存时和其它操作一样只写回一次。 */
    edit: { longPress: { enabled: true, ms: 500 } },
  };
  /* ══ FANO_PANEL_CONFIG_END ════════════════════════════════════════════ */

  /** 允许的球形状（写错就退回圆形，不让一个错字把球画没）。定义在 CFG 之前，CFG 初始化时要用 */
  const BALL_SHAPES = ['circle', 'square', 'rounded', 'diamond', 'triangle', 'hexagon'];

  /* ── 芳乃 / 千恋万花 配色 token ─────────────────────────────────── */
  const THEMES = {
    day: {
      '--fp-bg': '#fff7fa', '--fp-bg-raised': '#ffffff', '--fp-bg-inset': '#fdeef4',
      '--fp-border': '#f2dbe6', '--fp-border-strong': '#e0b4c8',
      '--fp-input-bg': '#fdeef4', '--fp-input-border': '#e0b4c8',
      '--fp-text': '#3b2c38', '--fp-text-dim': '#8b7684', '--fp-text-faint': '#b6a3b0',
      '--fp-accent': '#d4577f', '--fp-accent-hi': '#ef83a7', '--fp-accent-soft': '#fbe4ec',
      '--fp-gold': '#c8a24a', '--fp-indigo': '#3a4368',
      '--fp-ok': '#4f9e78', '--fp-danger': '#cf4a45', '--fp-warn': '#c98a1f',
      '--fp-shadow': 'rgba(120, 60, 90, 0.18)', '--fp-overlay': 'rgba(255, 247, 250, 0.82)',
    },
    night: {
      '--fp-bg': '#17131c', '--fp-bg-raised': '#221b28', '--fp-bg-inset': '#100d14',
      '--fp-border': '#372c40', '--fp-border-strong': '#54405e',
      '--fp-input-bg': '#100d14', '--fp-input-border': '#54405e',
      '--fp-text': '#f4eaf1', '--fp-text-dim': '#b09aab', '--fp-text-faint': '#7e6c7c',
      '--fp-accent': '#e884a9', '--fp-accent-hi': '#ffa3c3', '--fp-accent-soft': '#3a2430',
      '--fp-gold': '#e0c07a', '--fp-indigo': '#8f9bd0',
      '--fp-ok': '#6fbf8a', '--fp-danger': '#ef6f75', '--fp-warn': '#d8b25f',
      '--fp-shadow': 'rgba(0, 0, 0, 0.55)', '--fp-overlay': 'rgba(23, 19, 28, 0.86)',
    },
  };

  /* 配置 → 生效值。全部做类型与范围夹取：CONFIG 是给人手改的，写错了不能让面板崩。
     注意 null / undefined / 空串一律当"没写"→ 用默认值（Number(null) 是 0，
     不特判的话"清空这个字段"会变成"设成 0"，那就掉进夹取下限了）。 */
  const num = (v, d, lo, hi) => {
    if (v === null || v === undefined || v === '') return d;
    const n = Number(v);
    if (!Number.isFinite(n)) return d;
    return Math.max(lo, Math.min(hi, n));
  };
  const CFG = {
    ball: {
      size: Math.round(num(CONFIG?.ball?.size, 46, 28, 96)),
      glyph: String(CONFIG?.ball?.glyph ?? '芳').slice(0, 3) || '芳',
      shape: BALL_SHAPES.includes(CONFIG?.ball?.shape) ? CONFIG.ball.shape : 'circle',
      content: {
        kind: CONFIG?.ball?.content?.kind === 'image' && String(CONFIG?.ball?.content?.image ?? '').trim()
          ? 'image' : 'text',
        image: String(CONFIG?.ball?.content?.image ?? ''),
      },
    },
    window: {
      w: Math.round(num(CONFIG?.window?.w, 380, 200, 4000)),
      h: Math.round(num(CONFIG?.window?.h, 620, 160, 4000)),
      minW: Math.round(num(CONFIG?.window?.minW, 260, 140, 2000)),
      minH: Math.round(num(CONFIG?.window?.minH, 200, 100, 2000)),
      maxW: Math.round(num(CONFIG?.window?.maxW, 0, 0, 4000)),
      maxH: Math.round(num(CONFIG?.window?.maxH, 0, 0, 4000)),
    },
    layout: {
      radius: num(CONFIG?.layout?.radius, 14, 0, 40),
      scale: num(CONFIG?.layout?.scale, 1, 0.6, 2),
      fontScale: num(CONFIG?.layout?.fontScale, 1, 0.7, 1.8),
      opacity: num(CONFIG?.layout?.opacity, 1, 0.15, 1),
      blur: num(CONFIG?.layout?.blur, 14, 0, 40),
    },
    wallpaper: {
      url: String(CONFIG?.wallpaper?.url ?? ''),
      fit: ['cover', 'contain', 'repeat'].includes(CONFIG?.wallpaper?.fit) ? CONFIG.wallpaper.fit : 'cover',
      opacity: num(CONFIG?.wallpaper?.opacity, 0.35, 0, 1),
      blur: num(CONFIG?.wallpaper?.blur, 0, 0, 40),
      dim: num(CONFIG?.wallpaper?.dim, 0.15, 0, 0.95),
      dimColor: String(CONFIG?.wallpaper?.dimColor ?? '#000000'),
    },
    /* 只认显式 false：没写 / 写错 / null 都当**开启**（默认要有这一层防护）。
       字段顺序与 tools/gui/lib/panelconfig.js 的 clampConfig() 必须一致：
       test-panelconfig.mjs 会把两边的生效值逐字段（含顺序）比对。 */
    antitrunc: {
      enabled: CONFIG?.antitrunc?.enabled !== false,
    },
    button: {
      enabled: CONFIG?.button?.enabled !== false,
      panel: String(CONFIG?.button?.panel ?? '⚙ 芳乃').trim() || '⚙ 芳乃',
      antitrunc: String(CONFIG?.button?.antitrunc ?? '🛡 防截断').trim() || '🛡 防截断',
    },
    edit: {
      longPress: {
        enabled: CONFIG?.edit?.longPress?.enabled !== false,
        ms: Math.round(num(CONFIG?.edit?.longPress?.ms, 500, 250, 1500)),
      },
    },
  };
  const hasWallpaper = () => !!CFG.wallpaper.url;

  /** 整体缩放：把面板 CSS 里 ≥3px 的字面量乘一下。
      1px/2px 的描边保持原样，否则细线会被放大成粗边；vw/vh/% 一律不碰。 */
  function scaleCss(css, k) {
    if (Math.abs(k - 1) < 0.001) return css;
    return css.replace(/(\d+(?:\.\d+)?)px/g, (m, n) => {
      const v = Number(n);
      if (v < 3) return m;
      return (Math.round(v * k * 100) / 100) + 'px';
    });
  }

  /** 字号倍率：**只**乘 font-size 的 px，不动间距（想要整体变大用 scale）。 */
  function scaleFontCss(css, k) {
    if (Math.abs(k - 1) < 0.001) return css;
    return css.replace(/font-size:\s*(\d+(?:\.\d+)?)px/g, (m, n) =>
      'font-size:' + (Math.round(Number(n) * k * 100) / 100) + 'px');
  }

  /* ── 小工具 ─────────────────────────────────────────────────────── */
  const el = (tag, cls, text) => {
    const n = HOST.doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const readLS = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } };
  const writeLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 配额满就放弃，不阻断面板 */ } };
  const chars = (s) => (s ? [...s].length : 0);
  const sizeLabel = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n));

  /**
   * 把窗口的尺寸与坐标夹回当前视口。
   *
   * 存的尺寸/坐标可能是别的时候留下的——桌面上拖到右下角、或手机横竖屏切换前定的位置。
   * 直接照用会让窗口整个落在屏幕外，表现就是「打开了但什么都看不见」。
   * 手机上尤其明显：默认 380 宽在 390 的屏幕上配 right:16px，左边缘已经是 -6px；
   * 桌面存下的 x=880 更是完全看不见。
   */
  function clampToViewport(pos, size) {
    const vw = HOST.win.innerWidth || 1024;
    const vh = HOST.win.innerHeight || 768;
    const w = Math.max(CFG.window.minW, Math.min(Number(size && size.w) || CFG.window.w, vw - 24));
    const h = Math.max(CFG.window.minH, Math.min(Number(size && size.h) || CFG.window.h, vh - 140));
    let x = null;
    let y = Math.min(72, Math.max(8, vh - h - 8));
    if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
      x = Math.max(8, Math.min(pos.x, vw - w - 8));
      y = Math.max(8, Math.min(pos.y, Math.max(8, vh - 96)));
    }
    return { w: Math.round(w), h: Math.round(h), x: x === null ? null : Math.round(x), y: Math.round(y) };
  }

  /* ── 酒馆助手适配层（沿用 has()/attempt() 防御式写法） ───────────── */
  const hostFn = (name) => {
    try {
      const w = typeof window !== 'undefined' ? window : {};
      if (typeof w[name] === 'function') return w[name];
      const th = w.TavernHelper;
      if (th && typeof th[name] === 'function') return th[name].bind(th);
    } catch { /* 忽略 */ }
    return undefined;
  };
  const has = (name) => !!hostFn(name);
  const attempt = (label, fn, fallback) => {
    try { return fn(); } catch (e) { console.warn('[芳乃面板] ' + label, e); return fallback; }
  };

  const api = {
    available() { return has('getPreset') && (has('updatePresetWith') || has('replacePreset')); },
    async get() {
      const get = hostFn('getPreset');
      if (!get) throw new Error('缺少酒馆助手 API：getPreset 不可用');
      return await get('in_use');
    },
    async write(updater) {
      const up = hostFn('updatePresetWith');
      if (up) return await up('in_use', updater, { render: 'immediate' });
      const get = hostFn('getPreset');
      const replace = hostFn('replacePreset');
      if (get && replace) {
        const preset = await get('in_use');
        const next = updater(preset) || preset;
        return await replace('in_use', next);
      }
      throw new Error('缺少酒馆助手 API：updatePresetWith / replacePreset 都不可用');
    },
  };

  /* ── 写回串行化（一次切换只写一次预设） ─────────────────────────── */
  let writeChain = Promise.resolve();
  const enqueue = (fn) => {
    writeChain = writeChain.then(fn, fn);
    return writeChain;
  };

  /* ── 状态 ───────────────────────────────────────────────────────── */
  const state = {
    ready: false,
    presetName: '',
    prompts: [],       // 当前预设的 prompts（酒馆助手 Preset API 形状）
    index: new Map(),  // name -> prompt
    missing: new Map(),// groupId -> 缺失成员数
    night: readLS(LS.night, false),
    collapsed: false,
    /* 整块隐藏：默认**只在本次会话有效**（刷新必然回来）。
       存档里有这个键 = 用户显式 persistHidden 过，那就照办。 */
    hidden: readLS(LS.hidden, false) === true,
    persistHidden: readLS(LS.hidden, null) !== null,
    open: readLS(LS.open, true),
    /** 展开了哪些模块（手风琴）。默认全折。 */
    expanded: new Set(readLS(LS.expanded, [])),
    /** 每个 bundle 组选了哪一套（记住用户的选择，而不是靠猜）。 */
    bundles: readLS(LS.bundle, {}),
    /** 在非自定义模块里手动展开了哪些编辑框。 */
    editors: new Set(),
    /** 长按条目打开的那个正文编辑器：当前正在改哪一条（null = 没开）。 */
    editTarget: null,
    /** 位置校验：跑飞时只尝试换挂载点一次，避免递归。 */
    remountTried: false,
    lastPlacement: null,
    busy: false,
    lastError: '',
  };

  const on = (p) => !!p && p.enabled !== false;

  function reindex(prompts) {
    const index = new Map();
    for (const p of prompts) {
      if (!p || typeof p !== 'object') continue;
      const n = p.name ?? '';
      if (!index.has(n)) index.set(n, p);          // 同名取第一条（源预设里就有重名）
      if (p.identifier) index.set('#' + p.identifier, p);
    }
    state.prompts = prompts;
    state.index = index;
    state.missing = new Map();
    for (const g of GROUPS) {
      if (g.mode === 'bundle') {
        for (const o of g.options) {
          const names = [...o.members, ...(o.tunables || []).flatMap((t) => t.members)];
          state.missing.set(g.id + ':' + o.id, names.filter((m) => !index.has(m)).length);
        }
      } else if (g.members) {
        state.missing.set(g.id, g.members.filter((m) => !index.has(m)).length);
      }
    }
  }

  const find = (name) => state.index.get(name) || null;

  async function reload(showToast) {
    if (!api.available()) {
      state.ready = false;
      state.lastError = '没找到酒馆助手 API（getPreset / updatePresetWith）。请在装了「酒馆助手」的环境里运行。';
      render();
      return;
    }
    try {
      const preset = await api.get();
      if (!preset) throw new Error('getPreset 返回空');
      state.presetName = preset.name || attempt('name', () => SillyTavern.getContext().name2, '') || '当前预设';
      reindex(Array.isArray(preset.prompts) ? preset.prompts : []);
      state.ready = true;
      state.lastError = '';
      if (showToast) toast('已读取：' + state.presetName, 'ok');
    } catch (e) {
      state.ready = false;
      state.lastError = String(e && e.message ? e.message : e);
    }
    render();
  }

  /**
   * 思维链标签互斥。
   *
   * 踩过的坑：Kemini 的 ICOT/COT 要求用 <thinking> 思考（ICOT 还是三段，
   * 模型会吐 3 个思考块），Izumi 的思维链条目要求用 konatan_planning~。
   * 两套同时开着，模型会把两种都吐出来，折叠后就变成
   * "一个 Izumi 形态 + 好几个 Kemini 形态"混在一起。
   *
   * 规则：一次写入里若开启了某一套标签的条目，就把另外几套标签的条目全部关掉。
   * 组内不互斥（Izumi 的思维链 + 基米flash尾部 本来就要配对用）。
   */
  function enforceThinkingTags(changes) {
    if (!Array.isArray(THINKING_TAGS) || !THINKING_TAGS.length) return changes;
    const turnOn = new Set(changes.filter((c) => c.enabled === true).map((c) => c.name));
    if (!turnOn.size) return changes;
    const active = THINKING_TAGS.filter((t) => (t.members || []).some((m) => turnOn.has(m)));
    if (!active.length) return changes;
    const keep = active[0];
    const others = THINKING_TAGS.filter((t) => t.id !== keep.id);
    if (!others.length) return changes;
    const isOtherMember = (n) => others.some((t) => (t.members || []).includes(n));
    /* 先把"要开另一套标签"的项剔掉，再把那一套统一关干净 */
    const out = changes.filter((c) => !(c.enabled === true && isOtherMember(c.name)));
    const touched = new Set(out.map((c) => c.name));
    for (const t of others) {
      for (const m of t.members || []) {
        if (touched.has(m) || !find(m)) continue;
        out.push({ name: m, enabled: false });
      }
    }
    return out;
  }

  /** 在预设上批量改 enabled / content；一次调用 = 一次写回。 */
  async function apply(input, note) {
    const changes = enforceThinkingTags(input);
    if (!changes.length) return;
    state.busy = true;
    paintBusy();
    await enqueue(async () => {
      try {
        await api.write((preset) => {
          const prompts = Array.isArray(preset.prompts) ? preset.prompts : (preset.prompts = []);
          const idx = new Map();
          for (const p of prompts) {
            if (!p || typeof p !== 'object') continue;
            const n = p.name ?? '';
            if (!idx.has(n)) idx.set(n, p);
            if (p.identifier) idx.set('#' + p.identifier, p);
          }
          for (const ch of changes) {
            const target = idx.get(ch.name) || idx.get('#' + ch.name);
            if (!target) continue;
            if (typeof ch.content === 'string') target.content = ch.content;
            if (typeof ch.enabled === 'boolean') target.enabled = ch.enabled;
          }
          return preset;
        });
        // 本地镜像同步，避免每次操作都重新拉一遍预设
        for (const ch of changes) {
          const p = find(ch.name);
          if (!p) continue;
          if (typeof ch.content === 'string') p.content = ch.content;
          if (typeof ch.enabled === 'boolean') p.enabled = ch.enabled;
        }
        if (note) toast(note, 'ok');
      } catch (e) {
        toast('写回失败：' + (e && e.message ? e.message : e), 'err');
        console.warn('[芳乃面板] write failed', e);
      }
    });
    state.busy = false;
    paintBusy();
    render();
  }

  /** 单选子集：开一个，关同组其他。 */
  function pickSingle(group, name) {
    const changes = [];
    for (const m of group.members) {
      const p = find(m);
      if (!p) continue;
      changes.push({ name: m, enabled: m === name });
    }
    if (!changes.length) return toast('这一组的条目当前预设里都没有', 'err');
    apply(changes, name ? '已切到 ' + name : '已关闭 ' + group.label);
  }

  /** 破甲分流：开满选中骨架，关掉另外两家；再补该骨架"必选一"档位的默认值。 */
  function pickBundle(group, optionId) {
    const changes = [];
    const seen = new Set();
    for (const o of group.options) {
      const want = o.id === optionId;
      for (const m of o.members) {
        if (seen.has(m)) continue;
        seen.add(m);
        const p = find(m);
        if (!p) continue;
        changes.push({ name: m, enabled: want });
      }
    }
    /* 档位不受切换影响（用户自己的选择保留）；只有"必选一却一个都没开"才补默认 */
    const target = group.options.find((o) => o.id === optionId);
    let filled = 0;
    if (target && target.tunables) {
      for (const t of target.tunables) {
        if (!t.ensureOne) continue;
        const present = t.members.filter((m) => find(m));
        if (!present.length) continue;
        if (present.some((m) => on(find(m)))) continue;
        const pick = present.includes(t.default) ? t.default : present[0];
        changes.push({ name: pick, enabled: true });
        filled++;
      }
    }
    if (!changes.length) return toast('这个预设里没有三组破甲条目', 'err');
    /* 记住这次选的是哪一套，下次打开面板还显示这一套 */
    state.bundles[group.id] = optionId;
    writeLS(LS.bundle, state.bundles);
    const opt = group.options.find((o) => o.id === optionId);
    apply(changes, optionId === 'manual'
      ? '已关掉全部破甲骨架'
      : `破甲切到 ${opt.label}${filled ? `（补了 ${filled} 个必选档位）` : ''}`);
  }

  /** 改某一个条目的正文（雪融雪降那种要用户自己填的）。 */
  function saveContent(name, text) {
    if (!find(name)) return toast('当前预设里没有这一条：' + LBL(name), 'err');
    const before = (find(name).content || '').length;
    if (before === text.length && find(name).content === text) return toast('内容没有变化', 'err');
    apply([{ name, content: text }], `已写入「${LBL(name)}」（${before} → ${text.length} 字）`);
  }

  /** 单选档位（不改变互斥语义的开关）。 */
  function pickTunableSingle(group, t, name) {
    const changes = [];
    for (const m of t.members) {
      const p = find(m);
      if (!p) continue;
      changes.push({ name: m, enabled: m === name });
    }
    if (!changes.length) return toast('这一档的条目当前预设里都没有', 'err');
    apply(changes, `${t.label} → ${name ? LBL(name) : '不使用'}`);
  }

  /* ── 可编辑条目：给输入框 ───────────────────────────────────────── */

  /** 输入框块：开关（locked 的除外）+ textarea + 保存/撤销 + 字数。 */
  function editorBlock(name, info) {
    const p = find(name);
    const wrap = el('div', 'fp-editor');
    const head = el('div', 'fp-rowhead');

    if (info && info.locked) {
      head.appendChild(el('span', 'fp-badge', '固定开启'));
    } else {
      const sw = el('div', 'fp-sw');
      sw.dataset.on = p && on(p) ? '1' : '0';
      sw.appendChild(el('span', '', p && on(p) ? '已启用' : '未启用'));
      sw.title = '点一下开关这一条';
      if (p) sw.addEventListener('click', () => toggleOne(name, !on(p)));
      head.appendChild(sw);
    }
    const count = el('span', 'fp-note', p ? `${chars(p.content)} 字` : '当前预设里没有这一条');
    head.appendChild(count);
    wrap.appendChild(head);

    if (!p) return wrap;

    const ta = el('textarea', 'fp-textarea');
    ta.value = p.content || '';
    ta.addEventListener('input', () => { count.textContent = `${chars(ta.value)} 字（保存后生效）`; });
    wrap.appendChild(ta);

    const row = el('div', 'fp-chips');
    row.appendChild(el('span', 'fp-mini', '保存')).addEventListener('click', () => saveContent(name, ta.value));
    row.appendChild(el('span', 'fp-mini', '撤销改动')).addEventListener('click', () => {
      ta.value = find(name)?.content || '';
      count.textContent = `${chars(ta.value)} 字`;
    });
    wrap.appendChild(row);

    if (info && info.hint) wrap.appendChild(el('div', 'fp-modnote', info.hint));
    return wrap;
  }

  /** 开关银行里给可编辑条目用的「✎ 填内容」按钮。 */
  function editBtn(name) {
    const b = el('div', 'fp-sw fp-editbtn');
    b.dataset.on = state.editors.has(name) ? '1' : '0';
    b.appendChild(el('span', '', '✎ 填内容'));
    b.title = '展开输入框，自己填这一条的内容';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.editors.has(name)) state.editors.delete(name);
      else state.editors.add(name);
      render();
    });
    return b;
  }

  /** 把「某个模块里已展开的可编辑项」输入框补到容器尾部。 */
  function appendOpenEditors(box, members) {
    for (const m of members) {
      if (!EDITABLE[m] || !state.editors.has(m)) continue;
      const wrap = el('div', 'fp-tunable');
      wrap.appendChild(el('div', 'fp-tunlabel', LBL(m)));
      wrap.appendChild(editorBlock(m, EDITABLE[m]));
      box.appendChild(wrap);
    }
  }

  function toggleOne(name, enabled) {
    if (!find(name)) return toast('当前预设里没有这一条：' + name, 'err');
    apply([{ name, enabled }], (enabled ? '已开 ' : '已关 ') + name);
  }

  /* ══ 长按条目 → 改这一条的正文 ══════════════════════════════════════
     为什么要有这个：面板上大多数条目只有一个开关/下拉，正文看不到也改不了；
     想看某一条写了什么、顺手改两句，原来只能去酒馆的预设编辑器里翻。

     手势规则（都写在 CONFIG.edit.longPress 里，enabled=false 就整个关掉）：
       · 按住 ms 毫秒算长按；
       · 期间指针移动超过 8px 就取消——手机上那是"在滚动"，不是"在长按"；
       · 长按触发后，松手跟来的那次 click **会被吞掉**，否则会顺手把这一条开关掉；
       · 触发时那一行高亮一下，手机支持震动就轻震一下（反馈，不是效果）。
     落在哪儿：
       · 多选开关排 / 破甲档位 —— 每一行（.fp-sw）都能长按；
       · 单选下拉 —— 下拉本身是原生控件（一按就弹系统选择器），所以它下面那一行
         "当前：<条目>" 就是它的条目行，长按它改当前这一条；
       · 只读区（固定分组）—— 每个名字一个可长按的条目行；
       · 注入位标记（marker：聊天记录/角色卡/世界书这些位置标记）**只给看**，
         不给保存：它们的正文本来就该是空的，往里写东西会直接坏掉注入。 */

  /** 能力标记：编辑器导出前检查靠这一行判断"这份面板脚本会不会长按改正文"。
      改这段代码时**别删这一行**（删了编辑器就认不出来了）。 */
  const CAP_LONGPRESS_EDIT = 'FANO_PANEL_CAP_LONGPRESS_EDIT';

  /** 长按期间指针允许的抖动（px）。超过就当成滚动/拖动，取消。 */
  const HOLD_CANCEL_PX = 8;
  /** 长按已经触发过：紧跟的那一次 click 要吞掉（见 bindGestureOnce 里的捕获监听）。 */
  let swallowNextClick = false;

  /** 这一条是不是酒馆的注入位标记（正文必须为空，改了就坏）。 */
  const isMarker = (name) => {
    const p = find(name);
    return !!(p && p.marker === true);
  };

  /** 长按触发时的反馈：能震就轻震一下（拿不到就当没有，绝不抛）。 */
  function buzz() {
    try {
      const nav = HOST.win.navigator || (typeof navigator !== 'undefined' ? navigator : null);
      if (nav && typeof nav.vibrate === 'function') nav.vibrate(15);
    } catch { /* 忽略 */ }
  }

  /** 打开某一条的正文编辑器（浮层）。 */
  function openEntryEditor(name) {
    if (!find(name)) return toast('当前预设里没有这一条：' + LBL(name), 'err');
    state.editTarget = name;
    render();
    /* 打开就把光标放进去（省一次点击）。拿不到就拉倒。 */
    try {
      const mask = HOST.doc.getElementById(ID + '-edit');
      const ta = mask && typeof mask.querySelector === 'function' ? mask.querySelector('textarea') : null;
      if (ta && !isMarker(name) && typeof ta.focus === 'function') ta.focus();
    } catch { /* 忽略 */ }
    return name;
  }

  /** 关掉浮层（不写回）。 */
  function closeEntryEditor() {
    if (state.editTarget === null) return false;
    state.editTarget = null;
    render();
    return true;
  }

  /**
   * 把长按手势挂到某一行上。行里点一下该干嘛还干嘛（开关/选中），
   * 只有"按住不动"才是改正文——两件事不抢同一个手势。
   */
  function bindLongPress(node, name) {
    if (!CFG.edit.longPress.enabled || !name || !node || typeof node.addEventListener !== 'function') return;
    let timer = null;
    let sx = 0;
    let sy = 0;
    const cancel = () => {
      if (timer !== null) { clearTimeout(timer); timer = null; }
      try { node.classList.remove('fp-hold'); } catch { /* 忽略 */ }
    };
    node.addEventListener('pointerdown', (e) => {
      if (e && typeof e.button === 'number' && e.button !== 0) return;   // 只认左键/触摸
      /* 下拉框自己要用这个手势（点一下就是选它），别抢 */
      if (e && e.target && typeof e.target.closest === 'function' && e.target.closest('select')) return;
      swallowNextClick = false;         // 上一次长按留下的"吞一次"不该跨到这一次
      sx = e ? e.clientX : 0;
      sy = e ? e.clientY : 0;
      try { node.classList.add('fp-hold'); } catch { /* 忽略 */ }
      timer = setTimeout(() => {
        timer = null;
        swallowNextClick = true;        // 松手跟来的那次 click 由 onRowClick 吞掉
        try { node.classList.remove('fp-hold'); } catch { /* 忽略 */ }
        buzz();
        openEntryEditor(name);
      }, CFG.edit.longPress.ms);
    });
    node.addEventListener('pointermove', (e) => {
      if (timer === null) return;
      const dx = Math.abs((e ? e.clientX : 0) - sx);
      const dy = Math.abs((e ? e.clientY : 0) - sy);
      if (dx + dy > HOLD_CANCEL_PX) cancel();
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) node.addEventListener(ev, cancel);
  }

  /**
   * 条目行的"点一下"统一走这里：长按刚开过编辑器的那一次点击会被吞掉。
   *
   * 为什么必须由**行**自己拦：长按会触发一次重渲染，原来那一行已经从文档里摘下来了，
   * 而浏览器仍可能把随后的 click 派发到这个**已摘下的节点**上——那时行里"点一下开关"
   * 照样会跑，于是长按一下就顺手把条目开关掉了，或者把刚打开的东西又切走。
   * 文档级的捕获监听救不了（节点已不在文档树里），所以守卫必须在行内部。
   */
  function onRowClick(fn) {
    return (e) => {
      if (swallowNextClick) {
        swallowNextClick = false;
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        return;
      }
      fn(e);
    };
  }

  /** 一个可长按的条目行（名字 + 字数）：只读区、单选组的"当前条目"都用它。
      opts.onPick 给了就是"点一下选中它"，没给就是"点一下打开正文编辑器"。 */
  function entryRow(name, opts = {}) {
    const p = find(name);
    const row = el('div', 'fp-sw');
    row.dataset.on = p && on(p) ? '1' : '0';
    if (!p) row.dataset.miss = '1';
    if (opts.subtle) row.dataset.subtle = '1';
    row.appendChild(el('span', '', LBL(name)));
    if (p) row.appendChild(el('i', '', sizeLabel(chars(p.content))));
    const foot = isMarker(name)
      ? '注入位标记：正文必须为空，只能看'
      : (CFG.edit.longPress.enabled ? `长按改正文（按住 ${CFG.edit.longPress.ms}ms）` : '');
    row.title = (p ? `${LBL(name)}\n${chars(p.content)} 字` : `${LBL(name)}\n当前预设里没有这一条`)
      + (foot ? `\n${foot}` : '');
    if (p) row.addEventListener('click', onRowClick(() => (opts.onPick ? opts.onPick(name) : openEntryEditor(name))));
    bindLongPress(row, name);
    return row;
  }

  /** 长按开出来的正文编辑器浮层（盖在窗口里）。 */
  function entryEditorBox(name) {
    const p = find(name);
    const marker = isMarker(name);
    const mask = el('div', 'fp-editmask');
    mask.id = ID + '-edit';
    /* 点空白处关掉；点内容不关（否则一不小心就把没保存的改动丢了） */
    mask.addEventListener('click', (e) => { if (!e || e.target === mask) closeEntryEditor(); });

    const box = el('div', 'fp-editbox');
    const head = el('div', 'fp-rowhead');
    head.appendChild(el('b', 'fp-editname', LBL(name)));
    head.appendChild(el('span', 'fp-badge', p && on(p) ? '已启用' : '未启用'));
    const count = el('span', 'fp-note', `${chars(p.content)} 字`);
    head.appendChild(count);
    box.appendChild(head);

    if (marker) {
      box.appendChild(el('div', 'fp-modnote',
        `这是酒馆的**注入位标记**（${p.identifier || '位置标记'}）：它的正文本来就该是空的，`
        + '往这里写东西会让世界书/角色卡/聊天记录进不了上下文。所以这一条只给看，不给改。'));
    } else {
      box.appendChild(el('div', 'fp-modnote',
        `改的是预设里「${name}」这一条的正文，保存时和其它操作一样**只写回一次**。`
        + '（长按面板上任一条目都能打开这里。）'));
    }

    const ta = el('textarea', 'fp-textarea');
    ta.value = p.content || '';
    if (marker) ta.readOnly = true;
    ta.addEventListener('input', () => { count.textContent = `${chars(ta.value)} 字（保存后生效）`; });
    box.appendChild(ta);

    const chips = el('div', 'fp-chips');
    if (!marker) {
      chips.appendChild(el('span', 'fp-mini', '保存')).addEventListener('click', () => {
        const text = ta.value;
        state.editTarget = null;      // 先关掉浮层再写回：写回成功/失败都由 toast 说话
        saveContent(name, text);
      });
      chips.appendChild(el('span', 'fp-mini', '撤销改动')).addEventListener('click', () => {
        ta.value = (find(name) || {}).content || '';
        count.textContent = `${chars(ta.value)} 字`;
      });
    }
    chips.appendChild(el('span', 'fp-mini', marker ? '知道了' : '关闭')).addEventListener('click', () => closeEntryEditor());
    box.appendChild(chips);

    mask.appendChild(box);
    return mask;
  }

  /** 只读区（固定分组）的条目行：不改开关，只给长按看/改正文。 */
  function entryRows(members, opts = {}) {
    const grid = el('div', 'fp-switches');
    for (const m of members) grid.appendChild(entryRow(m, opts));
    return grid;
  }

  /**
   * 当前用哪一套骨架。
   * 优先用记住的选择——不能靠"哪组成员的都开着"去猜：梦鲸那套骨架只有 1 条，
   * 源预设里恰好开着就会误判。记住的选择失效时（那套在本预设里根本没有条目）才回到推断。
   */
  function currentBundleOption(group) {
    const chosen = state.bundles[group.id];
    if (chosen && group.options.some((o) => o.id === chosen)) {
      if (chosen === 'manual') return chosen;
      const o = group.options.find((x) => x.id === chosen);
      const present = o.members.filter((m) => find(m));
      if (present.some((m) => on(find(m)))) return chosen;
    }
    let best = 'manual';
    let bestScore = 0;
    for (const o of group.options) {
      if (!o.members.length) continue;
      const present = o.members.filter((m) => find(m));
      if (!present.length) continue;
      const score = present.filter((m) => on(find(m))).length;
      if (score > bestScore) { bestScore = score; best = o.id; }
    }
    return best;
  }

  /* ── 小方案 ─────────────────────────────────────────────────────── */
  const managedNames = () => {
    const out = [];
    for (const g of GROUPS) {
      if (g.mode === 'bundle') for (const o of g.options) out.push(...o.members);
      else if (g.mode !== 'fixed' && g.members) out.push(...g.members);
    }
    return [...new Set(out)].filter((n) => find(n));
  };
  const plans = () => readLS(LS.plans, []);
  function savePlan() {
    const snap = {};
    for (const n of managedNames()) if (on(find(n))) snap[n] = 1;
    const name = '方案 ' + (plans().length + 1);
    const next = plans().concat([{ id: 'p' + Date.now(), name, entries: snap }]);
    writeLS(LS.plans, next);
    render();
    toast('已存为「' + name + '」（' + Object.keys(snap).length + ' 条）', 'ok');
  }
  function applyPlan(plan) {
    const changes = [];
    for (const n of managedNames()) {
      const p = find(n);
      changes.push({ name: n, enabled: !!plan.entries[n] });
    }
    apply(changes, '已应用「' + plan.name + '」');
  }

  /* ── toast ──────────────────────────────────────────────────────── */
  let toastTimer = null;
  function toast(msg, kind) {
    /* toast 也必须能容错：body 未就绪时不该把调用方带崩 */
    try {
      if (!HOST.doc.body) { console.log('[芳乃面板] ' + msg); return; }
      let box = HOST.doc.getElementById(ID + '-toast');
      if (!box) {
        box = el('div', 'fp-toast');
        box.id = ID + '-toast';
        HOST.doc.body.appendChild(box);
      }
      box.textContent = msg;
      box.dataset.kind = kind || 'info';
      box.classList.add('fp-toast-show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => box.classList.remove('fp-toast-show'), 2600);
    } catch (e) {
      console.log('[芳乃面板] toast 失败：' + msg, e);
    }
  }
  function paintBusy() {
    const root = HOST.doc.getElementById(ID + '-win');
    if (root) root.dataset.busy = state.busy ? '1' : '0';
  }

  /**
   * 用酒馆自己的 toast 播报一条消息。
   *
   * 为什么需要它：手机 Chrome 上打不开控制台，面板又正好是"看不见"的那一方，
   * 于是用户拿不到任何线索。酒馆的 toastr 渲染在酒馆自己的界面里，手机上一眼就能看到。
   */
  function notifyUser(msg, kind) {
    const level = kind === 'err' ? 'error' : kind === 'ok' ? 'success' : 'info';
    let shown = false;
    for (const scope of [HOST.win, window]) {
      try {
        const t = scope && scope.toastr;
        if (t && typeof t[level] === 'function') { t[level](msg); shown = true; break; }
      } catch { /* 换下一个 */ }
    }
    if (!shown) toast(msg, kind);
    if (kind === 'err') console.error('[芳乃面板] ' + msg);
    else console.log('[芳乃面板] ' + msg);
    return shown;
  }

  /**
   * 量悬浮球是否真的在视口内，并给出可能的原因。
   *
   * 手机上实测到的现象是「悬浮球 (12,-158) / 视口 360×695」——left 正常、top 完全跑飞。
   * 这说明定位所依赖的**包含块高度算成了 0**，也就是 `.fp-root` 没有被拉伸成视口大小。
   * 最常见的原因是页面某层祖先带了 transform / filter / perspective / contain，
   * 于是 `position:fixed` 被"关进"那个祖先的坐标系里。
   */
  function measureBall(ball) {
    const docEl = HOST.doc.documentElement || {};
    const vw = HOST.win.innerWidth || docEl.clientWidth || 0;
    const vh = HOST.win.innerHeight || docEl.clientHeight || 0;
    let rect = null;
    try { rect = ball.getBoundingClientRect(); } catch { /* 某些宿主拿不到几何 */ }
    if (!rect) return { ok: true, rect: '未知', viewport: `${vw}×${vh}`, hint: '' };
    const ok = rect.left >= 0 && rect.top >= 0
      && rect.left + rect.width <= vw + 1 && rect.top + rect.height <= vh + 1;
    const root = HOST.doc.getElementById(ID + '-root');
    let rootH = null;
    try { rootH = root ? Math.round(root.getBoundingClientRect().height) : null; } catch { /* 忽略 */ }
    const hint = rootH === null ? ''
      : `（根容器高 ${rootH}px，挂载点 ${root && root.parentNode === docEl ? 'documentElement' : 'body'}）`;
    return {
      ok,
      rect: `${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}×${Math.round(rect.height)}`,
      viewport: `${vw}×${vh}`,
      rootHeight: rootH,
      mountedOn: root && root.parentNode === docEl ? 'documentElement' : 'body',
      hint,
    };
  }

  /**
   * 渲染后校验悬浮球位置；跑飞了就换个挂载点再试一次。
   *
   * 换挂载点的理由：fixed 定位的包含块由最近的 transform/filter/contain 祖先决定。
   * 若这层祖先在 body 里，把面板挪到 `documentElement` 下（body 的兄弟）就能绕开。
   */
  function afterRenderPlacement(root, ball) {
    const g = measureBall(ball);
    state.lastPlacement = g;
    if (g.ok) return g;
    const docEl = HOST.doc.documentElement;
    if (!state.remountTried && docEl && root.parentNode !== docEl) {
      state.remountTried = true;
      console.warn('[芳乃面板] 悬浮球位置异常（' + g.rect + '），改挂到 documentElement 再试一次');
      try {
        docEl.appendChild(root);
        render();
        return state.lastPlacement;
      } catch (e) {
        console.warn('[芳乃面板] 改挂失败', e);
      }
    }
    return g;
  }

  /** 启动自检：确认面板**真的看得见**。看不见就说清楚是哪一种，别让用户对着空气猜。 */
  function selfCheck() {
    const problems = [];
    if (HOST.fellBack) problems.push('拿不到外层页面（跨域），面板被挂进了内层 iframe');
    if (!HOST.doc.body) problems.push('宿主文档 body 还没就绪');
    const root = HOST.doc.getElementById(ID + '-root');
    if (!root) {
      problems.push('面板根节点没插进页面');
    } else {
      let ball = null;
      try { ball = root.querySelector ? root.querySelector('.fp-launch') : null; } catch { /* 忽略 */ }
      if (!ball) problems.push('悬浮球没创建出来');
      else {
        const g = measureBall(ball);
        if (!g.ok) problems.push(`悬浮球跑到了视口外（${g.rect} / 视口 ${g.viewport}）${g.hint}`);
      }
    }
    if (state.lastError) problems.push('读取预设出错：' + state.lastError);
    return problems;
  }

  /* ── 样式 ───────────────────────────────────────────────────────── */
  function ensureStyle() {
    let s = HOST.doc.getElementById(ID + '-style');
    if (!s) { s = el('style'); s.id = ID + '-style'; HOST.doc.head.appendChild(s); }
    const tokens = (theme) => Object.entries(theme).map(([k, v]) => `${k}:${v};`).join('');
    /* CONFIG.tokens 覆盖内置主题（只写想改的键） */
    const day = { ...THEMES.day, ...((CONFIG && CONFIG.tokens && CONFIG.tokens.day) || {}) };
    const night = { ...THEMES.night, ...((CONFIG && CONFIG.tokens && CONFIG.tokens.night) || {}) };
    const raw = `
.fp-root{position:fixed;top:0;left:0;width:0;height:0;z-index:2147482000;pointer-events:none;
  font-family:system-ui,-apple-system,"Segoe UI","Noto Sans SC",sans-serif;
  font-size:13px;line-height:1.65;color:var(--fp-text);-webkit-font-smoothing:antialiased;}
.fp-root[data-theme="day"]{${tokens(day)}}
.fp-root[data-theme="night"]{${tokens(night)}}

/* 窗口的分层（由下到上）：
   0 底色层（原来的磨砂玻璃，带 CONFIG 的不透明度/模糊）
   1 壁纸层   2 压暗层   3 内容
   分成 4 层是为了让"半透明 + 壁纸 + 文字仍可读"这三件事互不打架。 */
.fp-bglayer{position:absolute;inset:0;z-index:0;background:var(--fp-overlay);
  opacity:var(--fp-opacity,1);backdrop-filter:blur(var(--fp-blur,14px)) saturate(1.1);
  -webkit-backdrop-filter:blur(var(--fp-blur,14px)) saturate(1.1);}
.fp-wall{position:absolute;inset:0;z-index:1;background-position:center;background-repeat:no-repeat;
  opacity:var(--fp-wall-opacity,0);filter:blur(var(--fp-wall-blur,0px));pointer-events:none;}
.fp-wall[data-fit="repeat"]{background-repeat:repeat;background-size:auto;}
.fp-wall[data-fit="contain"]{background-size:contain;}
.fp-wall[data-fit="cover"]{background-size:cover;}
.fp-walldim{position:absolute;inset:0;z-index:2;pointer-events:none;
  background:var(--fp-wall-dim-color,#000);opacity:var(--fp-wall-dim,0);}
.fp-head,.fp-body,.fp-foot{position:relative;z-index:3;}
/* 悬浮球：自己 fixed 定位、坐标由 JS 按视口算好写进去。
   早先靠 .fp-root 的 inset:0 撑满 + bottom:96px 来定位，实测在手机上会算到
   视口外（12,-158）——因为根容器一旦没被拉伸成视口大小（祖先带了 transform/
   filter/contain 等），bottom 就是从零高度算出来的负值。改掉这个依赖。 */
.fp-launch{position:fixed;pointer-events:auto;width:var(--fp-ball,46px);height:var(--fp-ball,46px);
  border-radius:50%;display:grid;place-items:center;
  background:linear-gradient(145deg,var(--fp-accent-hi),var(--fp-accent));color:#fff;cursor:pointer;
  box-shadow:0 6px 18px var(--fp-shadow);border:2px solid var(--fp-gold);
  font-family:Georgia,"Songti SC","SimSun",serif;font-size:calc(var(--fp-ball,46px) * .41);user-select:none;
  -webkit-tap-highlight-color:transparent;}
/* 金色点缀就用在球的金边上（改 --fp-gold 立刻看得见） */
.fp-launch:hover{filter:brightness(1.06)}
.fp-launch[data-open="1"]{opacity:.35}
/* 形状：圆/方/圆角方靠 border-radius，菱形/三角/六边靠 clip-path */
.fp-launch[data-shape="circle"]{border-radius:50%}
.fp-launch[data-shape="square"]{border-radius:2px}
.fp-launch[data-shape="rounded"]{border-radius:26%}
.fp-launch[data-shape="diamond"]{clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%)}
.fp-launch[data-shape="triangle"]{clip-path:polygon(50% 4%,98% 94%,2% 94%)}
.fp-launch[data-shape="hexagon"]{clip-path:polygon(25% 4%,75% 4%,100% 50%,75% 96%,25% 96%,0 50%)}
/* 尖角形状里的字要缩小，不然会顶出边界 */
.fp-launch[data-shape="triangle"],.fp-launch[data-shape="diamond"],.fp-launch[data-shape="hexagon"]{font-size:calc(var(--fp-ball,46px) * .3)}
.fp-ball-img{width:100%;height:100%;object-fit:cover;display:block;border-radius:inherit}
/* 整块隐藏时：根节点连球一起不画 */
.fp-root[data-hidden="1"]{display:none}

/* 窗口自己 fixed 定位，left/top 由 clampToViewport() 算好后写进去。
   底色/磨砂/壁纸都在子层里（.fp-bglayer/.fp-wall/.fp-walldim），
   所以这里背景是透明的，圆角交给 CONFIG。 */
.fp-win{position:fixed;pointer-events:auto;
  background:transparent;
  border:1px solid var(--fp-border-strong);border-radius:var(--fp-radius,14px);
  box-shadow:0 18px 48px var(--fp-shadow);
  display:flex;flex-direction:column;overflow:hidden;
  min-width:var(--fp-minw,260px);min-height:var(--fp-minh,200px);
  max-width:var(--fp-maxw,calc(100vw - 16px));max-height:var(--fp-maxh,calc(100dvh - 16px));}
.fp-win[data-night="1"]{}
.fp-win[data-collapsed="1"] .fp-body,.fp-win[data-collapsed="1"] .fp-foot{display:none}
.fp-win[data-busy="1"]{cursor:progress}

.fp-head{display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:move;touch-action:none;
  background:linear-gradient(180deg,var(--fp-accent-soft),transparent);
  border-bottom:1px solid var(--fp-border);}
.fp-title{flex:1;min-width:0;font-family:Georgia,"Songti SC","STSong","SimSun",serif;font-size:14px;
  color:var(--fp-indigo);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:.4px}
.fp-title small{display:block;font-family:inherit;font-size:10px;color:var(--fp-ok);
  letter-spacing:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fp-icon{width:24px;height:24px;border-radius:7px;border:1px solid var(--fp-border);background:var(--fp-bg-raised);
  color:var(--fp-text-dim);display:grid;place-items:center;cursor:pointer;font-size:12px;flex:0 0 auto}
.fp-icon:hover{color:var(--fp-accent);border-color:var(--fp-border-strong)}

/* 关键：子项必须 flex:0 0 auto。body 高度固定时，默认的 flex-shrink:1 会把每个模块
   压成 2px（只剩边框），标题就点不到了——这就是「点名字展不开」的真凶。 */
.fp-body{flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain;padding:8px 10px 10px;
  display:flex;flex-direction:column;gap:7px}
.fp-body > *{flex:0 0 auto}
.fp-seclabel{font-size:10.5px;font-weight:600;color:var(--fp-text-faint);letter-spacing:.8px;padding:7px 2px 0}
.fp-seclabel:first-child{padding-top:0}

.fp-mod{border:1px solid var(--fp-border);border-radius:10px;background:var(--fp-bg-raised);overflow:hidden}
.fp-mod[data-open="1"]{border-color:var(--fp-border-strong);box-shadow:0 2px 10px var(--fp-shadow)}
.fp-modhead{display:flex;align-items:center;gap:7px;padding:7px 9px;cursor:pointer;user-select:none}
.fp-modhead:hover{background:var(--fp-accent-soft)}
.fp-mod[data-open="1"] .fp-modhead{border-bottom:1px solid var(--fp-border);background:var(--fp-bg-inset)}
.fp-chev{flex:0 0 auto;color:var(--fp-text-faint);font-size:9px;transition:transform .15s}
.fp-mod[data-open="1"] .fp-chev{transform:rotate(90deg);color:var(--fp-accent)}
.fp-modlabel{font-size:12px;font-weight:600;color:var(--fp-text);flex:1 1 auto;min-width:0;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fp-modstate{flex:0 1 auto;max-width:50%;font-size:10.5px;color:var(--fp-accent);text-align:right;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fp-modstate[data-empty="1"]{color:var(--fp-text-faint)}
.fp-modbody{padding:9px;display:flex;flex-direction:column;gap:7px;background:var(--fp-bg)}
.fp-modnote{font-size:10.5px;color:var(--fp-text-faint);line-height:1.5}

/* 破甲档位 */
.fp-tunables{display:flex;flex-direction:column;gap:9px;padding-top:8px;border-top:1px dashed var(--fp-border)}
.fp-tunable{display:flex;flex-direction:column;gap:5px;padding:7px 8px;border-radius:8px;
  border:1px solid var(--fp-border);background:var(--fp-bg-raised)}
.fp-tunlabel{font-size:11.5px;font-weight:600;color:var(--fp-text)}
.fp-textarea{width:100%;box-sizing:border-box;min-height:110px;resize:vertical;padding:6px 8px;
  border-radius:8px;border:1px solid var(--fp-input-border);background:var(--fp-input-bg);
  color:var(--fp-text);font:inherit;font-size:11.5px;line-height:1.5}
.fp-textarea:focus{outline:none;border-color:var(--fp-accent);box-shadow:0 0 0 3px var(--fp-accent-soft)}

/* 可编辑条目的输入框块 */
.fp-editor{display:flex;flex-direction:column;gap:6px}
.fp-editor .fp-textarea{min-height:132px;background:var(--fp-input-bg)}
.fp-editbtn{border-style:dashed;color:var(--fp-text-dim)}
.fp-editbtn[data-on="1"]{border-style:solid}

/* 长按条目改正文：按住时先给反馈，松手前一直亮着（.fp-hold 由手势加上去） */
.fp-sw{touch-action:pan-y}
.fp-sw.fp-hold{border-color:var(--fp-accent);background:var(--fp-accent-soft);
  box-shadow:0 0 0 3px var(--fp-accent-soft);transform:scale(.97)}
.fp-sw[data-subtle="1"]{font-size:11px;color:var(--fp-text-faint)}

/* 长按开出来的正文编辑器：盖在窗口里的一层（点空白处关掉） */
.fp-editmask{position:absolute;inset:0;z-index:5;display:flex;align-items:center;justify-content:center;
  padding:14px;background:rgba(0,0,0,0.28);border-radius:inherit}
.fp-editbox{display:flex;flex-direction:column;gap:7px;width:100%;max-height:100%;overflow:auto;
  padding:11px;border-radius:12px;border:1px solid var(--fp-border-strong);background:var(--fp-bg-raised);
  box-shadow:0 8px 28px var(--fp-shadow)}
.fp-editbox .fp-textarea{min-height:180px}
.fp-editname{font-size:12.5px;color:var(--fp-text)}

.fp-rowhead{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}
.fp-note{font-size:10.5px;color:var(--fp-text-faint)}
.fp-badge{font-size:10px;padding:0 5px;border-radius:99px;border:1px solid var(--fp-border-strong);
  color:var(--fp-accent);background:var(--fp-accent-soft);flex:0 0 auto}
.fp-badge[data-kind="miss"]{color:var(--fp-warn);border-color:var(--fp-warn);background:transparent}

.fp-select{width:100%;box-sizing:border-box;padding:5px 7px;border-radius:8px;
  border:1px solid var(--fp-input-border);background:var(--fp-input-bg);color:var(--fp-text);font:inherit;font-size:12px;
  cursor:pointer}
.fp-select:focus{outline:none;border-color:var(--fp-accent);box-shadow:0 0 0 3px var(--fp-accent-soft)}

.fp-switches{display:flex;flex-wrap:wrap;gap:5px}
.fp-sw{display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:99px;
  border:1px solid var(--fp-border);background:var(--fp-bg);color:var(--fp-text-dim);
  font-size:11.5px;cursor:pointer;user-select:none;max-width:100%}
.fp-sw span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:230px}
.fp-sw i{font-style:normal;font-size:9.5px;color:var(--fp-text-faint)}
.fp-sw:hover{border-color:var(--fp-border-strong)}
.fp-sw[data-on="1"]{background:var(--fp-accent-soft);border-color:var(--fp-accent);color:var(--fp-accent)}
.fp-sw[data-on="1"] i{color:var(--fp-accent)}
.fp-sw[data-miss="1"]{opacity:.42;cursor:not-allowed;text-decoration:line-through}

.fp-foot{border-top:1px solid var(--fp-border);padding:8px 10px;display:flex;flex-direction:column;gap:7px;
  background:var(--fp-bg-inset)}
.fp-chips{display:flex;flex-wrap:wrap;gap:5px;align-items:center}
.fp-chip{font-size:11px;padding:3px 9px;border-radius:99px;border:1px solid var(--fp-border-strong);
  background:var(--fp-bg);color:var(--fp-text);cursor:pointer}
.fp-chip:hover{border-color:var(--fp-accent);color:var(--fp-accent)}
.fp-mini{font-size:11px;padding:3px 9px;border-radius:8px;border:1px solid var(--fp-border-strong);
  background:var(--fp-bg);color:var(--fp-text-dim);cursor:pointer}
.fp-mini:hover{color:var(--fp-accent);border-color:var(--fp-accent)}
.fp-warnbox{margin:0 0 8px;padding:7px 9px;border-radius:8px;border:1px solid var(--fp-warn);
  background:var(--fp-accent-soft);color:var(--fp-warn);font-size:11.5px}
/* 出错（读不到预设、注入失败）单独用危险色——和"缺少某些条目"这种提醒区分开 */
.fp-warnbox[data-kind="err"]{border-color:var(--fp-danger);color:var(--fp-danger)}

.fp-resize{position:absolute;right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;touch-action:none}
.fp-resize::after{content:"";position:absolute;right:3px;bottom:3px;width:7px;height:7px;
  border-right:2px solid var(--fp-border-strong);border-bottom:2px solid var(--fp-border-strong)}

.fp-toast{position:fixed;left:50%;bottom:26px;transform:translate(-50%,14px);z-index:10100;
  padding:7px 14px;border-radius:99px;font-size:12px;background:#2b2230;color:#fff;opacity:0;
  pointer-events:none;transition:opacity .18s,transform .18s;max-width:80vw;text-align:center}
.fp-toast[data-kind="ok"]{background:var(--fp-accent,#d4577f)}
.fp-toast[data-kind="err"]{background:#b8403c}
.fp-toast-show{opacity:1;transform:translate(-50%,0)}
`;
    /* 1) 整体缩放（≥3px 的字面量乘一下）  2) 把 CONFIG 的量写成 CSS 变量（放最后，覆盖前面的默认值）
       顺序很重要：先缩放静态 CSS，再追加变量覆盖 —— 变量里的 px 不该被缩放。 */
    const cfgVars = [
      `--fp-radius:${CFG.layout.radius}px`,
      `--fp-opacity:${CFG.layout.opacity}`,
      `--fp-blur:${CFG.layout.blur}px`,
      `--fp-ball:${CFG.ball.size}px`,
      `--fp-wall-opacity:${hasWallpaper() ? CFG.wallpaper.opacity : 0}`,
      `--fp-wall-blur:${CFG.wallpaper.blur}px`,
      `--fp-wall-dim:${hasWallpaper() ? CFG.wallpaper.dim : 0}`,
      `--fp-wall-dim-color:${CFG.wallpaper.dimColor}`,
      `--fp-minw:${CFG.window.minW}px`,
      `--fp-minh:${CFG.window.minH}px`,
      `--fp-maxw:${CFG.window.maxW ? CFG.window.maxW + 'px' : 'calc(100vw - 16px)'}`,
      `--fp-maxh:${CFG.window.maxH ? CFG.window.maxH + 'px' : 'calc(100dvh - 16px)'}`,
    ].join(';');
    s.textContent = scaleFontCss(scaleCss(raw, CFG.layout.scale), CFG.layout.fontScale)
      + `\n.fp-root{${cfgVars};}\n`
      + `.fp-win{min-width:var(--fp-minw,260px);min-height:var(--fp-minh,200px);`
      + `max-width:var(--fp-maxw,calc(100vw - 16px));max-height:var(--fp-maxh,calc(100dvh - 16px));}\n`;
  }

  /* ── 渲染 ───────────────────────────────────────────────────────── */
  function render() {
    /* body 还没就绪时不要硬插，更不要抛异常——抛出去会让整个面板什么都不画。
       等一下就绪再画。 */
    if (!HOST.doc.body) {
      whenHostReady().then((ready) => { if (ready) render(); });
      return;
    }
    try {
      ensureStyle();
    } catch (e) {
      console.warn('[芳乃面板] 注入样式失败', e);
    }
    /* 全量重渲染会把滚动位置冲掉（改一个选项就跳回顶部）。先记住，画完再还回去。 */
    const prevScroll = state.bodyEl ? state.bodyEl.scrollTop : 0;
    let root = HOST.doc.getElementById(ID + '-root');
    if (!root) {
      root = el('div', 'fp-root');
      root.id = ID + '-root';
      HOST.doc.body.appendChild(root);
    }
    root.dataset.theme = state.night ? 'night' : 'day';
    root.dataset.hidden = state.hidden ? '1' : '0';
    root.textContent = '';

    /* 悬浮球：形状 / 内容（字或图）/ 可拖 / 可整块隐藏 */
    if (state.hidden) return;                    // 整块隐藏：连球一起不画
    const ball = el('div', 'fp-launch');
    ball.dataset.open = state.open ? '1' : '0';
    ball.dataset.shape = CFG.ball.shape;
    ball.title = (state.open ? '收起芳乃面板' : '打开芳乃面板') + '（可拖动；Ctrl+Shift+F 整块隐藏）';
    if (CFG.ball.content.kind === 'image') {
      const img = el('img', 'fp-ball-img');
      img.src = CFG.ball.content.image;
      img.alt = '';
      ball.appendChild(img);
    } else {
      ball.textContent = CFG.ball.glyph;
    }
    /* 坐标：优先用上次拖到的位置（夹回视口），否则按当前视口算默认位。
       不依赖容器被拉伸，也不依赖 bottom/env 的解析。 */
    {
      const docEl = HOST.doc.documentElement || {};
      const vw = HOST.win.innerWidth || docEl.clientWidth || 360;
      const vh = HOST.win.innerHeight || docEl.clientHeight || 640;
      const def = {
        x: Math.max(8, Math.min(12, vw - CFG.ball.size - 14)),
        y: Math.max(8, vh - 96 - CFG.ball.size - 8),
      };
      const p = clampBall(readLS(LS.ball, null), def, CFG.ball.size, vw, vh);
      ball.style.left = p.x + 'px';
      ball.style.top = p.y + 'px';
    }
    ball.addEventListener('click', () => {
      /* 刚拖完的那一下 pointerup 之后会跟一个 click：别把它当成"点开面板" */
      if (ballMoved) { ballMoved = false; return; }
      state.open = !state.open;
      writeLS(LS.open, state.open);
      render();
    });
    root.appendChild(ball);
    /* 球自己也能拖（窗口那个是标题栏上的 makeDraggable，两者坐标分开存） */
    makeDraggable(ball, ball, LS.ball, () => { ballMoved = true; });
    if (!state.open) return;

    /* 窗 */
    const win = el('div', 'fp-win');
    win.id = ID + '-win';
    win.dataset.collapsed = state.collapsed ? '1' : '0';
    win.dataset.night = state.night ? '1' : '0';

    /* 底色层 / 壁纸层 / 压暗层（顺序即层级，见样式注释）。
       壁纸为空时壁纸层 opacity 是 0，等于不存在。 */
    win.appendChild(el('div', 'fp-bglayer'));
    if (hasWallpaper()) {
      const wall = el('div', 'fp-wall');
      wall.id = ID + '-wall';
      wall.dataset.fit = CFG.wallpaper.fit;
      wall.style.backgroundImage = `url("${CFG.wallpaper.url.replace(/"/g, '%22')}")`;
      win.appendChild(wall);
      win.appendChild(el('div', 'fp-walldim'));
    }

    /* 位置与尺寸一律先夹回视口。
       存的宽高/坐标可能是桌面上留下的（或手机横竖屏切换前的），
       直接照用会把窗口整个推到屏幕外——表现就是"打开了但什么都看不见"。 */
    const box = clampToViewport(readLS(LS.pos, null), readLS(LS.size, null));
    win.style.width = box.w + 'px';
    win.style.height = box.h + 'px';
    if (box.x === null) {
      win.style.right = '12px';
      win.style.top = box.y + 'px';
    } else {
      win.style.left = box.x + 'px';
      win.style.top = box.y + 'px';
    }

    /* 头 */
    const head = el('div', 'fp-head');
    const title = el('div', 'fp-title', CONFIG?.title || '🌸 芳乃 · 预设面板');
    const sub = el('small', '', state.ready
      ? `${state.presetName}　·　${state.prompts.filter(on).length}/${state.prompts.length} 条开启`
      : (state.lastError || '正在读取预设…'));
    title.appendChild(sub);
    head.appendChild(title);

    const nightBtn = el('div', 'fp-icon', state.night ? '☀' : '🌙');
    nightBtn.title = state.night ? '切到白天配色' : '切到夜间配色';
    nightBtn.addEventListener('click', () => { state.night = !state.night; writeLS(LS.night, state.night); render(); });
    head.appendChild(nightBtn);

    const minBtn = el('div', 'fp-icon', state.collapsed ? '▢' : '—');
    minBtn.title = state.collapsed ? '展开' : '收起';
    minBtn.addEventListener('click', () => { state.collapsed = !state.collapsed; render(); });
    head.appendChild(minBtn);

    const closeBtn = el('div', 'fp-icon', '✕');
    closeBtn.title = '关闭（点悬浮球再打开）';
    closeBtn.addEventListener('click', () => { state.open = false; writeLS(LS.open, false); render(); });
    head.appendChild(closeBtn);
    win.appendChild(head);

    /* 体 */
    const body = el('div', 'fp-body');
    if (HOST.fellBack) {
      const box = el('div', 'fp-warnbox',
        '⚠ 拿不到外层页面的访问权（跨域），面板被挂在了内层 iframe 里——如果你看不到它，这就是原因。'
        + '把 window.__FANO_PANEL__.diagnose() 的结果发出来可以确认。');
      body.appendChild(box);
    }
    if (!state.ready) {
      const box = el('div', 'fp-warnbox', state.lastError || '正在读取预设…');
      if (state.lastError) box.dataset.kind = 'err';
      body.appendChild(box);
    }
    for (const sec of SECTIONS) {
      body.appendChild(el('div', 'fp-seclabel', sec.title));
      for (const gid of sec.groups) {
        const g = GROUPS.find((x) => x.id === gid);
        if (g) body.appendChild(renderGroup(g));
      }
    }
    win.appendChild(body);

    /* 长按条目开出来的正文编辑器：盖在窗口内容之上的一层 */
    if (state.editTarget !== null && find(state.editTarget)) win.appendChild(entryEditorBox(state.editTarget));
    else if (state.editTarget !== null) state.editTarget = null;   // 那一条没了就自己收起来

    /* 脚 */
    const foot = el('div', 'fp-foot');
    const chips = el('div', 'fp-chips');
    chips.appendChild(el('span', 'fp-note', '小方案：'));
    const ps = plans();
    if (!ps.length) chips.appendChild(el('span', 'fp-note', '（还没存）'));
    for (const plan of ps) {
      const c = el('span', 'fp-chip', plan.name);
      c.title = '点一下应用；右键删除';
      c.addEventListener('click', () => applyPlan(plan));
      c.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        writeLS(LS.plans, plans().filter((x) => x.id !== plan.id));
        render(); toast('已删除「' + plan.name + '」', 'ok');
      });
      chips.appendChild(c);
    }
    chips.appendChild(el('span', 'fp-chip', '＋存为小方案')).addEventListener('click', savePlan);
    foot.appendChild(chips);

    const actions = el('div', 'fp-chips');
    actions.appendChild(el('span', 'fp-mini', '刷新')).addEventListener('click', () => reload(true));
    actions.appendChild(el('span', 'fp-mini', state.expanded.size ? '全部折起' : '全部展开')).addEventListener('click', () => {
      if (state.expanded.size) state.expanded.clear();
      else for (const g of GROUPS) if (g.mode !== 'hidden') state.expanded.add(g.id);
      writeLS(LS.expanded, [...state.expanded]);
      render();
    });
    actions.appendChild(el('span', 'fp-mini', '本组全关')).addEventListener('click', () => {
      const changes = managedNames().filter((n) => on(find(n))).map((n) => ({ name: n, enabled: false }));
      apply(changes, '已关掉面板管理的全部条目');
    });
    actions.appendChild(el('span', 'fp-note', `v${VERSION}（${managedNames().length} 条受管）`));
    foot.appendChild(actions);
    win.appendChild(foot);

    const rz = el('div', 'fp-resize');
    rz.title = '拖动缩放';
    win.appendChild(rz);

    root.appendChild(win);
    state.bodyEl = body;
    if (prevScroll) {
      body.scrollTop = prevScroll;
      /* 有些浏览器在元素刚插入时会重置 scrollTop，下一帧再兜一次 */
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => { body.scrollTop = prevScroll; });
      }
    }
    makeDraggable(win, head);
    makeResizable(win, rz);

    /* 画完校验一次悬浮球位置：跑飞了就换挂载点重试（见 afterRenderPlacement）。
       用户开着的窗口也顺手夹一次，避免它落到屏外。 */
    afterRenderPlacement(root, ball);
    if (state.open) {
      try {
        const r = win.getBoundingClientRect();
        const docEl = HOST.doc.documentElement || {};
        const vw = HOST.win.innerWidth || docEl.clientWidth || 360;
        const vh = HOST.win.innerHeight || docEl.clientHeight || 640;
        if (r.left < 0 || r.left + r.width > vw + 1) {
          win.style.left = `${Math.max(8, Math.min(parseFloat(win.style.left) || 8, vw - r.width - 8))}px`;
        }
        if (r.top < 0 || r.top + 40 > vh) {
          win.style.top = `${Math.max(8, Math.min(parseFloat(win.style.top) || 8, vh - 96))}px`;
        }
      } catch { /* 拿不到几何就算了 */ }
    }
  }

  /** 折叠状态下那一行右边显示的"现在是什么"——不展开也能看清当前状态。 */
  function groupStateText(g) {
    if (g.mode === 'bundle') {
      const active = currentBundleOption(g);
      const opt = g.options.find((o) => o.id === active);
      if (!opt) return '';
      if (active === 'manual') return '手动 · 全关';
      const n = opt.members.filter((m) => find(m)).length;
      const tuned = (opt.tunables || []).filter((t) => t.members.some((m) => { const p = find(m); return p && on(p); })).length;
      return `${opt.source || opt.label} · ${n} 条${tuned ? ` · 档位 ${tuned}` : ''}`;
    }
    if (g.mode === 'fixed') return `${g.members.length} 条 · 不碰`;
    if (g.mode === 'editable') {
      const present = g.members.filter((m) => find(m));
      const onCount = present.filter((m) => on(find(m))).length;
      return `${onCount}/${present.length} 条启用 · 可填写`;
    }
    if (g.mode === 'single') {
      const cur = g.members.find((m) => { const p = find(m); return p && on(p); });
      return cur ? LBL(cur) : '未选';
    }
    const onNames = g.members.filter((m) => { const p = find(m); return p && on(p); });
    if (!onNames.length) return `0/${g.members.length} 开`;
    const head = onNames.slice(0, 2).map(LBL).join('、');
    return `${onNames.length}/${g.members.length} · ${head}${onNames.length > 2 ? ` +${onNames.length - 2}` : ''}`;
  }

  /** 一个档位（tunable）：单选下拉 / 多选开关 / 正文编辑框。 */
  function renderTunable(g, option, t) {
    const wrap = el('div', 'fp-tunable');
    const head = el('div', 'fp-rowhead');
    head.appendChild(el('span', 'fp-tunlabel', t.label));
    const onNames = t.members.filter((m) => { const p = find(m); return p && on(p); });
    head.appendChild(el('span', 'fp-badge', t.ensureOne ? '必选一' : (t.mode === 'text' ? '需填内容' : '可多选')));
    if (t.mode === 'multi' || t.mode === 'text') {
      head.appendChild(el('span', 'fp-note', `${onNames.length}/${t.members.length} 开`));
    }
    wrap.appendChild(head);

    const miss = t.members.filter((m) => !find(m)).length;
    if (miss) {
      const b = el('span', 'fp-badge', '缺' + miss);
      b.dataset.kind = 'miss';
      head.appendChild(b);
    }

    if (t.mode === 'text') {
      const name = t.members[0];
      if (!find(name)) {
        wrap.appendChild(el('div', 'fp-modnote', `当前预设里没有「${LBL(name)}」。`));
        return wrap;
      }
      wrap.appendChild(editorBlock(name, { hint: t.note }));
      return wrap;
    }

    if (t.mode === 'single') {
      const sel = el('select', 'fp-select');
      if (t.optional) {
        const noneOpt = el('option', '', '（不使用）');
        noneOpt.value = '';
        sel.appendChild(noneOpt);
      }
      let cur = '';
      for (const m of t.members) {
        const p = find(m);
        const opt = el('option', '', p ? `${LBL(m)}　(${sizeLabel(chars(p.content))})` : `${LBL(m)}　（缺失）`);
        opt.value = m;
        if (p && on(p)) { opt.selected = true; cur = m; }
        if (!p) opt.disabled = true;
        sel.appendChild(opt);
      }
      sel.value = cur;
      sel.addEventListener('change', () => pickTunableSingle(g, t, sel.value));
      wrap.appendChild(sel);
      /* 同 single 组：档位的"条目行"放在下拉框下面，长按改当前这一条的正文 */
      if (cur) wrap.appendChild(entryRows([cur], { subtle: true }));
      if (cur && EDITABLE[cur]) {
        const sub = el('div', 'fp-tunable');
        sub.appendChild(el('div', 'fp-tunlabel', `${LBL(cur)} · 自己填`));
        sub.appendChild(editorBlock(cur, EDITABLE[cur]));
        wrap.appendChild(sub);
      }
      appendOpenEditors(wrap, t.members);
      if (t.note) wrap.appendChild(el('div', 'fp-modnote', t.note));
      return wrap;
    }

    const grid = el('div', 'fp-switches');
    for (const m of t.members) {
      const p = find(m);
      const sw = el('div', 'fp-sw');
      sw.dataset.on = p && on(p) ? '1' : '0';
      if (!p) sw.dataset.miss = '1';
      sw.appendChild(el('span', '', LBL(m)));
      if (p) sw.appendChild(el('i', '', sizeLabel(chars(p.content))));
      sw.title = p ? `${LBL(m)}\n${chars(p.content)} 字　当前：${on(p) ? '开' : '关'}` : `${LBL(m)}\n当前预设里没有这一条`;
      if (CFG.edit.longPress.enabled && p) sw.title += '\n长按这一行改它的正文';
      if (p) sw.addEventListener('click', onRowClick(() => toggleOne(m, !on(p))));
      bindLongPress(sw, m);
      grid.appendChild(sw);
      if (EDITABLE[m]) grid.appendChild(editBtn(m));
    }
    wrap.appendChild(grid);
    appendOpenEditors(wrap, t.members);
    if (t.note) wrap.appendChild(el('div', 'fp-modnote', t.note));
    return wrap;
  }

  function renderGroup(g) {
    const open = state.expanded.has(g.id);
    const mod = el('div', 'fp-mod');
    mod.dataset.open = open ? '1' : '0';
    mod.dataset.group = g.id;

    const miss = g.mode === 'bundle'
      ? g.options.reduce((a, o) => a + (state.missing.get(g.id + ':' + o.id) || 0), 0)
      : (state.missing.get(g.id) || 0);

    const head = el('div', 'fp-modhead');
    head.appendChild(el('span', 'fp-chev', '▶'));
    head.appendChild(el('span', 'fp-modlabel', g.label));
    const text = groupStateText(g);
    const st = el('span', 'fp-modstate', text);
    if (!text || text === '未选' || /^0\//.test(text)) st.dataset.empty = '1';
    head.appendChild(st);
    if (miss) { const b = el('span', 'fp-badge', '缺' + miss); b.dataset.kind = 'miss'; head.appendChild(b); }
    head.title = (g.note || '') + (g.note ? '\n' : '') + '点击展开 / 折叠';
    head.addEventListener('click', () => {
      if (state.expanded.has(g.id)) state.expanded.delete(g.id);
      else state.expanded.add(g.id);
      writeLS(LS.expanded, [...state.expanded]);
      render();
    });
    mod.appendChild(head);

    if (open) mod.appendChild(renderGroupBody(g));
    return mod;
  }

  /** 展开后的内容：bundle 下拉框 / single 下拉框 / multi 开关排。 */
  function renderGroupBody(g) {
    const box = el('div', 'fp-modbody');

    /* bundle：破甲按模型分流 —— 先选骨架，再调这一套骨架的档位 */
    if (g.mode === 'bundle') {
      const active = currentBundleOption(g);
      const sel = el('select', 'fp-select');
      for (const o of g.options) {
        const miss = state.missing.get(g.id + ':' + o.id) || 0;
        const total = o.members.length;
        const opt = el('option', '', total
          ? `${o.label}　(骨架 ${total - miss}/${total} 条)`
          : `${o.label}　（无骨架条目）`);
        opt.value = o.id;
        if (o.id === active) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.addEventListener('change', () => pickBundle(g, sel.value));
      box.appendChild(sel);

      const opt = g.options.find((o) => o.id === active);
      if (opt && opt.tunables && opt.tunables.length) {
        box.appendChild(el('div', 'fp-modnote', `${opt.label}（${opt.source || '—'}）的档位：`));
        const tun = el('div', 'fp-tunables');
        for (const t of opt.tunables) tun.appendChild(renderTunable(g, opt, t));
        box.appendChild(tun);
      } else if (opt && active !== 'manual') {
        box.appendChild(el('div', 'fp-modnote', '这一套没有可调档位。'));
      }

      const others = g.options
        .filter((o) => o.id !== active && o.tunables && o.tunables.length)
        .map((o) => `${o.label} ${o.tunables.length} 项`);
      if (others.length) {
        box.appendChild(el('div', 'fp-modnote', `切到别家后可调的档位：${others.join('、')}。档位不会被切换清掉。`));
      }
      if (g.note) box.appendChild(el('div', 'fp-modnote', g.note));
      return box;
    }

    /* fixed：不给开关（酒馆内置槽位与核心结构），但**正文可以看、可以改**——
       注入位标记那几条只给看（正文必须为空）。 */
    if (g.mode === 'fixed') {
      box.appendChild(el('div', 'fp-modnote',
        `面板不碰这 ${g.members.length} 条的开关（酒馆内置槽位与核心结构）`
        + (CFG.edit.longPress.enabled ? '；长按名字可以看/改它的正文。' : '。')));
      box.appendChild(entryRows(g.members, { subtle: true }));
      return box;
    }

    /* editable：整块都是输入框 */
    if (g.mode === 'editable') {
      if (g.note) box.appendChild(el('div', 'fp-modnote', g.note));
      for (const m of g.members) {
        const wrap = el('div', 'fp-tunable');
        const label = el('div', 'fp-tunlabel', LBL(m));
        if (CFG.edit.longPress.enabled) {
          label.title = '长按这里可以把正文摊成一个大框改（下面这个框本来就是可改的）';
          bindLongPress(label, m);
        }
        wrap.appendChild(label);
        wrap.appendChild(editorBlock(m, (g.editable || {})[m] || {}));
        box.appendChild(wrap);
      }
      return box;
    }

    /* single：下拉框 */
    if (g.mode === 'single') {
      const sel = el('select', 'fp-select');
      const noneOpt = el('option', '', '（不使用）');
      noneOpt.value = '';
      sel.appendChild(noneOpt);
      let cur = '';
      for (const m of g.members) {
        const p = find(m);
        const opt = el('option', '', p ? `${LBL(m)}　(${sizeLabel(chars(p.content))})` : `${LBL(m)}　（缺失）`);
        opt.value = m;
        if (p && on(p)) { opt.selected = true; cur = m; }
        if (!p) opt.disabled = true;
        sel.appendChild(opt);
      }
      sel.value = cur;
      sel.addEventListener('change', () => pickSingle(g, sel.value));
      box.appendChild(sel);
      /* 下拉框是原生控件（一按就弹系统选择器），长按挂不上去；
         所以它的"条目行"放在下面这一行：长按 = 改当前选中那一条的正文。 */
      if (cur) box.appendChild(entryRows([cur], { subtle: true }));
      else if (CFG.edit.longPress.enabled) box.appendChild(el('div', 'fp-modnote', '选中一条之后，下面会出现它的条目行——长按可以看/改它的正文。'));
      /* 选中的是可编辑条目就直接把输入框摊开，不用再去别处找 */
      if (cur && EDITABLE[cur]) {
        const wrap = el('div', 'fp-tunable');
        wrap.appendChild(el('div', 'fp-tunlabel', `${LBL(cur)} · 自己填`));
        wrap.appendChild(editorBlock(cur, EDITABLE[cur]));
        box.appendChild(wrap);
      } else {
        const eds = g.members.filter((m) => EDITABLE[m]);
        if (eds.length) box.appendChild(el('div', 'fp-modnote',
          `含可编辑项：${eds.map(LBL).join('、')}——选中后这里会出现输入框。`));
      }
      appendOpenEditors(box, g.members);
      if (g.parked) box.appendChild(el('div', 'fp-modnote', '备选库：默认不在条目列表里，选中即启用。'));
      if (g.note) box.appendChild(el('div', 'fp-modnote', g.note));
      return box;
    }

    /* multi：开关排 */
    if (g.parked) box.appendChild(el('div', 'fp-modnote', '备选库：默认不在条目列表里，点开即加入。'));
    const grid = el('div', 'fp-switches');
    for (const m of g.members) {
      const p = find(m);
      const sw = el('div', 'fp-sw');
      sw.dataset.on = p && on(p) ? '1' : '0';
      if (!p) sw.dataset.miss = '1';
      sw.appendChild(el('span', '', LBL(m)));
      if (p) sw.appendChild(el('i', '', sizeLabel(chars(p.content))));
      sw.title = p ? `${LBL(m)}\n${chars(p.content)} 字　当前：${on(p) ? '开' : '关'}` : `${LBL(m)}\n当前预设里没有这一条`;
      if (CFG.edit.longPress.enabled && p) sw.title += '\n长按这一行改它的正文';
      if (p) sw.addEventListener('click', onRowClick(() => toggleOne(m, !on(p))));
      bindLongPress(sw, m);
      grid.appendChild(sw);
      if (EDITABLE[m]) grid.appendChild(editBtn(m));
    }
    box.appendChild(grid);
    appendOpenEditors(box, g.members);
    if (g.note) box.appendChild(el('div', 'fp-modnote', g.note));
    return box;
  }

  /* ── 拖动 / 缩放 ────────────────────────────────────────────────── */
  /* 指针监听只挂一次。之前每次 render() 都往 window 上再挂两个 pointermove/pointerup，
     拖一会儿就堆上百个监听器。 */
  const gesture = { mode: null, target: null, sx: 0, sy: 0, ox: 0, oy: 0, ow: 0, oh: 0, storeKey: null, moved: false, onDrag: null };
  let gestureBound = false;
  /** 球刚被拖过：随后的那次 click 不该被当成"点开面板" */
  let ballMoved = false;

  /** 球的坐标夹回视口（存的坐标可能是别的视口留下的——手机上会整个跑出屏幕） */
  function clampBall(stored, def, size, vw, vh) {
    const x = stored && Number.isFinite(stored.x) ? stored.x : def.x;
    const y = stored && Number.isFinite(stored.y) ? stored.y : def.y;
    return {
      x: Math.round(Math.max(4, Math.min(vw - size - 4, x))),
      y: Math.round(Math.max(4, Math.min(vh - size - 4, y))),
    };
  }

  function bindGestureOnce() {
    if (gestureBound) return;
    gestureBound = true;
    /* Ctrl+Shift+F：整块隐藏 / 恢复。藏起来之后球也没了，所以必须留一个键盘出口，
       否则"隐藏"就等于把自己关在门外（只能靠控制台）。 */
    HOST.doc.addEventListener('keydown', (e) => {
      if (!e.ctrlKey || !e.shiftKey) return;
      if (!(e.key === 'F' || e.key === 'f')) return;
      e.preventDefault();
      state.hidden = !state.hidden;
      if (!state.hidden) state.open = true;
      if (state.persistHidden) writeLS(LS.hidden, state.hidden);
      render();
    });
    HOST.win.addEventListener('pointermove', (e) => {
      if (!gesture.mode || !gesture.target) return;
      if (gesture.mode === 'drag') {
        const x = Math.max(4, Math.min(HOST.win.innerWidth - 80, gesture.ox + e.clientX - gesture.sx));
        const y = Math.max(4, Math.min(HOST.win.innerHeight - 40, gesture.oy + e.clientY - gesture.sy));
        /* 挪过 3px 就算"拖过"，用来把拖动和点击分开（球上这两个手势撞在一起） */
        if (Math.abs(e.clientX - gesture.sx) + Math.abs(e.clientY - gesture.sy) > 3) gesture.moved = true;
        gesture.target.style.left = x + 'px';
        gesture.target.style.top = y + 'px';
        gesture.target.style.right = 'auto';
      } else {
        const w = Math.max(260, Math.min(HOST.win.innerWidth - 16, gesture.ow + e.clientX - gesture.sx));
        const h = Math.max(200, Math.min(HOST.win.innerHeight - 16, gesture.oh + e.clientY - gesture.sy));
        gesture.target.style.width = w + 'px';
        gesture.target.style.height = h + 'px';
      }
    });
    HOST.win.addEventListener('pointerup', () => {
      if (gesture.mode && gesture.target) {
        const r = gesture.target.getBoundingClientRect();
        /* 落盘的键由发起拖动的那个元素决定：窗口是 LS.pos，悬浮球是 LS.ball */
        if (gesture.mode === 'drag') writeLS(gesture.storeKey || LS.pos, { x: Math.round(r.left), y: Math.round(r.top) });
        else writeLS(LS.size, { w: Math.round(r.width), h: Math.round(r.height) });
        if (gesture.moved && gesture.onDrag) { try { gesture.onDrag(); } catch { /* 忽略 */ } }
      }
      gesture.mode = null;
      gesture.target = null;
      gesture.moved = false;
      gesture.onDrag = null;
    });
  }

  function makeDraggable(win, handle, storeKey = LS.pos, onDrag = null) {
    bindGestureOnce();
    handle.addEventListener('pointerdown', (e) => {
      if (e.target.classList && e.target.classList.contains('fp-icon')) return;
      const r = win.getBoundingClientRect();
      gesture.mode = 'drag';
      gesture.target = win;
      gesture.storeKey = storeKey;
      gesture.onDrag = onDrag;
      gesture.moved = false;
      gesture.sx = e.clientX; gesture.sy = e.clientY;
      gesture.ox = r.left; gesture.oy = r.top;
      handle.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    });
  }

  function makeResizable(win, grip) {
    bindGestureOnce();
    grip.addEventListener('pointerdown', (e) => {
      const r = win.getBoundingClientRect();
      gesture.mode = 'resize';
      gesture.target = win;
      gesture.sx = e.clientX; gesture.sy = e.clientY;
      gesture.ow = r.width; gesture.oh = r.height;
      grip.setPointerCapture?.(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    });
  }

  /* ── 启动 ───────────────────────────────────────────────────────── */
  const prev = window.__FANO_PANEL__;
  if (prev && typeof prev.destroy === 'function') attempt('destroy previous', () => prev.destroy());

  /* 屏幕旋转 / 键盘弹出 / 窗口缩放后重新夹一次位置，免得窗口留在屏外。
     监听只挂一次（挂在宿主窗口上）。 */
  let resizeTimer = null;
  const onViewportChange = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.open) render(); }, 180);
  };
  attempt('bind viewport listeners', () => {
    HOST.win.addEventListener('resize', onViewportChange);
    HOST.win.addEventListener('orientationchange', onViewportChange);
  }, undefined);

  window.__FANO_PANEL__ = {
    version: VERSION,
    /** 生效中的外观配置（含夹取后的值）——预设生成器的「面板外观」用它做对照。 */
    config: () => ({ raw: CONFIG, effective: CFG, wallpaper: hasWallpaper() }),
    /** 这份面板有哪些能力（编辑器导出前检查、以及"这份面板是不是新版"都看这个）。 */
    caps: () => ({ longPressEdit: CFG.edit.longPress.enabled === true, longPressMs: CFG.edit.longPress.ms }),
    /** 长按条目的那条路，程序化入口（给控制台与测试用；界面上就是长按）。 */
    editEntry: (name) => openEntryEditor(name),
    closeEditor: () => closeEntryEditor(),
    reload: () => reload(true),
    open: () => { state.open = true; writeLS(LS.open, true); render(); },
    close: () => { state.open = false; writeLS(LS.open, false); render(); },
    /** 卡住了就调这个：清掉存的位置/尺寸/开关状态，并把面板拉回默认样子。 */
    reset() {
      ['_pos_v1', '_size_v1', '_open_v1', '_expanded_v1', '_collapsed_v1', '_night_v1', '_ball_v1', '_hidden_v1'].forEach((suffix) => {
        try { localStorage.removeItem(ID + suffix); } catch { /* 忽略 */ }
      });
      state.open = true;
      state.collapsed = false;
      state.hidden = false;
      state.persistHidden = false;
      state.expanded = new Set();
      state.bodyEl = null;
      try { HOST.doc.getElementById(ID + '-root')?.remove(); } catch { /* 忽略 */ }
      render();
      return '已重置：位置/尺寸/开关状态都恢复默认';
    },
    /* ── 整块隐藏（连球一起藏）──────────────────────────────────────
       默认**不落盘**：刷新就回来。想让"隐藏"一直记住，显式 persistHidden(true)。
       恢复手段三条：Ctrl+Shift+F、控制台 __FANO_PANEL__.show()、或 persistHidden(false) 后刷新。 */
    hide() {
      state.hidden = true;
      if (state.persistHidden) writeLS(LS.hidden, true);
      render();
      return '已隐藏（Ctrl+Shift+F 或 __FANO_PANEL__.show() 恢复）';
    },
    show() {
      state.hidden = false;
      state.open = true;
      if (state.persistHidden) writeLS(LS.hidden, false);
      render();
      return '已显示';
    },
    /** 要"刷新也保持隐藏"就传 true；传 false 恢复成"只在本次会话有效" */
    persistHidden(v) {
      state.persistHidden = !!v;
      try { if (v) writeLS(LS.hidden, !!state.hidden); else localStorage.removeItem(LS.hidden); } catch { /* 忽略 */ }
      return state.persistHidden ? '隐藏状态会记住（刷新也保持）' : '隐藏状态只在本次会话有效';
    },
    isHidden: () => !!state.hidden,
    groups: GROUPS,
    thinkingTags: THINKING_TAGS,
    /** 手机上看不见面板时，让用户把这段结果发我，一眼就能定位是哪一种情况。 */
    diagnose() {
      const rootEl = HOST.doc.getElementById(ID + '-root');
      let launchInDom = false;
      try {
        launchInDom = !!(rootEl && typeof rootEl.querySelector === 'function' && rootEl.querySelector('.fp-launch'));
      } catch { /* 某些宿主没实现 querySelector，忽略即可 */ }
      return {
        version: VERSION,
        host: {
          mountedOn: HOST.doc === document ? '本地文档' : '外层文档',
          depth: HOST.depth,
          crossOriginFallback: HOST.fellBack,
          bodyReady: !!HOST.doc.body,
          viewport: `${HOST.win.innerWidth}×${HOST.win.innerHeight}`,
        },
        state: {
          open: state.open,
          ready: state.ready,
          preset: state.presetName,
          prompts: state.prompts.length,
          lastError: state.lastError,
        },
        rootInDom: !!rootEl,
        launchInDom,
        mountedOn: rootEl && rootEl.parentNode === HOST.doc.documentElement ? 'documentElement' : 'body',
        placement: state.lastPlacement,
        stored: { pos: readLS(LS.pos, null), size: readLS(LS.size, null), ball: readLS(LS.ball, null), hidden: readLS(LS.hidden, null) },
        hidden: { now: !!state.hidden, persisted: !!state.persistHidden },
        ball: { shape: CFG.ball.shape, kind: CFG.ball.content.kind, size: CFG.ball.size },
      };
    },
    destroy() {
      HOST.doc.getElementById(ID + '-root')?.remove();
      HOST.doc.getElementById(ID + '-toast')?.remove();
      HOST.doc.getElementById(ID + '-style')?.remove();
      if (window.__FANO_PANEL__ === this) delete window.__FANO_PANEL__;
    },
  };

  /* ══ FANO_ANTITRUNC_BEGIN ══════════════════════════════════════════════
     脚本层防截断：拦截发往 api/backends/<后端>/generate 的请求，让模型把正文
     走一个合成函数调用回传，从而绕开"纯文本流被渠道掐断"那条路。

     这一段**由构建期注入**：tools/build-panel.mjs 把 panel/src/antitrunc.js 的
     整体内容塞进下面那对标记之间（要改就去改 panel/src/antitrunc.js，
     这个文件里那一段会被覆盖）。开关读 LS.antitrunc = fano-antitrunc-v1，
     与顶部「🛡 防截断」按钮同一个键；出厂默认值来自 CONFIG.antitrunc.enabled。

     位置：放在面板本体之后、按钮接线之前——它要用 LS 与 CFG（都在上面定义好了），
     而创建实例时就按开关决定装不装拦截器，所以必须在按钮接线之前落地。
     ═══════════════════════════════════════════════════════════════════ */
  /* ── 以下是 panel/src/antitrunc.js 的内容（构建期注入；要改请改那个文件）── */
/**
 * 芳乃 · 防截断运输（脚本层）　v1.0
 * ---------------------------------------------------------------------------
 * 干什么：拦截发往 api/backends/<后端名>/generate 的请求，往请求里塞一个合成的
 *        function-call，让模型把最终正文放进那个函数的 content 参数回传；再把
 *        finish_reason 由 "tool_calls" 改回 "stop"、剥掉 tool_calls。正文于是绕过
 *        「纯文本流被渠道掐断」那条路，从函数调用参数里完整落地。
 *        OpenAI 方言读 choices[].delta.tool_calls[].function.arguments，
 *        Google 方言读 candidates[].content.parts[].functionCall.args。
 *
 * 出处：从「芳乃预设 v2.8.1」那条 13.8 万字脚本里**原样抽出**的同一段
 *       （原作是 Kemini Dramatron v3.1 的 scripts[0]，作者 Kemini）。
 *       素材：_port/antitrunc-extracted.txt。移植前后逐项对照见
 *       spec/防截断移植对照.md —— 哪些搬来了、哪些没搬、为什么，都写在里面。
 *
 * 这段代码怎么进面板：panel/src/panel-core.js 里有一对
 *       FANO_ANTITRUNC_BEGIN/END 标记，tools/build-panel.mjs 把**这个文件整体**
 *       塞进那两个标记之间。所以：
 *         · 这里不写 import / export，也不要顶层副作用（只能是一个函数声明）；
 *         · 里面所有名字都活在 createAntiTruncation() 这个函数作用域里，
 *           不会和 panel-core.js 里的同名变量打架。
 *       PORTED-CORE 标记之间那一段由 _port/mk-antitrunc.mjs 从素材**机械搬入**，
 *       手改那一段会在下次跑那个脚本时被覆盖。
 *
 * 开关：读 localStorage 里调用方传进来的键（面板传 LS.antitrunc，即
 *       fano-antitrunc-v1 —— 与 v2.8.1 共用同一个键，换过来时开关状态不丢）。
 *       默认**开启**；只认 "1"/"0"/"true"/"false"，认不出来的值一律按开启。
 * 控制台：globalThis.__FANO_ANTITRUNC__（也是 v2.8.1 那边那套：
 *       isEnabled / enable / disable / lastRun / anchor / interceptor）。
 *       enable()/disable() 会连装/卸一起做，返回 { enabled, installed }。
 *
 * @param {object} [options]
 * @param {string} [options.key]      开关的 localStorage 键（默认 fano-antitrunc-v1）
 * @param {boolean} [options.defaultOn] 键不存在时算开还是关（默认 true）
 * @param {(msg:string)=>void} [options.onNotice] 渠道明显不支持时的提醒出口
 *        （面板传 notifyUser；不传就退回 toastr / 控制台。只提醒，绝不自动关开关）
 */
function createAntiTruncation(options) {
  'use strict';
  const opt = options || {};
  /** 开关的存档键。默认值与 v2.8.1 那边是同一个：换过来时用户的选择不会丢。 */
  const LS_KEY = String(opt.key || 'fano-antitrunc-v1');
  /** 键还没写过时的出厂默认（面板传 CONFIG.antitrunc.enabled）。 */
  const DEFAULT_ON = opt.defaultOn !== false;
  /** 提醒出口：面板会传自己的 notifyUser 进来；单独用时退回 toastr / 控制台。 */
  const notice = typeof opt.onNotice === 'function' ? opt.onNotice : defaultNotice;

  /** 默认提醒出口（不接面板时用）。 */
  function defaultNotice(msg) {
    try {
      if (typeof toastr !== 'undefined' && toastr && toastr.info) { toastr.info(msg); return; }
    } catch { /* 忽略 */ }
    try {
      const t = globalThis.toastr;
      if (t && t.info) { t.info(msg); return; }
    } catch { /* 忽略 */ }
    eventLog.info(msg);
  }

  /**
   * 宿主窗口 = 从当前窗口一路往上爬到**最外层的同源窗口**。
   *
   * 为什么不能只往上看一层（v2.8.1 那版写的是 window.parent ?? window）：
   *   酒馆助手脚本本身跑在 iframe 里，手机上还可能是**嵌套** iframe；而
   *   generate 请求是**最外层那个窗口**发的。只上一层就装到中间层去了，
   *   表现是"开关开着、却什么也没拦截到"。
   *   panel-core.js 里挂载点 HOST 用的是同一套爬法（那边踩过的坑是
   *   "只查 iframe 的 document"，于是面板渲染在看不见的框里）。
   *
   * 跨域（parent.document 抛异常）时返回 null：**宁可不装**，也不把拦截器装在
   * 一个根本不发请求的窗口上，然后让开关看起来是开着的。
   */
  function hostWindow() {
    try {
      let w = window;
      let depth = 0;
      while (w.parent && w.parent !== w) {
        const next = w.parent;
        void next.document;              /* 跨域在这里就会抛 */
        w = next;
        depth++;
        if (depth > 10) break;           /* 防御：不正常的嵌套 */
      }
      return w;
    } catch {
      return null;
    }
  }

  /* ══ PORTED-CORE-BEGIN ═══════════════════════════════════════════════ */
  const eventLog = (() => {
    const toText = (v) => {
      try { return typeof v === "string" ? v : JSON.stringify(v); } catch { return String(v); }
    };
    const emit = (level, msg) => {
      const line = "[防截断] " + toText(msg);
      try {
        if (level === "warn") console.warn(line);
        else if (level === "error") console.error(line);
        else console.log(line);
      } catch { /* 控制台不可用时静默 */ }
    };
    return {
      info: (m) => emit("info", m),
      warn: (m) => emit("warn", m),
      error: (m) => emit("error", m),
      debug: (m) => emit("debug", m)
    };
  })();
  const TRANSPORT_CONTROL_ANCHOR = "<format>";
  const HIGH_SURROGATE_START = 55296;
  const HIGH_SURROGATE_END = 56319;
  const LOW_SURROGATE_START = 56320;
  const LOW_SURROGATE_END = 57343;
  const MAX_KEY_SCAN = 500;

  function readArgsContent(args) {
    if (typeof args === "string") {
      if (!args) return void 0;
      try {
        const value = JSON.parse(args).content;
        if (typeof value === "string") return value;
        return void 0;
      } catch {
        const decoder = new IncrementalContentDecoder();
        const salvaged = decoder.feed(args) + decoder.finish();
        if (!salvaged) return void 0;
        eventLog.warn("anti-truncation: transport arguments were cut off, salvaged what parsed");
        return salvaged;
      }
    }
    if (args && typeof args === "object") {
      const value = args.content;
      return typeof value === "string" ? value : void 0;
    }
    return void 0;
  }
  function describeError(error) {
    return error instanceof Error ? error.message : String(error);
  }
  function resolveUrl(input) {
    try {
      if (typeof input === "string") return input;
      if (input instanceof URL) return input.href;
      if (input && typeof input === "object" && "url" in input) {
        const url = input.url;
        return typeof url === "string" ? url : void 0;
      }
    } catch {
    }
    return void 0;
  }
  async function readRequestBody(args) {
    const [input, init] = args;
    if (init?.body !== void 0 && init.body !== null) {
      return typeof init.body === "string" ? init.body : void 0;
    }
    if (input instanceof Request) {
      return await input.clone().text();
    }
    return void 0;
  }
  function withBody(args, body) {
    const [input, init] = args;
    if (init?.body !== void 0 && init.body !== null) {
      return [input, { ...init, body }];
    }
    if (input instanceof Request) {
      return [new Request(input, { body }), init];
    }
    return args;
  }
  const EMPTY_RUN = {
    decodedChars: 0,
    emittedChars: 0,
    decodedChunks: 0,
    streamed: false,
    endedCleanly: false,
    conflict: false,
    plainWon: false
  };

  class IncrementalContentDecoder {
    state = "init";
    keyScan = "";
    /** An escape sequence cut in half by a fragment boundary. */
    pendingEscape = "";
    /** A quote held back because we cannot yet tell if it closes the string. */
    pendingQuote = false;
    highSurrogate = 0;
    emittedAny = false;
    get hasEmitted() {
      return this.emittedAny;
    }
    get isComplete() {
      return this.state === "completed";
    }
    /** Feed one raw fragment; returns the text that is now safe to show. */
    feed(fragment) {
      if (!fragment) return "";
      let out = "";
      let source = fragment;
      if (this.pendingQuote) {
        this.pendingQuote = false;
        const rest = source.replace(/^[\s]*/, "");
        if (rest.startsWith("}") || rest === "") {
          this.state = "completed";
          return "";
        }
        out += '"';
      }
      if (this.pendingEscape) {
        source = this.pendingEscape + source;
        this.pendingEscape = "";
      }
      let i = 0;
      while (i < source.length) {
        const char = source[i];
        switch (this.state) {
          case "init":
            if (char === "{" || char === '"') {
              this.state = "lookingForKey";
              if (char === '"') this.keyScan = '"';
            }
            i += 1;
            break;
          case "lookingForKey":
            this.keyScan += char;
            i += 1;
            if (this.keyScan.includes('"content"')) {
              this.state = "lookingForColon";
              this.keyScan = "";
            } else if (this.keyScan.length > MAX_KEY_SCAN) {
              this.state = "error";
            }
            break;
          case "lookingForColon":
            if (char === ":") this.state = "lookingForQuote";
            i += 1;
            break;
          case "lookingForQuote":
            if (char === '"') {
              this.state = "inString";
            } else if (!/\s/.test(char)) {
              this.state = "error";
            }
            i += 1;
            break;
          case "inString": {
            const consumed = this.consumeStringChar(source, i);
            out += consumed.text;
            if (consumed.stop) {
              i = source.length;
            } else {
              i += consumed.width;
            }
            break;
          }
          case "completed": {
            const rest = source.slice(i).trim();
            if (rest !== "" && rest !== "}" && rest !== "},") {
              this.state = "inString";
              break;
            }
            i = source.length;
            break;
          }
          case "error":
            i = source.length;
            break;
        }
      }
      if (out) this.emittedAny = true;
      return out;
    }
    /**
     * Consume one logical character of the JSON string starting at `index`.
     *
     * `stop` means the rest of this fragment must not be processed — either the string ended
     * or an incomplete tail was stashed for the next fragment.
     */
    consumeStringChar(source, index) {
      const char = source[index];
      if (char === "\\") {
        const next = source[index + 1];
        if (next === void 0) {
          this.pendingEscape = "\\";
          return { text: "", width: 0, stop: true };
        }
        if (next === "u") {
          const hex = source.slice(index + 2, index + 6);
          if (hex.length < 4) {
            this.pendingEscape = source.slice(index);
            return { text: "", width: 0, stop: true };
          }
          const code = Number.parseInt(hex, 16);
          if (Number.isNaN(code)) {
            return { text: `\\u${hex}`, width: 6, stop: false };
          }
          if (code >= HIGH_SURROGATE_START && code <= HIGH_SURROGATE_END) {
            this.highSurrogate = code;
            return { text: "", width: 6, stop: false };
          }
          if (code >= LOW_SURROGATE_START && code <= LOW_SURROGATE_END && this.highSurrogate) {
            const combined = 65536 + (this.highSurrogate - HIGH_SURROGATE_START << 10) + (code - LOW_SURROGATE_START);
            this.highSurrogate = 0;
            return { text: String.fromCodePoint(combined), width: 6, stop: false };
          }
          return { text: String.fromCharCode(code), width: 6, stop: false };
        }
        const simple = SIMPLE_ESCAPES[next];
        if (simple !== void 0) {
          return { text: simple, width: 2, stop: false };
        }
        return { text: char + next, width: 2, stop: false };
      }
      if (char === '"') {
        const rest = source.slice(index + 1);
        if (rest === "") {
          this.pendingQuote = true;
          return { text: "", width: 0, stop: true };
        }
        if (rest.replace(/^[\s]*/, "").startsWith("}")) {
          this.state = "completed";
          return { text: "", width: 0, stop: true };
        }
        return { text: '"', width: 1, stop: false };
      }
      return { text: char, width: 1, stop: false };
    }
    /**
     * Flush whatever is still held back once the stream is over.
     *
     * A dangling escape is emitted verbatim: showing the user a stray backslash is better
     * than silently dropping characters they paid for.
     */
    finish() {
      let out = "";
      if (this.pendingQuote && !this.emittedAny) {
        out += '"';
      }
      this.pendingQuote = false;
      if (this.pendingEscape) {
        out += this.pendingEscape;
        this.pendingEscape = "";
      }
      if (out) this.emittedAny = true;
      return out;
    }
  }
  const SIMPLE_ESCAPES = {
    '"': '"',
    "\\": "\\",
    "/": "/",
    b: "\b",
    f: "\f",
    n: "\n",
    r: "\r",
    t: "	"
  };
  class JsonArrayStreamSplitter {
    buffer = "";
    /** How far into `buffer` the scan has already reached. */
    at = 0;
    /** Offset where the element currently being scanned began. */
    start = 0;
    depth = 0;
    inElement = false;
    inString = false;
    escaped = false;
    opened = false;
    closed = false;
    /** True once the closing `]` arrived, i.e. the array was complete rather than cut off. */
    get complete() {
      return this.closed;
    }
    /** Feed raw text; returns every top-level element that is now whole. */
    push(text) {
      if (!text) return [];
      this.buffer += text;
      const elements = [];
      while (this.at < this.buffer.length) {
        const char = this.buffer[this.at];
        if (this.closed) {
          this.at += 1;
          continue;
        }
        if (!this.inElement) {
          if (!this.opened) {
            if (char === "[") {
              this.opened = true;
              this.at += 1;
              continue;
            }
            if (isSpace(char)) {
              this.at += 1;
              continue;
            }
            this.opened = true;
            continue;
          }
          if (isSpace(char) || char === ",") {
            this.at += 1;
            continue;
          }
          if (char === "]") {
            this.closed = true;
            this.at += 1;
            continue;
          }
          this.inElement = true;
          this.start = this.at;
          this.depth = 0;
        }
        if (this.inString) {
          if (this.escaped) this.escaped = false;
          else if (char === "\\") this.escaped = true;
          else if (char === '"') this.inString = false;
        } else if (char === '"') {
          this.inString = true;
        } else if (char === "{" || char === "[") {
          this.depth += 1;
        } else if (char === "}" || char === "]") {
          this.depth -= 1;
          if (this.depth === 0) {
            elements.push(this.buffer.slice(this.start, this.at + 1));
            this.inElement = false;
            this.buffer = this.buffer.slice(this.at + 1);
            this.at = 0;
            continue;
          }
        }
        this.at += 1;
      }
      return elements;
    }
    /**
     * Whatever never formed a complete element.
     *
     * Emitted rather than dropped on a truncated stream: the characters arrived and were paid
     * for, and a half-object downstream is more honest than silence.
     */
    finish() {
      if (!this.inElement) return "";
      const rest = this.buffer.slice(this.start);
      this.inElement = false;
      this.buffer = "";
      this.at = 0;
      return rest;
    }
  }
  function isSpace(char) {
    return char === " " || char === "\n" || char === "\r" || char === "	";
  }
  function flattenJsonElement(element) {
    try {
      return JSON.stringify(JSON.parse(element));
    } catch {
      return element.replace(/[\r\n]+/g, " ");
    }
  }
  const TOOL_PREFIX = "emit_complete_response_";
  function matchesToolName(candidate, toolName) {
    if (typeof candidate !== "string" || !candidate || !toolName) return false;
    if (candidate === toolName) return true;
    return bareToolName(candidate) === toolName;
  }
  function bareToolName(candidate) {
    return candidate.slice(candidate.lastIndexOf(":") + 1);
  }
  const NO_CLIENT_TOOLS = new Set();
  function classifyToolName(candidate, toolName, clientToolNames = NO_CLIENT_TOOLS) {
    if (typeof candidate !== "string" || !candidate) return "client";
    if (matchesToolName(candidate, toolName)) return "own";
    const bare = bareToolName(candidate);
    if (clientToolNames.has(candidate) || clientToolNames.has(bare)) return "client";
    return bare.length > TOOL_PREFIX.length && bare.startsWith(TOOL_PREFIX) ? "foreign" : "client";
  }
  function randomToolName(existing) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const bytes = new Uint8Array(12);
      crypto.getRandomValues(bytes);
      const name = TOOL_PREFIX + Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (!existing.has(name)) return name;
    }
    throw new Error("could not generate a unique transport tool name");
  }
  function collectToolNames(tools) {
    const names = new Set();
    if (!Array.isArray(tools)) return names;
    for (const tool of tools) {
      const name = tool?.function?.name;
      if (typeof name === "string" && name) names.add(name);
    }
    return names;
  }
  function callerControlsTools(body) {
    const choice = body["tool_choice"];
    if (choice === "none") return "tools-disabled-by-caller";
    if (choice === "required") return "caller-forced-tool";
    if (choice && typeof choice === "object") return "caller-forced-tool";
    return void 0;
  }
  function buildToolDefinition(name) {
    return {
      type: "function",
      function: {
        name,
        description: "Emit the complete final user-visible reply exactly once. Put the entire reply in content and write no reply text outside this call.",
        parameters: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description: "The complete final reply shown to the user."
            }
          },
          required: ["content"]
        }
      }
    };
  }
  function buildControlPrompt(toolName) {
    return `Call the \`${toolName}\` function exactly once and put your complete final reply in its \`content\` argument. Do not write any of the final reply outside that call. Use any other available tools normally when they are needed.`;
  }
  function findAnchor(messages, anchor) {
    for (let index = 0; index < messages.length; index += 1) {
      const content = messages[index]?.content;
      if (typeof content === "string" && content.includes(anchor)) return index;
    }
    return -1;
  }
  function prepareRequest(rawBody, options = {}) {
    let body;
    try {
      const parsed = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { kind: "bypass", reason: "unparseable" };
      }
      body = parsed;
    } catch {
      return { kind: "bypass", reason: "unparseable" };
    }
    const messages = body["messages"];
    if (!Array.isArray(messages) || messages.length === 0) {
      return { kind: "bypass", reason: "no-messages" };
    }
    const controlled = callerControlsTools(body);
    if (controlled) {
      return { kind: "bypass", reason: controlled };
    }
    const existingTools = Array.isArray(body["tools"]) ? [...body["tools"]] : [];
    const clientToolNames = collectToolNames(existingTools);
    const toolName = randomToolName(clientToolNames);
    body["tools"] = [...existingTools, buildToolDefinition(toolName)];
    body["tool_choice"] = "auto";
    const control = buildControlPrompt(toolName);
    const anchorIndex = options.controlAnchor ? findAnchor(messages, options.controlAnchor) : -1;
    let controlPlacement;
    if (anchorIndex >= 0) {
      body["messages"] = [
        ...messages.slice(0, anchorIndex),
        { role: "system", content: control },
        ...messages.slice(anchorIndex)
      ];
      controlPlacement = "anchored";
    } else {
      const lastRole = messages[messages.length - 1]?.role;
      const controlRole = lastRole === "assistant" ? "user" : "system";
      body["messages"] = [...messages, { role: controlRole, content: control }];
      controlPlacement = "appended";
    }
    return {
      kind: "prepared",
      prepared: {
        body: JSON.stringify(body),
        toolName,
        clientToolNames,
        streamRequested: body["stream"] === true,
        controlPlacement
      }
    };
  }
  class SseContentRewriter {
    constructor(toolName, clientToolNames = new Set()) {
      this.toolName = toolName;
      this.clientToolNames = clientToolNames;
    }
    states = new Map();
    stats = {
      syntheticSeen: false,
      contentConflict: false,
      plainWon: false,
      sawDone: false,
      decodedChars: 0,
      emittedChars: 0,
      decodedChunks: 0
    };
    /** Echoed back on a synthesized final chunk so it matches the rest of the stream. */
    lastChunkMeta = {
      id: "chatcmpl-anti-truncation",
      model: "unknown",
      created: Math.floor(Date.now() / 1e3)
    };
    state(index, dialect) {
      let existing = this.states.get(index);
      if (!existing) {
        existing = {
          dialect,
          plain: "",
          sent: "",
          channels: new Map(),
          slotNames: new Map(),
          activeGoogleChannel: void 0,
          sawSynthetic: false
        };
        this.states.set(index, existing);
      }
      existing.dialect = dialect;
      return existing;
    }
    /**
     * Transform one SSE `data:` payload.
     *
     * Returns the replacement payload, or `undefined` when the chunk carried nothing left to
     * forward (for example a tool-call fragment that decoded to no visible characters yet).
     */
    transformPayload(payload) {
      const trimmed = payload.trim();
      if (trimmed === "[DONE]") {
        this.stats.sawDone = true;
        return payload;
      }
      let chunk;
      try {
        const parsed = JSON.parse(trimmed);
        if (!parsed || typeof parsed !== "object") return payload;
        chunk = parsed;
      } catch {
        return payload;
      }
      if (typeof chunk["id"] === "string") this.lastChunkMeta.id = chunk["id"];
      if (typeof chunk["model"] === "string") this.lastChunkMeta.model = chunk["model"];
      if (typeof chunk["created"] === "number") this.lastChunkMeta.created = chunk["created"];
      const choices = chunk["choices"];
      if (Array.isArray(choices)) return this.rewriteChoices(chunk, choices, payload);
      const candidates = chunk["candidates"];
      if (Array.isArray(candidates)) return this.rewriteCandidates(chunk, candidates, payload);
      return payload;
    }
    /** The OpenAI dialect: `choices[].delta.tool_calls[].function.arguments`. */
    rewriteChoices(chunk, choices, payload) {
      let touched = false;
      let anythingToSend = false;
      for (const rawChoice of choices) {
        if (!rawChoice || typeof rawChoice !== "object") continue;
        const choice = rawChoice;
        const index = typeof choice["index"] === "number" ? choice["index"] : 0;
        const state = this.state(index, "openai");
        const field = choice["delta"] === void 0 || choice["delta"] === null ? choice["message"] && typeof choice["message"] === "object" ? "message" : "delta" : "delta";
        const delta = choice[field] ?? {};
        const originalContent = typeof delta["content"] === "string" ? delta["content"] : "";
        let streamedText = "";
        const toolCalls = delta["tool_calls"];
        if (Array.isArray(toolCalls)) {
          const { handled, decoded, remaining } = this.consumeToolCalls(state, toolCalls);
          streamedText += decoded;
          if (handled) touched = true;
          if (remaining.length > 0) {
            delta["tool_calls"] = remaining;
            anythingToSend = true;
          } else if (toolCalls.length > 0 && handled) {
            delete delta["tool_calls"];
            touched = true;
          }
        }
        if (originalContent) {
          touched = true;
          delete delta["content"];
          state.plain += originalContent;
        }
        if (streamedText) {
          delta["content"] = streamedText;
          anythingToSend = true;
        }
        const finish = choice["finish_reason"];
        if (finish !== null && finish !== void 0) {
          touched = true;
          anythingToSend = true;
          const tail = this.finalizeChoice(state);
          if (tail) {
            delta["content"] = (delta["content"] ?? "") + tail;
          }
          if (state.sawSynthetic && finish === "tool_calls") {
            choice["finish_reason"] = "stop";
          }
        }
        if (Object.keys(delta).length > 0) anythingToSend = true;
        choice[field] = delta;
      }
      if (!touched) return payload;
      if (!anythingToSend) return void 0;
      return JSON.stringify(chunk);
    }
    /**
     * The Google dialect: `candidates[].content.parts[].functionCall.args`.
     *
     * The recovered reply is emitted as a `parts[]` text entry, and it must come FIRST.
     * SillyTavern reads a Gemini chunk as `parts.filter(p => !p.thought).map(p => p.text)[0]`
     * (`public/scripts/openai.js`, `getStreamingReply`), so any other non-thought part left in
     * front of ours — an `inlineData` image, say — would shadow it and the reply would vanish.
     */
    rewriteCandidates(chunk, candidates, payload) {
      let touched = false;
      let anythingToSend = false;
      for (const rawCandidate of candidates) {
        if (!rawCandidate || typeof rawCandidate !== "object") continue;
        const candidate = rawCandidate;
        const index = typeof candidate["index"] === "number" ? candidate["index"] : 0;
        const state = this.state(index, "google");
        const rawContent = candidate["content"];
        const content = rawContent && typeof rawContent === "object" ? rawContent : {};
        const parts = content["parts"];
        let streamedText = "";
        const kept = [];
        if (Array.isArray(parts)) {
          for (const rawPart of parts) {
            if (!rawPart || typeof rawPart !== "object") {
              kept.push(rawPart);
              continue;
            }
            const part = rawPart;
            const call = part["functionCall"];
            if (call && typeof call === "object") {
              const consumed = this.consumeGoogleCall(state, call);
              if (!consumed.handled) {
                kept.push(rawPart);
                continue;
              }
              streamedText += consumed.decoded;
              touched = true;
              continue;
            }
            if (part["thought"] === true) {
              kept.push(rawPart);
              continue;
            }
            if (typeof part["text"] === "string" && part["text"]) {
              touched = true;
              state.plain += part["text"];
              continue;
            }
            kept.push(rawPart);
          }
        }
        let emitted = streamedText;
        const finish = candidate["finishReason"];
        if (finish !== null && finish !== void 0) {
          touched = true;
          anythingToSend = true;
          emitted += this.finalizeChoice(state);
        }
        if (!touched) continue;
        const nextParts = [];
        if (emitted) nextParts.push({ text: emitted });
        nextParts.push(...kept);
        if (nextParts.length > 0 || Array.isArray(parts)) {
          content["parts"] = nextParts;
          if (typeof content["role"] !== "string") content["role"] = "model";
          candidate["content"] = content;
        }
        if (nextParts.length > 0) anythingToSend = true;
      }
      if (!touched) return payload;
      if (!anythingToSend) return void 0;
      return JSON.stringify(chunk);
    }
    /**
     * Consume one Google `functionCall` block, in either of the two shapes it arrives in.
     *
     * ── Atomic ───────────────────────────────────────────────────────────────────────────
     * `{ name, args }` — the whole call in one block. What Gemini sends by default.
     *
     * ── Streamed (`streamFunctionCallArguments: true`) ───────────────────────────────────
     * The call is spread over several blocks and only the FIRST carries the name:
     *
     *   `{ name, id, willContinue: true }`                       ← opening, no arguments yet
     *   `{ partialArgs: [{ jsonPath: "$.content", stringValue }], willContinue: true }`
     *   `{ partialArgs: [{ jsonPath: "$.content" }] }`           ← end-of-argument marker
     *   `{}`                                                     ← end-of-call marker
     *
     * Every block after the first is anonymous, so `classifyToolName` cannot be asked again —
     * hence the latch. Without it those blocks read as somebody else's tool call and get
     * forwarded to a SillyTavern that finds no text in them: an empty message, with the whole
     * reply sitting in the fragments we just passed along.
     *
     * `stringValue` is DECODED text, not JSON source, so it must never reach
     * `IncrementalContentDecoder` — that one exists to read a raw `{"content":"…"}` string
     * while it is still arriving, which is a different problem.
     *
     * Malformed fragments are skipped rather than thrown on. The gateway-side reference
     * implementation throws; this one sits in front of a user's chat and must never turn a
     * degraded reply into a failed generation.
     */
    consumeGoogleCall(state, call) {
      const name = call["name"];
      let channelName;
      if (typeof name === "string" && name) {
        if (classifyToolName(name, this.toolName, this.clientToolNames) === "client") {
          state.activeGoogleChannel = void 0;
          return { handled: false, decoded: "" };
        }
        channelName = bareToolName(name);
        state.activeGoogleChannel = channelName;
      } else {
        channelName = state.activeGoogleChannel;
      }
      if (channelName === void 0) {
        const empty = call["args"] === void 0 && call["partialArgs"] === void 0 && state.sawSynthetic;
        return { handled: empty, decoded: "" };
      }
      this.markSynthetic(state);
      const channel = this.channel(state, channelName);
      let text = "";
      const partialArgs = call["partialArgs"];
      if (Array.isArray(partialArgs)) {
        text += readPartialArgs(partialArgs);
      }
      if (call["args"] !== void 0) {
        text += decodeGoogleArgs(channel, call["args"]);
      }
      if (call["willContinue"] !== true) {
        state.activeGoogleChannel = void 0;
      }
      return { handled: true, decoded: this.absorb(state, channel, text) };
    }
    /** First sight of a transport tool on this choice. */
    markSynthetic(state) {
      if (state.sawSynthetic) return;
      state.sawSynthetic = true;
      this.stats.syntheticSeen = true;
    }
    channel(state, name) {
      let channel = state.channels.get(name);
      if (!channel) {
        channel = { decoder: new IncrementalContentDecoder(), text: "" };
        state.channels.set(name, channel);
      }
      return channel;
    }
    /**
     * Record newly decoded transport text, and return the part that may go out right now.
     *
     * While a transport call is the only thing that has produced anything, its text streams as
     * it arrives — that progressive display is the whole point of the feature. The moment a
     * SECOND candidate exists (ordinary text the model wrote anyway, or another transport tool
     * because a gateway injected its own), streaming stops for this choice and the decision is
     * deferred to `finalizeChoice`, which sends the winner exactly once. Deferring costs the
     * progressive display only in the case that used to lose the reply outright.
     */
    absorb(state, channel, text) {
      if (!text) return "";
      channel.text += text;
      this.stats.decodedChunks += 1;
      if (state.plain !== "" || state.channels.size > 1) return "";
      state.sent += text;
      this.stats.decodedChars += text.length;
      this.stats.emittedChars += text.length;
      return text;
    }
    /**
     * Split a `tool_calls` delta into decoded transport text and the genuine calls that must
     * still be forwarded.
     */
    consumeToolCalls(state, toolCalls) {
      let handled = false;
      let decoded = "";
      const remaining = [];
      for (const rawCall of toolCalls) {
        if (!rawCall || typeof rawCall !== "object") {
          remaining.push(rawCall);
          continue;
        }
        const call = rawCall;
        const callIndex = typeof call["index"] === "number" ? call["index"] : 0;
        const fn = call["function"] ?? {};
        const name = typeof fn["name"] === "string" ? fn["name"] : "";
        let channelName = state.slotNames.get(callIndex);
        if (name) {
          const origin = classifyToolName(name, this.toolName, this.clientToolNames);
          if (origin === "client") {
            channelName = void 0;
            state.slotNames.delete(callIndex);
          } else {
            channelName = bareToolName(name);
            state.slotNames.set(callIndex, channelName);
          }
        }
        if (channelName === void 0) {
          remaining.push(rawCall);
          continue;
        }
        handled = true;
        this.markSynthetic(state);
        const channel = this.channel(state, channelName);
        const args = fn["arguments"];
        if (typeof args === "string" && args) {
          decoded += this.absorb(state, channel, channel.decoder.feed(args));
        }
      }
      return { handled, decoded, remaining };
    }
    /**
     * Decide which channel actually carried the reply, and return what still has to be sent.
     *
     * Longest wins, with a tie going to the transport call because that is the channel we
     * asked for. Anything already on screen cannot be recalled, so only the missing remainder
     * is emitted; a winner that is not a continuation of it is emitted whole, on the grounds
     * that showing a fragment twice beats not showing the reply at all.
     *
     * Idempotent: every accumulator is drained, so a second call (the `finish_reason` chunk
     * followed by the stream closing) adds nothing.
     */
    finalizeChoice(state) {
      let best = "";
      let bestIsPlain = false;
      let contenders = 0;
      for (const channel of state.channels.values()) {
        channel.text += channel.decoder.finish();
        if (channel.text) contenders += 1;
        if (channel.text.length > best.length) {
          best = channel.text;
          bestIsPlain = false;
        }
        channel.text = "";
      }
      if (state.plain) {
        contenders += 1;
        if (state.plain.length > best.length) {
          best = state.plain;
          bestIsPlain = true;
        }
      }
      state.plain = "";
      if (contenders > 1) {
        this.stats.contentConflict = true;
        if (bestIsPlain) this.stats.plainWon = true;
      }
      const tail = best.startsWith(state.sent) ? best.slice(state.sent.length) : best;
      state.sent += tail;
      this.stats.emittedChars += tail.length;
      if (!bestIsPlain) this.stats.decodedChars += tail.length;
      return tail;
    }
    /**
     * Release anything still held back, for a stream that ended without a `finish_reason`.
     *
     * Text is buffered until the winning channel is known, so a stream that simply stops — no
     * finish chunk, connection dropped, provider quirk — would otherwise take the entire reply
     * down with it. Returns one payload per choice that still owes the client text; the caller
     * writes them out before closing.
     */
    finalizePending() {
      const { id, model, created } = this.lastChunkMeta;
      const payloads = [];
      for (const [index, state] of this.states) {
        const pending = this.finalizeChoice(state);
        if (!pending) continue;
        payloads.push(
          state.dialect === "google" ? JSON.stringify({
            candidates: [
              { index, content: { role: "model", parts: [{ text: pending }] } }
            ]
          }) : JSON.stringify({
            id,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index, delta: { content: pending }, finish_reason: null }]
          })
        );
      }
      return payloads;
    }
  }
  function readPartialArgs(partialArgs) {
    let text = "";
    for (const rawFragment of partialArgs) {
      if (!rawFragment || typeof rawFragment !== "object") continue;
      const fragment = rawFragment;
      const path = typeof fragment["jsonPath"] === "string" ? fragment["jsonPath"].trim() : "";
      if (path !== "$.content") continue;
      const value = fragment["stringValue"];
      if (typeof value === "string") text += value;
    }
    return text;
  }
  function decodeGoogleArgs(channel, args) {
    if (typeof args === "string") return args ? channel.decoder.feed(args) : "";
    if (args && typeof args === "object") {
      const content = args["content"];
      if (typeof content !== "string" || !content) return "";
      if (!channel.text) return content;
      if (content.startsWith(channel.text)) return content.slice(channel.text.length);
      if (channel.text.startsWith(content)) return "";
      return content;
    }
    return "";
  }
  const MARKER = "__keminiAntiTruncation__";
  const SOFT_MISS_LIMIT = 3;
  let onTransportIncompatible = () => {
  };
  function setTransportIncompatibleHandler(handler) {
    onTransportIncompatible = handler;
  }
  const GENERATION_ENDPOINT = /\/api\/backends\/[^/]+\/generate\b/;
  class AntiTruncationInterceptor {
    installed = false;
    enabled = false;
    original;
    target;
    lastRunRecord;
    get isEnabled() {
      return this.enabled;
    }
    get lastRun() {
      return this.lastRunRecord;
    }
    /** Consecutive runs where the channel gave nothing back through the tool. */
    missStreak = 0;
    record(run) {
      this.lastRunRecord = { at: Date.now(), ...run };
      eventLog.info(
        `anti-truncation: ${run.outcome}` + (run.detail ? ` (${run.detail})` : "") + (run.outcome !== "transported" ? "" : run.plainWon ? ` — plain channel won with ${run.emittedChars} chars` : ` — ${run.decodedChars} chars in ${run.decodedChunks} chunks`)
      );
      this.warnIfChannelRejectsTransport(run.outcome, run.detail);
      this.warnIfChannelHasItsOwnTransport(run.outcome, run.plainWon);
    }
    /** Consecutive runs the ordinary text channel won. */
    plainWinStreak = 0;
    /**
     * Say when a channel looks like it is already doing this itself.
     *
     * Two anti-truncation layers are not harmful — the longest-wins rule keeps the reply — but
     * they are redundant, and the layer we add costs a control prompt and a tool the model has
     * to reason about. Worth telling the user; not worth deciding for them.
     */
    warnIfChannelHasItsOwnTransport(outcome, plainWon) {
      if (outcome !== "transported") return;
      if (!plainWon) {
        this.plainWinStreak = 0;
        return;
      }
      this.plainWinStreak += 1;
      if (this.plainWinStreak === SOFT_MISS_LIMIT) {
        onTransportIncompatible(
          `连续 ${SOFT_MISS_LIMIT} 次正文都是从普通通道拿到的，这条渠道多半自己就做了抗截断。正文没有丢，但本面板这一层是多余的，可以点「🛡 防截断」把它关掉。`
        );
      }
    }
    /**
     * Say when a channel looks unable to carry the transport — and do nothing else.
     *
     * Auto-disabling was considered and rejected: a model can decline the tool once for its
     * own reasons, and a panel that silently reverses the user's switch is worse than one that
     * keeps failing visibly. So this only warns, once per streak, and the user decides.
     *
     * `upstream-error` is a hard rejection and worth saying immediately. `no-synthetic-call`
     * and a barren `non-stream` are soft: they need to repeat before they mean anything.
     */
    warnIfChannelRejectsTransport(outcome, detail) {
      if (outcome === "transported" || outcome === "bypassed") {
        this.missStreak = 0;
        return;
      }
      if (outcome === "upstream-error") {
        this.missStreak = 0;
        onTransportIncompatible(
          `上游拒绝了这次请求（${detail ?? "未知"}）。如果每次都这样，多半是这条渠道不接受函数调用，可以点「🛡 防截断」把它关掉。`
        );
        return;
      }
      this.missStreak += 1;
      if (this.missStreak === SOFT_MISS_LIMIT) {
        onTransportIncompatible(
          `连续 ${SOFT_MISS_LIMIT} 次没有从传输函数里拿到正文，这条渠道可能不支持。开关没有被动过——要关请点「🛡 防截断」。`
        );
      }
    }
    setEnabled(enabled) {
      this.enabled = enabled;
      eventLog.info(`anti-truncation transport ${enabled ? "enabled" : "disabled"}`);
    }
    install() {
      if (this.installed) return;
      /* 【移植改动】宿主窗口 = 一路往上爬到最外层的同源窗口，不再只看 parent 一层。
         酒馆助手脚本跑在 iframe 里（手机上还可能是嵌套 iframe），而 generate 请求
         是**最外层那个窗口**发的。取不到（跨域）就宁可不装——不把拦截器装在一个
         根本不发请求的窗口上，让开关看起来"开着"。 */
      const target = hostWindow();
      if (!target) {
        eventLog.warn("anti-truncation: 外层窗口跨域，拿不到宿主窗口，未安装");
        return;
      }
      const current = target.fetch;
      if (typeof current !== "function") {
        eventLog.warn("anti-truncation: 宿主窗口没有 fetch，未安装");
        return;
      }
      const original = current[MARKER]?.original ?? current;
      const self = this;
      const wrapper = function patchedFetch(...args) {
        if (!self.enabled) {
          return original.apply(this ?? target, args);
        }
        try {
          const url = resolveUrl(args[0]);
          if (url && GENERATION_ENDPOINT.test(url)) {
            return self.intercept(original, this ?? target, args);
          }
        } catch (error) {
          eventLog.warn(`anti-truncation: intercept skipped, ${describeError(error)}`);
        }
        return original.apply(this ?? target, args);
      };
      wrapper[MARKER] = { original };
      target.fetch = wrapper;
      this.original = original;
      this.target = target;
      this.installed = true;
      eventLog.info("anti-truncation interceptor installed");
    }
    async intercept(original, thisArg, args) {
      const call = () => original.apply(thisArg, args);
      let rawBody;
      try {
        rawBody = await readRequestBody(args);
      } catch (error) {
        this.record({
          ...EMPTY_RUN,
          outcome: "bypassed",
          detail: `读取请求体失败: ${describeError(error)}`
        });
        return call();
      }
      if (rawBody === void 0) {
        this.record({ ...EMPTY_RUN, outcome: "bypassed", detail: "请求体不是可读取的字符串" });
        return call();
      }
      const result = prepareRequest(rawBody, { controlAnchor: TRANSPORT_CONTROL_ANCHOR });
      if (result.kind === "bypass") {
        this.record({ ...EMPTY_RUN, outcome: "bypassed", detail: result.reason });
        return call();
      }
      const { body, toolName, clientToolNames, streamRequested, controlPlacement } = result.prepared;
      if (controlPlacement === "appended") {
        eventLog.warn(
          `anti-truncation: control anchor ${JSON.stringify(TRANSPORT_CONTROL_ANCHOR)} not found, control prompt appended at the end instead`
        );
      }
      const patched = withBody(args, body);
      const response = await original.apply(thisArg, patched);
      if (!response.ok || !response.body) {
        this.record({
          ...EMPTY_RUN,
          outcome: "upstream-error",
          detail: `HTTP ${response.status}`
        });
        return response;
      }
      const contentType = response.headers.get("content-type") ?? "";
      const { shape, response: sniffed } = await sniffResponseShape(response, contentType);
      if (shape === "json-array" && streamRequested) {
        eventLog.info("anti-truncation: upstream sent a JSON array instead of SSE, reframing");
        return rewriteEventStream(reframeJsonArrayStream(sniffed), toolName, clientToolNames, (stats) => {
          this.record({
            outcome: stats.syntheticSeen ? "transported" : "no-synthetic-call",
            detail: "上游回的是 JSON 数组流，已转成 SSE",
            decodedChars: stats.decodedChars,
            emittedChars: stats.emittedChars,
            decodedChunks: stats.decodedChunks,
            streamed: stats.decodedChunks > 1,
            endedCleanly: stats.sawDone,
            conflict: stats.contentConflict,
            plainWon: stats.plainWon
          });
        });
      }
      if (shape !== "sse") {
        const { response: rewritten, recovered } = await rewriteJsonResponse(
          sniffed,
          toolName,
          clientToolNames
        );
        if (recovered !== void 0) {
          this.record({
            ...EMPTY_RUN,
            outcome: "transported",
            decodedChars: recovered.plainWon ? 0 : recovered.chars,
            emittedChars: recovered.chars,
            decodedChunks: 1,
            streamed: false,
            endedCleanly: true,
            conflict: recovered.conflict,
            plainWon: recovered.plainWon
          });
          return rewritten;
        }
        this.record({
          ...EMPTY_RUN,
          outcome: "non-stream",
          detail: (streamRequested ? `请求了流式但上游回的不是 SSE${contentType ? `（content-type: ${contentType}）` : ""}` : "本次请求没有开流式") + "，且没找到传输函数调用"
        });
        return rewritten;
      }
      return rewriteEventStream(sniffed, toolName, clientToolNames, (stats) => {
        this.record({
          outcome: stats.syntheticSeen ? "transported" : "no-synthetic-call",
          decodedChars: stats.decodedChars,
          emittedChars: stats.emittedChars,
          decodedChunks: stats.decodedChunks,
          // More than one carrying chunk is the proof that it arrived progressively.
          streamed: stats.decodedChunks > 1,
          endedCleanly: stats.sawDone,
          conflict: stats.contentConflict,
          plainWon: stats.plainWon
        });
      });
    }
    dispose() {
      this.enabled = false;
      if (!this.installed || !this.target || !this.original) {
        this.installed = false;
        return;
      }
      const current = this.target.fetch;
      if (current && current[MARKER]) {
        this.target.fetch = this.original;
        eventLog.info("anti-truncation interceptor removed");
      } else {
        eventLog.warn("anti-truncation: another patch is on top, leaving chain intact");
      }
      this.installed = false;
      this.target = void 0;
      this.original = void 0;
    }
  }
  const SSE_HEAD = /^\s*(?:data:|event:|id:|retry:|:)/;
  const JSON_ARRAY_HEAD = /^\s*\[/;
  const SNIFF_CHARS = 8;
  async function sniffResponseShape(response, contentType) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const consumed = [];
    let head = "";
    let ended = false;
    let readError;
    try {
      while (!ended && head.length < SNIFF_CHARS) {
        const { value, done } = await reader.read();
        if (done) {
          ended = true;
          break;
        }
        if (!value || value.length === 0) continue;
        consumed.push(value);
        head += decoder.decode(value, { stream: true });
      }
    } catch (error) {
      readError = error;
      ended = true;
    }
    const replay = new ReadableStream({
      start(controller) {
        for (const value of consumed) controller.enqueue(value);
        if (readError !== void 0) {
          controller.error(readError);
          return;
        }
        if (ended) controller.close();
      },
      async pull(controller) {
        const { value, done } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(value);
      },
      cancel(reason) {
        void reader.cancel(reason);
      }
    });
    const shape = JSON_ARRAY_HEAD.test(head) ? "json-array" : SSE_HEAD.test(head) || contentType.includes("text/event-stream") ? "sse" : "json";
    return {
      shape,
      response: new Response(replay, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      })
    };
  }
  function reframeJsonArrayStream(response) {
    const splitter = new JsonArrayStreamSplitter();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const emit = (controller, element) => {
      controller.enqueue(encoder.encode(`data: ${flattenJsonElement(element)}

`));
    };
    const stream = new TransformStream({
      transform(chunk, controller) {
        for (const element of splitter.push(decoder.decode(chunk, { stream: true }))) {
          emit(controller, element);
        }
      },
      flush(controller) {
        for (const element of splitter.push(decoder.decode())) {
          emit(controller, element);
        }
        const rest = splitter.finish();
        if (rest.trim()) emit(controller, rest);
        if (splitter.complete) {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } else {
          eventLog.warn("anti-truncation: JSON array stream ended without its closing bracket");
        }
      }
    });
    void response.body.pipeTo(stream.writable).catch((error) => {
      eventLog.warn(`anti-truncation: JSON array stream aborted, ${describeError(error)}`);
    });
    return new Response(stream.readable, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
  }
  function rewriteEventStream(response, toolName, clientToolNames, onComplete) {
    const rewriter = new SseContentRewriter(toolName, clientToolNames);
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = "";
    const stream = new TransformStream({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const rawEvent = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const rewritten = rewriteEvent(rewriter, rawEvent);
          if (rewritten !== void 0) {
            controller.enqueue(encoder.encode(rewritten + "\n\n"));
          }
          boundary = buffer.indexOf("\n\n");
        }
      },
      flush(controller) {
        buffer += decoder.decode();
        const rest = buffer.trim();
        if (rest) {
          controller.enqueue(encoder.encode(buffer));
        }
        for (const payload of rewriter.finalizePending()) {
          controller.enqueue(encoder.encode(`data: ${payload}

`));
        }
        if (!rewriter.stats.sawDone) {
          eventLog.warn("anti-truncation: upstream stream ended without [DONE]");
        }
        onComplete?.(rewriter.stats);
      }
    });
    void response.body.pipeTo(stream.writable).catch((error) => {
      eventLog.warn(`anti-truncation: upstream stream aborted, ${describeError(error)}`);
    });
    return new Response(stream.readable, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
  }
  function rewriteEvent(rewriter, rawEvent) {
    const lines = rawEvent.split("\n");
    const out = [];
    let sawData = false;
    let emittedData = false;
    for (const line2 of lines) {
      if (!line2.startsWith("data:")) {
        out.push(line2);
        continue;
      }
      sawData = true;
      const payload = line2.slice("data:".length).replace(/^ /, "");
      const rewritten = rewriter.transformPayload(payload);
      if (rewritten !== void 0) {
        out.push(`data: ${rewritten}`);
        emittedData = true;
      }
    }
    if (sawData && !emittedData) return void 0;
    return out.join("\n");
  }
  async function rewriteJsonResponse(response, toolName, clientToolNames) {
    let parsed;
    try {
      parsed = await response.clone().json();
    } catch (error) {
      eventLog.warn(`anti-truncation: response was not JSON, ${describeError(error)}`);
      return { response, recovered: void 0 };
    }
    let recovered;
    try {
      const choices = parsed["choices"];
      if (Array.isArray(choices)) {
        recovered = unwrapOpenAiChoices(choices, toolName, clientToolNames);
      }
      const google = unwrapGoogleContent(parsed, toolName, clientToolNames);
      if (google !== void 0) recovered = mergeRecovery(recovered, google);
    } catch (error) {
      eventLog.warn(`anti-truncation: could not unwrap JSON reply, ${describeError(error)}`);
      return { response, recovered: void 0 };
    }
    if (recovered === void 0) return { response, recovered };
    return {
      response: new Response(JSON.stringify(parsed), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      }),
      recovered
    };
  }
  function mergeRecovery(a, b) {
    if (!a) return b;
    return {
      chars: a.chars + b.chars,
      conflict: a.conflict || b.conflict,
      plainWon: a.plainWon || b.plainWon
    };
  }
  function longest(plain, carried) {
    let text = plain;
    let plainWon = true;
    for (const candidate of carried) {
      if (candidate.length >= text.length) {
        text = candidate;
        plainWon = false;
      }
    }
    const contenders = (plain ? 1 : 0) + carried.filter((entry) => entry !== "").length;
    return {
      text,
      chars: text.length,
      conflict: contenders > 1,
      plainWon: plainWon && contenders > 1
    };
  }
  function unwrapOpenAiChoices(choices, toolName, clientToolNames) {
    let recovered;
    for (const rawChoice of choices) {
      const choice = rawChoice;
      const message = choice["message"];
      if (!message) continue;
      const calls = message["tool_calls"];
      if (!Array.isArray(calls)) continue;
      const kept = [];
      const carried = [];
      for (const rawCall of calls) {
        const fn = rawCall?.function;
        if (fn && classifyToolName(fn["name"], toolName, clientToolNames) !== "client") {
          const value = readArgsContent(fn["arguments"]);
          if (typeof value === "string") {
            carried.push(value);
            continue;
          }
        }
        kept.push(rawCall);
      }
      if (carried.length === 0) continue;
      const plain = typeof message["content"] === "string" ? message["content"] : "";
      const best = longest(plain, carried);
      message["content"] = best.text;
      recovered = mergeRecovery(recovered, best);
      if (kept.length > 0) {
        message["tool_calls"] = kept;
      } else {
        delete message["tool_calls"];
        if (choice["finish_reason"] === "tool_calls") choice["finish_reason"] = "stop";
      }
    }
    return recovered;
  }
  function unwrapGoogleContent(parsed, toolName, clientToolNames) {
    const rawContent = parsed["responseContent"];
    if (!rawContent || typeof rawContent !== "object") return void 0;
    const content = rawContent;
    const parts = content["parts"];
    if (!Array.isArray(parts)) return void 0;
    const kept = [];
    const carried = [];
    let plain = "";
    let signature;
    for (const rawPart of parts) {
      const part = rawPart;
      const call = part?.["functionCall"];
      if (call && classifyToolName(call["name"], toolName, clientToolNames) !== "client") {
        const value = readArgsContent(call["args"]);
        if (typeof value === "string") {
          carried.push(value);
          if (part?.["thoughtSignature"] !== void 0) signature = part["thoughtSignature"];
          continue;
        }
      }
      if (part && part["thought"] !== true && typeof part["text"] === "string" && part["text"]) {
        plain += part["text"];
        if (signature === void 0 && part["thoughtSignature"] !== void 0) {
          signature = part["thoughtSignature"];
        }
        continue;
      }
      kept.push(rawPart);
    }
    if (carried.length === 0) return void 0;
    const choices = parsed["choices"];
    const message = Array.isArray(choices) ? choices[0]?.message : void 0;
    const wrapped = typeof message?.["content"] === "string" ? message["content"] : "";
    const best = longest(plain.length >= wrapped.length ? plain : wrapped, carried);
    const textPart = { text: best.text };
    if (signature !== void 0) textPart["thoughtSignature"] = signature;
    content["parts"] = [textPart, ...kept];
    if (message) message["content"] = best.text;
    return best;
  }
  /* ══ PORTED-CORE-END ═════════════════════════════════════════════════ */

  /* ══════════════════════════════════════════════════════════════════════
   * 引导层：开关的读写 / 装与卸 / 控制台 API
   *
   * 与 v2.8.1 那版引导层的差别（就这一处，其余照搬）：
   *   它那版还负责**注册顶部按钮**（appendInexistentScriptButtons /
   *   getButtonEvent / eventOn）。这里**故意不注册**：panel-core.js 已经静态声明
   *   并接线了那两个按钮，两处都注册就会把一次点击变成两次切换（＝点一下没反应，
   *   而且每点一次多挂一个监听）。按钮交给面板，这里只负责开关本身。
   * ══════════════════════════════════════════════════════════════════════ */

  /**
   * 读开关。三种历史写法都要认：
   *   "1" / "0"       —— v2.8.1 那一支写的就是这个（键也是它留下的）
   *   "true"/"false"  —— 本面板上一版的按钮用 JSON.stringify 写的是这个
   *   键不存在        —— 用出厂默认（options.defaultOn，面板传 CONFIG.antitrunc.enabled）
   * 认不出来的脏值一律按**开启**：宁可多一层防护，也不因为一个坏值把防护悄悄关掉。
   */
  function readSwitch() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw === null || raw === '') return DEFAULT_ON;
      const v = String(raw).trim().toLowerCase();
      if (v === '0' || v === 'false') return false;
      return true;
    } catch {
      return DEFAULT_ON;   /* 无痕模式 / 取不到 localStorage：用出厂默认 */
    }
  }

  /**
   * 写开关。写成 "1"/"0"——那是**这个键的原主人**（v2.8.1）认的写法，
   * 于是从这支换回那一支时，用户的选择也跟着过去。
   */
  function writeSwitch(on) {
    try { localStorage.setItem(LS_KEY, on ? '1' : '0'); } catch { /* 配额满 / 无痕：不阻断面板 */ }
  }

  const interceptor = new AntiTruncationInterceptor();
  /* 渠道明显不支持时只提醒，绝不自动关用户的开关（核心段的注释里写了为什么）。 */
  setTransportIncompatibleHandler((msg) => notice(msg));

  /**
   * 切开关：写存档 + **真的**装/卸拦截器（不是只改一个标志位）。
   * 返回 { enabled, installed }：installed=false 表示"开关记下了，但没装上"
   * （外层窗口跨域，或那个窗口没有 fetch），调用方据此提示用户。
   */
  function setEnabled(next) {
    const on = next !== false;
    writeSwitch(on);
    if (on) {
      interceptor.install();
      interceptor.setEnabled(true);
    } else {
      interceptor.setEnabled(false);
      interceptor.dispose();     /* 关掉就把 window.fetch 上的包装整个摘掉 */
    }
    return { enabled: interceptor.isEnabled, installed: interceptor.installed };
  }

  const api = {
    interceptor,
    key: LS_KEY,
    isEnabled: () => interceptor.isEnabled,
    installed: () => interceptor.installed,
    lastRun: () => interceptor.lastRun,
    anchor: TRANSPORT_CONTROL_ANCHOR,
    setEnabled,
    enable: () => setEnabled(true),
    disable: () => setEnabled(false),
    read: readSwitch,
    write: writeSwitch,
    hostWindow,
  };

  /** 控制台 API：挂在本脚本的 globalThis 上；够得着的话再挂到宿主窗口上。 */
  try { globalThis.__FANO_ANTITRUNC__ = api; } catch { /* 忽略 */ }
  try {
    const w = hostWindow();
    if (w && w !== globalThis) w.__FANO_ANTITRUNC__ = api;
  } catch { /* 跨域等：忽略 */ }

  /* 启动时按开关决定装不装：关着就一个包装都不留（window.fetch 原样）。
     注意传进来的键也在这儿被规范化一次（老值 "true" 会被写成 "1"）。 */
  const started = setEnabled(readSwitch());
  eventLog.info('防截断运输已装载，开关=' + (started.enabled ? '开' : '关')
    + (started.enabled && !started.installed ? '（⚠ 拦截器没装上：拿不到宿主窗口的 fetch）' : ''));

  return api;
}
  /** 防截断实例。开关读 LS.antitrunc（= fano-antitrunc-v1，顶部 🛡 按钮同一个键）；
      出厂默认值来自 CONFIG.antitrunc.enabled。创建时即按开关决定装不装拦截器。 */
  const ANTITRUNC = createAntiTruncation({
    key: LS.antitrunc,
    defaultOn: CFG.antitrunc.enabled,
    /* 渠道明显不支持时的提醒出口（只提醒，绝不自动关开关）。 */
    onNotice: (msg) => notifyUser(msg, 'warn'),
  });
  /* ══ FANO_ANTITRUNC_END ═══════════════════════════════════════════════ */

  /* ── 顶部脚本按钮（酒馆助手）───────────────────────────────────────
     两个按钮：⚙ 芳乃（开合面板）、🛡 防截断（切换脚本层防截断的开关）。
     要注意的三件事（前两条是 v2.8.1 那边踩过的坑）：
       · 按钮必须**静态声明**在预设脚本的 button.buttons 里、且 button.enabled = true，
         否则酒馆助手根本不渲染按钮区——光在运行时调 API 没用（build-preset 已照此写，
         它声明的名字就是 CONFIG.button 里的那两个）。
       · 宿主不一定给这些 API（不同版本/沙箱），所以全部**特性检测**：拿不到就静默跳过，
         绝不能让面板因为按钮接不上而挂掉。
       · 「🛡 防截断」这里只切开关：真正的装/卸在 panel/src/antitrunc.js 里做
         （ANTITRUNC.setEnabled，存档键 LS.antitrunc = fano-antitrunc-v1）。
         按钮**只在这里注册一次**：antitrunc.js 那边故意不注册，否则一次点击会被
         两处监听各切一次，等于点一下没反应。 */

  /** 酒馆助手的宿主 API：不同版本把它挂在 globalThis / window / 最外层窗口 /
      TavernHelper 上，逐个试，拿不到返回 null（特性检测，绝不抛）。 */
  function hostApi(name) {
    const scopes = [];
    const add = (o) => { try { if (o && scopes.indexOf(o) < 0) scopes.push(o); } catch { /* 忽略 */ } };
    add(globalThis);
    add(window);
    add(HOST.win);
    for (const s of scopes.slice()) { add(s.TavernHelper); add(s.tavernHelper); }
    for (const s of scopes) {
      try { if (typeof s[name] === 'function') return s[name].bind(s); } catch { /* 忽略 */ }
    }
    return null;
  }

  try {
    if (!CFG.button.enabled) {
      console.log('[芳乃面板] CONFIG.button.enabled = false：顶部按钮既不静态声明也不接线');
    } else {
      const declBtn = hostApi('appendInexistentScriptButtons');
      const getEvt = hostApi('getButtonEvent');
      const onEvt = hostApi('eventOn');
      if (declBtn) declBtn([{ name: CFG.button.panel, visible: true }, { name: CFG.button.antitrunc, visible: true }]);
      if (getEvt && onEvt) {
        onEvt(getEvt(CFG.button.panel), () => {
          state.open = !state.open;
          writeLS(LS.open, state.open);
          render();
        });
        onEvt(getEvt(CFG.button.antitrunc), () => {
          /* 切开关 = 真的装/卸拦截器（见 panel/src/antitrunc.js 的 setEnabled）。 */
          const want = !ANTITRUNC.isEnabled();
          const st = ANTITRUNC.setEnabled(want);
          /* 报"实际发生了什么"：开关记下了但没装上，就得直说，不能报个"已开启"就完事。 */
          if (st.enabled && !st.installed) {
            notifyUser('脚本层防截断：开关已打开，但拦截器没装上（拿不到宿主窗口的 fetch）——'
              + '详情见控制台 __FANO_ANTITRUNC__', 'err');
          } else {
            notifyUser(`脚本层防截断：${st.enabled ? '已开启' : '已关闭'}`, st.enabled ? 'ok' : 'info');
          }
        });
      } else {
        console.warn('[芳乃面板] 宿主没给按钮 API（appendInexistentScriptButtons / getButtonEvent / eventOn），顶部按钮不接线');
      }
    }
  } catch (e) {
    console.warn('[芳乃面板] 顶部按钮接线失败（不影响面板本体）', e);
  }

  /* 启动失败也要说话，不能静默什么都不画 */
  try {
    await reload(false);
  } catch (e) {
    state.ready = false;
    state.lastError = String((e && e.message) || e);
    console.error('[芳乃面板] 启动失败', e);
    try {
      await whenHostReady();
      render();
    } catch { /* 实在画不出来就只剩控制台 */ }
    notifyUser('芳乃面板启动失败：' + state.lastError, 'err');
  }

  /* 启动自检：面板要是自己看不见，就用酒馆的 toast 把原因播报出来——
     手机上没有控制台，不播报就只能对着空气猜。 */
  try {
    await whenHostReady();
    const problems = selfCheck();
    if (problems.length) {
      notifyUser('芳乃面板：' + problems.join('；') + '　（可在控制台跑 window.__FANO_PANEL__.diagnose() 看详情）', 'err');
    }
  } catch (e) {
    console.warn('[芳乃面板] 自检失败', e);
  }
})();
