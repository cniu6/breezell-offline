# 兼容表

每个 Breezell 版本都会重命名变量、挪动装配点。本项目不按版本号硬编码偏移，而是**锚点 + 形状容错正则 + 幂等判定**；下表记录已实测的版本差异与处理方式。

## 1. 当前支持

| 项 | 值 |
|---|---|
| `BREEZELL_SUPPORTED` | `1.4.691`（`appPatcher.js` L8） |
| 已实测安装版 | 1.4.3 / 1.4.4 / 1.4.5 / **1.4.6** |
| 已实测热运行时 | 1.4.31 / 1.4.33 / 1.4.34 / 1.4.35 / 1.4.36 / 1.4.37 / 1.4.41 / 1.4.51 / 1.4.52 / 1.4.54 / 1.4.55 / 1.4.59 / 1.4.62 / 1.4.63 / 1.4.64 / 1.4.66 / 1.4.67 / **1.4.691** |
| 补丁定义 | 44 条（有效 28 条 + 软跳过 16 条） |

面板与 CLI 都会对每个根输出 `breezell=<实际版本> (supported | untested, built for 1.4.691)`。

## 2. 已失效补丁（`OBSOLETE_IDS`）

官方在这些版本里删掉了对应实现，补丁自动 `skipped`（记日志，不报错）：

| 补丁 | 失效原因 |
|---|---|
| `A3-token-view-pro` | 1.4.59 起删除硬编码 token 视图对象，改由 `caps` 派生 `plan:"pro"` |
| `F4-model-config-10s` | 1.4.63 起 `/api/model-config` 只剩图片模型刷新 |
| `E3` `E4` | 热更新/模型配置节流点被官方重写 |
| `F2` `F3` `F5` `F8`–`F11` | 轮询点重构（`sched/market/banner/ext/presence` 等挪位或删除） |
| `F14` `F16` `F17` | viking 查询守卫、模式覆盖、14056 提示全部被官方移除 |
| `F21` | 1.4.5+ 无 `LayoutControlMenu` 的 menu 模式挂载点 |
| `F22` `F23` | 流式超时改由官方设置 `chatFirstByteTimeoutSeconds` 接管 |

## 3. 结构性差异（会直接影响锚点）

| 版本 | 变化 | 处理 |
|---|---|---|
| 1.4.4 | bundle 变量整体换名（`Mt/V` ↔ `Rt/q`、codicon `ce` → `se`） | F20/F21 引入 `codiconVarOf()` 反查模块名；`$ICONX` 占位 |
| 1.4.4 | 模式表 `roleDefinition` 置空，正文改云端下发 | `F16` 失效，转入 obsolete |
| 1.4.37 | 能力对象新增 `hasCloudTelemetry` | `CAPS_DEF_RE3` / `CAPS_DONE_RE` / `capsProOf()` 逐字段改写 |
| 1.4.37 | 门控变量 `G` → `J`；构造器形参 4 → 5；14056 改 `warn` | A2/B2/B3/F6/F14/F17 全部改形状正则 + 捕获变量 |
| 1.4.51 | **扩展宿主写保护**（`node:fs` / `workspace.fs` 全 Proxy，`a plugin may not reach …`） | 补丁只能由外部 `node` 进程施加；`PATCH_GUARD` + 面板黄条 |
| 1.4.51+ | 热运行时目录可能缺 `extensions/node_modules/resources` 三个 junction（1.4.54 / 1.4.55 / 1.4.66 / 1.4.67 / 1.4.691 均出现） | `patchRoot` 内 `ensureRuntimeLinks()` 自动补建并记日志；`install-hot.js` 亦建 link |
| 1.4.59 | token 视图对象删除 | `A3` → obsolete |
| 1.4.6+ | 安装版自带 junction，图标主题从安装根解析 | `theme-augment` 不再因换热运行时失效 |

## 4. 与其它插件共存

`compat` 检测（`PM_PURGE_RE = /bzl-offline:hm-gate|bzl-offline:gate3|BreezellOffline\.__hm/`）：

- `compat=clean`：提示词装配点只有本插件一层 `pSys`
- `compat=SHARED(hm)`：另有插件（`bzl-purge` 系）在同一处包了一层

**共用时的三个坑**：

1. 提示词被二次加工（对方用 `__hm` 决定是否改写），注入顺序影响最终文本
2. `product.json` 的 `checksum` 谁最后写谁负责——后写方能过校验，先写方下次会 `MISMATCH`
3. 打补丁顺序敏感：建议**先打对方，再打本插件**

面板黄色横幅仅在**正在运行的那个根**为 `SHARED` 时出现，避免误报。

## 5. 重新对锚点的流程

```bat
:: 1) 看哪些项失败（不写盘，只报告）
node extension\src\patchCli.js probe

:: 2) 定位锚点：在新 bundle 里搜该补丁常量里的关键片段
::    例：F15 → "Important notes:"；F24 → .trim().replaceAll("\t","  ")
::    注意 bundle 是单行巨型文件，"\t" 是真 TAB，"${" 是字面量

:: 3) 改 appPatcher.js 对应补丁的 find/validate/render/doneRe
::    软失败项保留 soft:1，确认官方删除的转入 OBSOLETE_IDS

:: 4) 打补丁 + 语法预检 + 状态巡检
node extension\src\patchCli.js apply
node extension\src\patchCli.js status
```

**铁律**：`node --check` 过 ≠ 能跑。注入点若引用了模块里不存在的标识符，会在模块求值时抛 `ReferenceError`，整个 workbench 不加载（表现为白屏，且 `renderer.log` 都不生成）。白屏时按此顺序排查：`main.log` → `renderer.log` 是否存在 → 两 bundle `node --check` → `checksum` 是否一致 → 恢复干净文件对照。
