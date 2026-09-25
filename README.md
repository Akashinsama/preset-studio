# 酒馆预设解析器 · 生成器

一个**零依赖、全本地**的酒馆（SillyTavern）预设工具包：双击一个 HTML 就能把任意预设拆开看、
体检、改结构、配面板外观、甚至从零搭一份；另配一个悬浮窗面板脚本（芳乃配色）。
不用 Node、不用服务器、不联网，**不改你的任何文件**——导出永远是"另存为"。

> ## ⚠️ 这个仓库里没有预设正文
>
> 这里发的是**工具与文档**，不是预设。开发期用来当样本的那些预设属于各自的作者，
> **不进这个仓库**（原因与署名见 [`NOTICE.md`](NOTICE.md)）。
> 所以依赖样例预设的测试会打印 `SKIP` 并正常退出——**没跑 ≠ 通过**；
> 想让它们真跑起来，按 [`samples/README.md`](samples/README.md) 放一份你自己的样例。

## 30 秒上手

1. 双击 `tools/gui/index.html`（打包版是根目录的 `开始.html`）。
2. 右上角 **导入预设…** 选一份你自己的酒馆预设 JSON（可多选）。
3. 左栏第一项 **引导：我要做什么**，会按"你手上有什么、想改到哪一步"给清单。

界面上**来源条目的正文只读**，逐字节哈希校验保证"没动过"。
右上角的 **⟳ 刷新** 只重挂当前这一屏用来解卡（不重载页面，输入与草稿都保留）。

## 自检怎么跑

**先跑一句**（造合成夹具 + 把整条链跑完，之后所有测试都能真跑）：

```bash
node tools/build-all.mjs          # make-fixture → build-regex → build-panel → build-preset
                                  # → build-preview → build-gui-demo → build-package
```

```bash
node tools/selftest.mjs           # 72 项   包内自检：库 + 面板 + 样例预设
node tools/test-regex.mjs         # 30 项   思维链折叠链逻辑
node tools/test-gui.mjs           # 331 项  解析 / 拼装内核 + M3 编辑端到端
node tools/test-panel.mjs         # 120 项  面板逻辑（假 DOM）
node tools/test-panelconfig.mjs   # 83 项   面板外观配置夹取一致性
node tools/test-mobile.mjs        # 20 项   手机场景
node tools/test-iframe.mjs        # 26 项   iframe 与时序
node tools/check-preset.mjs       # 108 项  样例预设的独立校验
node tools/check-browser.mjs      # 58 项   面板布局（真浏览器，本机 Chrome/Edge）
node tools/check-gui-browser.mjs  # 十屏    生成器 GUI 的 DOM 取证（真浏览器）
```

实测：**790 项全绿**（上面除浏览器两层）+ 浏览器两层在合成夹具上同样通过。

> **这些不需要你先准备任何预设。** 缺夹具时 `tools/lib/fixtures.mjs` 会自动调
> `tools/make-fixture.mjs` 造一份**合成夹具**：结构（条目名 / 槽位 / 顺序 / 开关）从 `spec/` 里
> 已经进库的规格推出来，正文全是「【合成夹具】…」占位，**不含任何预设正文**。
> 少数几条"真实规模"断言（226 条 / 60 条开启 / 30 条正则）在合成夹具下会**按夹具重算基准**
> 并打印一行说明——不是被放过，是换了基准。想看真实数字，把你的预设放成同名再跑一遍
> （见 [`samples/README.md`](samples/README.md)）。
>
> 真的连合成夹具都造不出来时才会打印 `SKIP` 并退出 0；`DSH_REQUIRE_FIXTURES=1` 把缺失变成失败。

## 许可

代码 **MIT**（见 `LICENSE`）；**不含任何预设正文**，那部分著作权属于各自的作者（见 `NOTICE.md`）。
