#!/usr/bin/env node
/**
 * 面板构建
 *
 *   node tools/build-panel.mjs                    # 默认：**不注入**脚本层防截断
 *   node tools/build-panel.mjs --with-antitrunc   # 注入真模块（借自 Kemini，见 NOTICE.md）
 *
 * 产物：panel/fano-panel.js（可粘贴进酒馆助手的脚本本体）。
 * 拼装逻辑在 tools/lib/panel-compose.mjs —— 构建脚本、编辑器快照、测试共用同一条路，
 * 免得"构建时注入的那一版"和"测试里跑的那一版"悄悄不是同一份。
 *
 * ── 为什么默认不注入防截断 ──────────────────────────────────────────────
 * 那段实现是**从别人的预设里移植来的**（原作 Kemini Dramatron v3.1 的 scripts[0]，
 * 作者 Kemini）。按作者定的口径：仓库可以大大方方承认借鉴、也可以留着那段代码并注明
 * 出处，但**不默认把它装出去**——要它得显式注入（这个开关，或编辑器「面板外观」里的勾选）。
 * 默认注入的是 panel/src/antitrunc-stub.js：本工程自己写的空壳，API 同名同形、什么都不做。
 *
 * 预览假数据（panel/preview-host.js）不在这里生成——它必须读**成品预设**，
 * 所以拆到了 tools/build-preview.mjs，在 build-preset.mjs 之后跑。
 */
import fs from 'node:fs';
import path from 'node:path';
import { composePanel } from './lib/panel-compose.mjs';

const ROOT = process.cwd();
const P = (...a) => path.join(ROOT, ...a);
const WITH = process.argv.includes('--with-antitrunc') || process.env.FANO_WITH_ANTITRUNC === '1';

let out;
try {
  out = composePanel({ root: ROOT, withAntitrunc: WITH });
} catch (e) {
  console.error('✗ ' + ((e && e.message) || e));
  process.exit(1);
}
fs.writeFileSync(P('panel', 'fano-panel.js'), out.src, 'utf8');

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log(`已生成 panel/fano-panel.js　${kb(Buffer.byteLength(out.src, 'utf8'))}`
  + `　（酒馆助手脚本本体，子集 ${out.groupsCount} 个，思维链标签组 ${out.tagsCount} 个）`);
console.log(WITH
  ? `防截断：**已注入** panel/src/antitrunc.js（${kb(out.moduleBytes)}，借自 Kemini Dramatron v3.1，出处见 NOTICE.md）`
  : `防截断：未注入（默认）——这一版装的是 panel/src/antitrunc-stub.js 空壳（${kb(out.moduleBytes)}），`
    + '一个字节的第三方代码都没有；要真防护：--with-antitrunc');
console.log('下一步：node tools/build-preset.mjs　然后：node tools/build-preview.mjs');
