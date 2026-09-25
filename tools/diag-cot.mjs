#!/usr/bin/env node
/** 读 ICOT / COT 全文，数清它们各要求几段思考 */
import fs from 'node:fs';

const files = fs.readdirSync('preset').filter((f) => f.startsWith('芳乃预设-') && f.endsWith('.json')).sort();
const p = JSON.parse(fs.readFileSync('preset/' + files[files.length - 1], 'utf8'));

for (const n of ['📽️ICOT（三段）', '📽️COT（格式友好型）']) {
  const e = p.prompts.find((x) => x.name === n);
  console.log('\n########## ' + n + ' ##########');
  console.log(e.content);
  const c = e.content;
  console.log('--- 统计：<thinking> ' + (c.match(/<thinking>/g) || []).length
    + '　</thinking> ' + (c.match(/<\/thinking>/g) || []).length
    + '　<Interleaving> ' + (c.match(/<Interleaving>/g) || []).length
    + '　{{正文内容}} ' + (c.match(/\{\{正文内容\}\}/g) || []).length
    + '　{{思考内容}} ' + (c.match(/\{\{思考内容\}\}/g) || []).length);
}
