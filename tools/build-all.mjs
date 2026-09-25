#!/usr/bin/env node
/**
 * 一条命令把整条链跑完（给刚克隆下来的人用）
 *
 *   node tools/build-all.mjs
 *
 * 它按依赖顺序调用：
 *   make-fixture  → 造合成夹具（结构来自 spec/，正文占位，不含任何预设正文）
 *   build-regex   → 思维链折叠链
 *   build-panel   → 面板脚本（只用 panel/src + spec/groups.json）
 *   build-preset  → 组装出一份样例预设
 *   build-preview → 假酒馆宿主（面板测试要用）
 *   build-gui-demo→ 页面演示数据
 *   build-package → dist/ 目录与 zip
 *
 * **跑完这些，全部测试套件就都能真跑了**（在此之前它们只会打印 SKIP）。
 *
 * 注意 `build-groups.mjs` **不在**这条链里，这是故意的：它推出来的 spec/groups.json
 * 是**进库的结构规格**，只能拿真实预设反推（见 fixtures.mjs 的 needReal）。
 * 也就是说：链子能跑 ≠ 规格能被重新推导——规格是事实，不是产物。
 *
 * 已经放了真预设的人：这一步照跑，真预设优先，合成夹具不会覆盖它，
 * 于是产出的就是真成品；只有缺哪份才会拿合成夹具顶上（会打印出来）。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STEPS = ['make-fixture', 'build-regex', 'build-panel', 'build-preset', 'build-preview', 'build-gui-demo', 'build-package'];

console.log('整条链（缺夹具会自动造合成夹具；真实预设优先）\n');
for (const step of STEPS) {
  const file = path.join(ROOT, 'tools', `${step}.mjs`);
  console.log(`\n════ ${step} ════`);
  const r = spawnSync(process.execPath, [file], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`\n✗ ${step} 退出码 ${r.status} —— 后面的步骤依赖它，先修这里。`);
    process.exit(r.status || 1);
  }
}
console.log('\n────────────────────────────────────────');
console.log('全部跑完。接着可以：');
console.log('  node tools/selftest.mjs        # 包内自检（72 项）');
console.log('  node tools/test-gui.mjs        # 解析 / 拼装内核（353 项）');
console.log('  node tools/test-panel.mjs      # 面板逻辑（155 项）');
console.log('  node tools/check-preset.mjs    # 样例预设的独立校验（108 项）');
console.log('  node tools/check-gui-browser.mjs   # 十屏 DOM 取证（要本机 Chrome/Edge）');
console.log('合成夹具是"结构等价、正文占位"的样例；要跑真实数据就把真预设放成同名再跑一遍这条命令。');
