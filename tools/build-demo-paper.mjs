#!/usr/bin/env node
/**
 * 标准纸 → 编辑器演示数据
 *
 *   node tools/build-demo-paper.mjs           # 生成/刷新 tools/gui/demo/paper-demo.js
 *   node tools/build-demo-paper.mjs --check   # 只校验：磁盘上那份与标准纸是否一致
 *
 * ── 为什么有这样的脚本 ──────────────────────────────────────────────
 * 编辑器是**双击就能开**的 file:// 页面：它不能 fetch（会被 CORS 拦），只能靠
 * <script src> 把演示数据当普通脚本加载。所以标准纸要转成一份 .js。
 *
 * 而这份 .js **随仓库走**（.gitignore 里特意留了它）——于是 clone 下来双击
 * tools/gui/index.html 就有样例可看，不用先跑任何构建脚本。要换纸、要重打，
 * 都从这里走：改 samples/标准纸.json，再跑这一句。
 *
 * ── 这张纸是什么 ────────────────────────────────────────────────────
 * `samples/标准纸.json` = **我们自己的**演示预设（条目 27 条，正文全是占位）：
 * 演示与测试都用它。早先编辑器默认加载的是**一份第三方预设**（demo/izumi-demo.js），
 * 测试也拿别人的纸当尺子量——按作者定的口径都换掉了。
 *
 * 输出是确定性的：同一个输入逐字节同一份输出（--check 就是靠这一点）。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const P = (...a) => path.join(ROOT, ...a);
const PAPER = P('samples', '标准纸.json');
const OUTDIR = P('tools', 'gui', 'demo');
const OUTFILE = path.join(OUTDIR, 'paper-demo.js');
const CHECK = process.argv.includes('--check');

if (!fs.existsSync(PAPER)) {
  console.error(`✗ 找不到标准纸：samples/标准纸.json`);
  console.error('  它是演示与测试用的那张纸（我们自己的，随仓库走）。文件没了就得先把它放回来。');
  process.exit(2);
}

const raw = fs.readFileSync(PAPER, 'utf8');
const json = JSON.parse(raw);
const entries = (json.prompts ?? []).length;
const regexes = (json.extensions?.regex_scripts ?? []).length;
const scripts = (json.extensions?.tavern_helper?.scripts ?? []).length;

const out = `/**
 * 编辑器默认演示数据：**标准纸**（自动生成，勿手改）
 * 来源：samples/标准纸.json　${(Buffer.byteLength(raw, 'utf8') / 1024).toFixed(0)} KB
 * 生成：node tools/build-demo-paper.mjs　（--check 校验一致性）
 *
 * 用普通 <script> 而不是 fetch：file:// 下 fetch 会被 CORS 拦掉，<script src> 不会。
 * 这一份随仓库走，所以 clone 下来双击 index.html 就有样例——不用先跑构建脚本。
 */
window.__DEMO_PRESETS__ = [
  { file: ${JSON.stringify('标准纸.json')}, bytes: ${Buffer.byteLength(raw, 'utf8')}, json: ${JSON.stringify(json)} }
];
`;

if (CHECK) {
  const cur = fs.existsSync(OUTFILE) ? fs.readFileSync(OUTFILE, 'utf8') : null;
  if (cur === out) {
    console.log(`✓ tools/gui/demo/paper-demo.js 与 samples/标准纸.json 一致`
      + `（条目 ${entries} 条，正则 ${regexes} 条，内嵌脚本 ${scripts} 个）`);
  } else {
    console.error('✗ 演示数据与标准纸不一致——跑 node tools/build-demo-paper.mjs 重新生成');
    console.error(cur === null ? '  （文件不存在）' : '  （内容有差异）');
    process.exitCode = 1;
  }
} else {
  fs.mkdirSync(OUTDIR, { recursive: true });
  fs.writeFileSync(OUTFILE, out, 'utf8');
  console.log(`已生成 tools/gui/demo/paper-demo.js　${(fs.statSync(OUTFILE).size / 1024).toFixed(0)} KB`);
  console.log(`  来源 samples/标准纸.json：条目 ${entries} 条，正则 ${regexes} 条，内嵌脚本 ${scripts} 个`);
}
