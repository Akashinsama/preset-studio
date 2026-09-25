/**
 * 夹具解析（fixtures）
 *
 * 本仓库**只发工具与文档，不发任何预设正文**——原因见 NOTICE.md。
 * 于是所有"要拿一份真实预设当样本"的脚本都先过这里：
 *
 *   import { need, skip, has } from './lib/fixtures.mjs';   // tools/xxx.mjs
 *
 *   const izumi = need('Izumi_0914.json', '界面回归要拿它当样本');
 *   if (!has('Kemini_Dramatron_v3.1.json')) skip('对比测试', ['Kemini_Dramatron_v3.1.json']);
 *
 * 找不到就**打印 SKIP 并正常退出 0**：这样新克隆下来的仓库不会红一片，
 * 而"没跑"和"跑过了"也不会被混为一谈——SKIP 会明确说出来缺哪个文件、往哪放。
 *
 * 想让缺失变成失败（CI、或你自己要确认全套都真跑过）：
 *   set DSH_REQUIRE_FIXTURES=1     # Windows
 *   DSH_REQUIRE_FIXTURES=1 node tools/check-preset.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

/** 仓库根（本文件在 tools/lib/ 下） */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SAMPLES = path.join(ROOT, 'samples');
const STRICT = process.env.DSH_REQUIRE_FIXTURES === '1';

/** 夹具找两处：samples/（你放进去的）优先，其次仓库根（原开发环境的样子） */
export function find(name) {
  for (const p of [path.join(SAMPLES, name), path.join(ROOT, name)]) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export const has = (name) => !!find(name);

/** 缺夹具的统一出口。缺了就说清楚缺什么、往哪放，然后正常退出 */
export function skip(what, missing, hint) {
  const list = [].concat(missing);
  console.log('');
  console.log('────────────────────────────────────────');
  console.log(`SKIP  ${what}`);
  console.log(`      缺夹具：${list.join('、')}`);
  console.log('      本仓库不随附任何预设正文（见 NOTICE.md）——这是故意的，不是坏了。');
  console.log(`      正常情况下不该走到这里：缺夹具时 ${AUTO_GEN ? '应当已经自动生成合成夹具' : '自动生成被关掉了'}。`);
  console.log('      要真跑这一步：node tools/make-fixture.mjs（自己造合成夹具）');
  console.log('      或者把这些文件放进 samples/（你自己的真预设，见 samples/README.md）');
  if (hint) console.log(`      备注：${hint}`);
  if (STRICT) {
    console.log('      DSH_REQUIRE_FIXTURES=1 已设置：缺失视为失败。');
    console.log('────────────────────────────────────────');
    process.exit(2);
  }
  console.log('      没跑 ≠ 通过。想让缺失直接报错，就用 DSH_REQUIRE_FIXTURES=1 再跑一次。');
  console.log('────────────────────────────────────────');
  process.exit(0);
}

/* ── 缺夹具时自动造一份 ───────────────────────────────────────────────
   公开仓库不随附预设正文，于是"缺夹具"是**常态**而不是意外。与其每次都让人先读一段
   SKIP 说明再手动跑一句，不如在这里自动调 tools/make-fixture.mjs 造合成夹具：
   合成夹具是仓库自己的脚本按 spec/ 生成的（结构等价、正文占位），不涉任何他人内容。
   生成不成功（比如沙箱不让派生子进程、或脚本被删了）就照旧 SKIP 并把话说清楚。
   关掉：DSH_NO_AUTO_FIXTURE=1（想确认"真夹具在不在"时用这个）。 */
const AUTO_GEN = process.env.DSH_NO_AUTO_FIXTURE !== '1';
let triedGen = false;

function autoGenerate() {
  if (!AUTO_GEN || triedGen) return false;
  triedGen = true;
  const gen = path.join(ROOT, 'tools', 'make-fixture.mjs');
  if (!fs.existsSync(gen)) return false;
  try {
    console.log('（缺夹具：正在生成合成夹具 tools/make-fixture.mjs —— 结构来自 spec/，正文是占位，不含任何预设正文）');
    execFileSync(process.execPath, [gen], { cwd: ROOT, stdio: 'inherit' });
    return true;
  } catch (e) {
    console.log(`（自动生成合成夹具失败：${e && e.message ? e.message : e}）`);
    return false;
  }
}

/** 要一个夹具；没有就先试试自动生成，再没有就 SKIP 退出。返回绝对路径 */
export function need(name, what, hint) {
  let p = find(name);
  if (!p && autoGenerate()) p = find(name);
  if (p) return p;
  skip(what || name, name, hint);
  return null;   /* 到不了这儿 */
}

/**
 * 要一份**真实**夹具（不接受合成夹具）。
 *
 * 给"输出会变成仓库里的事实"的脚本用——最典型的是 build-groups.mjs：它推出来的
 * spec/groups.json 是**进库的结构规格**。要是它喂了合成夹具，推出来的规格就是拿
 * 我们自己造的占位数据反推的，直接覆盖掉真规格，而且看起来一切正常。
 * 这种事必须硬拦：宁可停下来让人放真预设。
 */
export function needReal(name, what, hint) {
  const p = find(name);
  if (p && !isSynthetic(name)) return p;
  skip(what || name, [`${name}（需要**真实**预设，不接受合成夹具${p ? '：当前这份是合成夹具' : ''}）`],
    hint || '把真预设放成同名（或放进 samples/）再跑；这一步的产物会进库，不能用占位数据反推');
  return null;
}

/** 一次要一组；缺任何一个就一起报出来（比一个一个缺更容易一次补齐） */
export function needAll(names, what, hint) {
  let missing = names.filter((n) => !find(n));
  if (missing.length && autoGenerate()) missing = names.filter((n) => !find(n));
  if (!missing.length) return names.map((n) => find(n));
  skip(what || names.join('、'), missing, hint);
  return null;
}

/* ── 分辨"真夹具"还是"合成夹具" ───────────────────────────────────────
   tools/make-fixture.mjs 生成的合成夹具（结构等价、正文占位）顶层带 __synthFixture。
   有些断言写的是**真实预设的规模**（226 条、60 条开启、30 条正则…），那些数字对合成夹具
   没有意义。这时正确做法不是放它过去，也不是整条报错，而是**换成按夹具重算**：
   断言的意思（解析不丢条目、开关读得对、正则都在）不变，基准从写死的数字变成夹具本身。
   下面几个辅助函数就是给这种分叉用的。 */
export const SYNTH_MARK = '__synthFixture';
const SOURCES = ['Izumi_0914.json', 'Kemini_Dramatron_v3.1.json', '梦鲸思客V4-0915.json'];

export const readFixture = (name) => {
  const p = find(name);
  if (!p) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
};

export const isSynthetic = (name) => {
  const j = readFixture(name);
  return !!(j && j[SYNTH_MARK]);
};

/** 三份源预设里只要有合成夹具就算"合成模式"（真实夹具优先，混用会被报出来） */
export function fixtureMode() {
  const synth = [], real = [];
  for (const n of SOURCES) {
    if (!find(n)) continue;
    (isSynthetic(n) ? synth : real).push(n);
  }
  return { synthetic: synth.length > 0, mixed: synth.length > 0 && real.length > 0, synth, real };
}

/** 合成模式时在输出里说清楚：这些数字是按夹具重算的，不是被放过了 */
export function noteFixtureMode(label) {
  const m = fixtureMode();
  if (!m.synthetic) return '';
  const line = `  · ${label}：基准取自合成夹具（${m.synth.join('、')}）——真实规模类数字按夹具重算`;
  if (m.mixed) console.log(line + `　⚠ 同时存在真实夹具：${m.real.join('、')}`);
  else console.log(line);
  return line;
}
