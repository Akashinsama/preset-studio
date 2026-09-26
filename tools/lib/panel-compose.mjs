/**
 * 面板脚本拼装（panel-compose）
 *
 * 把 spec/groups.json 与**可选的**防截断模块拼进 panel/src/panel-core.js，
 * 得到可以贴进酒馆助手的那份脚本。**纯函数**：只读文件、返回字符串，不写盘。
 *
 *   import { composePanel } from './lib/panel-compose.mjs';
 *   const { src, withAntitrunc } = composePanel({ withAntitrunc: false });
 *
 * 为什么把这一段单独抽出来（原来它写在 tools/build-panel.mjs 里）：
 *   ① 防截断成了**可选注入**，于是"要注入哪一版"要在三个地方用到：
 *      tools/build-panel.mjs（出库内产物）、tools/build-gui-demo.mjs（出编辑器用的
 *      两版快照）、以及测试（要能当场拼一版带真模块的面板来验它的行为）；
 *   ② 拼装是字符串手术，拼坏了必须**当场**发现——所以这里拼完就过一遍 vm 语法检查。
 *
 * ── 防截断的两版（这是本文件存在的理由）──────────────────────────────
 *   withAntitrunc = false（默认）→ 注入 panel/src/antitrunc-stub.js：本工程自己写的空壳，
 *                                  API 同名同形但什么都不做，**不含第三方代码**。
 *   withAntitrunc = true         → 注入 panel/src/antitrunc.js：从 Kemini Dramatron v3.1
 *                                  移植来的真模块（出处见 NOTICE.md，可随时删除）。
 * 作者的判据：打印机不往纸上加内容，**别人的代码也不默认装出去**；要它得显式注入。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

/** 注入点两侧的哨兵：编辑器据此在"两版面板源码"之间整段换防截断模块 */
export const SLOT_BEGIN = '/* __FANO_ANTITRUNC_SLOT_BEGIN__ */';
export const SLOT_END = '/* __FANO_ANTITRUNC_SLOT_END__ */';
/** 空壳模块里带的标记（真模块故意不带），用来判断一份面板源码装的是哪一版 */
export const STUB_MARK = '__FANO_ANTITRUNC_STUB__';

/** panel-core.js 里那个占位行；必须原样存在，否则拼装无处落笔 */
const AT_HOLE = '  /* __FANO_ANTITRUNC_MODULE__ */';

export const REAL_MODULE = path.join('panel', 'src', 'antitrunc.js');
export const STUB_MODULE = path.join('panel', 'src', 'antitrunc-stub.js');

/** 面板里装的是哪一版防截断：'real' | 'stub' | 'none'（老面板：标记之间什么都没有） */
export function antitruncVariant(src) {
  const s = String(src ?? '');
  if (s.includes(STUB_MARK)) return 'stub';
  if (/function\s+createAntiTruncation\s*\(/.test(s)) return 'real';
  return 'none';
}

/**
 * 拼一份面板脚本。
 *
 * @param {object}  o
 * @param {string}  o.root            仓库根（默认 process.cwd()）
 * @param {boolean} o.withAntitrunc   true = 注入真模块；默认 false = 注入空壳
 * @param {object}  [o.groups]        已读好的 spec/groups.json（省一次读盘）
 * @returns {{src:string, withAntitrunc:boolean, moduleFile:string, moduleBytes:number,
 *            banner:string, groupsCount:number, tagsCount:number}}
 */
export function composePanel({ root = process.cwd(), withAntitrunc = false, groups } = {}) {
  const P = (...a) => path.join(root, ...a);
  const spec = groups ?? JSON.parse(fs.readFileSync(P('spec', 'groups.json'), 'utf8'));
  let core = fs.readFileSync(P('panel', 'src', 'panel-core.js'), 'utf8');

  const moduleFile = withAntitrunc ? REAL_MODULE : STUB_MODULE;
  const mod = fs.readFileSync(P(moduleFile), 'utf8');

  for (const [needle, what] of [
    ["'__FANO_GROUPS__'", '__FANO_GROUPS__'],
    ["'__FANO_DISPLAY__'", '__FANO_DISPLAY__'],
    ["'__FANO_THINKING_TAGS__'", '__FANO_THINKING_TAGS__'],
  ]) {
    if (!core.includes(needle)) throw new Error(`panel-core.js 里找不到 ${what} 占位符`);
  }
  if (!core.includes(AT_HOLE)) throw new Error('panel-core.js 里找不到防截断注入点（__FANO_ANTITRUNC_MODULE__）');
  if (!/function\s+createAntiTruncation\s*\(/.test(mod)) throw new Error(`${moduleFile} 里找不到 createAntiTruncation()`);
  if (/^\s*(import|export)\s/m.test(mod)) throw new Error(`${moduleFile} 里有 import/export，不能整段注入 IIFE`);
  if (!withAntitrunc && !mod.includes(STUB_MARK)) throw new Error(`${STUB_MODULE} 里没有空壳标记（${STUB_MARK}）`);

  const what = withAntitrunc
    ? 'panel/src/antitrunc.js（**从 Kemini Dramatron v3.1 移植**，出处见 NOTICE.md；要拿掉就删这个文件并改回空壳）'
    : 'panel/src/antitrunc-stub.js（本工程自己写的空壳：防截断**没注入**，什么都不做）';

  const block = `  /* ── 脚本层防截断（可选注入）──────────────────────────────────────
     这一版装的是：${what}
     换一版：node tools/build-panel.mjs --with-antitrunc（或在编辑器「面板外观」里勾选）
     ═══════════════════════════════════════════════════════════════ */
  ${SLOT_BEGIN}
${mod.trimEnd()}

  /** 防截断实例。开关读 LS.antitrunc（= fano-antitrunc-v1，顶部 🛡 按钮同一个键）；
      出厂默认值来自 CONFIG.antitrunc.enabled。创建时即按开关决定装不装拦截器。 */
  const ANTITRUNC = createAntiTruncation({
    key: LS.antitrunc,
    defaultOn: CFG.antitrunc.enabled,
    /* 渠道明显不支持时的提醒出口（只提醒，绝不自动关开关）。 */
    onNotice: (msg) => notifyUser(msg, 'warn'),
  });
  ${SLOT_END}`;

  core = core.replace(AT_HOLE, block);

  const indent = (json) => json.split('\n').map((l, i) => (i === 0 ? l : '  ' + l)).join('\n');
  const groupsCount = (spec.groups || []).length;
  const tagsCount = (spec.thinkingTags || []).length;

  const banner =
    `/**\n * 芳乃 · 预设面板　（自动生成，请勿直接改这个文件）\n` +
    ` * 源：panel/src/panel-core.js + ${moduleFile} + spec/groups.json\n` +
    ` * 构建：node tools/build-panel.mjs${withAntitrunc ? ' --with-antitrunc' : ''}\n` +
    ` * 子集：${groupsCount} 个　显示名映射：${Object.keys(spec.display || {}).length} 条` +
    `　思维链标签互斥组：${tagsCount} 个\n` +
    ` * 防截断：${withAntitrunc ? '已注入（借自 Kemini，见 NOTICE.md）' : '未注入（默认；要就显式注入）'}\n` +
    ` */\n`;

  const src = banner
    + core
      .replace("'__FANO_GROUPS__'", indent(JSON.stringify(spec.groups || [], null, 2)))
      .replace("'__FANO_DISPLAY__'", indent(JSON.stringify(spec.display || {}, null, 2)))
      .replace("'__FANO_THINKING_TAGS__'", indent(JSON.stringify(spec.thinkingTags || [], null, 2)));

  /* 拼完先过一遍语法：注入是字符串拼接，拼坏了要在这里当场知道，
     而不是等用户把它贴进酒馆、或者等测试莫名其妙地报错。 */
  try {
    new vm.Script(src, { filename: 'fano-panel.js' });
  } catch (e) {
    throw new Error('拼出来的面板脚本有语法错误（多半是注入的那一段没接好）：' + ((e && e.message) || e));
  }

  return {
    src,
    withAntitrunc,
    moduleFile,
    moduleBytes: Buffer.byteLength(mod, 'utf8'),
    banner,
    groupsCount,
    tagsCount,
  };
}
