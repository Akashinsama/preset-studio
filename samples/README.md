# samples/ · 放你自己的样例预设（可选）

**这个目录默认是空的，里面的东西不会被提交**（`.gitignore` 里写着 `samples/*`）。

## 先看这条：仓库自己能造夹具，你多半什么都不用放

```bash
node tools/build-all.mjs     # 造合成夹具 → 生成折叠链 / 样例预设 / 宿主 / 演示数据 / dist
```

`tools/make-fixture.mjs` 会照 **`spec/` 里已经进库的结构信息**（`groups.json` 的分组与成员名、
`slot-owner.json` 的槽位主人）**自己造**三份源预设：

- 条目名 / 槽位 / 顺序 / 初始开关 —— 与真实成品同一套结构；
- 正文一律是「【合成夹具】…」占位，**一个字节的第三方文本都没有**；
- 顶层带 `__synthFixture` 标记，测试据此分辨"真夹具 / 合成夹具"，并把按夹具重算的基准打印出来；
- 确定性：同一个 `spec/` 生成的结果逐字节相同（内容是名字/下标推出来的，不用随机数、不写时间戳）。

跑完这一句，**全部测试套件就都能真跑了**（实测：`selftest 72 + test-regex 30 + test-gui 331 +
test-panel 120 + test-panelconfig 83 + test-mobile 20 + test-iframe 26 + check-preset 108 = 790 项全绿`），
浏览器那两层也能跑（要本机 Chrome/Edge）。

## 想跑**真实**数据：把真预设放成同名即可

生成器**只写自己生成的文件**：目标文件已存在且没有 `__synthFixture` 标记 → 那是真预设，它一个字都不动；
名字对不上就直接读真文件，链条照旧跑真实数据。想要"真实夹具优先"的行为，把下面这些放进来：

| 文件名 | 谁需要它 | 说明 |
|---|---|---|
| `Izumi_0914.json` | `test-gui.mjs`、`build-gui-demo.mjs`、`check-browser.mjs` 的样本 | 主力样本（条目多、结构完整）。任意一份你自己的复杂预设改名成它即可。 |
| `Kemini_Dramatron_v3.1.json` | `build-regex.mjs`、`build-preset.mjs`、`check-preset.mjs` | 思维链"多块"形态与破甲结构的对照样本。 |
| `梦鲸思客V4-0915.json` | `build-preset.mjs`、`check-preset.mjs` | 第三方破甲层样本。 |
| `preset/芳乃预设.json` | `selftest.mjs`、`test-panel.mjs`、`build-preview.mjs` | **成品预设**：由上面三份经 `tools/build-preset.mjs` 组装。没有源预设就直接把它当夹具放进 `preset/`（该路径不受 `samples/` 影响，`.gitignore` 已忽略）。 |

放 `samples/` 里也行：查找顺序是 `samples/<名字>` 优先，其次仓库根。

> **注意**：那三份源预设是**别人的作品**，本仓库不随附、也不该被转载。
> 你自己跑测试要用，请自己准备好文件、别提交（`.gitignore` 已经挡了）。

## 缺夹具时会发生什么

正常情况下不会缺：`tools/lib/fixtures.mjs` 发现缺就直接调 `make-fixture.mjs` 造一份合成夹具，
并在输出里打印一行说明（"缺夹具：正在生成合成夹具…"）。真跑不起来（比如脚本被删、沙箱不让派生进程）才会：

```
────────────────────────────────────────
SKIP  面板逻辑测试（120 项）
      缺夹具：panel/preview-host.js
      本仓库不随附任何预设正文（见 NOTICE.md）——这是故意的，不是坏了。
      ...
      没跑 ≠ 通过。想让缺失直接报错，就用 DSH_REQUIRE_FIXTURES=1 再跑一次。
────────────────────────────────────────
```

默认退出码 **0**；设 `DSH_REQUIRE_FIXTURES=1` 变成 **2**（CI 用来确认"真的都跑过了"）。
想确认"手上到底是真夹具还是合成夹具"，用 `DSH_NO_AUTO_FIXTURE=1` 关掉自动生成再跑一次。
