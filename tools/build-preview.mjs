#!/usr/bin/env node
/**
 * 预览假数据生成
 *
 *   node tools/build-preview.mjs
 *
 * 必须在 tools/build-preset.mjs **之后**跑——它把成品预设读进来当假数据，
 * 这样 panel/preview.html 和 tools/test-panel.mjs 跑的就是成品本身。
 *
 * （早先这段逻辑长在 build-panel.mjs 里，导致流水线顺序上它总比成品旧，
 *   面板测试实际测的是上一版预设。现在拆成独立步骤，并由 test-panel.mjs
 *   的第一条断言检查"预览数据是否比成品新"。）
 */
import fs from 'node:fs';
import path from 'node:path';
import { has, skip } from './lib/fixtures.mjs';

/* 夹具守卫：假数据要么从成品预设来，要么从三份源预设的并集来；两样都没有就生不出来。 */
if (!has(path.join('preset', '芳乃预设.json'))
  && !['Izumi_0914.json', 'Kemini_Dramatron_v3.1.json', '梦鲸思客V4-0915.json'].some((f) => has(f))) {
  skip('预览假数据（panel/preview-host.js）', ['preset/芳乃预设.json（成品）', '或三份源预设'],
    '先 node tools/build-preset.mjs，或按 samples/README.md 放源预设');
}

const ROOT = process.cwd();
const P = (...a) => path.join(ROOT, ...a);

const builtFiles = fs.existsSync(P('preset'))
  ? fs.readdirSync(P('preset')).filter((f) => f.startsWith('芳乃预设') && f.endsWith('.json')).sort()
  : [];
const builtFile = builtFiles.length ? builtFiles[builtFiles.length - 1] : null;
if (builtFiles.length > 1) {
  console.error(`⚠ preset/ 下有 ${builtFiles.length} 份成品，可能拿错：${builtFiles.join('、')}`);
}

const seen = new Set();
const mockPrompts = [];
let mockName;

if (builtFile) {
  const json = JSON.parse(fs.readFileSync(P('preset', builtFile), 'utf8'));
  const order = new Map((json.prompt_order?.[0]?.order ?? []).map((o) => [o.identifier, !!o.enabled]));
  for (const p of json.prompts ?? []) {
    const name = p.name ?? '';
    if (seen.has(name)) continue;
    seen.add(name);
    mockPrompts.push({
      identifier: p.identifier,
      name,
      content: p.content ?? '',
      role: p.role ?? 'system',
      enabled: order.has(p.identifier) ? order.get(p.identifier) : false,
    });
  }
  mockName = `预览：${builtFile.replace(/\.json$/, '')}（成品）`;
} else {
  for (const file of ['Izumi_0914.json', 'Kemini_Dramatron_v3.1.json', '梦鲸思客V4-0915.json']) {
    const json = JSON.parse(fs.readFileSync(P(file), 'utf8'));
    const order = new Map((json.prompt_order?.[0]?.order ?? []).map((o) => [o.identifier, !!o.enabled]));
    for (const p of json.prompts ?? []) {
      const name = p.name ?? '';
      if (!name || seen.has(name)) continue;
      seen.add(name);
      mockPrompts.push({
        identifier: 'mock-' + mockPrompts.length,
        name,
        content: p.content ?? '',
        role: p.role ?? 'system',
        enabled: order.has(p.identifier) ? order.get(p.identifier) : false,
      });
    }
  }
  mockName = '预览：三家并集（模拟预设，尚未组装成品）';
}

const mock = `/**
 * 预览用假数据 + 假的酒馆助手 API（自动生成，勿手改）
 * 来源：${builtFile ? 'preset/' + builtFile + '（成品）' : '三份源预设的条目并集'}
 * 共 ${mockPrompts.length} 条。真实酒馆里没有这个文件，面板直接用酒馆助手提供的真 API。
 * 生成：node tools/build-preview.mjs
 */
window.__MOCK_PRESET__ = {
  name: ${JSON.stringify(mockName)},
  prompts: ${JSON.stringify(mockPrompts, null, 2)},
};

window.__MOCK_LOG__ = [];
window.__MOCK_LOG_UI__ = function (msg) {
  window.__MOCK_LOG__.push(msg);
  const box = document.getElementById('mock-log');
  if (box) {
    const line = document.createElement('div');
    line.textContent = new Date().toLocaleTimeString() + '  ' + msg;
    box.prepend(line);
    while (box.childElementCount > 40) box.lastElementChild.remove();
  }
};

window.getPreset = async function (which) {
  if (which !== 'in_use') return null;
  return window.__MOCK_PRESET__;
};
window.getPresetNames = async function () { return [window.__MOCK_PRESET__.name]; };
window.replacePreset = async function (which, preset) {
  window.__MOCK_PRESET__ = preset;
  window.__MOCK_LOG_UI__('replacePreset(' + which + ') 已写回');
  return preset;
};
window.updatePresetWith = async function (which, updater, opts) {
  const before = window.__MOCK_PRESET__.prompts.map((p) => ({ on: p.enabled !== false, len: (p.content || '').length }));
  const next = updater(window.__MOCK_PRESET__) || window.__MOCK_PRESET__;
  window.__MOCK_PRESET__ = next;
  const changed = [];
  next.prompts.forEach((p, i) => {
    const now = p.enabled !== false;
    const len = (p.content || '').length;
    if (now !== before[i].on) changed.push((now ? '开 ' : '关 ') + p.name);
    else if (len !== before[i].len) changed.push('改正文 ' + p.name + ' ' + before[i].len + '→' + len + ' 字');
  });
  window.__MOCK_LOG_UI__('updatePresetWith(' + which + ', …) → ' + changed.length + ' 处改动'
    + (changed.length ? '：' + changed.slice(0, 6).join('，') + (changed.length > 6 ? ' …' : '') : ''));
  return next;
};
window.eventOn = function () { return { stop() {} }; };
`;

fs.writeFileSync(P('panel', 'preview-host.js'), mock, 'utf8');
console.log('已生成 panel/preview-host.js　'
  + (fs.statSync(P('panel', 'preview-host.js')).size / 1024).toFixed(1) + ' KB　'
  + `来源：${builtFile ? builtFile : '三份源预设并集'}　条目 ${mockPrompts.length} 条`);
