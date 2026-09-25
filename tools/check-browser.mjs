#!/usr/bin/env node
/**
 * 浏览器布局回归测试
 *
 *   node tools/check-browser.mjs            # 桌面视口 1280×900
 *   node tools/check-browser.mjs --mobile   # 手机视口 390×844（并附加手机专用断言）
 *
 * 用 headless Chrome 真加载面板、真点标题、真量几何。node 版的 test-panel.mjs
 * 用的是假 DOM，量不出 CSS 布局问题（比如模块被 flex 压扁成 2px 导致点不到），
 * 所以这一层必须用真浏览器跑。
 *
 * 注意：Chrome 需要派生进程与 IPC，在 DSH 沙箱下会被拒（OpenProcess 拒绝访问）。
 * 需要以更宽权限运行（danger-full-access）。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { need } from './lib/fixtures.mjs';

/* 夹具守卫：这层要真加载面板的量几何，页面数据来自 preview-host.js（由成品预设生成）。 */
need(path.join('panel', 'preview-host.js'), '浏览器布局回归（58 项）',
  'preview-host.js 由 node tools/build-preview.mjs 生成');

const ROOT = process.cwd();
const P = (...a) => path.join(ROOT, ...a);

const MOBILE = process.argv.includes('--mobile');
const VIEWPORT = MOBILE ? '390,844' : '1280,900';

const CHROMES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const chrome = CHROMES.find((c) => fs.existsSync(c));
if (!chrome) { console.error('没找到 Chrome / Edge'); process.exit(2); }

const page = P('panel', 'browser-check.html');
const url = 'file:///' + page.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace('%3A', ':')
  + (MOBILE ? '?mobile=1' : '');
const out = P('panel', '_browser-check.html');
const profile = path.join(os.tmpdir(), 'fano-browser-check-' + (MOBILE ? 'm-' : 'd-') + Date.now());

const args = [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + profile,
  '--window-size=' + VIEWPORT,
  '--virtual-time-budget=12000',
  '--dump-dom', url,
];
if (MOBILE) {
  args.splice(4, 0, '--user-agent=Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
}

const res = spawnSync(chrome, args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });

if (res.error) { console.error('启动 Chrome 失败:', res.error.message); process.exit(1); }
const dom = (res.stdout || Buffer.alloc(0)).toString('utf8');
if (!dom) { console.error('Chrome 没输出（多半是沙箱拒了：OpenProcess 拒绝访问）。用更宽权限重跑。'); process.exit(1); }

fs.writeFileSync(out, dom, 'utf8');

const i = dom.indexOf('id="verdict"');
if (i < 0) { console.error('dump 里没有 #verdict，页面可能没跑完'); process.exit(1); }
const start = dom.indexOf('>', i) + 1;
const text = dom.slice(start, dom.indexOf('</pre>', start))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&amp;/g, '&');

console.log(`【${MOBILE ? '手机视口 ' + VIEWPORT : '桌面视口 ' + VIEWPORT}】`);
console.log(text);
try { fs.unlinkSync(out); } catch { /* 留不下也无所谓 */ }
process.exitCode = /\bFAIL\b/.test(text) ? 1 : 0;
