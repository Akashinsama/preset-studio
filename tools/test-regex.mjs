#!/usr/bin/env node
/**
 * 统一折叠链测试
 *
 *   node tools/test-regex.mjs
 *
 * 直接把 preset/fano-thinking-chain.json 里的正则按顺序套到模拟输出上，
 * 验证"1 块 → Izumi 形态；≥2 块 → Kemini 形态"真的成立。
 */
import fs from 'node:fs';
import path from 'node:path';
import { need } from './lib/fixtures.mjs';

/* 夹具守卫：这份链是从两份源预设的 regex replaceString 改写来的（那 10k+ 字 HTML
   属于各自作者），所以它和成品预设一样不进仓库。见 NOTICE.md / samples/README.md。 */
need(path.join('preset', 'fano-thinking-chain.json'), '思维链折叠链测试（30 项）',
  '先 node tools/build-regex.mjs 生成它（需要 samples/ 里的两份源预设）');

const ROOT = process.cwd();
const chain = JSON.parse(fs.readFileSync(path.join(ROOT, 'preset', 'fano-thinking-chain.json'), 'utf8'));

/** 把 "/pattern/flags" 还原成 RegExp */
function toRegExp(literal) {
  const m = /^\/([\s\S]*)\/([a-z]*)$/.exec(literal.trim());
  if (!m) throw new Error('无法解析 findRegex: ' + literal);
  return new RegExp(m[1], m[2]);
}

/** 按 ST 的方式依次套用（每条用 g 全局替换） */
function applyChain(text, steps = chain) {
  let out = text;
  for (const r of steps) {
    const re = toRegExp(r.findRegex);
    out = out.replace(re, r.replaceString);
  }
  return out;
}

let pass = 0;
const fails = [];
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fails.push(name + (detail ? '　→ ' + detail : '')); console.log('  ✗ ' + name + (detail ? '　→ ' + detail : '')); }
};

/** 统计两种形态各出现了几次 */
const countKemini = (s) => (s.match(/class="fano_thinking"/g) || []).length;
const countIzumi = (s) => (s.match(/class="konata-thinking-details"/g) || []).length;
/** 折叠后不该再有裸露的思考标签 */
const rawThink = (s) => (s.match(/<\/?think(?:ing)?>/gi) || []).length;

const block = (n, body) => `<thinking>\n第 ${n} 段思考内容\n</thinking>`;
const msg1 = `好的。\n\n${block(1)}\n\n这里是正文第一段。`;
const msg2 = `${block(1)}\n\n正文一\n\n${block(2)}\n\n正文二`;
const msg3 = `开头语。\n\n${block(1)}\n\n正文一\n\n${block(2)}\n\n正文二\n\n${block(3)}\n\n正文三\n\n收尾。`;
const msgKonata = `Master，小此来啦。\n<konatan_planning~>\n想着想着……\n</konatan_planning~>\n正文开始。`;
const msgNone = `这次没有思考，直接给正文。`;

console.log('统一折叠链测试\n');

console.log('[1] 单个思考块 → 应该用 Izumi 形态');
{
  const out = applyChain(msg1);
  ok('出现 1 个 Izumi 形态', countIzumi(out) === 1, `实际 ${countIzumi(out)}`);
  ok('没有 Kemini 形态', countKemini(out) === 0, `实际 ${countKemini(out)}`);
  ok('没有了裸露的 thinking 标签', rawThink(out) === 0, `剩 ${rawThink(out)} 个`);
  ok('正文保留', out.includes('这里是正文第一段。'));
  ok('开头语保留', out.includes('好的。'));
  ok('折叠文案是「芳乃祈福中」', out.includes('芳乃祈福中'));
}

console.log('\n[2] 两个思考块 → 应该用 Kemini 形态');
{
  const out = applyChain(msg2);
  ok('出现 2 个 Kemini 形态', countKemini(out) === 2, `实际 ${countKemini(out)}`);
  ok('没有 Izumi 形态', countIzumi(out) === 0, `实际 ${countIzumi(out)}`);
  ok('没有裸露 thinking 标签', rawThink(out) === 0, `剩 ${rawThink(out)} 个`);
  ok('两段正文都在', out.includes('正文一') && out.includes('正文二'));
}

console.log('\n[3] 三个思考块（ICOT 三段）→ 应该用 Kemini 形态，每块一个');
{
  const out = applyChain(msg3);
  ok('出现 3 个 Kemini 形态', countKemini(out) === 3, `实际 ${countKemini(out)}`);
  ok('没有 Izumi 形态', countIzumi(out) === 0, `实际 ${countIzumi(out)}`);
  ok('没有裸露 thinking 标签', rawThink(out) === 0, `剩 ${rawThink(out)} 个`);
  ok('三段正文都在', ['正文一', '正文二', '正文三'].every((t) => out.includes(t)));
  ok('开头与收尾都在', out.includes('开头语。') && out.includes('收尾。'));
}

console.log('\n[4] Izumi 标签（konatan_planning~）→ Izumi 形态');
{
  const out = applyChain(msgKonata);
  ok('出现 1 个 Izumi 形态', countIzumi(out) === 1, `实际 ${countIzumi(out)}`);
  ok('没有 Kemini 形态', countKemini(out) === 0, `实际 ${countKemini(out)}`);
  ok('前置文本保留', out.includes('Master，小此来啦。'));
  ok('正文保留', out.includes('正文开始。'));
}

console.log('\n[5] 没有思考块 → 原样不动');
{
  const out = applyChain(msgNone);
  ok('输出与输入一致', out === msgNone);
}

console.log('\n[6] 混杂（应当由面板拦住；这里只验证不会崩）');
{
  const mixed = `${block(1)}\n\n正文\n\n${block(2)}\n\n<konatan_planning~>\n混进来的\n</konatan_planning~>\n结束`;
  let out = '';
  let threw = false;
  try { out = applyChain(mixed); } catch (e) { threw = true; }
  ok('不抛异常', !threw);
  ok('至少有一种形态渲染出来', countKemini(out) + countIzumi(out) >= 1,
    `Kemini ${countKemini(out)} / Izumi ${countIzumi(out)}`);
}

console.log('\n[7] 链的元数据');
{
  ok('链里有 4 条', chain.length === 4, `${chain.length} 条`);
  ok('前两条是 Kemini 形态', chain.slice(0, 2).every((r) => r.replaceString.includes('fano_thinking')));
  ok('后两条是 Izumi 形态', chain.slice(2).every((r) => r.replaceString.includes('konata-thinking-details')));
  ok('全部是仅显示（markdownOnly 且非 promptOnly）', chain.every((r) => r.markdownOnly === true && r.promptOnly === false));
  ok('全部 placement=[2]', chain.every((r) => JSON.stringify(r.placement) === '[2]'));
  ok('全部启用', chain.every((r) => r.disabled === false));
  ok('都不含 CDN 外链', chain.every((r) => !/fonts\.googleapis|fonts\.gstatic/.test(r.replaceString)));
  ok('标题都带「芳乃思维链」', chain.every((r) => r.scriptName.includes('芳乃思维链')));
}

console.log('\n────────────────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fails.length} 项`);
if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); process.exitCode = 1; }
