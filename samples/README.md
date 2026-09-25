# samples/ · 放你自己的样例预设

**这个目录默认是空的，而且里面的东西不会被提交**（`.gitignore` 里写着 `samples/*`）。

本仓库只发工具与文档，**不含任何预设正文**（原因见仓库根目录的 `NOTICE.md`）。
但工程里有一批测试是"拿一份真实预设当样本"跑出来的——那些测试需要夹具。
把夹具放进来，它们就会真跑；不放，它们会打印 `SKIP` 并正常退出。

## 放什么、谁能用上

| 文件名 | 谁需要它 | 说明 |
|---|---|---|
| `Izumi_0914.json` | `test-gui.mjs`、`build-groups.mjs`、`build-gui-demo.mjs`、`design-groups.mjs`、一批 `diag-*.mjs` | 开发期的主力样本（一份条目多、结构完整的预设）。任意一份你自己的复杂预设改名成它即可。 |
| `Kemini_Dramatron_v3.1.json` | `build-regex.mjs`、`build-preset.mjs`、`check-preset.mjs`、`diag-mvu.mjs`、`diag-template.mjs` | 思维链"多块"形态与破甲结构的对照样本。 |
| `梦鲸思客V4-0915.json` | `build-preset.mjs`、`check-preset.mjs`、`panel-inventory.mjs`、`probe.mjs`、`recon.mjs` | 第三方破甲层样本。 |
| `preset/芳乃预设.json` | `selftest.mjs`、`test-panel.mjs`、`check-preset.mjs`、`build-preview.mjs` | **成品预设**：由上面几份源预设经 `tools/build-preset.mjs` 生成。没有源预设就生不出来，直接把它当夹具放进 `preset/` 也行（这个路径不受 `samples/` 影响，`.gitignore` 已忽略）。 |

> 夹具文件名是**工程内部约定**（很多脚本按名字找）。你要是只想跑通某一层，
> 先按报错里说的那个文件放一个即可——`tools/lib/fixtures.mjs` 会一次把缺的都列出来。

## 缺夹具时会看到什么

```
────────────────────────────────────────
SKIP  界面回归（十屏 DOM 取证）
      缺夹具：Izumi_0914.json
      本仓库不随附任何预设正文（见 NOTICE.md）——这是故意的，不是坏了。
      要把这一步真跑起来：把这些文件放进 samples/（见 samples/README.md）
      没跑 ≠ 通过。想让缺失直接报错，就用 DSH_REQUIRE_FIXTURES=1 再跑一次。
────────────────────────────────────────
```

默认退出码 **0**（新克隆不至于红一片）；设 `DSH_REQUIRE_FIXTURES=1` 就变成 **2**（CI 用）。

## 不放夹具也能跑的

```bash
node tools/test-regex.mjs      # 30 项  折叠链逻辑
node tools/selftest.mjs        # 需要成品预设（见上表）
node tools/build-package.mjs   # 需要成品预设与面板产物
```

真正完全不依赖夹具的是 `tools/test-regex.mjs`，以及两套**纯函数库**的断言。
页面本身（`tools/gui/index.html`）也不依赖夹具：直接双击打开、**导入你自己的预设**就能用，
只是演示数据那块会提示缺失。

## 演示数据（GUI 页面的"载入演示数据"按钮）

页面上的演示数据由 `node tools/build-gui-demo.mjs` 从夹具生成到 `tools/gui/demo/`，
而那个目录**不入库**（它是从预设正文生成的，`.gitignore` 已忽略）。所以新克隆里：

- 打开 `tools/gui/index.html` 时控制台会有一条 `demo/izumi-demo.js` 的 404——**是预期的**，
  页面照常工作；
- "载入演示数据"按钮会提示你先跑 `build-gui-demo.mjs`；
- 只想要一份能看的演示数据：把任意一份预设按上表改名放进 `samples/`，再跑
  `node tools/build-gui-demo.mjs`。
