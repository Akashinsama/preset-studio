#!/usr/bin/env node
/**
 * 生成 GUI 的默认演示数据
 *
 *   node tools/build-gui-demo.mjs
 *
 * 产物是普通 <script>（不是 fetch/JSON）——file:// 页面加载 fetch 会被拦，
 * 而 <script src> 不受影响，这样双击 index.html 就能用，不需要任何服务器。
 *
 * 出三样（都是**发布包**要用的示例素材）：
 *   fano-demo.js         成品预设的快照（发布包里 index.html 引的是它）
 *   fano-panel-demo.js   面板源码快照——**两版都出**：空壳版 + 注入了防截断的那版，
 *                        编辑器「面板外观」用它们做可选注入（见 tools/lib/panel-compose.mjs）
 *   preview-host-demo.js 假酒馆 API 源码（导出独立预览页时按需加载）
 *
 * **编辑器默认加载的那份演示纸不在这里出**：它是 samples/标准纸.json，
 * 由 tools/build-demo-paper.mjs 转成 tools/gui/demo/paper-demo.js（克隆下来就有）。
 * 早先这一步是拿一份**第三方预设**当默认演示数据（demo/izumi-demo.js）——
 * 按作者定的口径去掉了：演示与测试用的标准纸必须是我们自己那张。
 */
import fs from 'node:fs';
import path from 'node:path';
import { needAll } from './lib/fixtures.mjs';
import { composePanel } from './lib/panel-compose.mjs';

/* 夹具守卫：演示数据 = 一份样本预设（开发期用 Izumi）+ 成品预设的快照。 */
needAll(['Izumi_0914.json', path.join('preset', '芳乃预设.json')],
  '生成 GUI 演示数据（tools/gui/demo/*.js）',
  'samples/README.md 里写了这些文件各自要什么');

const ROOT = process.cwd();
const P = (...a) => path.join(ROOT, ...a);
const OUTDIR = P('tools', 'gui', 'demo');
fs.mkdirSync(OUTDIR, { recursive: true });

/* ── 演示纸（编辑器双击打开时看到的那些样例）**不在这里出** ─────────────
   它是我们自己的那张标准纸：samples/标准纸.json → tools/build-demo-paper.mjs →
   tools/gui/demo/paper-demo.js。这里原来拿一份**第三方预设**（Izumi_0914.json）
   当默认演示数据（demo/izumi-demo.js），按作者定的口径去掉了：
   演示与测试用的标准纸必须是我们自己那张。

   注意下面那份"成品预设快照"（fano-demo.js）仍然要出：它是**发布包**的示例素材
   （index.html 在包里引它），而这份仓库里 index.html 引的是标准纸。 */

/* ── 芳乃预设（本工程的成品）作为"发布包"的示例素材 ───────────────────
   发布包（node tools/build-package.mjs → dist/）里**只带这一份**示例，
   别人的预设（Izumi）只留在开发环境里跑测试用。
   两份演示数据不会同时被 index.html 加载：发布包里那一行 <script> 被换成这份。 */
const FANO = P('preset', '芳乃预设.json');
const fanoRaw = fs.readFileSync(FANO, 'utf8');
const fanoJson = JSON.parse(fanoRaw);
const fanoOut = `/**
 * 示例素材：芳乃预设（本工程的成品，自动生成，勿手改）
 * 来源：preset/芳乃预设.json　${(fanoRaw.length / 1024).toFixed(0)} KB
 * 生成：node tools/build-gui-demo.mjs
 *
 * 发布包用这一份当示例：它自带面板脚本、正则、变量总线、30 个思维链折叠规则，
 * 拿来当"导入 → 看诊断 → 搭面板 → 导出"的练习对象最合适。
 */
window.__DEMO_PRESETS__ = [
  { file: ${JSON.stringify('芳乃预设.json')}, bytes: ${Buffer.byteLength(fanoRaw, 'utf8')}, json: ${JSON.stringify(fanoJson)} }
];
`;
const fanoFile = path.join(OUTDIR, 'fano-demo.js');
fs.writeFileSync(fanoFile, fanoOut, 'utf8');
console.log(`已生成 tools/gui/demo/fano-demo.js　${(fs.statSync(fanoFile).size / 1024).toFixed(0)} KB`);
console.log(`  来源 preset/芳乃预设.json：条目 ${fanoJson.prompts?.length ?? 0} 条，开启 ${(fanoJson.prompt_order?.[0]?.order ?? []).filter((o) => o.enabled).length} 条，正则 ${fanoJson.extensions?.regex_scripts?.length ?? 0} 条，面板脚本 ${fanoJson.extensions?.tavern_helper?.scripts?.length ?? 0} 个`);

/* ── 面板源码（给「面板外观」用）─────────────────────────────────────
   「面板外观」要在**不导入任何文件**的情况下也能用：调颜色、看预览、导出配置。
   所以把成品面板的源码、静态 CSS、出厂配置、出厂配色一起发过去（都是我们自己的产物）。
   注意这里是**构建期**抽的：抽不到就在这里报错，别等到用户双击页面才发现预览是空的。

   **两版都发**：source（默认那版：防截断装的是空壳，不含第三方代码）与
   sourceWithAntitrunc（注入了真模块那版，借自 Kemini）。编辑器里那个
   「注入防截断」勾选项就是在这两版之间整段换（PC.withAntitrunc）。 */
const PANEL_SRC = fs.readFileSync(P('panel', 'fano-panel.js'), 'utf8');
const PANEL_SRC_AT = composePanel({ root: ROOT, withAntitrunc: true }).src;
new Function('globalThis', fs.readFileSync(P('tools', 'gui', 'lib', 'panelconfig.js'), 'utf8'))(globalThis);
const PC = globalThis.PresetPanelConfig;
const config = PC.extractConfig(PANEL_SRC);
const themes = PC.extractThemes(PANEL_SRC);
const css = PC.extractCss(PANEL_SRC);
if (!config) throw new Error('从 panel/fano-panel.js 里抽不到 CONFIG —— 面板是不是被改坏了？');
if (!themes) throw new Error('从 panel/fano-panel.js 里抽不到 THEMES');
if (!css) throw new Error('从 panel/fano-panel.js 里抽不到静态 CSS');
if (PC.antitruncVariant(PANEL_SRC) === 'real') throw new Error('panel/fano-panel.js 里带着真防截断模块——'
  + '它应当是"未注入"那版（默认）。是不是拿 build-panel.mjs --with-antitrunc 的输出覆盖了库内产物？');
if (PC.antitruncVariant(PANEL_SRC_AT) !== 'real') throw new Error('现拼的"注入防截断"那版里没有真模块——panel-compose 出问题了');
const version = (/const VERSION = '([^']+)'/.exec(PANEL_SRC) || [])[1] || '?';

const panelOut = `/**
 * 面板源码快照（自动生成，勿手改）　版本 ${version}
 * 生成：node tools/build-gui-demo.mjs（读 panel/fano-panel.js + tools/lib/panel-compose.mjs）
 *
 * 「面板外观」编辑器用它：source 用来改写配置、css 用来做**真样式**预览、
 * config/themes 给出出厂值。sourceWithAntitrunc 是"注入了脚本层防截断"的那一版——
 * 那一层**借自 Kemini Dramatron v3.1**（出处与"作者主张权利即删除"见 NOTICE.md），
 * 默认不装；用户勾选后才会用它换掉 source 里那一段。
 */
window.__FANO_PANEL_DEMO__ = {
  version: ${JSON.stringify(version)},
  source: ${JSON.stringify(PANEL_SRC)},
  sourceWithAntitrunc: ${JSON.stringify(PANEL_SRC_AT)},
  antitruncVariant: ${JSON.stringify(PC.antitruncVariant(PANEL_SRC))},
  css: ${JSON.stringify(css)},
  config: ${JSON.stringify(config)},
  themes: ${JSON.stringify(themes)}
};
`;
const panelFile = path.join(OUTDIR, 'fano-panel-demo.js');
fs.writeFileSync(panelFile, panelOut, 'utf8');
console.log(`已生成 tools/gui/demo/fano-panel-demo.js　${(fs.statSync(panelFile).size / 1024).toFixed(0)} KB`
  + `（含两版面板源码：空壳 ${(PANEL_SRC.length / 1024).toFixed(0)} KB / 注入防截断 ${(PANEL_SRC_AT.length / 1024).toFixed(0)} KB）`);
console.log(`  面板 ${version}：颜色 token ${Object.keys(themes.day).length} 个 / 静态 CSS ${(css.length / 1024).toFixed(1)} KB`);

/* 假酒馆 API（预览页要用）。单独一个文件，**按需加载**：
   它 377KB，页面启动时没必要背着；只有点「导出独立预览页」才去加载。 */
const hostSrc = fs.readFileSync(P('panel', 'preview-host.js'), 'utf8');
const hostOut = `/**
 * 假酒馆助手 API 源码快照（自动生成，勿手改）
 * 生成：node tools/build-gui-demo.mjs（读 panel/preview-host.js）
 * 用途：导出「独立预览页」时把这段内联进去，让面板在普通浏览器里也能真跑起来。
 */
window.__PREVIEW_HOST_SRC__ = ${JSON.stringify(hostSrc)};
`;
const hostFile = path.join(OUTDIR, 'preview-host-demo.js');
fs.writeFileSync(hostFile, hostOut, 'utf8');
console.log(`已生成 tools/gui/demo/preview-host-demo.js　${(fs.statSync(hostFile).size / 1024).toFixed(0)} KB（按需加载）`);
