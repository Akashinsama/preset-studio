/**
 * 面板外观配置 —— 读写 `panel/fano-panel.js` 里那段 `CONFIG`。
 *
 * 为什么要有这个文件：
 *   · 面板自己读 CONFIG 决定外观（颜色 / 悬浮球 / 窗口尺寸 / 圆角 / 缩放 / 不透明度 / 壁纸）；
 *   · 预设生成器的「面板外观」要**只改这一段**，别处代码一行都不能碰；
 *   · 两边的夹取与默认值必须一致 —— 所以这里复制了一份夹取逻辑，并用测试锁死：
 *     test-panelconfig.mjs 会真加载面板、拿它 `__FANO_PANEL__.config().effective`
 *     跟本文件的 clampConfig() 逐字段对比，有一处漂移就报错。
 *
 * 零依赖、纯函数；浏览器与 Node 都能用（挂在 globalThis 上，file:// 下不能用 ES module）。
 */
(function (root) {
  'use strict';

  const BEGIN = 'FANO_PANEL_CONFIG_BEGIN';
  const END = 'FANO_PANEL_CONFIG_END';

  /** 颜色 token 的中文说明（界面上每个颜色都要有"这是干嘛的"）。
      条数不用写死在这儿：跟 `extractThemes()` 的键一一对应，测试会逐键核对。 */
  const TOKEN_SPEC = [
    /* 前两条最容易搞混，所以按"面板上看到的"来标：
       窗口的**背景**其实是 --fp-overlay（底色层），--fp-bg 是内容区的底。
       早先标反了，于是"改面板底色没反应"。 */
    { key: '--fp-overlay', label: '★ 窗口底色（面板的背景就是它）', type: 'alpha' },
    { key: '--fp-bg', label: '内容底色（列表 / 选项框的底）', type: 'color' },
    { key: '--fp-bg-raised', label: '卡片 / 按钮底色', type: 'color' },
    { key: '--fp-bg-inset', label: '内嵌块底色（选项框）', type: 'color' },
    { key: '--fp-border', label: '分隔线', type: 'color' },
    { key: '--fp-border-strong', label: '明显的边（窗口边框）', type: 'color' },
    { key: '--fp-input-bg', label: '★ 输入框底色（可编辑正文、选项框）', type: 'color' },
    { key: '--fp-input-border', label: '输入框的边', type: 'color' },
    { key: '--fp-text', label: '正文文字', type: 'color' },
    { key: '--fp-text-dim', label: '次要文字（说明）', type: 'color' },
    { key: '--fp-text-faint', label: '最淡的字（脚注）', type: 'color' },
    { key: '--fp-accent', label: '主强调色（开关打开、选中）', type: 'color' },
    { key: '--fp-accent-hi', label: '强调色高光（悬浮球渐变）', type: 'color' },
    { key: '--fp-accent-soft', label: '强调色的淡底（选中行）', type: 'color' },
    { key: '--fp-gold', label: '金色点缀（悬浮球的金边）', type: 'color' },
    { key: '--fp-indigo', label: '标题色', type: 'color' },
    { key: '--fp-ok', label: '成功（标题下那行状态小字）', type: 'color' },
    { key: '--fp-danger', label: '危险（出错时的提示框）', type: 'color' },
    { key: '--fp-warn', label: '警示', type: 'color' },
    { key: '--fp-shadow', label: '阴影（带透明度）', type: 'alpha' },
  ];
  const TOKEN_KEYS = TOKEN_SPEC.map((t) => t.key);

  /* 出厂配置的形状。
     **title 必须列在这儿**：`patchConfig(src, patch)` 走的是 `mergeConfig(DEFAULT_CONFIG, patch)`，
     只按这份形状 + patch 自己的键去拼结果——不在形状里又没被 patch 提到的键会**直接消失**。
     曾经因为这儿没有 title，`patchConfig(src, { ball: { size: 60 } })` 这种"只改一个字段"的调用
     会把 CONFIG.title 整条抹掉，面板于是回退到源码里那句兜底标题（"🌸 芳乃 · 预设面板"）。
     要改配置请用 `patchConfig(src, mergeConfig(extractConfig(src), 你的改动))`，或者把整份配置展开传进来。 */
  /** 允许的球形状（与面板源码 panel-core.js 里的 BALL_SHAPES 保持一致，写错退回圆形） */
  const BALL_SHAPES = ['circle', 'square', 'rounded', 'diamond', 'triangle', 'hexagon'];

  const DEFAULT_CONFIG = {
    version: 1,
    title: '',
    tokens: { day: {}, night: {} },
    ball: { size: 46, glyph: '芳', shape: 'circle', content: { kind: 'text', image: '' } },
    window: { w: 380, h: 620, minW: 260, minH: 200, maxW: 0, maxH: 0 },
    layout: { radius: 14, scale: 1, fontScale: 1, opacity: 1, blur: 14 },
    wallpaper: { url: '', fit: 'cover', opacity: 0.35, blur: 0, dim: 0.15, dimColor: '#000000' },
    /* 脚本层防截断的出厂开关（真正的状态在 localStorage 的 fano-antitrunc-v1）。 */
    antitrunc: { enabled: true },
    /* 顶部脚本按钮：名字要与预设里静态声明的两个一致（tools/build-preset.mjs 读这里）。 */
    button: { enabled: true, panel: '⚙ 芳乃', antitrunc: '🛡 防截断' },
    /* 长按条目改正文：按住多少毫秒算长按（enabled=false 就关掉这个手势）。 */
    edit: { longPress: { enabled: true, ms: 500 } },
  };

  /* ── 从源码里把那段对象字面量抠出来 ───────────────────────────── */

  /** 从 from 处的开括号开始做配对（跳过字符串里的括号），返回闭合符的下标 */
  function matchPair(src, openIdx, openCh, closeCh) {
    let depth = 0;
    let quote = '';
    for (let i = openIdx; i < src.length; i++) {
      const c = src[i];
      if (quote) {
        if (c === '\\') { i++; continue; }
        if (c === quote) quote = '';
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2); if (i < 0) return -1; i++; continue; }
      if (c === openCh) depth++;
      else if (c === closeCh) { depth--; if (depth === 0) return i; }
    }
    return -1;
  }
  const matchBrace = (src, openIdx) => matchPair(src, openIdx, '{', '}');

  /**
   * 定位 `const <name> = <值>` 里那个值的区间。
   * 值可能是对象、数组，**也可能是 `null`** —— 分组覆盖默认就是 null（"用面板自带的分组"），
   * 早先这里只会找 `{`，于是 null 会一路匹配到后面某个不相干的大括号，读出来的东西完全不对。
   */
  function findLiteral(src, declName, from = 0) {
    const declRe = new RegExp('const\\s+' + declName + '\\s*=\\s*');
    const m = declRe.exec(src.slice(from));
    if (!m) return null;
    let start = from + m.index + m[0].length;
    while (start < src.length && /\s/.test(src[start])) start++;
    const c = src[start];
    if (c === '{') {
      const close = matchPair(src, start, '{', '}');
      return close < 0 ? null : { start, end: close + 1, text: src.slice(start, close + 1) };
    }
    if (c === '[') {
      const close = matchPair(src, start, '[', ']');
      return close < 0 ? null : { start, end: close + 1, text: src.slice(start, close + 1) };
    }
    /* 其它字面量（null / true / 数字 / 字符串）：读到行尾或分号 */
    let end = start;
    while (end < src.length && src[end] !== '\n' && src[end] !== ';') end++;
    const text = src.slice(start, end).trim();
    return { start, end, text };
  }

  /**
   * 解析对象字面量文本（带注释、尾逗号也能吃）。
   * 用 new Function 而不是 JSON.parse：面板里那段是给人看的 JS 字面量，
   * 带注释和尾逗号。这里只求值一个纯字面量，不执行任何语句。
   */
  function parseLiteral(text) {
    return new Function('"use strict";return (' + text + ');')();
  }

  /** 抽出面板里的 CONFIG 对象（读不到就返回 null） */
  function extractConfig(src) {
    try {
      const b = src.indexOf(BEGIN);
      const lit = findLiteral(src, 'CONFIG', b >= 0 ? b : 0);
      if (!lit) return null;
      return parseLiteral(lit.text);
    } catch { return null; }
  }

  /** 抽出面板内置的 THEMES（用来给界面显示"出厂色"） */
  function extractThemes(src) {
    try {
      const lit = findLiteral(src, 'THEMES', 0);
      if (!lit) return null;
      const themes = parseLiteral(lit.text);
      return themes && themes.day && themes.night ? themes : null;
    } catch { return null; }
  }

  /**
   * 抽出面板的静态样式表（`const raw = ` + 反引号 包起来的那一大段）。
   * 「面板外观」的预览用它：**预览用的是面板自己的 CSS**，不是另写一份像的——
   * 否则就成了"预览好看、真装上去不一样"。只依赖我们自己文件的形状
   * （panel-core.js 里那一行的写法），不做通用 JS 解析。
   */
  function extractCss(src) {
    const m = /const raw = `([\s\S]*?)`;\s*\n/.exec(src);
    return m ? m[1] : '';
  }

  /**
   * 抽出面板里那句**兜底标题**：`CONFIG.title` 是空的时候，真面板顶上显示的就是它。
   *
   * 为什么要读它：画布/预览上写的标题必须与真面板一致，否则就是"预览骗人"。
   * 而"留空"要分两种情况——预设自带的面板留空 = 面板作者那句兜底文案照旧；
   * 由生成器**新装进**别人预设的面板留空 = 应当用那份预设的名字（绝不能自称芳乃）。
   * 只依赖我们自己文件的写法（`CONFIG?.title || '…'`），不做通用 JS 解析。
   */
  function extractFallbackTitle(src) {
    const m = /CONFIG\??\.title\s*\|\|\s*'((?:[^'\\]|\\.)*)'/.exec(String(src ?? ''));
    return m ? m[1].replace(/\\(.)/g, '$1') : '';
  }

  /* ── 通用"标记块"读写 ─────────────────────────────────────────────
     面板里有两段给生成器用的配置：
       · CONFIG          —— 外观（颜色/尺寸/壁纸）
       · GROUPS_OVERRIDE —— 分组（哪些条目归哪个模块；null = 用面板自带的那套）
     两段都是"标记围起来的对象字面量"，所以读写逻辑通用。
     铁律：**只替换那段字面量**，块外的注释与代码一个字符都不动。 */

  function extractBlock(src, declName) {
    try {
      const lit = findLiteral(src, declName, 0);
      if (!lit) return null;
      return parseLiteral(lit.text);
    } catch { return null; }
  }

  function patchBlock(src, declName, value) {
    const lit = findLiteral(src, declName, 0);
    if (!lit) throw new Error(`这份面板脚本里找不到 ${declName}（需要对应的标记块）`);
    const body = JSON.stringify(value, null, 2).replace(/\n/g, '\n  ');
    return src.slice(0, lit.start) + body + src.slice(lit.end);
  }

  /** 把 CONFIG 写回去：只替换那段对象字面量，别的一个字符都不动 */
  function patchConfig(src, cfg) {
    return patchBlock(src, 'CONFIG', mergeConfig(DEFAULT_CONFIG, cfg));
  }

  const extractGroups = (src) => extractBlock(src, 'GROUPS_OVERRIDE');
  const patchGroups = (src, override) => patchBlock(src, 'GROUPS_OVERRIDE', override);

  /**
   * 面板**自带**的分组 / 分节 / 互斥组 / 显示名（构建期注入的那些）。
   * 「面板搭建」用它当起点：用户没推断过分组时，画布要先画出"面板本来长什么样"，
   * 第一次编辑动作再把它复制成草稿（不直接改自带的那份）。
   */
  function extractDefaults(src) {
    const groups = extractBlock(src, 'GROUPS_DEFAULT');
    const sections = extractBlock(src, 'SECTIONS_DEFAULT');
    const thinkingTags = extractBlock(src, 'THINKING_TAGS_DEFAULT');
    const display = extractBlock(src, 'DISPLAY_DEFAULT');
    return {
      groups: Array.isArray(groups) ? groups : [],
      sections: Array.isArray(sections) ? sections : [],
      thinkingTags: Array.isArray(thinkingTags) ? thinkingTags : [],
      display: display && typeof display === 'object' && !Array.isArray(display) ? display : {},
    };
  }

  /** 合并（深一层就够：tokens.day / ball / window / layout / wallpaper） */
  function mergeConfig(base, patch) {
    const out = {};
    for (const key of Object.keys(DEFAULT_CONFIG)) out[key] = base?.[key] ?? DEFAULT_CONFIG[key];
    if (patch) {
      for (const [k, v] of Object.entries(patch)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = { ...(out[k] || {}), ...v };
        else if (v !== undefined) out[k] = v;
      }
    }
    return out;
  }

  /* ── 夹取（必须与面板里的 CFG 一致；测试会锁）──────────────────── */

  const num = (v, d, lo, hi) => {
    /* null / undefined / 空串 = "没写" → 用默认值。
       不特判的话 Number(null) 是 0，会被夹到下限，等于悄悄改成了别的值。 */
    if (v === null || v === undefined || v === '') return d;
    const n = Number(v);
    if (!Number.isFinite(n)) return d;
    return Math.max(lo, Math.min(hi, n));
  };
  const FIT = ['cover', 'contain', 'repeat'];

  function clampConfig(cfg) {
    const c = mergeConfig(DEFAULT_CONFIG, cfg);
    return {
      ball: {
        size: Math.round(num(c.ball.size, 46, 28, 96)),
        glyph: String(c.ball.glyph ?? '芳').slice(0, 3) || '芳',
        shape: BALL_SHAPES.includes(c.ball.shape) ? c.ball.shape : 'circle',
        content: {
          kind: c.ball.content && c.ball.content.kind === 'image' && String(c.ball.content.image ?? '').trim() ? 'image' : 'text',
          image: String((c.ball.content && c.ball.content.image) ?? ''),
        },
      },
      window: {
        w: Math.round(num(c.window.w, 380, 200, 4000)),
        h: Math.round(num(c.window.h, 620, 160, 4000)),
        minW: Math.round(num(c.window.minW, 260, 140, 2000)),
        minH: Math.round(num(c.window.minH, 200, 100, 2000)),
        maxW: Math.round(num(c.window.maxW, 0, 0, 4000)),
        maxH: Math.round(num(c.window.maxH, 0, 0, 4000)),
      },
      layout: {
        radius: num(c.layout.radius, 14, 0, 40),
        scale: num(c.layout.scale, 1, 0.6, 2),
        fontScale: num(c.layout.fontScale, 1, 0.7, 1.8),
        opacity: num(c.layout.opacity, 1, 0.15, 1),
        blur: num(c.layout.blur, 14, 0, 40),
      },
      wallpaper: {
        url: String(c.wallpaper.url ?? ''),
        fit: FIT.includes(c.wallpaper.fit) ? c.wallpaper.fit : 'cover',
        opacity: num(c.wallpaper.opacity, 0.35, 0, 1),
        blur: num(c.wallpaper.blur, 0, 0, 40),
        dim: num(c.wallpaper.dim, 0.15, 0, 0.95),
        dimColor: String(c.wallpaper.dimColor ?? '#000000'),
      },
      /* 下面两段必须与面板 CFG 的写法**一模一样**（含字段顺序）：
         test-panelconfig.mjs 会把两边的生效值 JSON 逐字段比。
         规则：只认显式 false → 一律"关"；其余（没写 / 写错 / null）当"开"。
         少了这两段，外观页一保存就会把 antitrunc/button 这两个键写回默认值——
         用户明明关掉的东西会被悄悄打开。 */
      antitrunc: {
        enabled: c.antitrunc?.enabled !== false,
      },
      button: {
        enabled: c.button?.enabled !== false,
        panel: String(c.button?.panel ?? '⚙ 芳乃').trim() || '⚙ 芳乃',
        antitrunc: String(c.button?.antitrunc ?? '🛡 防截断').trim() || '🛡 防截断',
      },
      /* 长按改正文的手势。同样：只认显式 false。毫秒夹在 250–1500，
         写个 0 或负数会落到 250——想关掉请用 enabled:false（面板上"长按"整段都会消失）。 */
      edit: {
        longPress: {
          enabled: c.edit?.longPress?.enabled !== false,
          ms: Math.round(num(c.edit?.longPress?.ms, 500, 250, 1500)),
        },
      },
    };
  }

  const hasWallpaper = (cfg) => !!String(cfg?.wallpaper?.url ?? '');

  /** 与面板里那段 cfgVars 一一对应（测试会拿面板的 effective 比对） */
  function toCssVars(clamped) {
    const has = hasWallpaper(clamped);
    return {
      '--fp-radius': `${clamped.layout.radius}px`,
      '--fp-opacity': String(clamped.layout.opacity),
      '--fp-blur': `${clamped.layout.blur}px`,
      '--fp-ball': `${clamped.ball.size}px`,
      '--fp-wall-opacity': String(has ? clamped.wallpaper.opacity : 0),
      '--fp-wall-blur': `${clamped.wallpaper.blur}px`,
      '--fp-wall-dim': String(has ? clamped.wallpaper.dim : 0),
      '--fp-wall-dim-color': clamped.wallpaper.dimColor,
      '--fp-minw': `${clamped.window.minW}px`,
      '--fp-minh': `${clamped.window.minH}px`,
      '--fp-maxw': clamped.window.maxW ? `${clamped.window.maxW}px` : 'calc(100vw - 16px)',
      '--fp-maxh': clamped.window.maxH ? `${clamped.window.maxH}px` : 'calc(100dvh - 16px)',
    };
  }

  /** 面板里 scaleCss() 的镜像：≥3px 的字面量乘 k */
  function scaleCss(css, k) {
    if (Math.abs(k - 1) < 0.001) return css;
    return css.replace(/(\d+(?:\.\d+)?)px/g, (m, n) => {
      const v = Number(n);
      if (v < 3) return m;
      return (Math.round(v * k * 100) / 100) + 'px';
    });
  }

  /** 面板里 scaleFontCss() 的镜像：只乘 font-size */
  function scaleFontCss(css, k) {
    if (Math.abs(k - 1) < 0.001) return css;
    return css.replace(/font-size:\s*(\d+(?:\.\d+)?)px/g, (m, n) =>
      'font-size:' + (Math.round(Number(n) * k * 100) / 100) + 'px');
  }

  /* ── 校验（导出前给使用者看的）────────────────────────────────── */

  /** data: 图片大概占多少字节（base64 → 原始字节） */
  function estimateDataUrlBytes(url) {
    const m = /^data:([^;,]+)?(;base64)?,/.exec(url || '');
    if (!m) return 0;
    const payload = url.slice(m[0].length);
    if (m[2]) return Math.floor(payload.length * 3 / 4);
    return payload.length;
  }

  const isValidCssColor = (v) => /^#[0-9a-f]{3,8}$/i.test(v)
    || /^(rgb|rgba|hsl|hsla)\([^)]*\)$/i.test(v)
    || /^[a-z]{3,20}$/i.test(v);

  function validateConfig(cfg, themes) {
    const errors = [];
    const warnings = [];
    const c = clampConfig(cfg);
    const raw = mergeConfig(DEFAULT_CONFIG, cfg);
    const day = themes?.day ?? {};
    const night = themes?.night ?? {};

    /* 颜色：只查"填了但不像颜色"的 */
    for (const tier of ['day', 'night']) {
      const src = raw.tokens?.[tier] ?? {};
      for (const [k, v] of Object.entries(src)) {
        if (!TOKEN_KEYS.includes(k)) warnings.push({ kind: '未知颜色键', text: `${tier} 里的 ${k} 不是面板用的颜色变量，会被忽略。` });
        else if (!isValidCssColor(String(v))) errors.push({ kind: '颜色值不合法', text: `${tier} 的 ${k} = ${JSON.stringify(v)} 不是一个 CSS 颜色（写成 #rrggbb / rgba(...) 之类）。` });
        void day; void night;
      }
    }

    /* 壁纸 */
    const url = c.wallpaper.url;
    if (url) {
      const okScheme = /^https?:\/\//i.test(url) || /^data:image\//i.test(url);
      if (!okScheme) errors.push({ kind: '壁纸地址不合法', text: '壁纸只支持 http(s) 链接或 data:image/… ，其它会被浏览器拦掉。' });
      if (/^data:image\//i.test(url)) {
        const bytes = estimateDataUrlBytes(url);
        if (bytes > 400 * 1024) {
          warnings.push({
            kind: '壁纸撑大预设',
            text: `这张壁纸原图约 ${(bytes / 1024 / 1024).toFixed(2)} MB，base64 塞进预设后大约 ${((bytes * 4 / 3) / 1024 / 1024).toFixed(2)} MB——`
              + '预设会被撑得很大，酒馆导入也可能变慢。建议先压到 200KB 以内，或者用外链（那就有了外部依赖）。',
          });
        }
      }
      if (c.wallpaper.opacity > 0.6 && c.wallpaper.dim < 0.12) {
        warnings.push({ kind: '文字可能看不清', text: '壁纸不透明度偏高而压暗层几乎没开，正文颜色压在花壁纸上会难读。把"压暗"提到 0.2 以上试试。' });
      }
    }

    /* 尺寸 */
    const w = c.window;
    if (w.minW > w.w) warnings.push({ kind: '默认宽度小于最小宽度', text: `默认宽 ${w.w} < 最小宽 ${w.minW}，会被夹到最小宽。` });
    if (w.minH > w.h) warnings.push({ kind: '默认高度小于最小高度', text: `默认高 ${w.h} < 最小高 ${w.minH}，会被夹到最小高。` });
    if (w.maxW && w.maxW < w.minW) warnings.push({ kind: '最大宽度小于最小宽度', text: `最大宽 ${w.maxW} < 最小宽 ${w.minW}，窗口会被夹得很难受。` });
    if (w.maxH && w.maxH < w.minH) warnings.push({ kind: '最大高度小于最小高度', text: `最大高 ${w.maxH} < 最小高 ${w.minH}，窗口会被夹得很难受。` });
    if (Number(raw.window?.w) !== w.w || Number(raw.window?.h) !== w.h) {
      warnings.push({ kind: '尺寸被夹取', text: `默认尺寸 ${raw.window?.w}×${raw.window?.h} 超出允许范围，实际会是 ${w.w}×${w.h}。` });
    }
    if (c.layout.opacity < 0.55) warnings.push({ kind: '面板太透明', text: `窗口底色不透明度 ${c.layout.opacity}，会明显透出后面的酒馆界面，字可能看不清。` });
    if (Math.abs(Number(raw.layout?.scale) - c.layout.scale) > 0.001) {
      warnings.push({ kind: '缩放被夹取', text: `缩放 ${raw.layout?.scale} 超出 0.6–2，实际会是 ${c.layout.scale}。` });
    }
    if (c.layout.scale > 1.35) warnings.push({ kind: '缩放偏大', text: `整体缩放 ${c.layout.scale}，窗口内容会明显变大——记得把窗口尺寸也调大，否则会挤。` });

    /* 悬浮球 */
    if (c.ball.size < 34) warnings.push({ kind: '悬浮球偏小', text: `球直径 ${c.ball.size}px，手机上不太好点（建议 ≥40）。` });

    return { errors, warnings, clamped: c, effective: toCssVars(c), hasWallpaper: !!url };
  }

  /** 与出厂配色比，改了哪些 token（界面用来显示"已改"） */
  function changedTokens(cfg, themes) {
    const raw = mergeConfig(DEFAULT_CONFIG, cfg);
    const rows = [];
    for (const tier of ['day', 'night']) {
      const src = raw.tokens?.[tier] ?? {};
      for (const [k, v] of Object.entries(src)) {
        const base = themes?.[tier]?.[k];
        if (base !== undefined && String(base) !== String(v)) rows.push({ tier, key: k, from: base, to: v });
      }
    }
    return rows;
  }

  root.PresetPanelConfig = {
    BEGIN, END, TOKEN_SPEC, TOKEN_KEYS, DEFAULT_CONFIG, FIT,
    DEFAULT_THEME_KEYS: TOKEN_KEYS,
    extractConfig, extractThemes, extractCss, extractFallbackTitle, patchConfig, mergeConfig, clampConfig,
    extractBlock, patchBlock, extractGroups, patchGroups, extractDefaults,
    toCssVars, scaleCss, scaleFontCss, hasWallpaper, validateConfig, changedTokens, estimateDataUrlBytes,
    findLiteral, parseLiteral,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
