#!/usr/bin/env node
/**
 * 生成器 GUI 的浏览器回归测试
 *
 *   node tools/check-gui-browser.mjs            # 桌面视口 1440×900
 *   node tools/check-gui-browser.mjs --mobile   # 手机视口 390×844
 *
 * 为什么需要这一层：GUI 是**双击 index.html 就能用**的零依赖页面（file://），
 * node 版的 tools/test-gui.mjs 只测纯函数库，测不到"页面到底有没有渲染出来"、
 * "file:// 下 <script src> 有没有被拦"、"某个视图是不是白屏"。这些只有真浏览器知道。
 *
 * 两层证据：
 *   1. 页面自检（?selftest=1）把断言结果写进 #verdict，这里取回来判定；
 *   2. **独立取证**：用 ?view=... 让页面停在指定那一屏，然后直接数 dump 里的 DOM
 *      （导航项数、卡片数、输入框数……）。这一层不依赖页面自己的说法，
 *      避免"自检说自己没问题"的循环论证。
 *
 * Chrome 需要派生进程，在 DSH 沙箱下会被拒（OpenProcess 拒绝访问）→ 需要 danger-full-access。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { skip } from './lib/fixtures.mjs';

const ROOT = process.cwd();
const P = (...a) => path.join(ROOT, ...a);

const MOBILE = process.argv.includes('--mobile');
const VIEWPORT = MOBILE ? '390,844' : '1440,900';

const CHROMES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const chrome = CHROMES.find((c) => fs.existsSync(c));
if (!chrome) { console.error('没找到 Chrome / Edge'); process.exit(2); }

/* 默认查开发环境那份；发布包用 DSH_GUI_PAGE=dist/.../index.html 直接查同一套断言 */
const page = process.env.DSH_GUI_PAGE
  ? path.resolve(process.env.DSH_GUI_PAGE)
  : P('tools', 'gui', 'index.html');
const pageDir = path.dirname(page);
if (!fs.existsSync(page)) { console.error(`找不到 ${page}`); process.exit(2); }

/* 夹具守卫：这十屏断言是拿"一份真实预设当演示数据"跑出来的——条目数、卡片数、
   底栏统计都对着它写。本仓库不随附预设正文（见 NOTICE.md），演示数据自然也不在。
   缺了就直接 SKIP：否则页面会把"没有演示数据"记成自检失败，看着像回归挂了。 */
const demoTags = /<script src="(demo\/[^"]*demo\.js)"><\/script>/.exec(fs.readFileSync(page, 'utf8'));
if (!demoTags || !fs.existsSync(path.join(pageDir, demoTags[1]))) {
  skip('界面回归（十屏 DOM 取证）', [demoTags ? demoTags[1] : 'tools/gui/demo/*.js'],
    '演示数据由 node tools/build-gui-demo.mjs 生成，它需要 samples/ 里的夹具');
}
const baseUrl = 'file:///' + page.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace('%3A', ':');

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** 跑一次 headless Chrome，把某一屏的 DOM dump 回来 */
function dump(view) {
  const profile = path.join(os.tmpdir(), `gui-selftest-${MOBILE ? 'm' : 'd'}-${view}-${Date.now()}`);
  const args = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + profile,
    '--window-size=' + VIEWPORT,
    '--virtual-time-budget=15000',
    '--dump-dom', `${baseUrl}?selftest=1&view=${view}`,
  ];
  if (MOBILE) {
    args.splice(4, 0, '--user-agent=Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
  }
  const res = spawnSync(chrome, args, { encoding: 'buffer', maxBuffer: 96 * 1024 * 1024 });
  if (res.error) { console.error('启动 Chrome 失败:', res.error.message); process.exit(1); }
  const dom = (res.stdout || Buffer.alloc(0)).toString('utf8');
  if (!dom) { console.error('Chrome 没输出（多半是沙箱拒了：OpenProcess 拒绝访问）。用更宽权限重跑。'); process.exit(1); }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 无所谓 */ }
  return dom;
}

console.log(`【生成器 GUI · ${MOBILE ? '手机视口 ' : '桌面视口 '}${VIEWPORT}】`);

const problems = [];
const count = (s, re) => (s.match(re) || []).length;

/* 每一屏的独立取证规则：view -> { label, check(dom) 返回 [描述, 是否通过] } */
const PASSES = [
  {
    view: 'build',
    label: '面板搭建（画布）',
    check(dom) {
      const mods = count(dom, /class="fp-mod"/g);
      const secs = count(dom, /class="fp-seclabel"/g);
      const addItem = count(dom, /＋功能项/g);
      const addOpt = count(dom, /＋功能选项/g);
      const panelReal = count(dom, /class="fp-win"/g) >= 1 && count(dom, /class="fp-bglayer"/g) >= 1;
      const props = count(dom, /class="props"/g);
      const noFakeHint = (() => {
        /* 只在 #verdict 之前找那句话：自检的结论文字里也会提到它，整页 grep 会自己撞自己 */
        const cut = dom.indexOf('id="verdict"');
        const pageBody = dom.slice(0, cut >= 0 ? cut : dom.length);
        return !/假装是酒馆页面背景/.test(pageBody);
      })();
      return [
        /* 判据是**关系**不是规模：画布画出了至少一个分节/功能区，每个功能区的两个
           「＋」按钮成对出现，属性栏恰好一个。
           （原来写的是"分节 ≥5 / 功能区 ≥20 / ＋按钮 ≥20"——那是在量演示纸有多大：
             纸一换（换成我们自己的标准纸）就红，红的不是画布坏了。） */
        [`${secs} 个分节 · ${mods} 个功能区 · ${addItem} 个「＋功能项」· ${addOpt} 个「＋功能选项」· 属性栏 ${props ? '在' : '缺'}`,
          secs >= 1 && mods >= 1 && addItem >= 1 && addItem === addOpt && props === 1],
        [`画布用的是面板真实结构（.fp-win / .fp-bglayer 都在）· 没有"假装背景"那类文字混进来`,
          panelReal && noFakeHint],
        /* 分节可点 = 每个分节标题都能点开；面板质检卡片**只在有发现时才画**，
           所以这里不要求它出现（没有发现 = 好事，不是缺件）。 */
        [`分节可点（${count(dom, /title="点一下改这个分节"/g)} 个 / 共 ${secs} 个）· 面板质检 ${/面板质检/.test(dom) ? '有发现并画出来了' : '没有发现（卡片不画）'} · ＋新建分区 ${/＋新建分区/.test(dom) ? '在' : '缺'}`,
          count(dom, /title="点一下改这个分节"/g) === secs && secs >= 1 && /＋新建分区/.test(dom)],
      ];
    },
  },
  {
    view: 'start',
    label: '引导（从这里开始）',
    check(dom) {
      const steps = count(dom, /第 \d 步/g);
      const routes = count(dom, /① 我有一份预设|② 我要从零搭一份|③ 我只想给预设配个好看的面板/g);
      const hasExportHint = /导出预设 JSON/.test(dom);
      const saysWhatItWontDo = /替你写提示词正文/.test(dom);
      /* 说明书与给 AI 的接口手册：链接必须在，而且指向**相对本页**的真实路径 */
      const hasManual = /href="\.\.\/\.\.\/说明书\.md"/.test(dom);
      const hasApi = /href="API\.md"/.test(dom);
      const namesSelftest = /tools\/selftest\.mjs/.test(dom);
      return [
        [`${steps} 个步骤条目 · ${routes} 条路线按钮 · 提到导出按钮 ${hasExportHint ? '是' : '否'} · 说明了不代写正文 ${saysWhatItWontDo ? '是' : '否'}`,
          steps >= 4 && routes === 3 && hasExportHint && saysWhatItWontDo],
        [`说明书链接 ${hasManual ? '在' : '缺'} · API 手册链接 ${hasApi ? '在' : '缺'} · 提到自检命令 ${namesSelftest ? '是' : '否'}`,
          hasManual && hasApi && namesSelftest],
      ];
    },
  },
  {
    view: 'checkup',
    label: 'M2 体检',
    check(dom) {
      const pills = count(dom, /data-level="(err|warn|info)"/g);
      const whys = count(dom, /class="checkline"/g);
      const evs = count(dom, /class="checkev"/g);
      return [
        [`${pills} 个档位卡片 · ${whys} 行"为什么/怎么改" · ${evs} 块依据`, pills >= 1 && whys >= 2],
      ];
    },
  },
  {
    view: 'editor',
    label: 'M3 框架编辑',
    check(dom) {
      const names = count(dom, /class="nameinput"/g);
      const moves = count(dom, /class="btn tiny"/g);
      const rows = count(dom, /<tr>/g);
      const addForm = count(dom, /class="addform"/g);
      return [
        /* 同样改成关系：一行一个条目、每行一个可改名字的输入框、每行有移动/删除两个按钮
           （首行不能上移、末行不能下移，所以是 (行数-1)×2）。
           原来写的是"输入框 ≥100、按钮 ≥100"——那是在量纸。 */
        [`${rows} 行表格 · ${names} 个可改名字输入框 · ${moves} 个移动/删除按钮 · 新增表单 ${addForm ? '在' : '不在'}`,
          rows >= 2 && names === rows && moves === (rows - 1) * 2 && addForm === 1],
      ];
    },
  },
  {
    view: 'export',
    label: 'M3 导出',
    check(dom) {
      const cards = count(dom, /class="card"/g);
      const hasIntegrity = /来源完整性自证/.test(dom);
      const hasExportBtn = /导出新预设 JSON/.test(dom);
      const hasBlocked = /有必改项，先处理/.test(dom);
      /* 面板卡：面板是脚本，不跟着条目走——导出这一屏必须自己说清它在不在 */
      const hasPanelCard = /面板脚本/.test(dom);
      const panelVerdict = /已装进这份预设|还没装进预设|面板脚本被关着|这份预设没有面板/.test(dom);
      const panelGo = /去面板搭建/.test(dom);
      return [
        [`${cards} 张卡片 · 完整性自证 ${hasIntegrity ? '在' : '缺'} · 导出按钮 ${hasExportBtn ? '在' : '缺'}${hasBlocked ? '（被必改项禁用）' : ''}`,
          cards >= 3 && hasIntegrity && hasExportBtn],
        [`面板卡 ${hasPanelCard ? '在' : '缺'} · 给出明确结论 ${panelVerdict ? '是' : '否'} · 有去面板搭建的路 ${panelGo ? '是' : '否'}`,
          hasPanelCard && panelVerdict && panelGo],
      ];
    },
  },
  {
    view: 'new',
    label: 'M4 从零搭一份',
    check(dom) {
      const mods = count(dom, /class="modrow"/g);
      const hasGenBtn = /生成骨架并打开/.test(dom);
      const aboutMarkers = /位置标记为什么是空的/.test(dom);
      const noProse = !/<textarea[^>]*>[\s\S]{0,200}?(你是|请你|扮演)/.test(dom);
      return [
        [`${mods} 个模块可勾选 · 生成按钮 ${hasGenBtn ? '在' : '缺'} · 位置标记说明 ${aboutMarkers ? '在' : '缺'}`,
          mods >= 5 && hasGenBtn && aboutMarkers],
        [`生成页里没有任何现成的提示词正文`, noProse],
      ];
    },
  },
  {
    view: 'regexedit',
    label: 'M5 正则编辑',
    check(dom) {
      const cards = count(dom, /class="card"/g);
      const findBoxes = count(dom, /class="bigtext small mono"/g);
      const previews = count(dom, /<pre class="preview"/g);
      const rendered = count(dom, /class="renderbox"/g);
      const details = count(dom, /<details/g);
      const pills = count(dom, /匹配 \d+ 处/g);
      const hasSample = /样例文本（自己贴一段来试）/.test(dom);
      return [
        [`${cards} 张卡片 · ${findBoxes} 个 find/替换输入框 · ${previews} 处纯文本输出 · ${rendered} 处渲染预览（其中折叠条 ${details} 个）· ${pills} 条有匹配数`,
          /* 这里守的是**不变量**，不是真实预设的具体个数：
             卡片够多、find/替换框成对出现、有匹配数、样例框在、**两种输出方式都在场**
             （纯文本输出 + 渲染预览）。真实预设是 32 张卡 / 2+2 处输出；合成夹具的折叠链
             只有 4 条、1+1 处——按"各 ≥2"就会把夹具判失败，而界面本身完全正常。
             第一版写死 ≥2/≥2，就是在这儿栽的。 */
          cards >= 4 && findBoxes >= 4 && pills >= 1 && hasSample && (previews + rendered) >= 2],
      ];
    },
  },
  {
    view: 'scriptedit',
    label: 'M5 脚本编辑',
    check(dom) {
      const editors = count(dom, /class="bigtext mono"/g);
      const syntaxOk = /能编译通过/.test(dom);
      const hasDiffLine = /与原文的差别/.test(dom);
      const hasGuard = /工具不会去"理解"/.test(dom);
      return [
        [`${editors} 个代码框 · 语法校验 ${syntaxOk ? '通过' : '缺'} · diff ${hasDiffLine ? '在' : '缺'} · 边界说明 ${hasGuard ? '在' : '缺'}`,
          editors >= 1 && syntaxOk && hasDiffLine && hasGuard],
      ];
    },
  },
  {
    view: 'appearance',
    label: 'M5 面板外观',
    check(dom) {
      const pickers = count(dom, /type="color"/g);
      const cells = count(dom, /class="colorcell"/g);
      const alphaCells = count(dom, /class="alpha-cell"/g);
      const sliders = count(dom, /type="range"/g);
      const sticky = count(dom, /class="previewrail"/g);
      const previews = count(dom, /class="fp-preview"/g);
      const previewBall = count(dom, /class="fp-launch"/g);
      const previewWin = count(dom, /class="fp-win"/g);
      const previewCss = count(dom, /\.fp-preview \.fp-win\{position:absolute/g);
      const hasWallpaper = /壁纸/.test(dom);
      const hasApply = /应用到面板脚本|记下配置/.test(dom);
      /* 预设**自带**面板时这里显示的是「应用到面板脚本」，没有面板时才是「装进这份预设」——
         两边都算"有把改动落到预设里的按钮"。 */
      const hasAttach = /装进这份预设/.test(dom) || /应用到面板脚本/.test(dom);
      return [
        [`${cells} 个普通色 + ${alphaCells} 个带透明度的色（= 20 token × 昼夜）· ${pickers} 个取色器 · ${sliders} 个透明度滑杆`,
          cells + alphaCells >= 40 && pickers >= 40 && sliders >= 4],
        [`右侧预览栏 ${sticky ? '在（粘性，跟着滚）' : '缺'} · 预览 ${previews ? '在' : '缺'}`,
          sticky === 1 && previews === 1],
        [`预览里真渲染了悬浮球与窗口（球 ${previewBall} / 窗 ${previewWin}）· 用真样式 ${previewCss ? '是' : '否'}`,
          previewBall === 1 && previewWin === 1 && previewCss >= 1],
        [`壁纸设置区 ${hasWallpaper ? '在' : '缺'} · 应用按钮 ${hasApply ? '在' : '缺'} · 装进预设按钮 ${hasAttach ? '在' : '缺'}`,
          hasWallpaper && hasApply && hasAttach],
        [`输入框底色这一项 ${/输入框底色/.test(dom) ? '在' : '缺'} · 预览样式里真的定义了它 ${/--fp-input-bg:/.test(dom) ? '是' : '否'}`,
          /输入框底色/.test(dom) && /--fp-input-bg:/.test(dom)],
      ];
    },
  },
  {
    view: 'groups',
    label: 'M6 面板分组',
    check(dom) {
      const hasInfer = /按这份预设自动推断/.test(dom);
      const hasAll = /加入所有条目（兜底草稿）/.test(dom);
      const hasApply = /应用到面板脚本|装进这份预设/.test(dom);
      const explainsNames = /面板是按\*\*条目名\*\*匹配/.test(dom);
      /* 这一屏现在**一定会把面板当前的分组列出来**：自带那套（只读列出）或自动推断的草稿。
         早先这条规则把"空状态那句话"当成正常状态——而那句话正是"读不出来面板分组"的来源
         （用户导入 v2.8.4 之后的投诉：面板本来就有 25 个模块，却一个都不列）。
         所以改成按**实际列出来的成员数**判，两种正常状态都认。 */
      const chips = count(dom, /class="chip"/g);
      const modeText = /面板自带的分组（\d+ 个模块，只读）/.test(dom) ? '用面板自带的（只读列出）'
        : /草稿：\d+ 个模块/.test(dom) ? '自动推断了一版'
          : '什么都没画';
      return [
        [`推断按钮 ${hasInfer ? '在' : '缺'} · 兜底草稿 ${hasAll ? '在' : '缺'} · 应用按钮 ${hasApply ? '在' : '缺'}`,
          hasInfer && hasAll && hasApply],
        [`说了"按条目名匹配" ${explainsNames ? '是' : '否'} · 分组已就绪（${modeText}，列出 ${chips} 个成员胶囊）`,
          explainsNames && chips >= 20],
      ];
    },
  },
];

for (const pass of PASSES) {
  const dom = dump(pass.view);
  const title = /<title>([^<]*)<\/title>/.exec(dom)?.[1] ?? '';
  const navItems = count(dom, /class="nav-item"/g);
  const footStats = decode(/<span id="foot-stats"[^>]*>([^<]*)<\/span>/.exec(dom)?.[1] ?? '');

  if (pass.view === 'checkup') {
    /* 自检结论只在第一屏打印一次（每屏都跑一遍自检，结果一样） */
    const i = dom.indexOf('id="verdict"');
    if (i < 0) {
      console.error('dump 里没有 #verdict —— 页面可能没跑完，或 <script> 被 file:// 拦了');
      process.exit(1);
    }
    const start = dom.indexOf('>', i) + 1;
    const text = decode(dom.slice(start, dom.indexOf('</pre>', start)));
    console.log(text);
    if (/\bFAIL\b/.test(text)) problems.push('页面自检有 FAIL 项');
  }

  console.log(`【${pass.label} · view=${pass.view}】`);
  console.log('  页面标题 : ' + title);
  console.log('  左侧导航项 : ' + navItems);
  console.log('  底栏统计 : ' + footStats);
  for (const [desc, ok] of pass.check(dom)) {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${desc}`);
    if (!ok) problems.push(`${pass.label}：${desc}`);
  }
  if (!/^GUI-SELFTEST-OK/.test(title)) problems.push(`${pass.label}：页面标题不是 GUI-SELFTEST-OK（实际：${title}）`);
  if (navItems < 23) problems.push(`${pass.label}：左侧导航项只有 ${navItems} 个（引导 2 + M0 11 + M1 2 + M2 1 + M3 2 + M4 1 + M5 3 + M6 1 = 23）`);
  if (!/条目/.test(footStats)) problems.push(`${pass.label}：底栏统计没更新: ${footStats}`);
  if (!/体检/.test(footStats)) problems.push(`${pass.label}：底栏没有体检结论: ${footStats}`);
}

/* 演示数据文件：开发环境是 izumi-demo.js，发布包里是 fano-demo.js——
   从**页面自己引的那一行**读，别写死文件名。 */
const demoTag = /<script src="(demo\/[^"]*demo\.js)"><\/script>/.exec(fs.readFileSync(page, 'utf8'));
const demoFile = demoTag ? path.join(pageDir, demoTag[1]) : '';
const injected = demoFile && fs.existsSync(demoFile) && /__DEMO_PRESETS__/.test(fs.readFileSync(demoFile, 'utf8'))
  ? `${demoTag[1]} 已生成` : `演示文件读不到（${demoFile || '页面里没找到 demo/*-demo.js 的 <script>'}）`;
console.log('  演示数据 : ' + injected);
if (!/已生成/.test(injected)) problems.push('演示数据文件里没有 __DEMO_PRESETS__');

if (problems.length) {
  console.log('\n外部取证失败：');
  for (const p of problems) console.log('  FAIL  ' + p);
} else {
  console.log('\n外部取证：十屏的标题 / 导航 / 底栏 / DOM 计数 都对得上。');
}
process.exitCode = problems.length ? 1 : 0;
