# CHANGELOG

## 3.4.16 — 2026-11-24
- 修复一个真实事故：安装根（Programs\Breezell\resources\app）的 `.breezell-offline-backup` 是 1.4.5 时期留下的，今天误执行 Restore 时把 **1.4.5 的 main.app.js / workbench / product.json 写回了 1.4.6 安装根**，导致安装根版本号显示 1.4.5。已用 1.4.6 安装包覆盖重装并把备份重建为 1.4.6 版本。
- 新增**备份版本指纹**：`backup()` 在新建备份时写 `.breezell-offline-backup/meta.json`（`breezellVersion` / `breezellBaseVersion` / `commit` / 时间）；`restoreRoot()` 先比对备份与当前根 product.json 的 commit，不一致就直接拒绝还原并说明原因（`report.refused`）。跨版本 Restore 从此不会再把旧文件写回新安装。
- `productStamp()` 一并导出，便于外部检查与排障。
## 3.4.15 — 2026-11-24
- 官方热更新 **1.4.67**（`eedd2759e60c`，35,972,586 B）自动跟进到位；`BREEZELL_SUPPORTED = "1.4.67"`。
- 该版无锚点变化：28 条命中、16 条按预期软跳过，三根（安装版 1.4.6 / 1.4.67 current / 1.4.66）全绿。
- `ensureRuntimeLinks()` 在 1.4.67 上首次自动生效：解包目录只有 `out` 时自动补建三个 junction（此前需人工 `mklink /J`）。
## 3.4.14 — 2026-11-24
- 官方热更新 **1.4.66**（`301a6063c144`，35,972,656 B）自动跟进到位；`BREEZELL_SUPPORTED = "1.4.66"`。
- 该版无锚点变化：28 条命中、16 条按预期软跳过，三根（安装版 1.4.6 / 1.4.66 current / 1.4.64）全绿。
- 新增 `ensureRuntimeLinks()`：`patchRoot` 开跑前检查热运行时缺不缺 `extensions` / `node_modules` / `resources` 三个 junction，缺则自动补建。1.4.54 / 1.4.55 / 1.4.66 都出现过"只有 out 就写 .ready"的半装目录，以前靠人工 `mklink /J`，现在自动。

## 3.4.13 — 2026-11-21
- 官方热更新 **1.4.64**（`1441667b08fc`，35,923,246 B）自动跟进到位；`BREEZELL_SUPPORTED = "1.4.64"`。
- 该版无锚点变化：44 条定义中 28 条命中、16 条按预期软跳过；三根（安装版 1.4.6 / 1.4.64 current / 1.4.63）全绿。
- 1.4.64 只改 Agents 页、Git 面板、分析模式与设置页字体，未触碰我们注入的装配点。

## 3.4.12 — 2026-11-21
- 适配 **Breezell 1.4.6（安装版）+ 1.4.63（热运行时）**；`BREEZELL_SUPPORTED = "1.4.63"`。
- `A3-token-view-pro`、`F4-model-config-10s` 转入 `OBSOLETE_IDS`（1.4.63 已删除对应实现）。
- `compat` 标签统一为 `SHARED(hm)`（purge 新版标记为 `hm-live`）。
- 图标主题缓存改为解析安装根（junction 共享），换热运行时不再需要清 `iconThemeData`。
- `guardCurrent` 命中官方写保护时不再刷 `EACCES` 错误，改为置位 `PATCH_GUARD`。

## 3.4.11 — 2026-11-15
- 新增**固定支持版本号**：`BREEZELL_SUPPORTED`，每个根输出 `breezell=1.4.59 (supported)` / `(untested, built for …)`；面板头部角标「适配 x.y.z」，取**正在运行的根**。

## 3.4.10 — 2026-11-15
- 适配 1.4.59：`A3` 锚点消失（官方改为由 caps 派生 pro）→ 软跳过。

## 3.4.9 — 2026-11-11
- `F15` 的 `doneRe` 兼容 `bzl-purge` 的 `hm-gate` 包装，消除 `sys=fixed` 误报。

## 3.4.8 — 2026-11-11
- 新增 `compat` 检测：识别提示词装配点是否被其它插件（`hm-gate` / `__hm`）共用；仅当**当前运行根**被共用时显示黄色横幅。

## 3.4.6 / 3.4.5 — 2026-11-07
- 适配 1.4.51 的**程序目录写保护**：`PATCH_GUARD`、`guardTrip`、`runPatch` 检查 `errors` 数组、顶部黄条给出外部 CLI 命令；固化 `tools\patch-all.cmd` / `patch-then-launch.cmd` / `install-hot.js`。

## 3.4.4 — 2026-10-28
- Seti 图标映射补全（93 条：`txt/log/db/sh/ps1/exe/so/ini/lock/sum/…`、`Dockerfile`、`go.mod`、`.gitignore`），接入 `patchRoot` 成为 `augmentTheme()`。

## 3.4.3 — 2026-10-25
- 本地记忆的「模型来源」三档：`endpoint`（自有端点，默认）/ `provider`（Breezell 已配的）/ `none`（纯规则）；新增端点探测 `memTestEndpoint()`。
- 修 `readCfg()` 白名单丢字段导致面板切换不持久。

## 3.4.0 — 2026-10-23
- 本地记忆改为官方范式的 **L0/L1/L2 结构化蒸馏**（`title ≤60`、`l1 ≤400`、`l2 ≤3000`），支持 AI 重蒸馏。

## 3.3.1 — 2026-10-20
- 修 provider 上报：capability 通道第三形参是 `n` 而非 `s`；`settingsOfProvider` 字段名 `modelName` 映射。

## 3.3.0 — 2026-10-19
- 面板卡死三连修：`DEFAULT_CFG.memory` 丢失 → `buildState` 抛错；内联脚本转义；`buildState` 重复 `memory` 键。

## 3.2.0 — 2026-10-18
- 记忆「来源三档」`official-first / custom / off`；官方配额耗尽才注入本地记忆。

## 3.1.0 — 2026-10-18
- **本地超级记忆**：`memory.js`，本机存储 + 召回打分 + 中段槽位注入。

## 3.0.10 — 2026-10-17
- 分段替换 `pSection`（服务端提示词在 `delivery:"server"` 时只下发引用）；实测后默认关闭。

## 3.0.7 — 2026-10-15
- 大段粘贴不再被转存：`_LARGE_PASTE_SPILL_MIN_CHARS 32e3 → 2e6`、`LLM_HEAD 2e3 → 2e5`、`LLM_TAIL 1e3 → 1e5`。

## 3.0.5 / 3.0.6 — 2026-10-13
- 注入改为**纯叠加**：`pSys` 追加、`pModeOf` 字段追加；新增中段槽位 `pMid` / `F25`。

## 3.0.3 — 2026-10-11
- 修 1.4.4 白屏：codicon 模块变量 `ce → se`，F20 注入的 `icon:ce.globe` 在模块求值时抛 `ReferenceError`（`node --check` 查不出）。改为 `codiconVarOf()` 反查。

## 3.0.0 — 2026-10-09
- 适配 1.4.4（bundle 全量换名）。移除全部热更新相关命令/配置（1.4.4 起官方已删除热更新）。

## 2.8.x — 2026-10-05
- 内建扩展自检 `builtin=OK seti=OK`；`removeDirSafe` 删除保险丝；解包完整性闸门（5 个必需文件）。
- 1.4.37 锚点重写：能力对象新增 `hasCloudTelemetry`、门控变量 `G → J`、构造器形参 4 → 5、14056 改 `warn`。

## 2.7.0 — 2026-09-28
- `F21` 标题栏兜底挂载（`layoutControl.enabled=false` 时地球按钮回落到 `TitleBar` 主菜单）；面板「标题栏按钮自检」六层判定。

## 2.6.0 — 2026-09-24
- 「配置档案」→「配置管理」：一份配置覆盖 prompts / flags / browser / settings；整包 bundle 导入导出。

## 2.5.0 — 2026-09-20
- 修「保存新档案」无效：`#dlgOk` 无 `onclick`（harness 直调回调掩盖了它）；内置浏览器首页可设（默认 `cn.bing.com`）。

## 2.4.0 — 2026-09-15
- 面板改 9 页签 + 自绘弹窗（webview sandbox 不给 `allow-modals`，`prompt/alert/confirm` 全被拦）。

## 2.3.0 — 2026-09-10
- `F20` 标题栏「浏览器工作台」按钮 + 浏览器面板 + 多配置档案。

## 2.2.0 — 2026-09-05
- `F19`/`H2` DevTools(F12) 解锁（门禁 `editor-client-config.enableDevTools=false`）。

## 2.1.0 — 2026-09-01
- `F18` 会话 nonce 抓取与展示（`internalNoticeNonce` → `nonce="${T}"`）。

## 2.0.0 — 2026-08-28
- 静态补丁引擎重构：锚点 + 幂等 + 语法预检 + 备份 + 补丁戳；在线模型/倍率面板。
