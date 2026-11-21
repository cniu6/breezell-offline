# 架构

```
                        ┌──────────────────────────────┐
                        │  extension host (Node)       │
                        │  src/extension.js            │
                        │   ├─ 命令 22 条               │
                        │   ├─ Webview 面板 9 页签       │
                        │   ├─ memory.js  本地记忆       │
                        │   ├─ profiles.js 多配置        │
                        │   ├─ cloud.js   官方在线 API   │
                        │   └─ browser.js 内置浏览器     │
                        └───────────┬──────────────────┘
                                    │ 读配置 / 写配置 / 读状态文件
                    ┌───────────────┴────────────────┐
                    │ %APPDATA%\Breezell\            │
                    │  breezell-offline-config.json  │
                    │  breezell-offline-memory.json  │
                    │  breezell-offline-{nonce,      │
                    │    providers,settings,ops,     │
                    │    lastreq}.json               │
                    └───────────────┬────────────────┘
                                    │ 30s 轮询 + capability 通道
        ┌───────────────────────────┴───────────────────────────┐
        │  workbench (renderer)                                  │
        │  globalThis.BreezellOffline  ← 注入的桥                 │
        │   ├─ pCfg/pSys/pExtra  提示词前置槽位                    │
        │   ├─ pMid              中段槽位（官方 notes 之后）        │
        │   ├─ pTail             尾部槽位（CACHE_BOUNDARY 之后）   │
        │   ├─ pModeOf           模式文本追加                      │
        │   ├─ pNonce/pOps/pProv/pPush  各通道上报                 │
        │   └─ __ch = getChannel("breezell-channel-capability")   │
        └───────────────────────────┬───────────────────────────┘
                                    │ ipc
        ┌───────────────────────────┴───────────────────────────┐
        │  main process                                          │
        │  capabilityChannel switch：                            │
        │   readPrompts / pushNonce / pushPrompt / pushProviders │
        │   pushSettings / readOps / ackOps                      │
        └────────────────────────────────────────────────────────┘
```

## 1. 补丁引擎（`src/appPatcher.js`）

```js
patchRoot(root)
  ├─ backup(root)                     // 4 个目标文件 → .breezell-offline-backup
  ├─ patchesMainApp()   → applyAll → checkText（不通过就整根放弃）
  ├─ patchesWorkbench() → applyAll → checkText
  ├─ patchesProduct()   → 写回 product.json
  ├─ checksum 同步（workbench 变了才更）
  ├─ patchesAgentHost() → applyAll → checkText
  └─ augmentTheme(root)               // Seti 图标映射补全
```

每条补丁的结构：

```js
{
  id: "F24-prompt-tail",
  desc: "尾部槽位",
  soft: 1,                       // 锚点缺失时记 skipped 而不是 ERROR
  done: "BreezellOffline.pTail?",// 幂等判定（字符串命中即 already）
  doneRe: /…/,                   // 或正则判定
  find: (s) => {…},              // 返回 {start,end,v:[捕获组]}
  validate: (t) => bool,         // 形态校验（可选）
  render: (rep, loc) => text     // 用捕获组回填 replacement
}
```

`applyAll` 的状态机：`already → notfound → badrange → mismatch → patched`。

## 2. 提示词四层槽位

官方装配点（1.4.4+ 实测）：

```js
let $e = `Important notes:\n\n${be.join("\n\n")}`, qe = [];
qe.push(globalThis.BreezellOffline && globalThis.BreezellOffline.pSys ? pSys(q) : q);  // ← 前置
qe.push(X), De && qe.push(De), qe.push($e);
let ne = qe.join("\n\n\n"), ut = Ae.join("\n\n\n");
return `${…}${ne}\n\n\n<!-- BREEZELL_CACHE_BOUNDARY -->\n\n\n${ut}`
        + (pTail ? pTail() : "").trim().replaceAll("\t","  ");                        // ← 尾部
```

| 槽位 | 注入点 | 特点 | 补丁 |
|---|---|---|---|
| 前置 | `qe.push(pSys(q))` | 权重最低（后面还有几万字符） | `F15` |
| 中段 | `Ae.push("Current date: …")` 之前 | 位于官方 notes 之后、环境信息之前 | `F25` + 桥 `pMid` |
| 尾部 | `CACHE_BOUNDARY` 之后的最后一个字符串 | 权重最高 | `F24` + 桥 `pTail` |
| 模式 | `modeOf(name)` 的返回对象 | 只追加 `roleDefinition`/`modeDescription` | `F16`（1.4.4 起失效） |

三条原则：**只追加不覆盖**；槽位方法名由桥提供，缺失时调用点是防御性写法（`pTail ? pTail() : ""`），所以「桥没升级」不会崩，只会静默为空——排查时先 `grep pTail:function` 确认桥里真的有这个方法。

## 3. 桥（`BRIDGE`，B3 补丁）

注入到 settingsService 构造器（1.4.4+ 锚点 `constructor(e,t,o,r,s){super();this.settingsService=t;…`），形参对齐：`s = settingsService`、`mp = ipcRenderer`。

对外暴露：

```
version  settingsOf  dump  setProvider  setGlobal  setModel  listProviders
pCfg     pSys  pModeOf  pExtra  pMid  pTail  pSection  pNonce  pProv  pOps  pPush
pStop    pRefresh  __ch  __iv/__iv2/__iv3
```

`B4-bridge-version` 只改 `version` 字符串，用来让面板识别"桥是不是当前版本的"。改桥逻辑时必须同时改 `B3` 的 `done` 判定（例如 `ms:function`），否则旧桥永远不会被替换——这是踩过的坑：`F24` 调用点在、桥里却没有 `pTail`，注入静默为 0。

## 4. 本地记忆（`src/memory.js`）

```
原文 ──distill()──► {title, l1, l2, tags, durability}   ← 规则三层（L0 摘要 / L1 要点 / L2 细节）
                      │
                      ├─（可选）compressWithModel() 走 OpenAI 兼容端点，返回 JSON 覆盖上面四项
                      ▼
         memory.json  {entries:[…], trash:[…]}
                      │
              recall() ── 打分：100/(1+ageH/72) + pin*120 + 命中率*200
                      ▼
              materialize() ── 写进 prompts.midBlock（带 <!--bzl-mem:begin--> 包裹）
```

- 存储、召回、注入全在本机；模型只用来"把原话蒸馏成条目"，可关（`modelSource=none` → 纯规则）。
- 注入走中段槽位，`stripBlock()` 保证重复注入不会叠加。
- 垃圾识别 `JUNK2`（系统提示词碎片、`<|im_start|>`、原始工具 JSON 等）在入库与整理时都过一遍。

## 5. 缓存与性能

| 缓存 | 键 | 失效 |
|---|---|---|
| `inspectRoot` 磁盘缓存 | `root` + `size:mtime` 签名 | 目标文件改动 |
| 补丁戳 `.breezell-offline-stamp.json` | 4 个文件的 `size:mtime` | 同上 |
| `buildState` 内存缓存 | 1.5s TTL | 定时 |
| `cloudRefresh` | 60s TTL + 单飞 + 400ms 去重 | 手动刷新 |
| `inspectRoot` 内部：`sumOf()`(sha256) / `readText()` | 文件签名 | 同上 |

冷启动 ~1.1s，热启动 ~110ms（含 node 启动）。

## 6. 面板去抖

| 层 | 规则 |
|---|---|
| 前端 `p(cmd)` | 同命令 500ms |
| 前端 `p2(cmd,data)` | `cmd|JSON(data)` 400ms（`saveCfg` 除外） |
| 主进程 `nonceRefresh` | 400ms |
| 主进程 `runOpenDevTools` | 900ms（`toggleDevTools` 是开关语义，连点会开了又关） |
| 主进程 `runBrowser(act)` | 按动作名 400ms（不能全局锁，否则"打开→立刻访问"会被吞） |

## 7. 自检与安全

- `builtin=OK seti=OK`：内建扩展目录与 Seti 主题文件存在性
- `removeDirSafe(dir, onLog)`：删前 `lstat` 判 junction 只摘链接；删前删后比对 `extensions/node_modules/resources/out` 文件数，减少即中止
- 解包完整性闸门：`package.json` / `product.json` / `out/main.js` / `out/main.app.js` / `out/vs/workbench/workbench.desktop.main.js` 缺一即丢弃目录、不写 `.ready`
- 写前语法预检：`node --check` 不过不落盘

这三条都来自真实事故：旧版清理穿过 junction 删空 `resources\app\extensions`（85 个内建扩展 / 1274 文件）；半装运行时写了 `.ready` 却缺 `main.app.js`；补丁注入未定义标识符导致整窗白屏。
