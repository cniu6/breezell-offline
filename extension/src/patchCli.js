"use strict";
/* breezell-offline :: patchCli - 独立命令行补丁器（不依赖扩展宿主） */
const path = require("path");
const os = require("os");
const targets = require("./targets");
const P = require("./appPatcher");

function usage() {
  console.log([
    "breezell-offline v" + P.VERSION,
    "",
    "用法: node patchCli.js <action> [installDir]",
    "  status    只读检查各运行时目录的补丁状态",
    "  plan      只读预演：打印每个锚点的命中位置与新旧长度",
    "  apply     备份 -> 打补丁 -> 同步 product.json 校验和",
    "  restore   从备份还原",
    "  inspect   打印状态 JSON",
    "",
    "环境变量:",
    "  BREEZELL_INSTALL_DIR   安装目录（默认自动探测）",
    "  APPDATA              用于定位 %APPDATA%\\Breezell\\hot-runtime"
  ].join(os.EOL));
}

function statusText(st) {
  if (!st.exists) return "  (不存在)";
  var d = P.describeRoot(st), out = [], k;
  var map = { mainApp: "main.app", workbench: "workbench", antiPoll: "anti-poll", poll: "poll", poll2: "poll2",
    viking: "viking", prompts: "prompts", devtools: "devtools", browserBar: "toolbar", stream: "stream",
    extNoise: "extNoise", product: "product", builtin: "builtin", compat: "compat", breezell: "breezell", agentHost: "agentHost", checksum: "checksum" };
  for (k in map) if (d[k] !== undefined) out.push("  " + (map[k] + "            ").slice(0, 12) + d[k]);
  return out.join("\n");
}
function main() {
  var argv = process.argv.slice(2);
  var action = argv[0] || "status";
  var installDir = argv[1] || process.env.BREEZELL_INSTALL_DIR || targets.guessInstallDir();
  if (action === "-h" || action === "--help" || action === "help") { usage(); return 0; }

  var list = targets.allTargets({ installDir: installDir });
  if (!list.length) { console.error("没有找到任何运行时目录（探测结果: " + (installDir || "空") + "）。用 BREEZELL_INSTALL_DIR 或第二个参数指定安装目录。"); return 2; }

  var lines = [], report = { action: action, targets: [] };
  lines.push("breezell-offline v" + P.VERSION + "  action=" + action);
  lines.push("install dir: " + installDir);

  for (var i = 0; i < list.length; i++) {
    var t = list[i];
    lines.push("");
    lines.push("=== [" + t.label + "] " + t.root);
    if (action === "status" || action === "inspect") {
      var st = P.inspectRoot(t.root);
      report.targets.push({ label: t.label, root: t.root, state: st.state });
      lines.push(statusText(st));
    } else if (action === "apply") {
      var r = P.patchRoot(t.root, lines);
      report.targets.push({ label: t.label, root: t.root, changed: r.changed, results: r.results, errors: r.errors });
    } else if (action === "plan") {
      var pl = P.planRoot(t.root, lines);
      report.targets.push({ label: t.label, root: t.root, plan: pl.items });
    } else if (action === "restore") {
      var rr = P.restoreRoot(t.root, lines);
      report.targets.push({ label: t.label, root: t.root, restored: rr.restored });
    } else { console.error("未知 action: " + action); usage(); return 2; }
  }

  lines.push("");
  lines.push("---- 详细日志 ----");
  console.log(lines.join(os.EOL));
  lines.forEach(function (l) { if (/\[(ERROR|WARN)\]/.test(l)) console.log(l); });
  return 0;
}

if (require.main === module) process.exit(main());
module.exports = { main: main };
