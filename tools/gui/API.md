# `tools/gui/lib/` 编程接口（API 参考）

面向"要调用这套代码的另一个 AI/脚本"。所有事实来自仓库源码与实测，未验证的一律标注。

## 摘要

| 文件 | 全局名 | 用途 |
| --- | --- | --- |
| `tools/gui/lib/parse.js` | `globalThis.PresetParse` | M0 解析：预设 JSON → 结构化 model（条目 / 槽位 / 变量 / 依赖 / 标签族 / 外部依赖 / 正则 / 脚本 / 警告 / 分组建议） |
| `tools/gui/lib/assemble.js` | `globalThis.PresetAssemble` | M1 拼装：按 `prompt_order` 顺序模拟酒馆拼提示词，**有状态**展开 `setvar`/`getvar`/`addvar` |
| `tools/gui/lib/invariants.js` | `globalThis.PresetInvariants` | M2 体检：对照通用不变式输出 必改 / 建议 / 提示 清单（含依据与修法） |
| `tools/gui/lib/editor.js` | `globalThis.PresetEditor` | M3 框架编辑：编辑态、导出新预设、正则与脚本编辑、导出前检查、来源完整性自证 |
| `tools/gui/lib/skeleton.js` | `globalThis.PresetSkeleton` | M4 从零搭骨架（只给结构 + 待填注释，正文一个字不代写） |
| `tools/gui/lib/panelconfig.js` | `globalThis.PresetPanelConfig` | 面板脚本里 `CONFIG` / `GROUPS_OVERRIDE` 两个标记块的读写，夹取 / 校验，以及"装进**别人的**预设"时的去品牌化（`foreignPanelSource`） |
| `tools/gui/lib/groupinfer.js` | `globalThis.PresetGroupInfer` | 按一份预设推断面板分组（选一 / 可多选 / 只读 / 可填 / 兜底） |
| `tools/gui/lib/buildops.js` | `globalThis.PresetBuildOps` | 面板搭建操作层：分节 → 功能区 → 功能项 三层增删改、质检、导出形状 |

导出总数 **141** 个（函数 111、常量/值 30）——**实测值**（改代码时顺手量一遍：`Object.keys(globalThis.PresetXxx)` 逐个分类计数；这一行历史上漂过，别照抄）。`ui.js` 是 DOM/视图层，**不属于**本 API：它需要浏览器 `document`，只是渲染这些模块算出来的东西（`ui.js` 开头一次性取走上述 8 个全局名）。

---

## 1. 如何加载代码

这 8 个文件都是 **IIFE 普通脚本**，不是 ES module：每个文件结尾一句 `root.PresetXxx = { ... }`，`root` 为 `globalThis`（`file://` 下 ES module 会被 CORS 拦掉，所以故意不用 module）。

### 1.1 浏览器

按下面顺序放 `<script src>`（`tools/gui/index.html` 的原样顺序）：

```html
<script src="lib/parse.js"></script>
<script src="lib/assemble.js"></script>
<script src="lib/invariants.js"></script>
<script src="lib/editor.js"></script>
<script src="lib/skeleton.js"></script>
<script src="lib/panelconfig.js"></script>
<script src="lib/groupinfer.js"></script>
<script src="lib/buildops.js"></script>
```

加载后 `globalThis.PresetParse` 等一系列全局名即可用。**不要加 `type="module"`**。

### 1.2 Node.js（本仓库测试用的原样写法）

这是 `tools/test-gui.mjs`（第 25–37 行）、`tools/test-panelconfig.mjs`（第 386–387 行）、`tools/diag-checkup.mjs`（第 15–18 行）共用的模式，从仓库根目录运行：

```js
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const P = (...a) => path.join(ROOT, ...a);

/* 用 new Function 载入（与面板脚本同一种加载方式；这些库都挂在 globalThis 上） */
function load(rel) {
  const src = fs.readFileSync(P(rel), 'utf8');
  new Function('globalThis', src)(globalThis);
}
load('tools/gui/lib/parse.js');
load('tools/gui/lib/assemble.js');
load('tools/gui/lib/invariants.js');
load('tools/gui/lib/editor.js');
load('tools/gui/lib/skeleton.js');
load('tools/gui/lib/panelconfig.js');
load('tools/gui/lib/groupinfer.js');
load('tools/gui/lib/buildops.js');

const PP = globalThis.PresetParse;
```

等价且更短的两种写法（都已实测）：`require('./tools/gui/lib/parse.js')` 与 ESM 里的 `await import('./tools/gui/lib/parse.js')` —— 两者**返回值都是空的**（`{}` / `{ default: {} }`），作用只是产生挂 `globalThis` 的副作用。仓库没有 `package.json`，所以 `.js` 按 CJS 解析。

### 1.3 实测到的坑

- **加载顺序其实无所谓**：逐个文件在独立沙箱里单独加载、以及逆序加载 8 个文件，都各自成功（每个文件只引用 `globalThis` 与自身的局部 `const`）。跨模块依赖只发生在**调用时**：`PresetEditor.verifySourceIntact(json, edit, model, fp)` 的第 4 个参数通常传 `PresetParse.fingerprint`；视图层则在加载时就取全部 8 个全局名。
- **不需要 `window` / `document` / `localStorage` 垫片**，这 8 个文件都不碰 DOM。需要 DOM 的是视图层与 `panel/fano-panel.js`（`tools/test-panelconfig.mjs` 给它们造了假 DOM 与假 `localStorage`）。
- `crypto` 是**可选**的：`skeleton.js` / `editor.js` 的 `uuid()` 优先用 `root.crypto.randomUUID()`，取不到（或 `file://` 下抛错）就用 `Math.random` 手写实现。Node ≥ 19 走前者。
- `new Function` 被两处使用：`PresetPanelConfig.parseLiteral()`（求值面板里的对象字面量）与 `PresetEditor.checkScriptSyntax()`（只编译不执行）。**CSP 禁止 eval 的环境里这两个函数会抛**，其余 API 不受影响。
- **Windows PowerShell 5.1 的编码坑（实测踩到）**：把带中文的命令写成**无 BOM 的 UTF-8 `.ps1`/`.bat`** 再执行，5.1 会按 ANSI(GBK) 解码，中文路径与字符串全部损坏（`preset/芳乃预设.json` → `preset/鑺充箖棰勮.json`，随后 ENOENT）。对策：直接在控制台粘贴命令，或把脚本存成 **UTF-8 with BOM**，或干脆写成 `.mjs` 文件用 `node` 跑（第 4 节的配方都可以这样落地）。

---

## 2. 导出清单

### 2.1 `PresetParse`（7 个：3 函数 + 4 值）

| 签名 | 说明 |
| --- | --- |
| `parsePreset(json, file = '(未命名)', bytes = 0)` | 主入口。`json` 为预设对象（**只读，绝不修改**）、`file` 展示用文件名、`bytes` 原始字节数。返回 model（见 3.2） |
| `scanContent(content)` | 扫一条正文，返回 `{ sets[], adds[], gets[], macros[], families[], ejsCount, ejsHead, pureSetter, clearer, fill }`。`sets/adds/gets` 是变量名去重数组，`macros` 是非酒馆原生宏，`families` 命中的标签族 id，`ejsCount` 是 `<% … %>` 块数 |
| `fingerprint(s)` | 同步指纹（FNV-1a 32 位 + `s.length`），形如 `'1a47e90b-3'`。仅本地比对，**不是**安全哈希（权威校验用 `tools/check-preset.mjs` 的 sha1） |

| 值 | 实际内容 |
| --- | --- |
| `SLOT_LABELS` | 15 个 `identifier → 中文标签`：`main/nsfw/jailbreak/chatHistory/dialogueExamples/charDescription/charPersonality/worldInfoBefore/worldInfoAfter/personaDescription/scenario/enhanceDefinitions/agentSystemPrompt/agentTask/agentResults` |
| `INJECTED_SLOTS` | `Set`，8 个"内容由酒馆注入"的槽位：`chatHistory, dialogueExamples, charDescription, charPersonality, worldInfoBefore, worldInfoAfter, personaDescription, scenario` |
| `TAG_FAMILIES` | 11 个 `{ id, label, re, role }`，id 依次为 `think, konatan, interleaving, mvu, event, progress, summary, tucao, dream, clear, ejs`；`role` 取值如 `'思维链标签'`、`'变量更新'`、`'摘要'` |
| `NATIVE_MACROS` | `Set`，79 个酒馆原生宏名（`user/char/getvar/setvar/…`），不在此集合的宏算外部依赖 |

### 2.2 `PresetAssemble`（4 个：3 函数 + 1 值）

| 签名 | 说明 |
| --- | --- |
| `assemble(model, opts = {})` | `opts`：`user`（默认 `'用户'`）、`char`（默认 `'角色'`）、`includeDisabled`（默认 `false`）、`expandVars`（默认 `true`）。返回拼装结果（见 3.2 末） |
| `expand(text, vars, ctx)` | 展开一段正文里的宏。`vars` 是 `Map<string,string>`，**会被就地修改**；`ctx = { user, char, entryName, entryIdx, events, undefinedReads, unknownMacros }`，后三者被就地追加/写入。返回展开后的字符串。实测：`expand('{{setvar::a::甲}}{{addvar::a::乙}}{{getvar::a}}\|{{user}}/{{char}}\|{{未知宏::1}}\|{{//注释}}', vars, ctx)` → `'甲乙\|我/她\|⟨宏:未知宏⟩\|'` |
| `estimateTokens(s)` | 粗略估算：CJK 字符 1 字≈1 token、其余 4 字符≈1 token，四舍五入 |

| 值 | 实际内容 |
| --- | --- |
| `SLOT_PLACEHOLDER` | 8 个槽位 → 占位文本，如 `chatHistory: '⟨聊天记录（本处由酒馆注入历史消息）⟩'`。只在条目**占注入位且正文 0 字**时用于展示 |

### 2.3 `PresetInvariants`（4 个：2 函数 + 2 值）

| 签名 | 说明 |
| --- | --- |
| `check(m, r, opts = {})` | `m` = model、`r` = `assemble()` 结果（可传 `null`，此时只做不依赖拼装的检查）。`opts.isOn(idx) → bool` 可覆盖"这条开没开"（界面上的交互开关）。返回 `{ items, counts: { err, warn, info }, levelLabel }`；`items[]` 形如 `{ id, level: 'err'\|'warn'\|'info', title, why, fix, evidence: string[], entries: number[] }`，按 err → warn → info 排序。`m` 为空时返回 `{ items: [], counts: {err:0,warn:0,info:0}, levelLabel }` |
| `toMarkdown(report, m)` | 把 `check()` 结果转成可贴进待办的 Markdown 清单（`m.file` 用作标题） |

| 值 | 实际内容 |
| --- | --- |
| `LEVEL_LABEL` | `{ err: '必改', warn: '建议', info: '提示' }` |
| `ANCHORS` | 10 个 `{ id, tier, why }`。`tier === 'must'` 9 个：`main, chatHistory, charDescription, charPersonality, worldInfoBefore, worldInfoAfter, personaDescription, scenario, dialogueExamples`；`tier === 'opt'` 1 个：`jailbreak` |

`items[].id` 的取值（可用于程序化筛选）：`no-order, missing-anchors, missing-optional-anchor, slot-conflict:<identifier>, main-empty, thinking-conflict, mutex-on, switch-off, dangling-var, read-before-set, empty-final, unlisted, fill-on, dup-content, depth-missing, ext-macro, cdn, ejs-template, script-off, budget`。

### 2.4 `PresetEditor`（51 个：45 函数 + 6 值）

**编辑态 / 查询**

| 签名 | 说明 |
| --- | --- |
| `emptyEdit(model, anchors, opts = {})` | 建空编辑态（见 3.3）。`anchors` 是"不能删的槽位 id"数组；`opts.ownIdxs[]`（视为"使用者自己写的"条目下标）、`opts.markerIdxs[]`、`opts.generated` |
| `isDirty(edit)` | 有任何改动（开关/改名/正文/删除/新增/正则/脚本/正则顺序）→ `true` |
| `structuralDirty(edit)` | 只算结构改动（改名/删除/新增条目/增删正则），不含开关与写正文 |
| `canEditContent(edit, idx)` | 返回 `Number.isInteger(idx) && idx >= 0`（不是权限判断：来源正文照样能编，只是改过会被记进 `edited`） |
| `isOwnContent(edit, idx)` | `edit.own.has(idx)` |
| `isMarker(edit, idx, model)` | 是否"纯位置标记"：`edit.markerIdxs.has(idx)` 或该条目的 identifier 属于 `MARKER_SLOTS` |
| `isPending(content)` | 待填判定：`trim()` 后为空，或整条只包一句 `{{//…}}` |
| `contentOf(edit, json, idx)` | 当前正文（`edit.content` 优先，否则原 `json.prompts[idx].content`） |
| `keyOf(entry)` | `'e' + entry.idx`（列表键） |
| `newIdentifier(model, slotId)` | 占槽位就用槽位名，否则生成不撞车的 uuid |
| `orderIndexOf(json)` | `prompt_order` 里 `character_id === 100001` 那条的下标；找不到时退化为 `0`（数组非空）或 `-1` |

**改条目**

| 签名 | 说明 |
| --- | --- |
| `setContent(edit, json, idx, text)` | 改正文；`before` 与 `text` 相同返回 `false`（没动）；写回原文时自动撤销补丁。返回是否发生了状态变化 |
| `revertContent(edit, json, idx)` | 撤销该 idx 的正文补丁，返回是否删掉了补丁 |
| `setEnabledByName(edit, model, name, on)` | 按**条目名**改默认开关：新增条目写它自己的 `enabled`，导入条目写 `edit.enabled.set(idx, on)`。改名不存在时返回 `false` |
| `enabledByName(edit, model, name)` | 读默认开关（同样兼顾两种存法）；找不到该名字返回 `false` |
| `addEntry(edit, model, { name, slot = '', role = 'system' } = {})` | 新增条目并追加到 `edit.order` 末尾，返回新增对象。**默认 `enabled: false` + 正文 `FILL_MARK`**；若 `slot ∈ MARKER_SLOTS` 则 `content: ''`、`enabled: true`、`marker: true` |
| `deleteAdded(edit, key)` | 删掉本轮新增的条目（同时从 `edit.order` 移除） |
| `moveKey(edit, key, delta)` | 在 `edit.order` 里挪动，`delta` 为 `-1`/`+1`，越界返回 `false` |
| `removeFromOrder(edit, key)` / `appendToOrder(edit, key)` | 出列 / 入列（入列已存在则不重复加） |
| `ownEntries(edit, model)` | "你自己写的条目"行：`{ kind: 'own'\|'added', idx?, key?, identifier, role, name, content, enabled, marker }` |
| `pendingProgress(edit, model)` | `{ total, todo, done, markers, todoNames[] }`；`marker` 的行不计入 todo/done |

**正则**

| 签名 | 说明 |
| --- | --- |
| `regexKey(i)` | `'r' + i`（原有正则的键；新增的键是 `'a:' + uuid`） |
| `addRegex(edit, { scriptName = '新正则', findRegex = '', replaceString = '' } = {})` | 建一条新正则（`placement: [2]`、`disabled: false`、`runOnEdit: false`、`substituteRegex: 0`、`markdownOnly/promptOnly: false`、`id: ''`），压进 `edit.regex.added` 与 `edit.regex.order` 末尾 |
| `deleteRegex(edit, key)` | `'a:'` 开头从 `added` 移除，否则把下标记进 `regex.deleted`；两者都从 `order` 移除。无返回值 |
| `moveRegex(edit, key, delta)` | 在 `edit.regex.order` 里挪动，越界返回 `false` |
| `regexList(json, model)` | 只读原 `json.extensions.regex_scripts` 的行（**必须读原始 json**：model 里的字段名被归一化过），见 3.4 |
| `regexViews(edit, json, model)` | 叠上补丁、滤掉删除、按 `edit.regex.order` 排序后的行（新增行 `isNew: true, idx: -1, changed: true, raw: null`） |
| `setRegexField(edit, json, key, field, value)` | `field` 只接受 7 个字段（内部常量 `REGEX_SOURCE_FIELDS`，**未导出**，取值与 `REGEX_FIELD_LABEL` 的键完全相同）；改回原值自动撤掉补丁；**不认识的字段直接 `throw new Error('不支持改这个字段：' + field)`** |
| `testRegex(findRegex, replaceString, sample, opts = {})` | 本地试跑（不 eval）。返回 `{ ok, error, matches, out, reasons[], global, changed, patternForm, warns[] }`；`opts.global === false` 时给非 `/…/` 写法不加 `g` |
| `runRegexChain(list, sample)` | 按顺序把 `list` 里的正则作用到样例上，返回 `{ text, steps[] }`；`steps[] = { name, ok?, error?, matches, warns? }`，命中 `disabled` 的行是 `{ name, skipped: true, matches: 0 }` |

**脚本**

| 签名 | 说明 |
| --- | --- |
| `scriptKeyOf(idx)` | `'s' + idx` |
| `scriptViews(edit, json, model)` | 脚本行（原有 + 本轮新增），见 3.4 |
| `setScriptField(edit, json, ref, field, value)` | `ref` 原有脚本用**下标数字**，本轮新增的用它的 key（`'a:uuid'`）；与原值相同则撤掉补丁 |
| `addScript(edit, json, { name = '面板', content = '', id = '' } = {})` | 追加一条酒馆助手脚本，返回它。`id` 默认 `'fano-panel'`，撞车（含本轮已新增的）时追加随机后缀；`enabled: true` |
| `deleteScript(edit, key)` | **只能删本轮新增的**（`'a:'` 开头）；原有脚本一律返回 `false` |
| `checkScriptSyntax(content)` | 只编译不执行。返回 `{ ok, error, line? }`；空白内容返回 `{ ok: true, error: '', empty: true }` |
| `lineDiff(before, after)` | 粗略行级 diff（按行多重集合，不做 LCS）：`{ beforeLines, afterLines, removedLines[], addedLines[], changed, sample[] }` |
| `looksLikePanel(content)` | 正文里是否含 `PANEL_MARKS` 之一 |
| `panelScriptViews(edit, json, model)` | 只挑出像面板的脚本行：`{ key, ref, name, enabled, bytes, isNew, content }` |

**导出 / 校验**

| 签名 | 说明 |
| --- | --- |
| `applyEdit(json, edit, model)` | 生成**新预设对象**（见 3.7）。不修改入参 |
| `summary(edit, model)` | 改动摘要行 `[{ kind, text }]`，`kind` 如 `'删除条目' '新增条目' '改名' '写正文' '删除正则' '改正则' '新增正则' '正则顺序' '改脚本' '新增脚本' '排序' '开关' '入列' '出列'` |
| `exportChecks(json, edit, model, opts = {})` | 导出前检查，返回 `{ blocking[], warnings[], notes[] }`，元素为 `{ kind, text }`。`opts.panel = { groups, appearance, unapplied, ignored }`（界面传入的本轮搭建意图）、`opts.slotIds[]`（合法槽位表）、`opts.anchorIds[]`（默认 `edit.anchors`） |
| `verifySourceIntact(json, edit, model, fingerprintFn)` | 来源完整性自证，见 5.1 |
| `proseOf(p)` | 把一条 prompt 的 `PROSE_FIELDS` 抽成 JSON 字符串（比对用） |

| 值 | 实际内容 |
| --- | --- |
| `FILL_MARK` | `'{{//待填：在这里写这条的内容}}'` |
| `SLOT_CHOICES` | 13 个 `{ id, label }`，第一项 `{ id: '', label: '（普通条目，不占槽位）' }`，其余为 `main/nsfw/jailbreak/worldInfoBefore/worldInfoAfter/charDescription/charPersonality/personaDescription/scenario/dialogueExamples/chatHistory/enhanceDefinitions` |
| `MARKER_SLOTS` | **8** 个：`worldInfoBefore, worldInfoAfter, charDescription, charPersonality, personaDescription, scenario, dialogueExamples, chatHistory`（**不含** `main`/`nsfw`/`jailbreak`/`enhanceDefinitions`） |
| `REGEX_FIELD_LABEL` | `{ scriptName: '名字', findRegex: 'find 表达式', replaceString: '替换为', disabled: '启停', placement: '作用面', markdownOnly: '仅改显示', promptOnly: '仅改发送' }`（也是 `setRegexField` 的合法字段集） |
| `PANEL_MARKS` | `['FANO_PANEL_CONFIG_BEGIN', '__FANO_PANEL__']` |
| `PANEL_CAP_MARKS` | 面板"会什么"的**能力标记**：`{ longPressEdit: 'FANO_PANEL_CAP_LONGPRESS_EDIT', controlsV06: 'FANO_PANEL_CAP_CONTROLS_V06' }`。`panelSupport()` 靠它们判断"预设里那份面板是不是旧版"：缺哪个说哪个，两块都缺就两条拦截（导出前拦住 + 一键换新 + 一条"就带旧的"活路） |
| `PROSE_FIELDS` | `['identifier', 'content', 'role', 'system_prompt', 'injection_position', 'injection_depth', 'injection_order', 'marker', 'forbid_overrides']` |

### 2.5 `PresetSkeleton`（10 个：4 函数 + 6 值）

| 签名 | 说明 |
| --- | --- |
| `buildSkeleton(opts = {})` | `opts`：`name`（默认 `'我的预设'`）、`base`（`{ file, json }` 或 `null`，只抄顶层采样设置）、`moduleIds[]`（`core` 恒有）、`customCount`（0–20，钳制）。返回 `{ json, name, markers[], markerSlots[], counts, plan[] }` |
| `describe(opts = {})` | 给界面看的"将要生成什么"：`[{ kind, text }]`，`kind ∈ {'位置标记','必需','模块','自定义','正文'}` |
| `fillFor(hint)` | 待填正文模板：`` `{{//待填：${hint || '在这里写这条的内容'}}}` `` |
| `topLevelFrom(base)` | 从 `base.json` 抄顶层键，排除 `TOP_EXCLUDE`（实测成品预设能抄到 44 个采样/接口字段）。`base` 为空返回 `{}` |

`buildSkeleton` 的 `counts = { prompts, enabled, pending, markers }`。实测 `buildSkeleton({ name: '我的预设', base: null, moduleIds: ['breach','cot','mvu'], customCount: 2 })` → `{"prompts":20,"enabled":9,"pending":12,"markers":8}`。`pending` **只数**"正文只包一句 `{{//…}}`"的条目，空正文的注入位标记不计入（它们计在 `markers`）。

| 值 | 实际内容 |
| --- | --- |
| `MODULES` | 8 个模块 `{ id, required, label, note, entries:[{ slot?, name, role?, enabled?, hint }] }`，id：`core(必需) breach cot style guard mvu summary prefill` |
| `MARKER_SLOTS` | 8 个 `{ slot, name, hint }`（`worldInfoBefore, personaDescription, charDescription, charPersonality, scenario, worldInfoAfter, dialogueExamples, chatHistory`），name 形如 `⟨世界书·前⟩` |
| `MARKER_SLOT_IDS` | 上面 8 个的 `slot` 数组（顺序与 `MARKER_SLOTS` 一致） |
| `MARKER_HEAD` | 6 个：`worldInfoBefore, personaDescription, charDescription, charPersonality, scenario, worldInfoAfter` |
| `MARKER_TAIL` | 2 个：`dialogueExamples, chatHistory` |
| `TOP_EXCLUDE` | `['prompts', 'prompt_order', 'extensions', 'name']` |

条目生成顺序（`buildSkeleton` 实测）：`main` → 6 个 MARKER_HEAD → 勾选模块的条目（按 `MODULES` 顺序）→ 自定义空条目 → 2 个 MARKER_TAIL → `jailbreak` → `nsfw`。

### 2.6 `PresetPanelConfig`（33 个：25 函数 + 8 值）

| 签名 | 说明 |
| --- | --- |
| `extractConfig(src)` | 抠出面板 `CONFIG` 对象；读不到返回 `null` |
| `extractThemes(src)` | 抠出面板内置 `THEMES`（要求有 `day` 与 `night`），否则 `null` |
| `extractCss(src)` | 抠出 `const raw = \`…\`;` 里的面板静态 CSS；没有返回 `''` |
| `extractFallbackTitle(src)` | 抠出 `CONFIG?.title \|\| '…'` 里的兜底标题，并反转义；没有返回 `''` |
| `patchConfig(src, cfg)` | 用 `mergeConfig(DEFAULT_CONFIG, cfg)` 的结果替换 `CONFIG` 字面量。**找不到声明会抛** |
| `mergeConfig(base, patch)` | 逐键合并（对象键深一层展开，其余直接覆盖）。返回的键 = `Object.keys(DEFAULT_CONFIG)` ∪ `patch` 的键 |
| `clampConfig(cfg)` | 夹取到合法范围，**只返回** `{ ball, window, layout, wallpaper }`（**丢掉** `version` / `title`，见 5.2 陷阱） |
| `extractBlock(src, declName)` | 抠出 `const <declName> = <字面量>`（对象 / 数组 / `null` / 标量都支持）；读不到返回 `null` |
| `patchBlock(src, declName, value)` | 把该字面量替换为 `JSON.stringify(value, null, 2)`（每行再缩进 2 空格）。**只替换字面量本身**，找不到声明抛错 |
| `extractGroups(src)` | `extractBlock(src, 'GROUPS_OVERRIDE')` 的简写 |
| `patchGroups(src, override)` | `patchBlock(src, 'GROUPS_OVERRIDE', override)` 的简写（`null` 表示回到面板自带分组） |
| `extractDefaults(src)` | 面板自带的分组素材：`{ groups[], sections[], thinkingTags[], display }`（实测成品面板 `groups` 25 个） |
| `neutralizeBrand(src)` | 把源码里"芳乃"字样换成中性说法（逐条替换表见 `BRAND_PATTERNS`）。面板源码本体不动——只在**装进别人的预设**时用 |
| `findBrand(src)` | 源码里还剩哪些「芳乃」→ `[{ text, index }]`。**这是绊线**：换完必须为空，否则说明面板源码里新加了字样 |
| `neutralizeData(value)` | 同上，但对**分组数据**逐层做（数组/对象/键名/字符串都过一遍）。**只用在草稿上**：草稿多半是从面板自带那份（芳乃的清单）复制来的；从目标预设**推断**出来的分组是那份预设自己的条目名，一个字都别动 |
| `foreignPanelSource(src, opts)` | 把面板源码整理成"装进**别人**的预设"的形态：按钮名落成这家的、把自带模块表换成这家的、去品牌化，最后**断言产物里没有「芳乃」**（有就抛）。`opts.alsoOverride` 时同一份分组再写一份 `GROUPS_OVERRIDE` |
| `toCssVars(clamped)` | 由 `clampConfig` 结果算出 12 个 CSS 变量（`--fp-radius/--fp-opacity/--fp-blur/--fp-ball/--fp-wall-opacity/--fp-wall-blur/--fp-wall-dim/--fp-wall-dim-color/--fp-minw/--fp-minh/--fp-maxw/--fp-maxh`） |
| `scaleCss(css, k)` | 面板 `scaleCss()` 的镜像：≥3px 的字面量乘 `k`（`k` 与 1 相差 <0.001 时原样返回） |
| `scaleFontCss(css, k)` | 只乘 `font-size:` 的 px |
| `hasWallpaper(cfg)` | `wallpaper.url` 非空 |
| `validateConfig(cfg, themes)` | 返回 `{ errors[], warnings[], clamped, effective, hasWallpaper }`；元素形如 `{ kind, text }`。`kind` 如 `'颜色值不合法' '壁纸地址不合法' '壁纸撑大预设' '文字可能看不清' '未知颜色键' '尺寸被夹取' '面板太透明' '悬浮球偏小'` 等 |
| `changedTokens(cfg, themes)` | 与出厂配色比对：`[{ tier: 'day'\|'night', key, from, to }]` |
| `estimateDataUrlBytes(url)` | `data:` 图片的原始字节数估算（非 `data:` 返回 0） |
| `findLiteral(src, declName, from = 0)` | 定位 `const <declName> = <值>` 的值区间：`{ start, end, text }` 或 `null`（配对括号时跳过字符串与注释） |
| `parseLiteral(text)` | `new Function('"use strict";return (' + text + ');')()` —— 支持注释与尾逗号 |

| 值 | 实际内容 |
| --- | --- |
| `BEGIN` / `END` | `'FANO_PANEL_CONFIG_BEGIN'` / `'FANO_PANEL_CONFIG_END'` |
| `TOKEN_SPEC` | **21** 个 `{ key, label, type }`（`type ∈ {'color','alpha'}`）。源码注释里那个"18 个"是过期注释；**以实测为准**：`TOKEN_SPEC.length === 21`，与 `extractThemes(面板).day` 的键一一对应（测试按这个断言） |0 个键一一对应 |
| `TOKEN_KEYS` | `TOKEN_SPEC.map(t => t.key)`（21 个） |
| `DEFAULT_THEME_KEYS` | 与 `TOKEN_KEYS` **同一个数组引用** |
| `DEFAULT_CONFIG` | 见 3.5 |
| `FIT` | `['cover', 'contain', 'repeat']` |
| `BRAND_PATTERNS` | **16** 组 `[原样, 换成]`（顺序即优先级、长串在前）。里面两类要分清：**芳乃预设的数据**（模块名/成员名/说明——别人预设里根本没这些条目）与**芳乃的字样**（日志前缀/注释/兜底标题/按钮名）。`FANO_PANEL_*`、`fano-antitrunc-v1` 这类**英文标识不在表里**：那是"这是哪支面板"的技术标识，保留 |

### 2.7 `PresetGroupInfer`（4 个：3 函数 + 1 值）

| 签名 | 说明 |
| --- | --- |
| `inferGroups(model, json, opts = {})` | `opts.includeDisabled` 为 `false` 时只纳入"在列表里且开着"的条目（默认纳入所有在列表里的）。返回 `{ groups, sections, thinkingTags, display, notes, stats }`（见 3.6）。`model` 无条目时返回 `groups: []` 且 `notes` 首条为 `{ level: 'err', text: '没有条目，无法推断分组。' }` |
| `validateGroups(override, model)` | 对着预设核一遍：`{ errors[], warnings[] }`，元素 `{ kind, text }`。`kind` 如 `'条目不存在' 'id 重复' 'mode 不合法' 'bundle 缺选项' 'editable 缺内容' '分节引用了不存在的模块' '缺 id' '重名条目' '模块只有一条' '同一条目属于多个互斥模块'`、结构错 `'结构'`。非数组入参返回 `{ errors: [{ kind: '结构', text: '分组数据不是数组。' }], warnings: [] }` |
| `slug(s)` | 条目名 → 稳定 id：`'g_' +` 各字符 codePoint 的 36 进制拼接后截 24 位、只留字母数字 |

| 值 | 实际内容 |
| --- | --- |
| `SLOT_IDS` | 12 个注入位槽位：`main, nsfw, jailbreak, chatHistory, dialogueExamples, charDescription, charPersonality, worldInfoBefore, worldInfoAfter, personaDescription, scenario, enhanceDefinitions` |

### 2.8 `PresetBuildOps`（23 个，全是函数）

**全部就地修改传入的草稿 `draft`**（与 `PresetEditor` 的"返回新值"风格不同），并且只改草稿，不碰面板自带的那份。

| 签名 | 说明 |
| --- | --- |
| `seedFrom(defaults)` | 把面板自带分组复制成草稿：返回 `{ groups, sections: [], thinkingTags, display, source: 'seeded' }`。每个 group 带上 `__section`（由 `defaults.sections` 反查，找不到为 `'未分节'`）；`sections` 故意留空，导出时由 `__section` 重建 |
| `sectionsOf(draft)` | 按 `groups` 顺序推出分节标题数组 |
| `groupOf(draft, id)` | 按 id 找功能区，找不到返回 `null` |
| `newGroupId(draft)` | `'g1'`, `'g2'`… 第一个不撞车的 |
| `addSection(draft, title)` | 加分节；若该标题还不存在，**同时**塞一个空功能区进去。返回标题（空标题 → `'新分区'`） |
| `addGroup(draft, { section = '未分节', mode = 'multi', label = '新功能区', note = '' } = {})` | 加功能区，返回它（`mode: 'editable'` 时带空 `editable` 映射） |
| `removeGroup(draft, id)` | 返回是否删掉了 |
| `renameGroup(draft, id, label)` | 空标题则保持原名。返回是否成功 |
| `setMode(draft, id, mode)` | 换成 `editable` 会补 `editable` 映射；换成别的会删掉 `editable`。返回是否成功 |
| `setNote(draft, id, note)` | 返回是否成功 |
| `moveGroup(draft, id, delta)` | 只在同一分节内换序，越界返回 `false` |
| `moveGroupToSection(draft, id, section)` | 挪到目标分节**末尾** |
| `renameSection(draft, from, to)` | 连同里面所有功能区的 `__section` 一起改；`to` 为空或与 `from` 相同返回 `false` |
| `removeSection(draft, title)` | **不删功能区**：把里面的功能区挪到第一个还在的分区（没有就 `'未分节'`）。没有该分区返回 `false` |
| `moveSection(draft, title, delta)` | 按"第一次出现的位置"换序，内部按新顺序重排 `groups` |
| `members(draft, id)` | 返回该功能区的 `members`（顺带补 `[]`）；功能区不存在返回 `[]` |
| `addMember(draft, id, name)` | 挂一个条目名；已存在或功能区不存在或 `name` 为空返回 `false` |
| `removeMember(draft, id, name)` | 同时删掉 `editable[name]`；返回成员数是否变了 |
| `moveMember(draft, id, name, delta)` | 在 `members` 内换序 |
| `moveMemberToGroup(draft, fromId, toId, name)` | 跨功能区搬家（同 id 或源里没有则 `false`） |
| `auditPanel(draft, model, edit)` | 面板质检，返回 `[{ level: 'err'\|'warn'\|'info', kind, text, fix, entry? }]`。`kind` 如 `'空功能区' '条目不存在' '条目重名' '开着但没内容' '还没写内容' '同一条目属于多个选一区' '空面板' '面板管不到条目'` |
| `toOverride(draft)` | 变成能写进面板 `GROUPS_OVERRIDE` 的形状（见 3.6） |
| `stats(draft, model)` | `{ groups, sections, managed, missing: [{group,name}], duplicated: [{group,name}] }`（`mode === 'hidden'` 的功能区跳过；`mode !== 'fixed'` 的成员计入 `managed`） |

---

## 3. 数据结构

### 3.1 磁盘上的预设 JSON

字段名照抄 `preset/芳乃预设.json` 与 `Izumi_0914.json` 实测：

```jsonc
{
  // ── 顶层采样/接口参数（44 个：temperature / top_p / openai_max_context / …）
  //    skeleton.topLevelFrom() 原样复制它们；exclude 见 TOP_EXCLUDE
  "name": "…",

  "prompts": [
    {
      "identifier": "ea1d7f08-5171-55bd-afc6-9bae10c09692", // 槽位 id 或 uuid
      "name": "🌸芳乃 · 助手主体",
      "enabled": true,            // 与 prompt_order 里的开关同名（两处的关系见 5.5）
      "injection_position": 0,
      "injection_depth": 4,
      "injection_order": 100,
      "role": "system",
      "content": "…",
      "system_prompt": false,
      "marker": false,
      "forbid_overrides": false
    }
  ],

  "prompt_order": [
    {
      "character_id": 100001,
      "order": [ { "identifier": "ea1d7f08-…", "enabled": false } ]
    }
  ],

  "extensions": {
    "regex_scripts": [
      {
        "id": "fano-think-multi-head",
        "scriptName": "芳乃思维链 · 多块（Kemini 形态）",
        "findRegex": "/<(?:think|thinking)>([\\s\\S]*?)<\\/(?:think|thinking)>…/gi",
        "replaceString": "…",
        "disabled": false,
        "runOnEdit": true,
        "trimStrings": [],
        "placement": [2],
        "substituteRegex": 0,
        "markdownOnly": true,
        "promptOnly": false
      }
    ],
    "tavern_helper": {
      "scripts": [
        {
          "type": "script",
          "enabled": true,
          "name": "芳乃 · 预设面板",
          "id": "…",
          "content": "…（一整段 IIFE 脚本；面板的 CONFIG / GROUPS_OVERRIDE 标记块在里面）",
          "info": "由预设生成器的「面板外观 / 面板分组」写入。",
          "button": { "enabled": false, "buttons": [] },
          "data": {},
          "export_with": { "data": false, "button": true }
        }
      ]
    }
  }
}
```

面板脚本里两段"给生成器用"的标记块（`panel/fano-panel.js` 实测；`GROUPS` 块在文件前部，`CONFIG` 块在后部）：

```js
/* ══ FANO_PANEL_GROUPS_BEGIN ══════════════════════════════════════════ */
const GROUPS_OVERRIDE = null;   // 或 { groups, sections, thinkingTags, display }
/* ══ FANO_PANEL_GROUPS_END ════════════════════════════════════════════ */
/* ══ FANO_PANEL_CONFIG_BEGIN ══════════════════════════════════════════ */
const CONFIG = {
  version: 1,
  title: '',                                  // 空 → 面板用兜底标题（见 5.6）
  tokens: { day: {}, night: {} },             // 键为 21 个 --fp-* token
  ball: { size: 46, glyph: '芳' },
  window: { w: 380, h: 620, minW: 260, minH: 200, maxW: 0, maxH: 0 },
  layout: { radius: 14, scale: 1, fontScale: 1, opacity: 1, blur: 14 },
  wallpaper: { url: '', fit: 'cover', opacity: 0.35, blur: 0, dim: 0.15, dimColor: '#000000', enabled: true },
};
/* ══ FANO_PANEL_CONFIG_END ════════════════════════════════════════════ */
const THEMES = { day: { /* 21 个 --fp-* */ }, night: { /* 21 个 */ } };
const GROUPS_DEFAULT = [ … ]; const DISPLAY_DEFAULT = { … };
const THINKING_TAGS_DEFAULT = [ … ]; const SECTIONS_DEFAULT = [ … ];
```

### 3.2 `model`（`parsePreset` 的返回值）

| 字段 | 形状 |
| --- | --- |
| `file` / `bytes` / `name` | 传入的 `file` / `bytes` / `json.name ?? ''` |
| `counts` | `{ prompts, listed, enabled, enabledChars, totalChars }`。实测成品预设：`{prompts:233, listed:233, enabled:52, enabledChars:12028, totalChars:156501}` |
| `entries[]` | 见下表；**已排序**：listed 的按 `orderIndex` 在前，未 listed 的按原 `idx` 在后 |
| `slots[]` | `{ identifier, label, injected, owners: [{ idx, name, chars, enabled }], conflict }`（同名 identifier 多于一条则 `conflict: true`） |
| `variables[]` | `{ name, setBy: number[], addBy: number[], getBy: number[], defined, dangling, exclusive, realSetBy: number[] }`（`realSetBy` = 排除"清空型"条目后的设置者；内部的 `nameOf()` 函数在返回前已被剥掉） |
| `deps[]` | `{ from: idx, to: idx, variable: string }` —— "谁给谁供数" |
| `tagFamilies[]` | `{ id, label, role, members: [{ idx, name, enabled }] }`，只保留有成员的族 |
| `external` | `{ macros: [{ name, by: string[] }], cdn: string[] }` |
| `regexes[]` | `{ name, disabled, placement, markdownOnly, promptOnly, find, replaceChars, cdn }`（**归一化名**，不是磁盘字段名：`scriptName→name`、`findRegex→find`、`replaceString→replaceChars`） |
| `scripts[]` | `{ name, enabled, type, chars, buttons: string[], hasData, cdn }` |
| `suggestions[]` | `{ id, mode: 'single'\|'multi', reason, members: string[] }`，`id` 前缀 `excl:` / `acc:` / `tag:` |
| `warnings[]` | `{ level: 'err'\|'warn', kind, text }`（`kind` 如 `'槽位冲突' '悬空变量' '思维链标签冲突' '疑似待填' '结构缺失'`） |

`entries[]` 每一项：

| 字段 | 含义 |
| --- | --- |
| `idx` | 在**原始 `json.prompts`** 里的下标（一切读写都用它） |
| `name` / `content` / `identifier` | 原样（`content` 一字不改） |
| `slot` / `slotLabel` | identifier 是内置槽位时给它，否则 `null` |
| `injected` | identifier ∈ `INJECTED_SLOTS` |
| `role` / `systemPrompt` / `marker` | `role`（默认 `''`）、`!!system_prompt`、`!!marker` |
| `injPos` / `injDepth` | `injection_position ?? 0` / `injection_depth ?? null` |
| `listed` / `orderIndex` | 是否出现在 `prompt_order[0].order` 里 / 它在该数组的下标（未列出为 `-1`） |
| `enabled` | **listed 时取 `prompt_order` 里的 `enabled`**，否则取 `prompt.enabled` |
| `chars` / `fp` / `head` | 码点长度 / `fingerprint(name + '\u0000' + content)` / 单行前 90 字 |
| `sets` / `adds` / `gets` | 该条正文里 setvar / addvar / getvar 的变量名 |
| `macros` | 非原生宏名 |
| `families` | 命中的标签族 id |
| `ejsCount` / `ejsHead` | `<% … %>` 块数 / 第一块前 60 字 |
| `pureSetter` | 正文除宏外不足 40 字且确有 `setvar` |
| `clearer` | "初始化/清空型"：`setvar` ≥3 次且其中 ≥80% 的值为空白 |
| `fill` | 正文命中"看起来要你自己填"的固定话术表 |

`assemble(model, opts)` 的返回（实测成品预设，`user:'M', char:'C'`）：

| 字段 | 形状 |
| --- | --- |
| `user` / `char` | 生效的选项值 |
| `segments[]` | `{ idx, name, identifier, slot, slotLabel, kind: 'prompt'\|'injected-at-depth', text, chars, role?, note }`（`kind === 'injected-at-depth'` 的段 `text: ''`、带 `depth`） |
| `skipped[]` | `{ idx, name, why: '已关闭' }` |
| `unlisted[]` | `{ idx, name }` |
| `text` / `totalChars` | 所有 `kind === 'prompt'` 段用 `'\n\n'` 连接后的正文与其码点长度 |
| `bodyChars` | 去掉"注入位占位块"后的长度（token 估算按它算） |
| `textByIdx` | `Map<idx, 展开后正文>` |
| `tokenEstimate` | `estimateTokens(bodyText)` |
| `events[]` | `{ op: 'set'\|'add'\|'get', name, value, before, after?, defined?, by, idx }` |
| `emptyVars[]` | `{ name, reads, lastBy, lastOp }` —— 最终为空却被读取的变量 |
| `vars[]` | `{ name, value }`（最终变量表） |
| `warnings[]` | `{ level, kind, text }`，`kind` 如 `'读了未设置的变量' '变量最终为空' '注入位缺失' '思维链标签冲突' '外部宏'` |

### 3.3 `edit`（`emptyEdit()` 的返回值）

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `order` | `string[]` | 提示词列表顺序，元素是 `keyOf(e) = 'e<idx>'` 或新增条目的 `'a:<uuid>'`。初值 = 所有 listed 条目的键（按 `orderIndex`） |
| `enabled` | `Map<idx, bool>` | **用户改过**的导入条目的默认开关（没改过就不在里面） |
| `names` | `Map<idx, string>` | 用户改过的名字 |
| `content` | `Map<idx, string>` | 用户改过的正文（任何 idx 都允许；写回原文会自动撤销） |
| `own` | `Set<idx>` | 这些 idx 的正文是"使用者自己的"（工具生成的骨架才传），不算"别人的来源正文" |
| `markerIdxs` | `Set<idx>` | 其中哪些是纯位置标记（正文本来就该空） |
| `generated` | `bool` | 这份预设是不是工具生成出来的 |
| `deleted` | `Set<idx>` | 被删除的条目下标 |
| `added` | `object[]` | 本轮新增条目：`{ key: 'a:<uuid>', identifier, name, slot, role, enabled, content, injPos, injDepth, injOrder }`（位置标记额外有 `marker: true`） |
| `anchors` | `string[]` | 不能删的槽位 id（由调用方从 `PresetInvariants.ANCHORS` 里挑 `tier === 'must'` 传入；`exportChecks` 默认用它） |
| `regex.order` | `string[]` | 正则的应用顺序（键 `'r<idx>'` / `'a:<uuid>'`） |
| `regex.baseOrder` | `string[]` | 初值快照，用来判断"顺序改没改" |
| `regex.patches` | `Map<idx, object>` | 原有正则的字段补丁（`{ scriptName?, findRegex?, replaceString?, disabled?, placement?, markdownOnly?, promptOnly? }`） |
| `regex.added` | `object[]` | 新增正则：`{ key, scriptName, findRegex, replaceString, disabled, runOnEdit, trimStrings, placement, substituteRegex, markdownOnly, promptOnly, id }` |
| `regex.deleted` | `Set<idx>` | 被删除的原有正则下标 |
| `scripts.patches` | `Map<idx, object>` | 原有脚本的字段补丁（`{ name?, enabled?, content? }`） |
| `scripts.added` | `object[]` | 新增脚本：`{ key, type: 'script', enabled: true, name, id, content, info, button, data, export_with }` |

### 3.4 正则视图行 / 脚本视图行

`regexViews(edit, json, model)` 的行（实测字段）：

```jsonc
{
  "key": "r0",              // 原有：'r<idx>'；新增：'a:<uuid>'
  "idx": 0,                 // 新增行是 -1
  "isNew": false,
  "changed": false,         // 有补丁（或新增）时为 true
  "cdn": false,             // 来自 model.regexes[idx].cdn
  "raw": { /* 原始磁盘对象，一字未改 */ },   // 新增行是 null
  "scriptName": "…", "findRegex": "…", "replaceString": "…",
  "disabled": false, "placement": [2], "markdownOnly": true, "promptOnly": false
}
```

`scriptViews(edit, json, model)` 的行：

```jsonc
{
  "idx": 0,                 // 新增行是 -1
  "key": "s0",              // 新增行是 'a:<uuid>'
  "ref": 0,                 // 传回 setScriptField 用：原有是数字下标，新增是 key
  "isNew": false,
  "name": "…", "enabled": true, "content": "…",   // 已叠补丁
  "originalContent": "…",   // 原始正文（新增行是 ''）
  "type": "script", "id": "…",
  "buttons": ["…"],         // 来自 model.scripts[idx].buttons
  "changed": false, "changedFields": []   // 新增行是 ['新增']
}
```

`panelScriptViews()` 再过滤成 `{ key, ref, name, enabled, bytes, isNew, content }`。

### 3.5 面板配置对象

`DEFAULT_CONFIG`（`PresetPanelConfig` 的导出）：

```jsonc
{
  "version": 1,
  "tokens": { "day": {}, "night": {} },
  "ball": { "size": 46, "glyph": "芳" },
  "window": { "w": 380, "h": 620, "minW": 260, "minH": 200, "maxW": 0, "maxH": 0 },
  "layout": { "radius": 14, "scale": 1, "fontScale": 1, "opacity": 1, "blur": 14 },
  "wallpaper": { "url": "", "fit": "cover", "opacity": 0.35, "blur": 0, "dim": 0.15, "dimColor": "#000000" }
}
```

`extractConfig(面板源码)` 的实测结果比上面多一个 `title`（`""`），键顺序为 `version, title, tokens, ball, window, layout, wallpaper`；`window.maxW/maxH` 为 0 表示"不限制"（`toCssVars` 会换成 `calc(100vw - 16px)` / `calc(100dvh - 16px)`）。

`clampConfig(cfg)` 只返回 `{ ball, window, layout, wallpaper }`，各字段范围：`ball.size 28–96`（取整）、`ball.glyph` 最多 3 个字符（空则 `'芳'`）、`window.w 200–4000`、`h 160–4000`、`minW 140–2000`、`minH 100–2000`、`maxW/maxH 0–4000`、`layout.radius 0–40`、`scale 0.6–2`、`fontScale 0.7–1.8`、`opacity 0.15–1`、`blur 0–40`、`wallpaper.opacity 0–1`、`blur 0–40`、`dim 0–0.95`、`fit ∈ FIT`（非法回 `'cover'`）。

### 3.6 分组草稿 / `toOverride` 输出

`PresetBuildOps.seedFrom(defaults)` 的草稿：

```jsonc
{
  "groups": [
    {
      "id": "jailbreak", "label": "破甲（按模型分流）", "mode": "bundle", "note": "…",
      "options": [ { "id": "gemini", "label": "Gemini", "source": "Kemini",
                     "members": ["…"], "poolSize": 10,
                     "tunables": [ { "id": "km_nsfw", "label": "NSFW 加强", "mode": "multi",
                                     "members": ["💗NSFW"], "note": "…" } ] } ],
      "__section": "破甲（按模型分流）"   // 草稿专用，toOverride 时会被转成分节表
    }
  ],
  "sections": [],                    // 故意留空：分节由 __section 重建
  "thinkingTags": [ { "id": "think", "label": "…", "note": "…", "members": ["…"] } ],
  "display": {},
  "source": "seeded"
}
```

功能区 `mode` 的取值（`validateGroups` 认这一套）：`fixed`（只读，面板不碰）、`single`（选一）、`multi`（可多选）、`editable`（可填，带 `editable` 映射）、`bundle`（骨架 + 档位，带 `options`）、`hidden`。

`PresetBuildOps.toOverride(draft)` 的输出（就是写进面板 `GROUPS_OVERRIDE` 的东西）：

```jsonc
{
  "groups": [ { "id": "g1", "label": "…", "mode": "multi", "note": "",
                "members": ["甲"], "editable": { "条目名": { "hint": "…" } } } ],  // editable 仅 mode=editable
  "sections": [ { "title": "推断分组", "groups": ["g1"] } ],
  "thinkingTags": [ … ],
  "display": {}
}
```

`inferGroups()` 输出的 group 与上面同形（字段 `{ id, label, mode, note, members, editable? }`），`sections[] = { title, groups: id[] }`，另有 `notes[] = { level: 'err'\|'warn'\|'info', text }` 与 `stats = { groups, managed, fixed, usable, skippedDuplicates, unnamed }`（成品预设实测：`{"groups":35,"managed":221,"fixed":14,"usable":233,"skippedDuplicates":0,"unnamed":0}`）。

### 3.7 `applyEdit()` 的返回值

返回**一份完整的新预设对象**（可直接 `JSON.stringify` 存盘），不是补丁：

- `next = { ...json, prompts: out }`；`prompt_order` 里被编辑的那一条换成 `{ ...o, order: newOrder }`（**该对象是新副本**，数组也是新数组）；其余 `prompt_order` 项保持原引用；`json` 的其它顶层字段连引用都不换。
- `extensions` **只在正则或脚本真的有改动时**才换新对象；否则 `next.extensions === json.extensions`。
- 没动过的条目**复用原对象**（不是深拷贝），所以逐条 sha1 必然相等；只有名字/正文/开关真变了的才换成新对象。
- 新条目按 `edit.added` 顺序追加在 `prompts` 末尾，写成 `{ identifier, name, enabled, injection_position, injection_depth, injection_order, role, content, system_prompt: false, marker: false, forbid_overrides: false }`。
- `edit.order` 里没产出的原有 `order` 项作为"孤儿"**原样保留**在后面（绝不悄悄丢）；新增条目若有没进 `order` 的也会补上。
- **空编辑时输出与源 JSON 逐字节相同**：`JSON.stringify(out) === JSON.stringify(json)` 为 `true`（`test-gui.mjs` 第 421–426 行用 sha1 断言，我在成品预设上实测为 `true`，且 `topLevelFrom`/`extensions` 引用复用、顶层键数 47 → 47）。`verifySourceIntact` 在空编辑下实测 `{checked:233, changed:[], removed:0, own:0, edited:0}`。

### 3.8 `injection_position` / `injection_depth` / `injection_order` / `role` / `marker` / `forbid_overrides`

只写本仓库**实际用到**的范围：

| 字段 | 本仓库怎么用 |
| --- | --- |
| `injection_position` | `parsePreset` → `entry.injPos`（缺省 `0`）。`assemble` 只对**严格等于 1** 的情况特判：该条目变成 `kind: 'injected-at-depth'` 的段，`text: ''`、`depth: injDepth`、`note:` `` `注入到聊天第 ${injDepth ?? '?'} 层（不在主提示里）` ``，不参与正文拼接。其它取值在本仓库没有任何分支（按 0 处理） |
| `injection_depth` | `entry.injDepth`（缺省 `null`）；只被上面那条分支与 `PresetInvariants` 的 `depth-missing` 检查读取（`injPos === 1` 且 `injDepth` 为 `null`/`undefined` → 建议级提醒） |
| `injection_order` | 本仓库**没有任何排序逻辑读它**。它只出现在 `PROSE_FIELDS`（来源完整性比对）与新增条目的默认值 `100` 里 |
| `role` | `entry.role`（缺省 `''`）；`assemble` 只把它放进 `segment.role`，不参与过滤。`skeleton` 新增条目只接受 `'user'`/`'assistant'`，其余落 `'system'`；`editor.addEntry` 原样用传入的 `role` |
| `marker`（磁盘布尔字段） | 本仓库**恒写 `false`**（`applyEdit` 与 `skeleton.entryOf` 都是），只做保留不改；`parsePreset` 把它暴露成 `entry.marker`。⚠️ 它与 `PresetEditor.MARKER_SLOTS` / `isMarker()` 说的"位置标记"**不是一回事**：后者指 identifier 属于那 8 个注入位槽位 |
| `forbid_overrides` | 只出现在 `PROSE_FIELDS`（比对）与新增条目的默认 `false` |
| `system_prompt` | `entry.systemPrompt` = `!!system_prompt`；PROSE_FIELDS 成员；新增条目恒写 `false` |

---

## 4. 配方（每条都已实测跑通）

约定：在**仓库根目录**执行。每条配方都是一行 `node -e "…"` 命令，实测在原样粘贴的情况下跑通（Windows PowerShell；代码里只用单引号、不含 `$`（除下面的 `$L`）与反引号）。

公共前缀：先执行一次下面这行，把加载前缀存进 PowerShell 变量 `$L`（等价于 1.2 里那 8 行 `load(...)`）：

```powershell
$L = "const fs=require('fs');const load=(p)=>new Function('globalThis',fs.readFileSync(p,'utf8'))(globalThis);['parse','assemble','invariants','editor','skeleton','panelconfig','groupinfer','buildops'].forEach((n)=>load('tools/gui/lib/'+n+'.js'));"
```

之后配方里的 `node -e "$L <其余代码>"` 直接可用。**换 shell 要改一处**：

- **cmd.exe / bash**：没有 PowerShell 变量展开（bash 下未定义的 `$L` 会展开成空，命令会以 `PP is not defined` 之类报错）。把 `$L` 就地替换成上面那串代码即可。
- **不想用 shell 变量**：把 `$L` 换成那串代码、其余不动，整段落成 `tools/_x.mjs`（`require` 改成 `import fs from 'node:fs'`），再 `node tools/_x.mjs`。已实测的等价写法（`$L` 内联版，直接可用）：

```powershell
node -e "const fs=require('fs');const load=(p)=>new Function('globalThis',fs.readFileSync(p,'utf8'))(globalThis);['parse','assemble','invariants','editor','skeleton','panelconfig','groupinfer','buildops'].forEach((n)=>load('tools/gui/lib/'+n+'.js'));const PP=globalThis.PresetParse;const raw=fs.readFileSync('preset/芳乃预设.json','utf8');const m=PP.parsePreset(JSON.parse(raw),'芳乃预设.json',Buffer.byteLength(raw));console.log(m.file,m.name,JSON.stringify(m.counts));console.log('条目',m.entries.length,'槽位',m.slots.length);"
```

（实测输出：`芳乃预设.json  {"prompts":233,…}` / `条目 233 槽位 12`。）

### R1 解析一份预设并打印报告

```powershell
node -e "$L const PP=globalThis.PresetParse;const raw=fs.readFileSync('preset/芳乃预设.json','utf8');const m=PP.parsePreset(JSON.parse(raw),'芳乃预设.json',Buffer.byteLength(raw));console.log(m.file,m.name,JSON.stringify(m.counts));console.log('条目',m.entries.length,'槽位',m.slots.length,'变量',m.variables.length,'标签族',m.tagFamilies.length,'警告',m.warnings.length,'建议',m.suggestions.length);"
```

实测输出：`芳乃预设.json  {"prompts":233,"listed":233,"enabled":52,"enabledChars":12028,"totalChars":156501}` / `条目 233 槽位 12 变量 117 标签族 9 警告 4 建议 22`。

### R2 跑体检（M2）并落一份 Markdown 清单

```powershell
node -e "$L const PP=globalThis.PresetParse,PA=globalThis.PresetAssemble,PI=globalThis.PresetInvariants;const raw=fs.readFileSync('preset/芳乃预设.json','utf8');const m=PP.parsePreset(JSON.parse(raw),'芳乃预设.json',Buffer.byteLength(raw));const r=PA.assemble(m,{user:'Master',char:'角色卡'});const rep=PI.check(m,r);console.log('必改',rep.counts.err,'建议',rep.counts.warn,'提示',rep.counts.info);rep.items.forEach((x)=>console.log('['+rep.levelLabel[x.level]+']',x.title));console.log('展开后正文',r.totalChars,'字 / 去掉注入位占位',r.bodyChars,'字 / 约',r.tokenEstimate,'token');fs.writeFileSync('preset/_体检清单.md',PI.toMarkdown(rep,m));"
```

实测：`必改 0 建议 3 提示 2`（三档清单逐条打印），token 估算 `3852`。成品预设上"必改 0"是**预期**的（`diag-checkup.mjs` 就是拿它当反例检查器）。

### R3 改一条条目的正文并导出新预设

```powershell
node -e "$L const PP=globalThis.PresetParse,PE=globalThis.PresetEditor;const raw=fs.readFileSync('preset/芳乃预设.json','utf8');const json=JSON.parse(raw);const m=PP.parsePreset(json,'芳乃预设.json');const e=PE.emptyEdit(m,[]);PE.setContent(e,json,0,'这一条现在是新正文。');const out=PE.applyEdit(json,e,m);fs.writeFileSync('preset/_我的导出.json',JSON.stringify(out,null,2));console.log('第 0 条现在是:',out.prompts[0].content);console.log('其余条目引用未变:',json.prompts.every((p,i)=>i===0||out.prompts[i]===p));console.log('自证:',JSON.stringify(PE.verifySourceIntact(json,e,m,PP.fingerprint)));"
```

实测：`其余条目引用未变: true`；`自证: {"checked":232,"changed":[],"removed":0,"own":0,"edited":1}`。

### R4 新增一条条目（默认关、正文待填）

```powershell
node -e "$L const PP=globalThis.PresetParse,PE=globalThis.PresetEditor;const raw=fs.readFileSync('preset/芳乃预设.json','utf8');const json=JSON.parse(raw);const m=PP.parsePreset(json,'芳乃预设.json');const e=PE.emptyEdit(m,[]);const a=PE.addEntry(e,m,{name:'📝我的新模块',slot:''});console.log('新条目:',JSON.stringify(a));console.log('待填?',PE.isPending(a.content),'默认开?',a.enabled);PE.setEnabledByName(e,m,'📝我的新模块',true);console.log('挡导出:',JSON.stringify(PE.exportChecks(json,e,m).blocking.map((b)=>b.kind)));a.content='这一条的内容我已经写好了。';const out=PE.applyEdit(json,e,m);console.log('导出后条目数',out.prompts.length,'新增那条 enabled',out.prompts[out.prompts.length-1].enabled);"
```

实测：`待填? true 默认开? false`；打开后 `挡导出: ["待填却开着"]`；填上正文后可以导出（没写内容就开 → 挡导出）。

### R5 按条目名切换开关（两处 `enabled` 一起写）

```powershell
node -e "$L const PP=globalThis.PresetParse,PE=globalThis.PresetEditor;const raw=fs.readFileSync('preset/芳乃预设.json','utf8');const json=JSON.parse(raw);const m=PP.parsePreset(json,'芳乃预设.json');const e=PE.emptyEdit(m,[]);const name=m.entries.find((x)=>x.listed&&x.enabled).name;console.log('目标:',name,'改前',PE.enabledByName(e,m,name));PE.setEnabledByName(e,m,name,false);const out=PE.applyEdit(json,e,m);const p=out.prompts.find((x)=>x.name===name);const o=out.prompt_order[0].order.find((x)=>x.identifier===p.identifier);console.log('条目 enabled',p.enabled,'/ prompt_order enabled',o.enabled);console.log('改动摘要:',JSON.stringify(PE.summary(e,m)));"
```

实测：目标 `🔗`，`条目 enabled false / prompt_order enabled false`。

### R6 改正则脚本的字段 + 试跑

```powershell
node -e "$L const PP=globalThis.PresetParse,PE=globalThis.PresetEditor;const raw=fs.readFileSync('preset/芳乃预设.json','utf8');const json=JSON.parse(raw);const m=PP.parsePreset(json,'芳乃预设.json');const e=PE.emptyEdit(m,[]);console.log('改前:',PE.regexViews(e,json,m)[0].scriptName);PE.setRegexField(e,json,PE.regexKey(0),'disabled',true);PE.setRegexField(e,json,PE.regexKey(0),'scriptName','我改的名字');const out=PE.applyEdit(json,e,m);console.log('改后 disabled',out.extensions.regex_scripts[0].disabled,'名',out.extensions.regex_scripts[0].scriptName);console.log('其余正则引用未变:',out.extensions.regex_scripts.slice(1).every((r,i)=>r===json.extensions.regex_scripts[i+1]));console.log('试跑:',JSON.stringify(PE.testRegex('/(\\d+)/g','<b>数字</b>','a1b2')));"
```

实测：`其余正则引用未变: true`；试跑 `{"ok":true,"error":"","matches":2,"out":"a<b>数字</b>b<b>数字</b>",…}`。

### R7 生成一份空骨架

```powershell
node -e "$L const PS=globalThis.PresetSkeleton;const sk=PS.buildSkeleton({name:'我的预设',base:null,moduleIds:['breach','cot','mvu'],customCount:2});console.log(JSON.stringify(sk.counts));console.log('顺序:',sk.json.prompts.map((p)=>p.name).join(' | '));console.log('第一条:',JSON.stringify(sk.json.prompts[0]));fs.writeFileSync('preset/_我的骨架.json',JSON.stringify(sk.json,null,2));"
```

实测：`{"prompts":20,"enabled":9,"pending":12,"markers":8}`；第一条是 `main`，正文为 `{{//待填：写你的核心指令：…}}`，8 个位置标记的正文是 `''` 且 `enabled: true`。

### R8 按预设推断面板分组

```powershell
node -e "$L const PP=globalThis.PresetParse,GI=globalThis.PresetGroupInfer;const raw=fs.readFileSync('preset/芳乃预设.json','utf8');const json=JSON.parse(raw);const m=PP.parsePreset(json,'芳乃预设.json');const inf=GI.inferGroups(m,json);console.log('统计:',JSON.stringify(inf.stats));console.log('分节:',inf.sections.map((s)=>s.title+'('+s.groups.length+')').join(' / '));console.log('前 5 个模块:',inf.groups.slice(0,5).map((g)=>g.mode+':'+g.label+'='+g.members.length).join(' | '));const v=GI.validateGroups(inf,m);console.log('校验: 错',v.errors.length,'提醒',v.warnings.length);"
```

实测：`{"groups":35,"managed":221,"fixed":14,"usable":233,"skippedDuplicates":0,"unnamed":0}`；校验 `错 0 提醒 2`。

### R9 把外观 + 分组写进面板源码（只动两个标记块）

```powershell
node -e "$L const PP=globalThis.PresetParse,PC=globalThis.PresetPanelConfig,GI=globalThis.PresetGroupInfer,BO=globalThis.PresetBuildOps;const raw=fs.readFileSync('preset/芳乃预设.json','utf8');const json=JSON.parse(raw);const m=PP.parsePreset(json,'芳乃预设.json');const panel=fs.readFileSync('panel/fano-panel.js','utf8');const inf=GI.inferGroups(m,json);const draft=BO.seedFrom({groups:inf.groups,sections:[{title:'推断分组',groups:inf.groups.map((g)=>g.id)}],thinkingTags:inf.thinkingTags,display:{}});let src=PC.patchConfig(panel,{title:'我的预设面板',ball:{size:52,glyph:'我'}});src=PC.patchGroups(src,BO.toOverride(draft));console.log('外观回读:',PC.extractConfig(src).ball.size,PC.extractConfig(src).title,'（兜底标题是',PC.extractFallbackTitle(src)+'）');console.log('分组回读:',PC.extractGroups(src).groups.length,'个模块 /',PC.extractGroups(src).sections.length,'个分节');const head=(s)=>s.slice(0,s.indexOf('const GROUPS_OVERRIDE'));const tail=(s)=>s.slice(s.indexOf(PC.END));console.log('两个标记块以外一字未动:',head(src)===head(panel)&&tail(src)===tail(panel));console.log('写完仍是合法 JS:',(()=>{try{new Function(src);return true;}catch{return false;}})());fs.writeFileSync('panel/_我的面板.js',src);"
```

实测：`外观回读: 52 我的预设面板 （兜底标题是 🌸 芳乃 · 预设面板）` / `分组回读: 35 个模块 / 1 个分节` / `两个标记块以外一字未动: true` / `写完仍是合法 JS: true`。

### R10 给"本来没有面板"的预设装一条面板脚本并导出

```powershell
node -e "$L const PP=globalThis.PresetParse,PE=globalThis.PresetEditor,PC=globalThis.PresetPanelConfig;const raw=fs.readFileSync('Izumi_0914.json','utf8');const json=JSON.parse(raw);const m=PP.parsePreset(json,'Izumi_0914.json');const e=PE.emptyEdit(m,[]);console.log('本来有几个面板脚本:',PE.panelScriptViews(e,json,m).length);const panel=fs.readFileSync('panel/fano-panel.js','utf8');const s=PE.addScript(e,json,{name:'演练 · 面板',content:PC.patchConfig(panel,{title:'Izumi · 预设面板'}),id:'preset-panel'});console.log('新脚本:',s.id,'enabled',s.enabled,'字节',s.content.length);console.log('导出前提示:',JSON.stringify(PE.exportChecks(json,e,m).notes.map((x)=>x.kind)));const out=PE.applyEdit(json,e,m);fs.writeFileSync('preset/_我的导出.json',JSON.stringify(out,null,2));console.log('导出后脚本数',out.extensions.tavern_helper.scripts.length,'原有脚本引用未变',out.extensions.tavern_helper.scripts[0]===json.extensions.tavern_helper.scripts[0]);console.log('再解析一遍条目数',PP.parsePreset(JSON.parse(JSON.stringify(out)),'导出.json').counts.prompts);"
```

实测：`本来有几个面板脚本: 0`（Izumi 只有一条"泉此方悬浮窗"，`looksLikePanel()` 不认）；导出后脚本数 2、原有脚本引用未变、条目数 226 不变。

### R11 读面板的配色 / 兜底标题 / 分组

```powershell
node -e "$L const PC=globalThis.PresetPanelConfig;const src=fs.readFileSync('panel/fano-panel.js','utf8');const cfg=PC.extractConfig(src);const themes=PC.extractThemes(src);console.log('兜底标题:',PC.extractFallbackTitle(src));console.log('当前标题:',JSON.stringify(cfg.title));console.log('出厂强调色: 白天',themes.day['--fp-accent'],'/ 夜间',themes.night['--fp-accent']);console.log('窗口',cfg.window.w+'x'+cfg.window.h,'球',cfg.ball.size+'px',cfg.ball.glyph);console.log('配色 token 数',Object.keys(themes.day).length,'/ 说明条目',PC.TOKEN_SPEC.length);console.log('分组覆盖:',PC.extractGroups(src),'/ 自带模块',PC.extractDefaults(src).groups.length,'个');"
```

实测：`兜底标题: 🌸 芳乃 · 预设面板`、`当前标题: ""`、白天 `#d4577f` / 夜间 `#e884a9`、窗口 `380x620` 球 `46px 芳`、token 数 20/20、分组覆盖 `null`、自带模块 25 个。

### R12 改成品预设里内嵌面板的配置（preset 模式）并导出

```powershell
node -e "$L const PP=globalThis.PresetParse,PE=globalThis.PresetEditor,PC=globalThis.PresetPanelConfig;const raw=fs.readFileSync('preset/芳乃预设.json','utf8');const json=JSON.parse(raw);const m=PP.parsePreset(json,'芳乃预设.json');const e=PE.emptyEdit(m,[]);const idx=json.extensions.tavern_helper.scripts.findIndex((s)=>String(s.content).includes(PC.BEGIN));console.log('面板脚本下标',idx);const cur=PC.extractConfig(json.extensions.tavern_helper.scripts[idx].content);const next=PC.mergeConfig(cur,{tokens:{day:{'--fp-accent':'#1188ff'}},window:{w:460,h:700},ball:{size:58}});const patched=PC.patchConfig(json.extensions.tavern_helper.scripts[idx].content,next);PE.setScriptField(e,json,idx,'content',patched);const out=PE.applyEdit(json,e,m);console.log('配置写进去了:',PC.extractConfig(out.extensions.tavern_helper.scripts[idx].content).ball.size,PC.extractConfig(out.extensions.tavern_helper.scripts[idx].content).window.w);console.log('条目区未动:',out.prompts.every((p,i)=>p===json.prompts[i]),'/ 其它脚本未动:',out.extensions.tavern_helper.scripts.every((s,i)=>i===idx||s===json.extensions.tavern_helper.scripts[i]));console.log('回写后仍是合法 JS:',(()=>{try{new Function(out.extensions.tavern_helper.scripts[idx].content);return true;}catch{return false;}})());"
```

实测：面板脚本下标 `0`，`配置写进去了: 58 460`，条目区未动 `/ 其它脚本未动: true`，回写后仍是合法 JS。

> 注意 R12 的 `next` 是由 `extractConfig` 的结果合并出来的，**带 `title`**；如果直接 `patchConfig(src, { tokens: … })` 传一个不含 `title` 的对象，`CONFIG.title` 会消失（见 5.2）。

---

## 5. 不变式与陷阱（调用方必须遵守）

### 5.1 工具永不改写别人的正文 —— `verifySourceIntact()` 到底比什么

```js
verifySourceIntact(json, edit, model, fingerprintFn) // → { checked, changed, removed, own, edited }
```

- `PROSE_FIELDS = ['identifier','content','role','system_prompt','injection_position','injection_depth','injection_order','marker','forbid_overrides']`，`proseOf(p) = JSON.stringify(PROSE_FIELDS.map(k => [k, p[k]]))`。**故意排除 `name` 与 `enabled`**：那是使用者有权改的结构字段，不算来源正文。
- 它内部先 `applyEdit(json, edit, model)`，把结果里所有 `prompts` 的正文指纹收成一个**多重集合**（`Map<指纹, 剩余条数>`），再逐条走 `model.entries`：
  - `edit.own.has(idx)` → `own++`（你自己写的，不算别人的正文）；
  - `edit.deleted.has(idx)` → `removed++`（删除是显式动作，不算"被改写"）；
  - `edit.content.has(idx)` → `edited++`（你**显式改过**这条正文）；
  - 否则拿原指纹去池子里扣，扣得到 → `checked++`；扣不到 → 名字进 `changed[]`。
- 实测（成品预设）：空编辑 `{checked:233, changed:[], removed:0, own:0, edited:0}`；改第 0 条正文 `{checked:232, changed:[], removed:0, own:0, edited:1}`。恒等式：`checked + changed.length + removed + own + edited === model.entries.length`。
- 指纹用 `PresetParse.fingerprint`（FNV-1a，**不抗碰撞**，只用于本地"有没有被改过"）；`tools/check-preset.mjs` 用 sha1 做权威校验（它逐条比来源条目 + 比对顶层其它字段）。`fingerprintFn` 可省略（默认恒等函数，此时比较的是 `proseOf` 字符串本身）。
- **它是多重集合比对，不做下标对齐**：两条正文完全相同的条目互换位置不会被发现。这在本仓库的语义下是可接受的（交换同文条目 = 文件内容不变）。

### 5.2 只替换标记之间的字面量

- 面板里两段配置都是"标记围起来的对象字面量"：`FANO_PANEL_CONFIG_BEGIN/END`（`CONFIG`）与 `FANO_PANEL_GROUPS_BEGIN/END`（`GROUPS_OVERRIDE`，默认 `null`）。
- `patchBlock(src, declName, value)` = `src.slice(0, lit.start) + JSON.stringify(value, null, 2).replace(/\n/g, '\n  ') + src.slice(lit.end)`。实测：`panel/fano-panel.js` 补丁后**两个块以外逐字节相同**（前缀到 `const GROUPS_OVERRIDE` 之前、以及 `CONFIG_END` 之后完全相同），补丁后仍是合法 JS。
- 陷阱：
  - **块内的注释会丢**（它们在本对象字面量内部，属于被替换的那段）；标记之间、字面量之外的说明性注释保留。实测回写后 `窗口标题` 等行内注释消失，行数 +3。
  - **`patchConfig(src, cfg)` 会丢 `DEFAULT_CONFIG` 与 `cfg` 都没有的键**。特别是 `title`：`DEFAULT_CONFIG` 里没有 `title`，所以传 `{ ball: { size: 50 } }` 会让 `CONFIG.title` 变成 `undefined`（面板随即回退到兜底标题）。正确做法：`PC.patchConfig(src, PC.mergeConfig(PC.extractConfig(src), 你的改动))`。
  - `clampConfig()` 的返回值**不能**拿去 `patchConfig`：它只返回 `ball/window/layout/wallpaper`（`version`/`title` 都丢了）。
  - 声明名找不到时 `patchBlock` **抛错**，`extractBlock` 返回 `null`（不抛）。
  - `patchGroups(src, null)` 是合法的（表示"用面板自带分组"）。
  - `findLiteral` 找的是**从 `from=0` 开始的第一个** `const <name> =`；面板里每个名字只出现一次。

### 5.3 位置标记：正文必须真的是空的，而且必须开着

- `MARKER_SLOTS`（8 个，实测值）：`worldInfoBefore, worldInfoAfter, charDescription, charPersonality, personaDescription, scenario, dialogueExamples, chatHistory`。**不含** `main`/`nsfw`/`jailbreak`/`enhanceDefinitions`——实测 `addEntry(edit, model, { name:'占住历史后置位', slot:'jailbreak' })` 得到的是**普通条目**（`content: FILL_MARK`、`enabled: false`），只有 8 个 MARKER_SLOTS 才会得到 `content: ''`、`enabled: true`、`marker: true`。
- `skeleton` 生成的 8 个位置标记：正文 `''`（**真的是空字符串，不是注释**）、`enabled: true`。这是有意的：`assemble` 只在 `e.injected && !e.chars` 时显示占位块 `⟨世界书·前⟩`；给它写了正文反而会让占位块消失、把你写的东西当正文拼进去。
- `exportChecks` 对位置标记的唯一要求是**开着**，关掉 → `warnings` 里出现 `'位置标记被关掉'`（不是 blocking，因为可能是作者有意用深度注入代替）。位置标记不受"待填却开着"的拦截（`if (r.marker) { …; continue; }`）。
- 删掉占注入位的条目 → **blocking** `'删掉了注入位'`（anchors 取自 `opts.anchorIds ?? edit.anchors`，通常传 `PresetInvariants.ANCHORS` 里 `tier === 'must'` 的 9 个）。不想留正文就清空正文，别删条目。
- `parsePreset` 里 `entry.marker` 是**磁盘那个布尔字段**，与这里的"位置标记"无关（见 3.8）。

### 5.4 一个新条目默认是关的

- `PresetEditor.addEntry()`：普通条目 `enabled: false`，正文 `FILL_MARK`；只有 8 个 MARKER_SLOTS 例外（`enabled: true`）。
- `PresetSkeleton`：`main` 默认开（`enabled: true`），`jailbreak` / `nsfw` 默认关，模块条目与自定义条目一律关，8 个位置标记开。
- 理由写在代码注释里：**没写内容就不该生效**。

### 5.5 两处 `enabled`：谁读哪个

| 位置 | 本仓库怎么用 |
| --- | --- |
| `prompt_order[0].order[].enabled` | `parsePreset` 生成 `entry.enabled` 时**优先取它**（entry 在列表里就用它，否则才回退 `prompt.enabled`）；`assemble` 是否拼这一条、`PresetInvariants` 的 `isOn`、`inferGroups`、`check-preset.mjs`（第 77 行 `enabledOf`）全都走这个口径 |
| `prompts[].enabled` | `editor` 在用户**显式**改过开关时，会把两处都写成一致；没改过的条目**保持原样**（实测 `Izumi_0914.json` 本来就有 3 条两处不一致，空编辑导出后仍是不一致的 3 条；成品 `preset/芳乃预设.json` 是 0 对 0 —— 工具"不顺手归一化"，一条也不修）。新增条目两处都写成 `!!a.enabled` |
| 面板脚本写回 | `panel/fano-panel.js` 的 `apply()` 改的是 `preset.prompts[]` 上的 `enabled`（酒馆助手 `getPreset('in_use')` 返回的对象） |

**给调用方的建议**：改开关只走 `setEnabledByName()` / `edit.enabled`，别自己直接改 `prompts[].enabled`，否则两处会脱钩。

### 5.6 面板标题绝不能写成空字符串

- 面板源码里写死了：`const title = el('div', 'fp-title', CONFIG?.title || '🌸 芳乃 · 预设面板');`（`panel/fano-panel.js` 第 1661 行；`panel/src/panel-core.js` 第 1067 行）。
- `extractFallbackTitle(src)` 用 `/CONFIG\??\.title\s*\|\|\s*'((?:[^'\\]|\\.)*)'/` 抠出这句兜底文案并反转义。对成品面板实测返回 `'🌸 芳乃 · 预设面板'`（找不到返回 `''`）。
- 所以：
  - 预设**自带**的面板留空 = 面板作者那句兜底文案照旧（对芳乃预设是对的）；
  - 由生成器**新装进别人预设**的面板，留空 = 面板自称"芳乃" → **必须带上那份预设的名字**（R10 就是传 `{ title: 'Izumi · 预设面板' }`）。
  - 校验用的口径：预览/画布上的标题必须与 `extractFallbackTitle()`（或你真的写进 `CONFIG.title` 的值）一致，否则就是"预览骗人"。

### 5.7 `FILL_MARK` / "待填"：什么算没写完，为什么挡导出

- 待填判定 `isPending(content)`：`trim()` 后为空，**或**整条正文只包一句注释宏（`/^\{\{\/\/[\s\S]*\}\}$/`）。`FILL_MARK = '{{//待填：在这里写这条的内容}}'`，骨架用 `{{//待填：<提示>}}`。
- 为什么用注释宏而不是空字符串：在酒馆的编辑器里看得见"这里要填"，而 `{{//…}}` 展开后是空（`assemble.expand` 对 `inner.startsWith('//')` 直接吞掉），所以既不进模型，也不会被 M2 的 `fill-on` 误报（M2 判"待填"用的是**展开后**的正文）。
- 为什么"开着的待填条目"挡导出：`exportChecks` 里对"自己写的条目"（`ownEntries` = `edit.added` 的 + `edit.own` 里的，且 `edit.deleted` 之外的）逐个判 `if (!isPending(r.content) \|\| !r.enabled) continue;` —— 也就是**待填 且 开着**才拦，`main` 槽位用另一句措辞（`'主提示还没写'`，因为 main 默认就是开的）。
- 不变式：**工具一个字都不代写正文**。新增条目的正文恒为 `FILL_MARK`，骨架的正文恒为 `{{//待填：…}}`（8 个位置标记除外，它们恒为 `''`）。
- 提前看到进度：`pendingProgress(edit, model)` → `{ total, todo, done, markers, todoNames[] }`；`exportChecks` 的 `notes` 里也会有 `'待填'` 一条。

### 5.8 其它实测到的坑（调用方容易踩）

1. **`addScript` 的 `id` 撞车检查**同时看源文件里的 `id` 与**本轮已新增**的 `id`；撞上就追加随机后缀，所以返回的 `s.id` 可能不等于你传进去的 `id`（要用返回对象的 `id`，别用入参）。
2. **`deleteScript` 只能删本轮新增的**（`'a:'` 开头）；传原有脚本的下标一律 `false`，且不会报错——别以为删成功了。
3. **`setRegexField` 字段名写错会抛异常**；字段必须是 `REGEX_FIELD_LABEL` 的 7 个键之一。
4. **`regexList` / `setRegexField` / `setScriptField` 必须拿原始 `json`**：`model.regexes[].name` 是归一化后的名字（`scriptName→name`、`findRegex→find`、`replaceString→replaceChars`），拿 model 做"改回原样了吗"的判断会永远判成"改过"。
5. **`emptyEdit` 的 `own` / `markerIdxs` 要调用方自己传**：导入的预设不传 → `own` 为空 → `pendingProgress` 全是 0、`exportChecks` 不会拦"开着的待填条目"（因为那些条目不算"你自己写的"）。做骨架流程时传 `ownIdxs: model.entries.map(e => e.idx)`（见 `test-gui.mjs` 第 13 节）。
6. **面板按条目名匹配条目**：`inferGroups` 会把**重名**与**无名**条目排除在模块外并写进 `notes`；`validateGroups` 对重名只给 warning；`auditPanel` 给 `'条目重名'`（err）。改名会让按名字匹配的面板/正则失效（`exportChecks` 的 `'改了名字'` warning）。
7. **`PresetBuildOps` 全部就地改草稿**（返回 `true/false` 或对象本身），而 `PresetEditor` 的动作函数改的是 `edit`、查询函数返回新值。混用时别期待 `addGroup` 返回一个"新草稿"。
8. **`seedFrom(defaults)` 才与面板自带分组脱钩**（内部 `JSON.parse(JSON.stringify(...))`）；直接拿 `extractDefaults()` 的结果去改会动到"自带的那份"。草稿里的 `__section` 是临时字段，`toOverride()` 会把它转成 `sections[]` 并删掉。
9. **`stats()` 与 `auditPanel()` 的 `managed` 口径**：`mode === 'fixed'` 的成员不计入 `managed`；`mode === 'hidden'` 的功能区在 `stats()` 里整个跳过。
10. **`buildSkeleton` 的 `customCount` 被钳到 0–20**：`Math.max(0, Math.min(20, Number(x) || 0))` —— 传字符串数字可以，传非数字落 0。
11. **`skeleton.counts.pending` 只数"注释待填"**，空正文的注入位标记计在 `markers`（实测 20 条骨架：`pending 12 / markers 8`）。
12. **`TOKEN_SPEC` 实际 21 条**（源码注释里那句"18 个颜色 token"是过期注释；`extractThemes().day` 也是 21 个键，`test-panelconfig.mjs` 用它们一一对应来断言）。0.6.0 起多了 `--fp-solid`（关掉壁纸后的纯色底，昼夜各一个）。
13. **`checkScriptSyntax` 只编译不执行**（`new Function(text)`），所以它不会真的跑别人的面板；但被 CSP 拦的环境里会抛。
14. **面板改动没写进脚本就导出**：`exportChecks` 的 `opts.panel = { groups, appearance, unapplied, ignored }` 由界面告诉你"这一轮搭过什么"；`groups > 0 || appearance === true` 且预设里没有面板脚本 → **blocking** `'面板没装进预设'`。这是补一个真实踩过的坑：搭完面板直接导出，文件里没有面板脚本却毫无提示。

---

## 6. 验证

在仓库根目录跑（实测全绿，输出为"通过 N 项，失败 0 项"）：

| 命令 | 覆盖内容 | 实测 |
| --- | --- | --- |
| `node tools/test-gui.mjs` | M0 解析 / M1 拼装（含人造小预设的 setvar/getvar/addvar 时序语义）、M2 体检的**每个不变式都造一个反例**、M3 编辑器的空编辑逐字节等价与来源 sha1 自证、M4 骨架、正则编辑、脚本编辑、面板外观端到端、分组推断、EJS 识别、`PresetBuildOps` 三层操作 | 通过 353 项 |
| `node tools/test-panelconfig.mjs` | `panelconfig.js` 的 `clampConfig()` 与**真加载的面板** `__FANO_PANEL__.config().effective` 逐字段比对（防漂移）、配置块抠取/回写只动一段、壁纸图层、缩放、20 个 token 都有中文说明且都真被用到、`GROUPS_OVERRIDE` 读写与面板真的照它渲染、"装进预设"导出的脚本真能跑起来 | 通过 101 项 |
| `node tools/test-panel.mjs` | `panel/fano-panel.js` 的面板逻辑（假 DOM 真加载）：手风琴、破甲骨架与档位、档位不被切换清掉、角色名替换、滚动位置、每次操作只写回一次、长按条目改正文（含取消/吞点击/注入位标记只读） | 通过 155 项 |
| `node tools/check-preset.mjs` | **成品预设的权威校验**：结构、**来源提示词一字未改（sha1 硬约束）**、新增条目范围、内置槽位唯一性与锚点、面板兼容性、破甲初始状态、扩展（面板与正则）、思维链标签互斥 | 通过 108 项 |
| `node tools/test-regex.mjs` | `preset/fano-thinking-chain.json` 的折叠链：1 块 → Izumi 形态、≥2 块 → Kemini 形态、标签/无块/混杂场景 | 通过 30 项 |
| `node tools/test-mobile.mjs` | 手机场景（390×844 视口、桌面遗留坐标）：尺寸/坐标夹回视口、旋转后重夹、`diagnose()` 能报出挂错层 | 通过 20 项 |
| `node tools/test-iframe.mjs` | 面板必须挂到最外层同源文档：两层 iframe、顶层 body 未就绪要等、父窗口跨域时退回本地并示警 | 通过 34 项 |

- **`tools/check-preset.mjs` 是预设的权威校验器**：它不借用 `build-preset.mjs` 的任何中间结果，直接读 `preset/芳乃预设.json` + 三份源预设（`Izumi_0914.json`、`Kemini_Dramatron_v3.1.json`、`梦鲸思客V4-0915.json`）+ `spec/`，重新推导一遍再比对；"来源提示词一字未改"这条硬约束由它用 sha1 逐条裁定。任何工具链的改动，最后都要过它。
- 顺带一条诊断脚本（不是断言）：`node tools/diag-checkup.mjs [文件.json …]` 打印 M2 体检清单（默认 `Izumi_0914.json` 与 `preset/芳乃预设.json`），实测成品预设上 `必改 0 · 建议 3 · 提示 2`。
