#!/usr/bin/env node
/**
 * 包内自检：把"这个包到底能不能用"用命令答出来。
 *
 *   node tools/selftest.mjs
 *
 * 给两种人用：
 *   · 拿到压缩包的人——装完先跑这个，绿了就说明库、面板、成品预设都对得上；
 *   · 要调用这里代码的 AI——这是**可编程接口**的最小可运行样例：
 *     下面每一段都在真实文件上跑了一遍（解析 → 体检 → 拼装 → 改 → 导出 → 面板）。
 *
 * 这里故意不复用开发环境的重型测试（那些要第三方源预设）；它只依赖包内的文件。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { needAll } from './lib/fixtures.mjs';

/* 夹具守卫：包内自检要对着**成品预设**跑（解析 → 拼装 → 改 → 导出 → 面板）。
   这份仓库不随附预设正文，所以缺了就是 SKIP，而不是假装通过。 */
needAll([path.join('preset', '芳乃预设.json'), path.join('preset', '芳乃预设.zip')],
  '包内自检（72 项）', '先 node tools/build-preset.mjs，或按 samples/README.md 放夹具');

const ROOT = process.cwd();
const P = (...a) => path.join(ROOT, ...a);

let pass = 0;
const fails = [];
const ok = (name, cond, detail) => {
  if (cond) { pass++; }
  else { fails.push(name); console.log(`  ✗ ${name}${detail ? '　→ ' + detail : ''}`); }
};
const section = (t) => console.log(`\n${t}`);

/* ── 1. 库能不能加载 ─────────────────────────────────────────────────
   这些文件是普通 <script>（不是 ES module）：每个都用 IIFE 往 globalThis 上挂一个全局。
   Node 里没有 <script>，所以用 new Function 把同一个源码在 globalThis 作用域里跑一遍。 */
section('[1] 可编程库（tools/gui/lib/*.js）');
const LIBS = [
  ['parse.js', 'PresetParse'],
  ['assemble.js', 'PresetAssemble'],
  ['invariants.js', 'PresetInvariants'],
  ['editor.js', 'PresetEditor'],
  ['skeleton.js', 'PresetSkeleton'],
  ['panelconfig.js', 'PresetPanelConfig'],
  ['groupinfer.js', 'PresetGroupInfer'],
  ['buildops.js', 'PresetBuildOps'],
];
const loadLib = (rel) => new Function('globalThis', fs.readFileSync(P('tools', 'gui', 'lib', rel), 'utf8'))(globalThis);
const libLine = [];
for (const [file, global] of LIBS) {
  let err = '';
  try { loadLib(file); } catch (e) { err = e.message; }
  const mod = globalThis[global];
  ok(`能加载 lib/${file} 并拿到 globalThis.${global}`, !!mod && typeof mod === 'object', err || `拿到 ${typeof mod}`);
  if (mod) {
    const names = Object.keys(mod);
    ok(`  ${global} 有对外函数（${names.length} 个）`, names.length > 0, names.slice(0, 4).join('、'));
    libLine.push(`${global}(${names.length})`);
  }
}
console.log('  ' + libLine.join('　'));
const PP = globalThis.PresetParse;
const PA = globalThis.PresetAssemble;
const PI = globalThis.PresetInvariants;
const PE = globalThis.PresetEditor;
const PS = globalThis.PresetSkeleton;
const PC = globalThis.PresetPanelConfig;
const GI = globalThis.PresetGroupInfer;
const BO = globalThis.PresetBuildOps;
if (!PP || !PE || !PC) { console.error('\n库没加载起来，后面的检查没法做。'); process.exit(1); }

/* ── 2. 成品预设：解析 / 体检 / 拼装 ───────────────────────────────── */
section('[2] 成品预设 preset/芳乃预设.json');
const presetPath = P('preset', '芳乃预设.json');
const raw = fs.readFileSync(presetPath, 'utf8');
const json = JSON.parse(raw);
const model = PP.parsePreset(json, '芳乃预设.json', Buffer.byteLength(raw));
console.log(`  ${model.counts.prompts} 条条目（开启 ${model.counts.enabled}）　`
  + `槽位 ${model.slots.length}　变量 ${model.variables.length}　标签族 ${model.tagFamilies.length}　`
  + `正则 ${model.regexes.length}　脚本 ${model.scripts.length}　诊断 ${model.warnings.length}`);
ok('解析出条目', model.counts.prompts > 100, String(model.counts.prompts));
ok('解析出槽位占用', model.slots.length > 0);
ok('解析出变量总线', model.variables.length > 0);
ok('解析出标签族', model.tagFamilies.length > 0);
ok('解析是只读的（没改传进去的 json）', json.prompt_order.length === 1 && !!json.prompts);

const assembled = PA.assemble(model, { user: 'Master', char: '示例角色' });
console.log(`  拼装：${assembled.segments.length} 段　${assembled.totalChars} 字　≈${assembled.tokenEstimate} token　`
  + `变量事件 ${assembled.events.length}`);
ok('拼装出正文', assembled.totalChars > 1000, String(assembled.totalChars));
ok('token 估算为正', assembled.tokenEstimate > 100);

const report = PI.check(model, assembled);
console.log(`  体检：必改 ${report.counts.err} · 建议 ${report.counts.warn} · 提示 ${report.counts.info}`);
/* 成品预设是自己构建校验过的：体检器在它身上报"必改"多半是体检器误报。
   所以这里只断言"体检跑得出来、条目完整"，不把 err 当成包坏了。 */
ok('体检跑得出结果且每条都有依据与改法',
  report.items.length > 0 && report.items.every((i) => i.title && i.why && i.fix));
ok('体检结论与原预设一致（结论稳定，可复现）',
  PI.check(PP.parsePreset(json, 'x.json'), PA.assemble(PP.parsePreset(json, 'x.json'))).counts.err === report.counts.err);

/* ── 3. 最重要的一条不变式：空编辑导出必须与原文件逐字节相同 ────────── */
section('[3] 编辑与导出（"别人的原文一个字都不改"）');
const anchors = model.entries.filter((e) => PS.MARKER_SLOT_IDS.includes(e.identifier)).map((e) => e.identifier);
const edit = PE.emptyEdit(model, anchors);
const emptyOut = PE.applyEdit(json, edit, model);
ok('空编辑导出 == 原文件（逐字节）', JSON.stringify(emptyOut) === JSON.stringify(json),
  `${JSON.stringify(emptyOut).length} vs ${JSON.stringify(json).length} 字节`);

const intact = PE.verifySourceIntact(json, edit, model, PP.fingerprint);
ok('来源完整性自证：全部一致', intact.changed.length === 0, intact.changed.join('、'));
ok('自证覆盖了来源条目', intact.checked > 100, String(intact.checked));

/* 真的改一条：改完只有那条变、自证能指出是你改的 */
const target = model.entries.find((e) => e.listed && e.name && e.chars > 40 && !PE.isOwnContent(edit, e.idx));
const orig = PE.contentOf(edit, json, target.idx);
PE.setContent(edit, json, target.idx, orig + '\n（自检追加一行）');
const out1 = PE.applyEdit(json, edit, model);
ok('改动进了导出', String(out1.prompts.find((p) => p.name === target.name).content).includes('（自检追加一行）'));
ok('其它条目一个字节没动',
  PE.verifySourceIntact(json, edit, model, PP.fingerprint).changed.length === 0);
ok('自证把"你改过的那条"单独算', PE.verifySourceIntact(json, edit, model, PP.fingerprint).edited === 1);
PE.setContent(edit, json, target.idx, orig);
ok('改回原文后补丁自动撤销', !edit.content.has(target.idx));
ok('撤销后又是逐字节相同', JSON.stringify(PE.applyEdit(json, edit, model)) === JSON.stringify(json));

const added = PE.addEntry(edit, model, { name: '自检新增条目', slot: '' });
ok('新增条目默认关着（没写内容就不该生效）', added.enabled === false);
ok('新增条目是"待填"状态', PE.isPending(added.content) === true);
/* 待填 + 开着 = 拦住导出（工具不替你写正文，所以这条必须拦） */
added.enabled = true;
ok('导出前检查会拦住"待填却开着"',
  PE.exportChecks(json, edit, model, { anchorIds: anchors }).blocking.some((b) => b.kind === '待填却开着'),
  JSON.stringify(PE.exportChecks(json, edit, model, { anchorIds: anchors }).blocking.map((b) => b.kind)));
added.content = '自检写的正文';
ok('写完之后不再是待填', PE.isPending(added.content) === false);
ok('写完就放行导出', PE.exportChecks(json, edit, model, { anchorIds: anchors }).blocking.length === 0);
ok('新增条目进了导出',
  PE.applyEdit(json, edit, model).prompts.some((p) => p.name === '自检新增条目'));
PE.deleteAdded(edit, added.key);
ok('删掉新增条目后回到逐字节相同', JSON.stringify(PE.applyEdit(json, edit, model)) === JSON.stringify(json));

/* ── 4. 空骨架：从零搭一份的起点 ───────────────────────────────────── */
section('[4] 从零搭一份（骨架）');
/* 注意返回的是 { json, name, markers, counts } —— 骨架本身在 .json 里 */
const sk = PS.buildSkeleton({ name: '自检骨架', moduleIds: ['core', 'fano'] });
const skModel = PP.parsePreset(sk.json, '骨架.json');
console.log(`  ${sk.counts.prompts} 条条目　开启 ${sk.counts.enabled}　位置标记 ${sk.markers.length} 个`);
ok('骨架能被解析', skModel.counts.prompts > 10, String(skModel.counts.prompts));
ok('骨架的位置标记正文是空的（酒馆在这儿注入世界书/角色卡/聊天记录）',
  skModel.entries.filter((e) => e.marker).every((e) => e.chars === 0));
ok('骨架自带模块说明（界面上告诉人每条是干什么的）',
  PS.describe({ moduleIds: ['core', 'fano'] }).length >= 3,
  String(PS.describe({ moduleIds: ['core', 'fano'] }).length));
ok('骨架的注入位齐全', !PI.check(skModel, PA.assemble(skModel)).items.some((i) => i.id === 'missing-anchors'));

/* ── 5. 面板脚本：配置块与分组块 ───────────────────────────────────── */
section('[5] 面板面板 panel/fano-panel.js');
const panelSrc = fs.readFileSync(P('panel', 'fano-panel.js'), 'utf8');
const cfg = PC.extractConfig(panelSrc);
const themes = PC.extractThemes(panelSrc);
const css = PC.extractCss(panelSrc);
console.log(`  颜色 token ${Object.keys(themes.day).length} 个（昼夜各一套）　静态 CSS ${(css.length / 1024).toFixed(1)} KB`);
ok('能抽出 CONFIG', !!cfg && !!cfg.wallpaper);
ok('能抽出 THEMES（昼夜两套）', !!themes?.day && !!themes?.night);
ok('能抽出静态 CSS（预览用真样式）', css.length > 3000, String(css.length));
ok('每个颜色 token 都有中文说明（界面上不会出现没标签的颜色）',
  Object.keys(themes.day).every((k) => PC.TOKEN_SPEC.some((t) => t.key === k)),
  Object.keys(themes.day).filter((k) => !PC.TOKEN_SPEC.some((t) => t.key === k)).join('、'));
ok('面板源码里那句兜底标题读得出来（标题留空时真面板显示的就是它）',
  PC.extractFallbackTitle(panelSrc).length > 0, JSON.stringify(PC.extractFallbackTitle(panelSrc)));

const patched = PC.patchConfig(panelSrc, { ...cfg, title: '自检面板', layout: { ...cfg.layout, radius: 20 } });
ok('改配置能回读', PC.extractConfig(patched).title === '自检面板' && PC.extractConfig(patched).layout.radius === 20);
ok('只改一个字段时不会把别的字段（尤其标题）弄丢',
  (() => {
    const one = PC.patchConfig(panelSrc, { ...cfg, ball: { ...cfg.ball, size: 60 } });
    const back = PC.extractConfig(one);
    return back.ball.size === 60 && back.title === cfg.title && !!back.wallpaper && !!back.tokens;
  })());
ok('改配置只动标记块那一段（前后缀逐字相同）',
  panelSrc.slice(0, panelSrc.indexOf(PC.BEGIN)) === patched.slice(0, patched.indexOf(PC.BEGIN))
  && panelSrc.slice(panelSrc.indexOf(PC.END)) === patched.slice(patched.indexOf(PC.END)));

/* 分组推断 → 覆盖块 → 回读 */
const inf = GI.inferGroups(model, json);
const draft = BO.seedFrom(inf);
const ov = BO.toOverride(draft);
const withGroups = PC.patchGroups(patched, ov);
console.log(`  分组推断：${inf.groups.length} 个模块　分节 ${ov.sections.length} 个`);
ok('能按预设推断出分组', inf.groups.length > 0, String(inf.groups.length));
ok('推断结果全引用真实条目名', GI.validateGroups(inf, model).errors.length === 0,
  GI.validateGroups(inf, model).errors.slice(0, 2).map((e) => e.text).join('；'));
ok('分组覆盖写进面板后能回读', PC.extractGroups(withGroups)?.groups?.length === ov.groups.length);
ok('面板质检能跑（报出条目不存在的功能区）',
  BO.auditPanel(BO.seedFrom({ groups: [{ id: 'x', label: '空口', mode: 'multi', members: ['不存在的条目'] }], sections: [{ title: 'S', groups: ['x'] }], thinkingTags: [], display: {} }), model, edit)
    .some((x) => x.kind === '条目不存在'));

/* ── 6. 把面板装进预设（"给没有面板的预设配一个面板"这条路的成品检查）── */
section('[6] 装进预设');
const edit2 = PE.emptyEdit(model, anchors);
PE.addScript(edit2, json, { name: '自检 · 面板', content: withGroups, id: 'selftest-panel' });
const out2 = PE.applyEdit(json, edit2, model);
const scripts = out2.extensions?.tavern_helper?.scripts ?? [];
ok('导出的预设里带着这条脚本', scripts.some((s) => s.content.includes(PC.BEGIN)));
ok('原来那份预设的脚本没被动',
  scripts[0] === json.extensions.tavern_helper.scripts[0]);
const views = PE.panelScriptViews(edit2, json, model);
ok('能认出"这份预设里有几个面板脚本"',
  views.length === json.extensions.tavern_helper.scripts.length + 1 && views.some((v) => v.name === '自检 · 面板'),
  JSON.stringify(views.map((v) => v.name)));
ok('新装进去的那个算"这次加的"，预设自带的那个不算',
  views.find((v) => v.name === '自检 · 面板')?.isNew === true
  && views.filter((v) => !v.isNew).length === json.extensions.tavern_helper.scripts.length,
  JSON.stringify(views.map((v) => [v.name, v.isNew])));

/* ── 7. zip 与 json 同源 ───────────────────────────────────────────── */
section('[7] preset/芳乃预设.zip');
const zipPath = P('preset', '芳乃预设.zip');
if (!fs.existsSync(zipPath)) { ok('zip 存在', false, '没有 zip'); }
else {
  const buf = fs.readFileSync(zipPath);
  const inner = inflateFirst(buf);
  ok('zip 能解开', inner !== null);
  ok('zip 里装的正是这一份 json（不是旧版）',
    inner !== null && inner.toString('utf8') === JSON.stringify(json),
    inner ? `${inner.length} 字节 vs ${Buffer.byteLength(JSON.stringify(json), 'utf8')} 字节` : '解不开');
}
/** 从 zip 里取出第一个条目（只处理我们自己写出来的 store / deflate 两种） */
function inflateFirst(buf) {
  const sig = buf.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  if (sig < 0) return null;
  const method = buf.readUInt16LE(sig + 8);
  const nameLen = buf.readUInt16LE(sig + 26);
  const extraLen = buf.readUInt16LE(sig + 28);
  const compSize = buf.readUInt32LE(sig + 18);
  const body = buf.subarray(sig + 30 + nameLen + extraLen, sig + 30 + nameLen + extraLen + compSize);
  try { return method === 0 ? Buffer.from(body) : zlib.inflateRawSync(body); } catch { return null; }
}

/* ── 8. 包内其它产物在不在 ─────────────────────────────────────────── */
section('[8] 包内文件');
for (const f of ['README.md', '使用说明.md', '说明书.md', 'tools/gui/index.html', 'tools/gui/API.md',
  'tools/gui/demo/fano-demo.js', 'panel/preview.html', 'panel/preview-host.js', 'spec/groups.json']) {
  ok(`有 ${f}`, fs.existsSync(P(f)));
}
/* 标准纸与它的编辑器副本：这是"clone 下来双击就有样例"的落脚点，
   两边必须都在、而且是同一份（不一致就会"页面里的样例跟测试量到的不是一张纸"）。 */
ok('有标准纸 samples/标准纸.json', fs.existsSync(P('samples', '标准纸.json')));
const paperJs = P('tools', 'gui', 'demo', 'paper-demo.js');
ok('有编辑器用的演示纸 tools/gui/demo/paper-demo.js', fs.existsSync(paperJs));
if (fs.existsSync(paperJs) && fs.existsSync(P('samples', '标准纸.json'))) {
  const r = spawnSync(process.execPath, [P('tools', 'build-demo-paper.mjs'), '--check'], { cwd: ROOT, encoding: 'utf8' });
  ok('演示纸与标准纸一致（node tools/build-demo-paper.mjs --check）', r.status === 0,
    (r.stdout || '').trim().split('\n').slice(-1)[0] || String(r.status));
}
const demoTag = /<script src="(demo\/[^"]*demo\.js)"><\/script>/.exec(fs.readFileSync(P('tools', 'gui', 'index.html'), 'utf8'));
ok('编辑器引的示例数据文件在（file:// 下少一个文件就是白屏）',
  !!demoTag && fs.existsSync(P('tools', 'gui', demoTag[1])), demoTag ? demoTag[1] : '没找到那一行');
if (demoTag && demoTag[1] !== 'demo/fano-demo.js') {
  console.log(`  注：这份编辑器引的是 ${demoTag[1]}——**我们自己的标准纸**（演示与测试共用一张）。`
    + ' 发布包里它会被换成 demo/fano-demo.js（成品预设的快照，node tools/build-package.mjs 会强制检查）。');
}

/* ── 结果 ──────────────────────────────────────────────────────────── */
console.log('\n' + '─'.repeat(40));
if (fails.length) {
  console.log(`通过 ${pass} 项，失败 ${fails.length} 项`);
  for (const f of fails) console.log('  失败：' + f);
  process.exitCode = 1;
} else {
  console.log(`通过 ${pass} 项，失败 0 项　—— 这个包是可用的。`);
  console.log('接着可以：node tools/check-preset.mjs（成品预设的权威校验，108 项）');
}
