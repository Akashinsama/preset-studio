# 芳乃预设 · 锁定规格（SPEC）

> 本文件是唯一权威。任何实现细节与本文件冲突时，以本文件为准；要改必须先改这里。
> 最后确认：用户第 3 轮澄清 + 3 项选择（梦鲸=B / 面板=B / 功能=全量搬但收敛成子集）。

## 0. 一句话

自用酒馆预设：**朝武芳乃当助手主体**，**破甲按模型分流**（Gemini→Kemini / DS·GLM→梦鲸 / 其他→Izumi），
**非破甲功能全量取 Izumi 但收敛成子集**，**整体槽位结构照 Kemini**，
**面板是 Izumi 悬浮窗的精简重写版**，**配色换芳乃/千恋万花**。

## 1. 各层来源（照着填，不要自由发挥）

| 层 | 来源 | 处理方式 |
|---|---|---|
| 整体结构 / 槽位 | `Kemini_Dramatron_v3.1.json` | 照搬。`main` = `💠CLEAR`；`jailbreak` = `💠continue`；`<DATA>/</DATA>`、`<HISTORY>/</HISTORY>` 包裹结构保留 |
| 破甲 · Gemini | Kemini | 搬它的破甲组（CLEAR / ROLE AND GUIDE / 假对话预填充 / 防截断 / 雪融雪降） |
| 破甲 · DS·GLM | 梦鲸思客V4 | **只搬 6 条**：`梦境思客`、`V4Pro神秘小指令`、`Deepseek官方`、`硅基流动或其他`、`DeepSeek禁词`、`Glm/Gemini禁词` |
| 破甲 · 其他模型 | `Izumi_0914.json` | 搬它的破甲组，放在最后当兜底 |
| 非破甲功能 | Izumi | **全量搬条目**，但收敛成子集，面板渲染成下拉框 / 开关排 |
| 面板 | Izumi 悬浮窗 | **重写精简版**（不是改它那 10937 行） |
| 配色 | 千恋万花 / 朝武芳乃 | 替掉设计 token |
| 助手主体 | 朝武芳乃 | 共享身份层（元叙事助手位），与故事角色层隔离 |

## 2. 明确不要的东西

- 梦鲸的：DREAM_PLOT / XML Schema 协议、MVU、6 个脚本管线、正则美化、`压缩相邻消息` 宏、摘要/选项/叙事者/说书/大调查等全部功能条目。
- Kemini 的：向导（onboarding）、仪表盘、诊断、`promptRegistry` 那套面板、它的"功能"条目（人称/文风/剧情偏好等）。
- Izumi 的：`泉此方` 人设与标识、悬浮窗的全部非核心模块（见 §5）。
- 权限边界：不新写/不强化绕过安全机制的提示词（只做既有文本的工程化搬运）；剔除梦鲸 `<创作>` 里"任何虚构年龄层的内容"那一条。

## 3. 破甲：先选骨架，再调档位

破甲分两层，都由面板管：

**第一层 · 骨架（bundle，三选一互斥）**——决定用哪一套破甲结构。切换时开满选中那套的全部骨架条目、关掉另外两套。

| 选项 | 来源 | 骨架条数 | 内容 |
|---|---|---|---|
| Gemini | Kemini | 18 | `🔗`、`💠CLEAR`、`🎬ROLE AND GUIDE`、`<DATA>/<HISTORY>` 包裹、`⚙️SETTING`、`🎬ROLEPLAY GUIDE`、`💠continue`、`💠BEGIN`、`💠FAKE` |
| DeepSeek / GLM | 梦鲸思客V4 | 1 | `梦境思客`（`<meta>` 反注入核心） |
| 其他模型 | Izumi | 4 | `✓头部破甲`、`flash破甲`、`🐱基米flash适配`、`⚡️防机器人（数据化就开）` |
| 手动 | — | 0 | 全关，自己开 |

**第二层 · 档位（tunable）**——每套骨架下可调的开关。**档位不受切换影响**，用户的选择会保留。

| 骨架 | 档位 | 模式 | 内容 |
|---|---|---|---|
| Gemini | 思维链档位 | 单选 · 必选一 | `📽️ICOT（三段）` / `📽️COT（格式友好型）`，缺省时自动补 ICOT |
| Gemini | 防截断档位 | 单选 · 可全关 | `📐牢大防截断` / `💿普通防截断`（互补关系，不是强弱；用不上开着是反效果） |
| Gemini | NSFW 加强 | 多选 | `💗NSFW`（仅角色卡自带 NSFW 时有效） |
| Gemini | 雪融雪降填充文本 | **正文编辑** | `💠雪融雪降！…` —— 面板内置编辑框，用户必须换成自己的 ≥7000 token 私有小说段落 |
| DeepSeek / GLM | 渠道 / 思考标签 | 单选 · 必选一 | `Deepseek官方`（`<｜begin▁of▁thinking｜>`）/ `硅基流动或其他`（`<think>`）/ `KimiK3思考` |
| DeepSeek / GLM | 模型禁词 | 多选 | `DeepSeek禁词` / `Glm/Gemini禁词` / `自定义禁词` |
| DeepSeek / GLM | V4Pro 神秘小指令 | 多选 | `V4Pro神秘小指令` |
| 其他模型 | 防截断档位 | 多选 | `kemini防截断(强)` / `超长防截断（k,mygo）` |
| 其他模型 | 破甲强度 | 多选 | `破甲1-Claude` / `😤破甲1` / `😤破甲2` / `不用开` |
| 其他模型 | 尾部 / 预填充 | 多选 | `非预填充尾部` / `基米flash尾部` / `基米flash尾部1` / `卡思维链（K）` |

**面板要记住用户选的骨架**（存 localStorage），不能靠"哪套成员的都开着"去猜——梦鲸那套骨架只有 1 条，源预设里恰好开着就会误判。

## 3b. 来源提示词一律不改名（硬约束）

**用户明确要求：三份源预设里的提示词正文与原作者角色名必须原样保留，一个字节都不动。**

因此：

- `spec/groups.json` 的 `display` 恒为空对象——面板显示名 == 源条目名，不做任何改名。
- `tests` 断言 `display` 为空、且界面上「小此」仍然存在、且不存在「🔵芳乃对话」这类被改名的痕迹。
- `tools/build-preset.mjs` 对每条搬运过来的条目做 **content / name / role / system_prompt 逐字段哈希比对**，任何一处不一致就拒绝产出。
- `tools/check-preset.mjs` 再独立复核一次，并额外核对 `泉此方` / `小此` / `Konata` 在成品里的**出现次数**与三份来源合计完全相同。
- `spec/rename.json` 现在只承担一件事：思维链折叠条上的**显示文案**（用户单独要求的「芳乃祈福中」）。它不碰任何 prompt。

**芳乃怎么落地**：只增不改。芳乃是 `spec/fano-layer.json` 里我新写的三条（`🌸芳乃 · 助手主体` / `🌸芳乃 · 称呼` / `🌸芳乃 · 祈福口癖`），默认全部关闭——它和破甲分支自带的身份（Kemini 的 Dramatron、Izumi 的泉此方）会争同一层，不开就不会打架。成品里新增条目的集合必须**恰好等于**这三条，校验器会卡这一点。

## 3c. 思维链显示：块数决定形态

产物 `preset/fano-thinking-chain.json`，由 `tools/build-regex.mjs` 生成，共 **4 条、顺序敏感**（ST 按数组顺序依次套用）。

**规则（用户要求）**：

| 模型实际吐出的思考块数 | 显示形态 |
|---|---|
| 1 块 | **Izumi 形态**（毛玻璃卡片，文案 `💕 芳乃祈福中✨`） |
| ≥2 块 | **Kemini 形态**（每块一个朴素折叠条，文案 `芳乃祈福中`） |

**纯正则实现，不需要脚本**——靠"顺序 + 前瞻"：

| # | id | findRegex | 作用 |
|---|---|---|---|
| 1 | `fano-think-multi-head` | `/<(?:think\|thinking)>([\s\S]*?)<\/(?:think\|thinking)>(?=[\s\S]*?<(?:think\|thinking)>)/gi` | 折"后面还有思考块"的块 → Kemini 形态（即除末块外的全部） |
| 2 | `fano-think-multi-tail` | `/(<details class="fano_thinking"[\s\S]*?<\/details>[\s\S]*?)<(?:think\|thinking)>([\s\S]*?)<\/(?:think\|thinking)>/gi` | 前面已有 Kemini 折叠块时，把末块也折成 Kemini 形态（`$1` 前缀 + 模板的 `$1`→`$2`） |
| 3 | `fano-think-single` | `/<(?:think\|thinking)>([\s\S]*?)<\/(?:think\|thinking)>/gi` | 剩下没被折的（全程只有一块）→ **Izumi 形态** |
| 4 | `fano-think-konatan` | `/([\s\S]*)<\/konatan_planning~>/g` | Izumi 标签，保持 Izumi 原行为 → Izumi 形态 |

第 1、2 条的前瞻/前缀条件保证了"块数决定形态"：只有一块时第 1、2 条都不匹配，第 3 条才接手。

其他约定：

- 全部 `markdownOnly: true` + `promptOnly: false` + `placement: [2]`——**只影响显示，不改变发给模型的内容**。
- Kemini 模板的 marker 类名改成 `fano_thinking`（避开别的预设、也给第 2 条一个稳定锚点）。
- 剥掉 Google Fonts CDN 依赖。
- 验证：`tools/test-regex.mjs`（30 项）把链套到模拟输出上，逐一验 1 块 / 2 块 / 3 块 / Izumi 标签 / 无块 五种情形。

## 3e. 思维链标签互斥（混排的根源）

**踩过的坑**：Kemini 的 `📽️ICOT（三段）` 要求用 `<thinking>`，而且明确"输出主体分为**三段**"（模型因此吐 3 个思考块）；Izumi 的 `思维链-*` 要求用 `konatan_planning~`。源预设里这两套各自都是开的，直接拼在一起就变成**两种指令同时生效**——模型把两种都吐出来，折叠后就是用户看到的"一个 Izumi 形态 + 好几个 Kemini 形态"混排。

`spec/groups.json` 的 `thinkingTags` 把它们按标签分成两组：

| 标签组 | 标签 | 成员 |
|---|---|---|
| `kemini` | `<thinking>` | `📽️ICOT（三段）`、`📽️COT（格式友好型）` |
| `izumi` | `konatan_planning~` | Izumi 的 9 条 `思维链-*` + `快速思维链` + `不要思维链了` + `卡思维链（K）` + `非预填充尾部` + `基米flash尾部` + `基米flash尾部1`（共 15 条） |

规则：**组内可共存（Izumi 的思维链本来就要和预填充尾部配对用），跨组互斥**。面板在每次写入前跑 `enforceThinkingTags()`，开了某组就把其它组的成员全部关掉；组装时也显式指定唯一默认（`📽️ICOT（三段）`）。

**「个数」由 COT / ICOT 决定**（本来就是这样，不需要新开关）：

- **ICOT（三段）** → 3 个思考块 → Kemini 形态
- **COT（格式友好型）** → 1 个思考块 → Izumi 形态
- Izumi 系任一思维链 → 1 个 `konatan_planning~` 块 → Izumi 形态

所以思考方式现在只有一个入口：面板的「**思维链 / 思考方式（选一）**」下拉框，Kemini 的 ICOT/COT 与 Izumi 的思维链都收在里面（13 项）。**ICOT/COT 不再是破甲骨架的档位**——放在档位里会随骨架被强制开启，正是导致混排的路径之一。

## 3f. MVU 变量更新（一键开关）

**要求**：一个开关就能开关变量更新，同时兼容普通 MVU 与 MVU Zod；旧的 `✅MVU Zod兼容` 去掉。

**旧做法为什么不行**（Izumi 原设计）：骨架塞在 `{{setvar::mvu::}}` 变量里，再由「格式示例」里的 `{{getvar::mvu}}` 展开。

- 生产者（`✅MVU Zod兼容` / `✅MVU兼容（用再开）`，在 `adapter` 模块）与消费者（3 个「格式示例」，在 `format` 模块）**分散在两个模块**，只开一半就等于没开——用户实测：模型完全不更新变量。
- 而且「格式示例」是五选一，其中 `🔵吐槽（普通）`、`吐槽思维链尾` **不读** `mvu`，选了就静默失效。
- `初始化变量（别动）` 会把 `mvu` 清空，所以没生产者时 `{{getvar::mvu}}` 展开成空字符串。

**新做法**：骨架**字面写入条目**，不经过任何变量。

| 条目 | 文件 | 内容 |
|---|---|---|
| `🔧MVU · 变量更新（普通）` | `spec/mvu-layer.json` | `<UpdateVariable><Analysis>…</Analysis>（变量更新内容）</UpdateVariable>` |
| `🔧MVU · 变量更新（Zod / JSONPatch）` | 同上 | `<UpdateVariable><Analysis>…</Analysis><JSONPatch>…</JSONPatch></UpdateVariable>` |

- 两条都是**本预设新写的**（来源提示词一字未改），统一 `🔧` 前缀，**默认关闭**。
- 面板模块 `mvu`（`mode: single`）三选一：`不使用` / `MVU（普通）` / `MVU Zod`——一次点亮一条，互斥自动成立，**不再依赖别的模块**。
- 两条都明确要求变量块放在**整轮回复最末尾**、整轮只输出一次、无变更则不输出。

**移除的**：`✅MVU Zod兼容`、`✅MVU兼容（用再开）` 两条来源条目**不再搬运**（`build-groups.mjs` 里归入 hidden 规则 `mvu_old`）。留着会形成第二套竞争机制，正是之前反复踩的那类坑。用户只点名要求去掉 Zod 那条，另一条是同机制的孪生条目，一起去掉才自洽。

**预设管不到的前提**（写在文档里）：解析并应用 `<UpdateVariable>` 的是酒馆助手的 MVU / 变量更新扩展；变量定义来自角色卡或世界书的 schema。

**校验**：`check-preset.mjs` 断言「新增条目恰好是芳乃层 + MVU 层」「旧的变量式 MVU 条目已移除」「没有任何条目再往 mvu 变量里塞骨架」；`test-panel.mjs` 断言三选一开关的开/关/切换各写回一次且两条不会同时开。

## 3d. 可编辑条目（自定义内容）

有些条目不是开关，是**要用户自己敲内容**的。它们在 `spec/groups.json` 里由 `custom` 模块的 `editable` 字段统一登记（唯一真相），面板给它们真正的输入框。

| 条目 | 归属 | 处理 |
|---|---|---|
| `🔴指南（可改）` | custom（固定开启） | 输入框 + 「固定开启」标签，只能改内容不能关 |
| `☀️自定义缝合处` | custom（固定开启） | 同上 |
| `🤖自定义（字数）` | `length` 单选的一档 | 选中后**就地**出现输入框；custom 模块里也有一份 |
| `思维链-自定义` | `cot` 单选的一档 | 同上 |
| `🧐用户画像（点进去看）` | custom（可开关） | 输入框 + 启用开关 |
| `自定义禁词` | DS/GLM 档位「模型禁词」 | 档位里带「✎ 填内容」；custom 模块里也有一份 |

设计规则：

- **`custom` 模块是"视图"，不是唯一入口。** 其中三条已被各自的模块当成选项/档位拿走，一条来自梦鲸而非 Izumi，所以它的成员以 `EDITABLE_INFO` 显式清单为准，不走分类。在哪个入口改，写的都是同一个条目，不会不一致。
- **单选模块**：选中的是可编辑项 → 输入框直接摊在下面；没选中时给一行提示。
- **多选 / 档位**：可编辑项旁边挂一个「✎ 填内容」按钮，点开才渲染输入框（避免面板被一排大文本框撑爆）。
- **每条都带提示文案**（`hint`），说明这一条什么时候生效、该填什么。构建时会检查缺文案的项。
- 保存/撤销分开：`保存` 写入预设（一次写回），`撤销改动` 只把输入框恢复成预设里的当前值，不写回。

## 4. 槽位归属（硬约束，不可协商）

`main`、`jailbreak`、`nsfw`、`chatHistory`、`dialogueExamples`、`charDescription`、
`charPersonality`、`worldInfoBefore`、`worldInfoAfter`、`personaDescription`、`scenario`、
`enhanceDefinitions` 在 SillyTavern 里全局唯一。

- `main` → **Kemini 的 `💠CLEAR`**（Izumi 的 `💾主提示` 降级为普通条目，不进 main）
- `jailbreak` → **Kemini 的 `💠continue`**
- `nsfw` → 保留 Izumi 的 `信息结束`（Kemini 那条 `123213wsdasdasdasda` 是关闭的噪声，不搬）
- 其余槽位结构照 Kemini 的 `<DATA>` / `<HISTORY>` 包裹方式

## 4b. 注入锚点（永远开启，不属于任何破甲分支）

**这是踩过的坑，务必守住。** 上表那些槽位条目，加上 Kemini 的 `<DATA>` / `<HISTORY>` 包裹条目，合起来是**注入锚点**：酒馆靠它们的位置把世界书、角色卡、用户人设、聊天记录塞进提示词。

共 12 条，在 `spec/groups.json` 的 `anchors` 数组里，属于 `anchors` 模块（`mode: fixed`，面板不给开关），组装时**无条件强制开启**：

```
💠CLEAR( main )　💠continue( jailbreak )
💠↑Char( worldInfoBefore )　💠↓Char( worldInfoAfter )
💠Char Description　💠Char Personality　💠Persona Description　💠Scenario
💠<DATA>　💠</DATA>　💠<HISTORY>　💠</HISTORY>
```

**曾经的错误**：把这 12 条放进了 Gemini 破甲骨架的成员表。后果是——切到 DeepSeek/GLM 或其他模型时，面板会把"Gemini 骨架全部关掉"，于是连世界书与角色卡的注入位一起关掉，**整个上下文丢失**（用户实测报告：切模型后前后文都没了，世界书不注入）。

**现在的防线**：

- 构建期：`build-groups.mjs` 报告锚点清单；`build-preset.mjs` 对锚点无条件 `enabled = true`。
- 校验期：`check-preset.mjs` 断言「没有锚点被塞进破甲骨架或档位」「全部锚点初始开启」「10 个关键槽位初始全部开启」。
- 面板测试：`test-panel.mjs` 依次切到四个骨架选项（含「手动」），每次都断言 10 个关键槽位与 12 个锚点**全部仍在**。

**已知取舍**：`main` / `jailbreak` 由 Kemini 的 `💠CLEAR` / `💠continue` 占着，它们是锚点所以永远开启——意味着切到 Izumi 或其他分支时，主提示与预填充位里仍是 Kemini 的文本。要彻底做到"每个分支自带自己的主提示"，需要面板在切换时**改写 identifier 归属**（把 `main` 从 `💠CLEAR` 挪给 `💾主提示`）。这是可选增强，未实现，因为它会让条目 id 变动，风险高于收益。

## 5. 面板（Izumi 悬浮窗精简重写版）

**保留**：
1. 悬浮窗本体：拖动、缩放、位置/尺寸记忆（PC + 移动）、收起、彻底关闭、刷新
2. 夜间模式（白天 / 夜间两套芳乃配色）
3. 条目开关：按子集渲染（single → 下拉框；multi → 开关排）
4. 互斥规则：single 子集内开新的自动关旧的
5. 小方案：把"开哪些条目"的组合存下来、一键切换
6. advice：开关 + 插入位置（头 / 尾）+ "按照advice继续吧。"
7. 写回预设：`updatePresetWith`，沿用 Kemini 的 `has()/attempt()` 防御式适配器写法
8. 芳乃配色 / 标识

**丢掉**：大方案管理、方案对比、导入导出、存储占用报告与垃圾键清理、sanitizer / 关键词替换、会话快照、内置教程、长按头像菜单。

**技术口径**：
- 不依赖 CDN（梦鲸面板从 jsdelivr 拉 Vue/Pinia/Zod，这条必须避免）。
- 依赖：`酒馆助手`（TavernHelper）的 `getPreset("in_use")` / `updatePresetWith` / `eventOn`。
- 条目定位优先用 prompt `identifier`（UUID），名称兜底（沿用 Kemini 的 `stableId` + `nameFallbacks` 思路）。

## 5b. 手机兼容（踩过的坑）

用户在手机浏览器里打不开面板／悬浮窗。真浏览器 390×844 视口回归**全过**，说明不是纯 CSS 尺寸问题；
于是按四类真实原因分别加固：

| 问题 | 根因 | 修法 |
|---|---|---|
| **悬浮球算到视口外**（实测 `(12,-158) / 视口 360×695`） | 悬浮球原先靠 `.fp-root{inset:0}` 撑满视口 + `bottom:96px` 定位。**根容器只要没被拉伸成视口大小**（页面某层祖先带 `transform`/`filter`/`contain`，`position:fixed` 就被关进那个祖先的坐标系），`bottom` 就是从零高度算出的负值（-96-46-16 = -158 正好对上） | 悬浮球与窗口改为**各自 `position:fixed`**，坐标由 JS 按视口算好写进行内样式：**不再依赖容器尺寸，也不依赖 `bottom`/`env()` 的解析**。`.fp-root` 退化成 `0×0` 的事件穿透壳。渲染后调用 `afterRenderPlacement()` 量一次；跑飞就把面板**改挂到 `documentElement`**（body 的兄弟）绕开 body 层的 transform，再渲染一次（`remountTried` 保证只重试一次） |
| **挂在看不见的 iframe 里** | ①原实现只往上看**一层** `window.parent`；②解析 HOST 时要求父文档 `document.body` **已经就绪**。脚本执行时机只要稍早于父文档解析完，`body` 就是 `null` → 静默退回本地文档 → 面板挂进看不见的 iframe。桌面与手机加载时序不同，这正是"桌面好、手机坏"的典型成因 | `HOST` 一路走到**最外层同源窗口**（≤10 层）；**不再要求 body 就绪**，用 `whenHostReady()` 等待（`DOMContentLoaded` + 轮询兜底），绝不退回内层 |
| 出错后什么都不画（死寂） | `body.appendChild` 或样式注入抛异常 → 整个面板一个元素都不渲染，且没有任何提示 | `render()` 先等 body；`ensureStyle()`/`toast()` 各自容错；启动整体包 try/catch 并播报 `lastError` |
| 打开了却看不见 | 存的 `pos`/`size` 被无条件套用 | `clampToViewport()` 每次渲染前夹回视口；`resize`/`orientationchange` 后重新夹 |

**可见性自检 + 播报**：手机上打不开控制台，所以面板启动后会跑 `selfCheck()`
（跨域回退 / body 未就绪 / 根节点没插入 / 悬浮球没创建 / 悬浮球在视口外 / 读取预设出错），
有问题就用**酒馆自带的 `toastr`** 把原因播报出来——正常时不打扰用户。
`measureBall()` 会一并报出根容器高度与当前挂载点，便于定位是哪一类。

**自救入口**：`window.__FANO_PANEL__.reset()` 清掉存的位置/尺寸/开关状态并把面板拉回默认。
**版本标识**：`VERSION` = `0.2.0`，`diagnose()` 会报出来，用来确认导入的是哪一版。

**新增测试层**：`tools/test-iframe.mjs`（25 项）覆盖之前**从没被测过**的挂载路径——
两层嵌套 iframe 是否挂到最顶层、父文档 body 未就绪时是否等待而非退避、跨域时是否回退并示警、
自检是否播报、**悬浮球跑飞时是否改挂到 `documentElement`**。其中"body 未就绪"与"跑飞自愈"
两条在修复前必然失败。

**测试桩也修了两个会掩盖真相的缺陷**（三个假 DOM 文件统一）：
`getElementById` 原先扫"创建过的全部节点"（重渲染后返回已脱离文档的旧节点）、
`appendChild` 不把节点从原父级移走（"改挂"会看起来像复制了一份）。
这两个缺陷此前已分别掩盖过一次真实布局问题。

## 5c. 面板 0.6.0：按钮改隐藏 / 壁纸开关 + 纯色 / 小方案改名（**0.7.0 起改名手势改成三击，见 §5d**）

三条都是用户点名要的，属于"面板长什么样、怎么用"的规格，所以记在这里。
面板 `VERSION` 从 `0.5.0` 升到 **`0.6.0`**（酒馆里靠 `__FANO_PANEL__.diagnose().version` 确认导入的是哪一版）。

### 5c-1 顶部按钮 = 整块隐藏（不再是"开合窗口"）

原行为：点一下把面板窗口开/关。**改为**：点一下把**悬浮球与面板一起**藏起来，再点一下回来。

- 走 `toggleHidden()`——它与 Ctrl+Shift+F、`__FANO_PANEL__.hide()/show()` **同一条路**，不许各写一套。
- 隐藏状态**落盘**（`_hidden_v1`）：`按钮本身就是回来的路`，所以记住是安全的；
  另外两条出口照旧保留（Ctrl+Shift+F、`__FANO_PANEL__.show()`）。手机上没键盘，所以按钮这一条必须可靠。
- 按钮名仍是 `CONFIG.button.panel`（可配置），**语义与文案都变了**：0.6.0 起默认文案是
  **`🙈 隐藏`**（不再是 `⚙ 芳乃`——那个字样连同"开合面板"的说法一起退休了），
  装进**别人的**预设时写的也是这一句（不再按预设名拼）。

### 5c-2 壁纸开关 + 纯色背景（标题栏两个小控件）

只有**配了壁纸**（`CONFIG.wallpaper.url` 非空）时才长出来——没配就没有可开关的东西。

| 控件 | 行为 |
|---|---|
| `🖼` / `🎨`（`.fp-icon`） | 开关壁纸。关掉 → 底色层换**纯色**、图标变 `🎨`；再点回来 |
| `input[type=color]`（`.fp-color`） | **只在关掉壁纸时出现**，选纯色底；开着壁纸时不给（那时它不生效，给了只会误导） |

- **两层，各管各的**：
  · **预设层**（进文件、编辑器里能设）：`CONFIG.wallpaper.enabled` = "这份预设出厂时壁纸开不开"；
    纯色是**配色 token `--fp-solid`**（昼夜各一个）。放进主题里 = 外观页自动长出两个取色器，
    不用另写 UI，也不会有"两份实现漂移"的问题。
  · **使用者层**（只在本机、不进预设）：`LS.wall = { on?, color? }`——他点过就以他点的为准。
- 状态存 `LS.wall = { on?, color? }`。跟夜间模式一样是**使用者偏好**：存本地、**不进预设、不碰 `CONFIG`**。
- 纯色默认按昼夜给（`DEFAULT_SOLID`）。**只有他显式关过壁纸才接管底色**——否则等于替所有人
  把"没配壁纸"那种半透明观感也换掉。
- 实现要点：底色层读 `var(--fp-solid-bg, var(--fp-overlay))`。用**新变量**而不是覆盖 `--fp-overlay`：
  主题写在 `.fp-root[data-theme]` 上，比 `.fp-root` 更具体，直接覆盖会被主题盖掉。
  关掉壁纸时发 `--fp-solid-bg: var(--fp-solid)`——`var()` 按当前昼夜解析，所以昼夜两套自动生效；
  用户自己选过色就发那个色（盖过昼夜）。
- 选色走 `input` 事件、且**只更新样式变量不重画**（重画会把正在拖的那个控件换掉，手感直接断）。

### 5c-3 小方案：三击 chip 就地改名

- **三击**方案 chip（每两下之间不超过 `CONFIG.edit.tripleClick.ms`）→ chip 就地变成输入框；
  Enter / 失焦保存，Esc 放弃。（0.6.0 时这个手势是长按，0.7.0 起跟着条目正文一起改成三击，见 §5d。）
- **不受 `CONFIG.edit.tripleClick.enabled` 影响**（那个开关管的是"三击条目改正文"，与小方案无关），
  所以 `rowClicks` 有 `force` 开关复用同一套手势实现。
- 不用 `prompt()`：面板跑在酒馆页面里（可能是嵌套 iframe），原生弹窗在手机与沙箱里表现不一；
  就地输入框没这个问题，而且看得见自己在改哪一个。
- **手势分工（用户点名要的）**：点一下 = 应用这个方案；**三击 = 就地改名**；**长按或右键 = 删除**
  （长按那条是给手机的：那里点不出右键；按住 600ms、移动超过 8px 就当滚动取消）。
  长按是**非点击手势**，触发时先调 `rowClicks` 那个 handler 的 `cancelPending()` 把点击那套作废——
  否则松手跟来的那次 click 会顺手把方案应用一次（每个动作都是一次写回）。
- **三击顺手的那两下不会把方案应用掉**：前两下点击被 `rowClicks` 推迟并丢掉，
  否则改完名会顺手应用两次（每次都是一次写回）。

### 5c-4 能力标记（0.6.0）

面板源码里多声明一行 `FANO_PANEL_CAP_CONTROLS_V06`，`tools/gui/lib/editor.js` 的 `PANEL_CAP_MARKS` 认它：

- 预设里那份面板**缺这个标记**（= 0.5.0 或更早）→ 导出前**拦住**，kind 是
  「面板是旧版：没有隐藏按钮 / 壁纸开关 / 小方案改名」，并给「换成新版面板」与
  「就带这个旧面板导出」两条路——与既有的 longPressEdit 那条同款分寸。
- 两个标记**各自独立**：缺哪个说哪个；但"就带旧的"说一次就够（共用 `staleIgnored`，不问两遍）。
- 为什么值得拦：老面板装进酒馆是"看着差不多、功能没有"，而这批正是用户点名要的功能。
- 断言：`test-gui.mjs` 的 `[20]` 节加了 5 条（两个标记都在 / 只缺一个 / 两块都缺 → 两条拦截 / 一句话放行）。

### 5c-5 验证

`tools/test-panel.mjs` 加 **25 项**（155 → 180，0.7.0 后是 185）：按钮隐藏/回来/落盘、三击 chip 出输入框并改名、
壁纸开关（另起一套壳把壁纸塞进 `CONFIG` 再加载一遍）、纯色变量声明的出现与撤掉。
`tools/test-iframe.mjs` 的版本断言跟着升到 `0.6.x`。
真浏览器那两层照跑：`check-browser.mjs`（面板布局，58 项 × 桌面+手机）与
`check-gui-browser.mjs`（生成器十屏，235 项 × 桌面+手机），全部为 0 失败。

## 5d. 面板 0.7.0：改正文的手势从长按改成三击

用户要求：条目正文、小方案名这些"打开编辑器"的动作，一律由**长按**改成**三击**。

- **实现**：`rowClicks({ onClick, onTripleClick, force })` 一个入口同时管两件事——
  单击**推迟 ms 毫秒**再执行（看后面还有没有第 2、3 下），三击执行 `onTripleClick` 并**丢掉**那两下单击。
  推迟是必须的：三击的前两下也是 click，不推迟就会顺手把条目开关两次、把方案应用两次（每次都写回一次预设）。
  计数挂在**每个节点自己的闭包**里——三击会重渲染，旧节点上派发来的 click 也要数得到。
- **代价**（写在界面文案里）：单击会等一个窗口才生效。窗口 = `CONFIG.edit.tripleClick.ms`，
  默认 **250**，夹在 250–1500（下限就是 250：再小就来不及点三下）。
- **兼容老预设**：老面板的 CONFIG 里那个键叫 `edit.longPress`。读的时候**只继承 enabled、不继承 ms**——
  旧的 500 是"按住多久"，与三击窗口不是同一个量，照搬会让每次单击白等半秒。
  而且 `clampConfig` 必须从**原始入参**读老键：`mergeConfig` 会把新键补上，`??` 就永远轮不到老键（踩过）。
- 能力标记：`FANO_PANEL_CAP_LONGPRESS_EDIT`（"能不能改正文"）**不改名**，但**另加**一个
  `FANO_PANEL_CAP_TRIPLE_CLICK`（"手势是不是三击"）。**这一条是补的，而且必须补**——
  只留旧标记的话，0.6.0 的面板（能改正文、但手势是长按）不会被判成旧版，而
  「应用到面板脚本」只换配置与分组、**不换代码**：用户把配置改成三击之后导出的预设是
  **"新配置 + 旧代码"**，三击毫无反应，卡片还显示绿色、不给「换成新版面板」，人就卡住了（真踩过）。
  `caps()` 的 `longPressEdit` / `longPressMs` 两个键仍保留（那是界面与测试读的能力位）。
- **验证**：`test-panel` **187**（[14] 整段按三击重写，含"两下不算三击、只当点一下"；
  [15b] 三击改名 + 长按删除）、
  `test-panelconfig` **104**（含"老键只继承 enabled 不继承 ms"）、`test-gui` **358**、`test-iframe` **34**。
  真浏览器那两层这次**没跑**（用户要求只验这一个画面）。

## 6. 子集骨架

面板按子集组织；每个子集有 `id / label / mode(single|multi|fixed) / members`。
`fixed` 表示固定启用、不暴露给用户。

| 子集 | 模式 | 内容 |
|---|---|---|
| `core` | fixed | 说明、初始化变量、内置槽位、`指南`、`格式要求结束`、`接`/`过渡`/`飞二楼`、扩写输入 |
| `jb_gemini` / `jb_dsglm` / `jb_izumi` | single（三选一） | 见 §3 |
| `style_main` | single | Izumi 主文风区（顺眼舒服 / 自适应叙事 / 紙芝居 / 日轻 / 小此爽写 / 小此说故事 / 武侠 / 质感写作 / 英式幽默 / 民国物哀 / 少年漫 / 小此散文 / 小此音声 / 小此漫改 / 网文 / 古风视觉小说） |
| `style_third` | multi | 第三人称追加文风（鲁迅 / Eula闲谈 / 闲谈示例×3 / 日日日 / 意识流 / 节奏大师 / 异世界战斗 / 哥杀 / 舞台剧2.0） |
| `style_first` | multi | 第一人称追加文风（意识流2.0 / 入间人间 / 伏见司 / 江南） |
| `style_nsfw` | multi | 可写 NSFW 文风（体型差 / 木珠 / 王小波 / 实验-nsfw / 本子 / ASMR / 直白色情 / 谷崎 / 广播剧 / 男性视觉） |
| `style_lib` | multi | 备选文风库（金庸 / 古龙 / 川端康成 / 麻枝准 / 镰池和马 / 邱妙津 / 女性向第一人称 / 自用）——默认不在条目列表，面板提供"加入" |
| `person` | single | 人称 4 种 |
| `dialogue_amt` | single | 对白量 4 档 |
| `difficulty` | single | 难度 3 档 |
| `cot` | single | 思维链 7 种 + Roland / 防机器人 / 快速 / 不要 |
| `cot_lang` | single | 思维链语言 7 种 |
| `guard` | multi | 叙事与防护开关（防429 / 防转折 / 允许转折 / 反直觉 / 剧情疯狂 / 防发情 / 防不发情 / 防情绪化油腻 / 慢推 / 推剧情 / 客观叙事 / 转述 / 防转述 / 防神化 / 防绝望 / 抢话 / 防抢话 / 防小此乱入 / 不只看user / 不许狂暴色色 / 防揣测 / 不许语气描写 / 防过度描写 / 防机器人 / 防全知三档 / 防重复上文 / 防媚user / 防叛逆 / 涩涩加速 / 高上下文 / 小巧思） |
| `nsfw` | multi | NSFW 指导与加强（黑森森 / 三选一 / 真实 / 加强 / 温柔加强 / 心理描写 / 禁词表） |
| `length` | single | 字数（自定义 / 字数加强） |
| `summary` | single | 摘要 4 种 |
| `out_mode` | single | 输出模式四选一（创作思路 / 吐槽 / 小此对话 / 情感陪伴） |
| `format` | single | 格式示例（吐槽版 / 其它 / 克劳德 / 吐槽普通 / 吐槽思维链尾） |
| `tail` | single | 尾部（卡思维链 / 非预填充尾部 / 基米flash尾部×2 / 快速思维链 / 不要思维链了 / 短对话模式） |
| `adapter` | multi | 适配（女性向 / Claude / 基米flash / 同人增强 / 事实增强 / MVU兼容×2） |
| `ui` | multi | 前端与美化（NyPigment / 选项栏 / 平行事件 / 弹幕小剧场） |
| `misc` | multi | 其余实验项（用户画像 / 概念锚定 / 性格标签 / 小说模式user / 双语对话 / 正文中文加强 / 自定义缝合处 / 增强输入 / 拷打模式 / 聊天模式1 / 头脑风暴 / 发散 / 暂时别用 / 通用主提示 / 泉此方人设 / 闲聊指南 / 额外要求三档） |

## 7. 已确认的技术事实（不要再重新假设）

- `{{addvar::}}`、`{{getglobalvar::}}`、`{{setglobalvar::}}`、`{{incvar::}}`、`{{decvar::}}`、
  `{{hasvar::}}`、`{{deletevar::}}`、`{{//注释}}`、`{{roll::}}`、`{{charIfNotGroup}}` 都是 **SillyTavern 原生宏**。
  → 梦鲸的 `addvar` 累加式开关不需要任何插件。（依据：https://docs.sillytavern.app/usage/macros.md）
- 三份预设里唯一真正的外部宏依赖是 `{{压缩相邻消息::…}}`（酒馆助手脚本提供），只出现在梦鲸，**本次不搬**。
- 变量撞名只有两处：`qianghua`、`zhuanshu`（Izumi 与 Kemini 同名不同义）。梦鲸用 `sleep_var_*` 前缀，干净。
- Izumi 悬浮窗写预设用 `updatePresetWith`，读用 `getPreset("in_use")` / `getPresetNames()`；
  用 `class TavernHelperAdapter` + `has()` / `attempt()` 做版本防御——新面板沿用这个写法。
- Izumi 悬浮窗配色落点只有 28 个 token（`--iz-*` / `--wf-*`，自带白天+夜间两套，其中已有 `--iz-pink-white`）。
- Izumi 悬浮窗自带「自动识别子区」和「只开一个的互斥子区」，正好承载 §3 的破甲三选一。

## 8. 成品与流水线

产物：`preset/芳乃预设-v1-<日期>.json`（≈0.48 MB，233 条：来源 230 + 芳乃 3）。

组装规则：

| 项 | 规则 |
|---|---|
| 骨架 | 整体照 `Kemini_Dramatron_v3.1.json`：顶层 47 个字段、采样参数、`SPreset` 插件配置、`character_id=100001` 全部照抄 |
| 顺序 | 芳乃层 → Kemini 块 → Izumi 块 → 梦鲸块；块内保留各来源自己的 `prompt_order` 相对顺序（梦鲸靠 `addvar` 累加、Izumi 靠变量初始化在前，都不能打乱） |
| 注入锚点 | 12 条，**无条件开启**，不属于任何破甲分支（见 §4b） |
| 初始开关 | 默认走 Gemini 骨架（6 条：`🔗`/`🎬ROLE AND GUIDE`/`⚙️SETTING`/`🎬ROLEPLAY GUIDE`/`💠BEGIN`/`💠FAKE`）+ `📽️ICOT（三段）`；另外两套骨架与所有档位关闭；`💠雪融雪降` 关闭（等用户填自己的文本） |
| 内置槽位 | 一个 identifier 一个主人。落败者：空占位直接丢弃，非空占位换新 uuid 降级为普通条目并强制关闭（名字与正文仍原样） |
| 扩展 | 内嵌芳乃面板脚本 + 两条思维链折叠正则（文案「芳乃祈福中」、无 CDN 外链）+ Kemini 的 `SPreset` |

**降级的 2 条**：Izumi 的 `💾主提示`（原占 `main`）、`短对话模式`（原占 `jailbreak`）——因为 `main`/`jailbreak` 按 SPEC §4 归 Kemini。
**丢弃的 8 条**：Izumi 的空内置占位（`角色描述`/`角色性格`/`场景`/`用户设定描述`/`角色定义之前`/`角色定义之后`/`Chat Examples`/`Chat History`），正文为空，槽位已归 Kemini 的标记条目。

流水线（改任何东西后按序重跑，**顺序有依赖**）：

```bash
node tools/build-groups.mjs    # spec/groups.json + 覆盖率/幽灵名字/锚点/标签组校验
node tools/build-regex.mjs     # preset/fano-thinking-chain.json（4 条折叠链）
node tools/build-panel.mjs     # panel/fano-panel.js（注入 groups + 思维链标签组）
node tools/build-preset.mjs    # preset/芳乃预设-*.json（内嵌面板与折叠链）
node tools/build-preview.mjs   # panel/preview-host.js ← 必须读成品，故放在 preset 之后
node tools/check-preset.mjs    # 成品独立校验（101 项）
node tools/test-regex.mjs      # 折叠链（30 项）
node tools/test-panel.mjs      # 面板逻辑（91 项，跑在成品数据上）
node tools/check-browser.mjs   # 真浏览器布局（37 项，需更宽权限）
```

**顺序坑（踩过）**：早先 `build-panel.mjs` 兼管预览假数据，于是它在 `build-preset.mjs` 之前跑，
面板测试实际测的是**上一版成品**。现在预览数据拆成独立步骤 `build-preview.mjs` 放在成品之后，
并且 `test-panel.mjs` 的**第一条断言**就是"预览假数据不比成品旧"，防止再犯。

诊断工具（排查用）：

```bash
node tools/diag-checkup.mjs [文件.json …]   # M2 体检清单（默认拿 Izumi / 成品预设当反例）
node tools/diag-skeleton.mjs                # 骨架各模块的 token 占比
```

> 早先这里还有一批 `diag-slots / diag-think / diag-cot / diag-tail / diag-order …` 一次性脚本，
> 它们全都写死读那三份第三方源预设，在公开仓库里**跑起来就报错**（违反"宁可不带，
> 也不带一个跑起来就报错的脚本"）。已在 v2.9 一并删除；要翻旧账见 git 历史：
> `git log --diff-filter=D --name-only`，或 `git checkout <旧提交> -- tools/diag-slots.mjs`。

## 9. 待办与风险

- [ ] `spec/groups.json`：机器可读的子集定义（本文件 §6 的落地），配一个校验器保证 226 条全覆盖且不重复。
- [ ] 芳乃身份层文本（按公开资料整理，不照搬游戏原文）。
- [ ] 面板能否在运行时启停**正则**：需在实现前用 `--list`/probe 在 Kemini 面板里确认写正则的 API 路径。
- [ ] 3 MB 合体体积需裁剪：Izumi 未入列表的 37 条备选、Kemini 的功能条目都不搬。
- [ ] 效果无法在本机端到端验证（无 SillyTavern、无渠道 key）：只保证静态校验通过，实测由用户完成。
- [ ] `雪融雪降` 必须由用户换成自己的 ≥7000 token 私有小说段落，面板只能提醒。
