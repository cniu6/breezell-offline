# Breezell Offline Patch（Breezell 离线补丁）

面向 Breezell 编辑器（基于 VS Code / Electron 分支）的**本地补丁与工作台扩展**。它不做"改一版就废"的偏移量硬编码，而是用**锚点 + 形状容错正则**在多个运行时根上打补丁，官方换版本时只需要重新对锚点。

> 当前适配：**Breezell 1.4.6（安装版） + 1.4.691（热运行时）**
> 扩展版本：**3.4.17** ｜ 补丁定义：**44 条**

---

## 1. 它能做什么

### 1.1 运行时补丁（写进 main.app.js / workbench.desktop.main.js / agentHostMain.js / product.json）

| 组 | 补丁 | 作用 |
|---|---|---|
| 能力与门控 | `A1–A4` `B1` `B2` `D1–D3` | 能力对象派生 pro、发送门控短路、token 视图、Studio 默认 |
| 轮询降噪 | `E1` `E2` `F1` `F6` `F7` `F12` `F13` | 关闭更新检查、热更新自动检查、压缩调度/market/banner/会话/终端轮询 |
| 提示词注入 | `F15` `F18` `F24` `F25` | `pSys` 前置槽位、会话 nonce 落盘、尾部槽位 `pTail`、中段槽位 `pMid` |
| 界面与工具 | `F19` `F20` `F21` `G1` | F12 DevTools 解锁、标题栏「浏览器工作台」按钮（含兜底挂载）、控制 URL 关闭 |
| 桥与通道 | `B3` `B3b` `B3c` `B3d` `B4` `H1` `H2` `H3` `H5` | settings 桥、尾部/中段/分段/凭据上报方法、桥版本对齐、capability 通道新命令 |
| 粘贴与体验 | `F26` `F27` `F28` | 大段粘贴不再被转存成 `user-input-*.txt` |

被官方接管/移除的项（`A3` `F4` `E3` `E4` `F2` `F3` `F5` `F8`–`F11` `F14` `F16` `F17` `F21` `F22` `F23`）已列入 `OBSOLETE_IDS`：**无锚点即静默跳过，不报错、不写坏文件**。

### 1.2 扩展面板（9 页签）

- **概览**：每个运行时根的分项状态、补丁落点、`breezell=` 适配版本、`compat=` 共存放检测
- **浏览器**：驱动官方内置浏览器（`breezell.browserView.*`），首页可设、标签/前进后退/静音
- **提示词**：四层槽位（`systemPrompt` / `extraBlock` / `midBlock` / `tailBlock`）+ 本地超级记忆
- **配置**：多套配置（提示词/开关/浏览器首页/编辑器设置）+ 整包导入导出（换机迁移）
- **模型·倍率**：走官方在线 API 读模型目录与折扣倍率（`pricingVisible=false` 时回落到内置目录）
- **官方设置**：22 项官方开关的三态管理（保留 / 设定 / 默认），带持久化
- **会话**：抓取并展示当前会话 nonce（UUID 分段、来源、注入位置、原句）
- **性能**：定时器开销、进程采样、GPU 对比
- **设置 / 日志**：路径、开关、日志尾部

### 1.3 本地超级记忆（离线）

不依赖云端记忆服务：本机存储 + 规则蒸馏（L0 摘要 / L1 要点 / L2 细节）+ 召回打分，注入 `midBlock` 槽位。可用官方模型、自有 OpenAI 兼容端点（本机 Ollama 也可以），或纯规则模式。

---

## 2. 安装

```bat
:: 1) 安装扩展（读取 package.json 版本，写入 <user>\.breezell-editor\extensions\local.breezell-offline-<ver>）
node tools\install-ext.js

:: 2) 打补丁（读写受写保护的运行时需要用外部进程）
tools\patch-all.cmd
```

> **1.4.51 起官方给扩展宿主加了程序目录写保护**（`a plugin may not reach …`）。插件自身不能再改运行时文件，必须用外部 `node` 进程；扩展面板会在被拦时显示黄色提示与命令。

### 2.1 打补丁的范围

`patch-all.cmd` 会枚举所有运行时根并逐一施加：

```
<安装目录>\resources\app                     ← 安装版（1.4.6）
%APPDATA%\Breezell\hot-runtime\<ver>-<sha12>  ← 每个热运行时（current 由 current.json 指定）
```

每个根都会：备份 → 逐项匹配 → 语法预检（`node --check`）→ 落盘 → 同步 `product.json` 的 `checksum` → 补齐 Seti 图标映射。

### 2.2 热更新

```bat
:: 官方推送新热更新后：先把 zip 放 %APPDATA%\Breezell\hot-cache\，然后
node tools\install-hot.js
```

它会解包、建 `extensions/node_modules/resources` 三个 junction、写 `.ready`、打补丁、切换 `current.json`。

---

## 3. 目录

```
extension/           扩展源码（entry: src/extension.js）
  src/
    extension.js     面板 + 命令 + 记忆/配置/浏览器接线
    appPatcher.js    补丁引擎（44 条定义 + 锚点 + 预检 + 备份）
    memory.js        本地记忆（L0/L1/L2 蒸馏、召回、注入）
    browser.js       官方浏览器命令封装
    cloud.js         官方在线模型/倍率客户端（含 JWT 读取与续期）
    profiles.js      多配置仓库 + 整包 bundle
    targets.js       运行时根枚举
    patchCli.js      外部 CLI（apply / restore / status / probe）
  assets/            图标、内置模型目录、提示词基线
docs/
  ANALYSIS.md          逐项补丁的逆向记录与实测数据（~180KB）
  PROMPT-INVENTORY.md  内置提示词与 109 个工具的全量盘点
  COMPAT.md            版本 × 锚点兼容表
  ARCHITECTURE.md      结构、注入点、数据流
  DELIVERY-INDEX-3.4.3.md  历史交付索引
  gen-inventory.js     清单生成器（换版本可重跑）
tools/               构建/安装/一键打补丁
  sync-repo.js       工作副本 → 仓库 单向镜像（见 §4.1）
release/             最新 vsix 成品
```

---

## 4. 构建

```bat
node tools\pack-vsix.js
:: → release\breezell-offline-<ver>.vsix（自写 zip：deflate + crc32 + 中央目录）
```

版本号三处同步（脚本会读 `extension/package.json`，不一致会直接拒绝）：

1. `extension/src/appPatcher.js` → `VERSION`
2. `extension/package.json` → `version`
3. `extension.vsixmanifest` → `PackageManifest` / `Identity` 两处 `Version`

换 Breezell 版本时额外改一处：`appPatcher.js` 的 `BREEZELL_SUPPORTED`（面板角标与 CLI 输出用它判断"是否官方声明适配"）。

### 4.1 从工作副本同步进仓库

开发时真正的源码在 `patch\breezell-offline\pkg\`（`install-ext.js` 也读这里），仓库只是镜像。改完代码跑一次：

```bat
node tools\sync-repo.js --all --check   :: 先看差异，不写盘
node tools\sync-repo.js --all           :: 写入（extension/ + docs/ + release/）
git add -A && git commit -m "chore: 同步 v3.4.13" && git push
```

- **单向**：`pkg` 是权威，仓库里被同步器写过、而源已删除的文件会被一并删掉
- **不会误删手写内容**：靠 `.sync-manifest.json`（上次同步写过的路径清单）判断，`docs/ARCHITECTURE.md`、`README.md`、`CHANGELOG.md` 这类手写文件永远不在清单里
- 只镜像 `extension/` 与两个根文件；加 `--docs` 带三份研究文档，加 `--release` 带最新 vsix，`--all` 两者都带
- 写盘前先验版本三处一致，不一致直接退出，避免把半套版本提交上去

---

## 5. 设计要点（为什么这么做）

1. **锚点而非偏移**：官方每个版本变量名/结构都会漂移（`Mt/V` ↔ `Rt/q`、`ce.globe` ↔ `se.globe`），所以每项补丁都带 `doneRe`（幂等判定）+ `validate`（形态校验）+ `render`（捕获组回填）。
2. **软失败**：`soft: 1` 的项在锚点消失时记为 `skipped`，不抛错、不写半截文件。
3. **写前语法预检**：任何改动先写探针 + `node --check`，不过就整根放弃。这条拦住过多次"看起来成功、实际白屏"。
4. **补丁戳**：`.breezell-offline-stamp.json` 记录 `size:mtime` 签名，命中即跳过整轮（冷启动从 ~1.1s 降到 ~110ms）。
5. **删除保险丝**：删目录前先 `lstat` 判 junction 只摘链接；删前删后比对受保护子目录文件数，减少即中止（这条来自一次真实事故：旧实现穿过 junction 删空了 `resources\app\extensions`，85 个内建扩展、1274 个文件）。
6. **纯叠加的提示词注入**：`pSys` / `pModeOf` 只追加不覆盖，避免丢官方内容。

---

## 6. 数据与回滚

| 文件 | 说明 |
|---|---|
| `%APPDATA%\Breezell\breezell-offline-config.json` | 主配置（提示词四层、开关、浏览器首页、记忆设置） |
| `%APPDATA%\Breezell\breezell-offline-memory.json` | 本地记忆（含回收站） |
| `%APPDATA%\Breezell\breezell-offline-profiles\` | 多套配置 |
| `%APPDATA%\Breezell\breezell-offline.log` | 插件日志 |
| `<root>\.breezell-offline-backup\` | 每个运行时根的原始文件备份 |

回滚：命令面板 `Breezell Offline: Restore Original`，或 `node extension/src/patchCli.js restore`。

---

## 7. 许可

MIT。仅供本地研究与自己机器的可逆性改造使用；使用时请自行评估目标环境。
