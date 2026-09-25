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
  console.log('      要把这一步真跑起来：把这些文件放进 samples/（见 samples/README.md）');
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

/** 要一个夹具；没有就 SKIP 退出。返回绝对路径 */
export function need(name, what, hint) {
  const p = find(name);
  if (p) return p;
  skip(what || name, name, hint);
  return null;   /* 到不了这儿 */
}

/** 一次要一组；缺任何一个就一起报出来（比一个一个缺更容易一次补齐） */
export function needAll(names, what, hint) {
  const missing = names.filter((n) => !find(n));
  if (!missing.length) return names.map((n) => find(n));
  skip(what || names.join('、'), missing, hint);
  return null;
}
