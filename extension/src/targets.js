"use strict";
/* breezell-offline :: targets - 发现需要打补丁的运行时根目录 */
const fs = require("fs");
const path = require("path");

function hasRuntime(root) {
  try {
    return fs.existsSync(path.join(root, "out", "main.app.js")) &&
           fs.existsSync(path.join(root, "out", "vs", "workbench", "workbench.desktop.main.js"));
  } catch (e) { return false; }
}

function installRoots(installDir) {
  var out = [];
  var p = path.join(installDir, "resources", "app");
  if (hasRuntime(p)) out.push({ root: p, label: "install" });
  else if (fs.existsSync(path.join(installDir, "out"))) out.push({ root: installDir, label: "install" });
  return out;
}

function hotRuntimeRoots(appData) {
  var base = path.join(appData, "Breezell", "hot-runtime");
  var list = [];
  var seen = {};
  function push(root, label) {
    if (seen[root]) return;
    if (!hasRuntime(root)) return;
    seen[root] = 1;
    list.push({ root: root, label: label });
  }
  var cur = path.join(base, "current.json");
  if (fs.existsSync(cur)) {
    try {
      var j = JSON.parse(fs.readFileSync(cur, "utf8"));
      if (j && j.dir) push(path.join(base, j.dir), "hot-runtime:" + (j.version || "?") + " current");
    } catch (e) {}
  }
  try {
    fs.readdirSync(base).forEach(function (d) {
      if (d === "current.json" || d === "reports.json") return;
      var full = path.join(base, d);
      try { if (!fs.statSync(full).isDirectory()) return; } catch (e) { return; }
      push(full, "hot-runtime:" + d);
    });
  } catch (e) {}
  return list;
}

function guessInstallDir() {
  var cands = [];
  if (process.env.BREEZELL_INSTALL_DIR) cands.push(process.env.BREEZELL_INSTALL_DIR);
  var ep = process.execPath || "";
  if (ep && /breezell/i.test(path.basename(ep))) cands.push(path.dirname(ep));
  if (process.env.LOCALAPPDATA) cands.push(path.join(process.env.LOCALAPPDATA, "Programs", "Breezell"));
  if (process.env.ProgramFiles) cands.push(path.join(process.env.ProgramFiles, "Breezell"));
  if (process.env["ProgramFiles(x86)"]) cands.push(path.join(process.env["ProgramFiles(x86)"], "Breezell"));
  if (process.env.ProgramW6432) cands.push(path.join(process.env.ProgramW6432, "Breezell"));
  for (var i = 0; i < cands.length; i++) {
    var d = cands[i];
    if (!d) continue;
    if (hasRuntime(path.join(d, "resources", "app"))) return d;
    if (hasRuntime(d)) return d;
  }
  return cands[0] || "";
}

function allTargets(opts) {
  opts = opts || {};
  var appData = opts.appData || process.env.APPDATA || path.join(process.env.USERPROFILE || ".", "AppData", "Roaming");
  var installDir = opts.installDir || guessInstallDir();
  var list = installDir ? installRoots(installDir) : [];
  if (opts.hot !== false) list = list.concat(hotRuntimeRoots(appData));
  return list;
}

module.exports = { allTargets: allTargets, installRoots: installRoots, hotRuntimeRoots: hotRuntimeRoots, hasRuntime: hasRuntime, guessInstallDir: guessInstallDir };
