#!/usr/bin/env node
/**
 * 生成 GUI 的默认演示数据
 *
 *   node tools/build-gui-demo.mjs
 *
 * 按用户要求：**只放 Izumi 一份**作为默认演示数据。
 * 产物是一个普通 <script>（不是 fetch/JSON）——file:// 页面加载 fetch 会被拦，
 * 而 <script src> 不受影响，这样双击 index.html 就能用，不需要任何服务器。
 */
import fs from 'node:fs';
import path from 'node:path';
import { needAll } from './lib/fixtures.mjs';

/* 夹具守卫：演示数据 = 一份样本预设（开发期用 Izumi）+ 成品预设的快照。 */
needAll(['Izumi_0914.json', path.join('preset', '芳乃预设.json')],
  '生成 GUI 演示数据（tools/gui/demo/*.js）',
  'samples/README.md 里写了这些文件各自要什么');

const ROOT = process.cwd();
const P = (...a) => path.join(ROOT, ...a);
const OUTDIR = P('tools', 'gui', 'demo');
fs.mkdirSync(OUTDIR, { recursive: true });

const SOURCE = 'Izumi_0914.json';
/* 开发仓库里有这份第三方预设（拿它当"别人的预设"跑测试）；
   发布包里**故意不带**——那时候这一步就跳过，只出芳乃那一份。 */
if (fs.existsSync(P(SOURCE))) {
  const raw = fs.readFileSync(P(SOURCE), 'utf8');
  const json = JSON.parse(raw);

  const out = `/**
 * GUI 默认演示数据（自动生成，勿手改）
 * 来源：${SOURCE}　${(raw.length / 1024 / 1024).toFixed(2)} MB
 * 生成：node tools/build-gui-demo.mjs
 *
 * 用普通 <script> 而不是 fetch：file:// 下 fetch 会被 CORS 拦掉，<script src> 不会。
 * （这一份是**开发环境**用的：发布包里没有它，发布包的示例素材只有芳乃预设。）
 */
window.__DEMO_PRESETS__ = [
  { file: ${JSON.stringify(SOURCE)}, bytes: ${Buffer.byteLength(raw, 'utf8')}, json: ${JSON.stringify(json)} }
];
`;

  const file = path.join(OUTDIR, 'izumi-demo.js');
  fs.writeFileSync(file, out, 'utf8');
  console.log(`已生成 tools/gui/demo/izumi-demo.js　${(fs.statSync(file).size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  来源 ${SOURCE}：条目 ${json.prompts?.length ?? 0} 条，正则 ${json.extensions?.regex_scripts?.length ?? 0} 条，内嵌脚本 ${json.extensions?.tavern_helper?.scripts?.length ?? 0} 个`);
} else {
  console.log(`（没有 ${SOURCE}：发布包不带第三方源预设，跳过这份开发用演示数据）`);
}

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
   注意这里是**构建期**抽的：抽不到就在这里报错，别等到用户双击页面才发现预览是空的。 */
const PANEL_SRC = fs.readFileSync(P('panel', 'fano-panel.js'), 'utf8');
new Function('globalThis', fs.readFileSync(P('tools', 'gui', 'lib', 'panelconfig.js'), 'utf8'))(globalThis);
const PC = globalThis.PresetPanelConfig;
const config = PC.extractConfig(PANEL_SRC);
const themes = PC.extractThemes(PANEL_SRC);
const css = PC.extractCss(PANEL_SRC);
if (!config) throw new Error('从 panel/fano-panel.js 里抽不到 CONFIG —— 面板是不是被改坏了？');
if (!themes) throw new Error('从 panel/fano-panel.js 里抽不到 THEMES');
if (!css) throw new Error('从 panel/fano-panel.js 里抽不到静态 CSS');
const version = (/const VERSION = '([^']+)'/.exec(PANEL_SRC) || [])[1] || '?';

const panelOut = `/**
 * 面板源码快照（自动生成，勿手改）　版本 ${version}
 * 生成：node tools/build-gui-demo.mjs（读 panel/fano-panel.js）
 *
 * 「面板外观」编辑器用它：source 用来改写配置、css 用来做**真样式**预览、
 * config/themes 给出出厂值。全是我们自己的产物，不涉及第三方代码。
 */
window.__FANO_PANEL_DEMO__ = {
  version: ${JSON.stringify(version)},
  source: ${JSON.stringify(PANEL_SRC)},
  css: ${JSON.stringify(css)},
  config: ${JSON.stringify(config)},
  themes: ${JSON.stringify(themes)}
};
`;
const panelFile = path.join(OUTDIR, 'fano-panel-demo.js');
fs.writeFileSync(panelFile, panelOut, 'utf8');
console.log(`已生成 tools/gui/demo/fano-panel-demo.js　${(fs.statSync(panelFile).size / 1024).toFixed(0)} KB`);
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
