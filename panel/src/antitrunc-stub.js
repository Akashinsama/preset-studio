/* ── 脚本层防截断：**未注入**时的空壳（本工程自己写的，不含任何第三方代码）──
 *
 * 为什么有这个文件：真正的脚本层防截断（panel/src/antitrunc.js）**是从别人的预设里
 * 移植过来的**（原作 Kemini Dramatron v3.1 的 scripts[0]，作者 Kemini），见 NOTICE.md。
 * 按作者定的口径：那段代码**不作为默认**随面板装出去——要它得**显式注入**
 * （node tools/build-panel.mjs --with-antitrunc，或在编辑器「面板外观」里勾选）。
 *
 * 默认那一版面板注入的是**这个文件**：它给出与真模块**同名同形的 API**，
 * 但什么都不做、也不碰 window.fetch。这样：
 *   · 面板本体、顶部「🛡 防截断」按钮、控制台 __FANO_ANTITRUNC__ 都不用改一行；
 *   · 库里默认那份产物里**一个字节的第三方代码都没有**；
 *   · 而且**能说实话**：available=false，点按钮时面板会直说"这版没装"，
 *     而不是报个"已开启"却什么都没发生。
 *
 * 形状必须与 panel/src/antitrunc.js 的返回一致（那边是 api 对象）：
 *   interceptor / key / isEnabled / installed / lastRun / anchor /
 *   setEnabled / enable / disable / read / write / hostWindow
 * 外加这里多一个 available，用来区分"关着"和"没装"。
 */

function createAntiTruncation(options) {
  'use strict';

  const opts = options || {};
  const LS_KEY = opts.key || 'fano-antitrunc-v1';
  const ANCHOR = '<format>';

  const api = {
    /* 空壳标记：构建脚本与编辑器据此判断"这一版有没有真模块"，
       所以真模块那边故意不带这个字符串。 */
    __FANO_ANTITRUNC_STUB__: true,
    available: false,
    interceptor: null,
    key: LS_KEY,
    isEnabled: () => false,
    installed: () => false,
    lastRun: () => null,
    anchor: ANCHOR,
    /* 开关动不了任何东西：如实返回 available=false，让调用方有话可说。 */
    setEnabled: () => ({ enabled: false, installed: false, available: false }),
    enable: () => api.setEnabled(true),
    disable: () => api.setEnabled(false),
    /* 不读也不写存档：万一以后换成真模块，别留下一个"偷偷开着"的旧值。 */
    read: () => false,
    write: () => false,
    hostWindow: () => null,
  };

  /* 与真模块一样把控制台 API 挂出去：本脚本所在的窗口 + 全局。
     （真模块是挂到"宿主窗口"上的；空壳够不着宿主，就挂在 window 上——
       反正有 available=false 兜着，谁点开看都知道这一版没装。） */
  try { globalThis.__FANO_ANTITRUNC__ = api; } catch { /* 忽略 */ }
  try {
    if (typeof window !== 'undefined' && window && window !== globalThis) window.__FANO_ANTITRUNC__ = api;
  } catch { /* 跨域等：忽略 */ }

  return api;
}
