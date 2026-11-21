#!/usr/bin/env node
/* breezell-offline :: 独立还原工具 (standalone rollback)
 * 不依赖 Breezell 扩展 —— 扩展被禁用或卸载后仍可用。
 * 用法:
 *   node rollback.js            # 还原全部
 *   node rollback.js --dry      # 只检查，不改
 *   node rollback.js --verify   # 还原后打印 sha256 比对
 * 退出码: 0 成功 / 1 有根目录无备份 / 2 参数错误
 */
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const BK_DIR = ".breezell-offline-backup";
const RELS = [
  ["out", "main.app.js"],
  ["out", "vs", "workbench", "workbench.desktop.main.js"],
  ["out", "vs", "workbench", "contrib", "breezell", "node", "agentHostMain.js"],
  ["product.json"]
];
const CHECKSUM_KEY = "vs/workbench/workbench.desktop.main.js";

function sha256b64(buf) { return crypto.createHash("sha256").update(buf).digest("base64").replace(/=+$/, ""); }
function hasRuntime(root) {
  return fs.existsSync(path.join(root, "out", "main.app.js")) &&
         fs.existsSync(path.join(root, "out", "vs", "workbench", "workbench.desktop.main.js"));
}
function guessInstallDir() {
  const cands = [];
  if (process.env.BREEZELL_INSTALL_DIR) cands.push(process.env.BREEZELL_INSTALL_DIR);
  if (process.execPath && /breezell/i.test(path.basename(process.execPath))) cands.push(path.dirname(process.execPath));
  if (process.env.LOCALAPPDATA) cands.push(path.join(process.env.LOCALAPPDATA, "Programs", "Breezell"));
  if (process.env.ProgramFiles) cands.push(path.join(process.env.ProgramFiles, "Breezell"));
  if (process.env["ProgramFiles(x86)"]) cands.push(path.join(process.env["ProgramFiles(x86)"], "Breezell"));
  if (process.env.ProgramW6432) cands.push(path.join(process.env.ProgramW6432, "Breezell"));
  cands.push(path.join(os.homedir(), "AppData", "Local", "Programs", "Breezell"));
  for (const d of cands) {
    if (!d) continue;
    if (hasRuntime(path.join(d, "resources", "app"))) return d;
    if (hasRuntime(d)) return d;
  }
  return cands[0] || "";
}
function installRoots(opts) {
  const base = (opts && opts.installDir) || guessInstallDir();
  const out = [];
  if (!base) return out;
  const cands = [path.join(base, "resources", "app"), base];
  for (const c of cands) if (hasRuntime(c) && out.indexOf(c) < 0) out.push(c);
  return out;
}
function hotRoots(opts) {
  const ad = (opts && opts.appData) || process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  const base = path.join(ad, "Breezell", "hot-runtime");
  const out = [];
  if (!fs.existsSync(base)) return out;
  let cur = null;
  try { cur = JSON.parse(fs.readFileSync(path.join(base, "current.json"), "utf8")).dir; } catch (e) {}
  if (cur) { const p = path.join(base, cur); if (hasRuntime(p)) out.push(p); }
  let names = [];
  try { names = fs.readdirSync(base); } catch (e) {}
  for (const n of names) {
    const p = path.join(base, n);
    try { if (!fs.statSync(p).isDirectory()) continue; } catch (e) { continue; }
    if (p === path.join(base, cur)) continue;
    if (hasRuntime(p) && out.indexOf(p) < 0) out.push(p);
  }
  return out;
}
function allTargets(opts) {
  const out = [];
  for (const r of installRoots(opts)) out.push({ label: "install", root: r });
  for (const r of hotRoots(opts)) out.push({ label: "hot-runtime:" + path.basename(r), root: r });
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  const dry = argv.indexOf("--dry") >= 0;
  const verify = argv.indexOf("--verify") >= 0;
  const lists = allTargets({});
  console.log("breezell-offline rollback :: " + new Date().toISOString());
  console.log("发现 " + lists.length + " 个运行时目录");
  console.log("");
  let restored = 0, missing = 0, ok = 0;
  for (const t of lists) {
    const dir = path.join(t.root, BK_DIR);
    console.log("=== [" + t.label + "] " + t.root);
    if (!fs.existsSync(dir)) { console.log("    (无备份目录,跳过)   " + dir); missing++; continue; }
    for (const rel of RELS) {
      const bak = path.join(dir, rel.join("__"));
      const dst = path.join(t.root, rel.join(path.sep));
      if (!fs.existsSync(bak)) { console.log("    [--] 备份缺失: " + rel.join("/")); continue; }
      if (!fs.existsSync(dst)) { console.log("    [--] 目标缺失: " + rel.join("/")); continue; }
      const before = sha256b64(fs.readFileSync(dst));
      const want = sha256b64(fs.readFileSync(bak));
      if (before === want) { console.log("    [ok] 已是原始: " + rel.join("/")); ok++; continue; }
      if (dry) { console.log("    [dry] 待还原: " + rel.join("/") + "  " + before.slice(0, 12) + " -> " + want.slice(0, 12)); restored++; continue; }
      fs.copyFileSync(bak, dst);
      const after = sha256b64(fs.readFileSync(dst));
      if (verify) console.log("    [->] " + rel.join("/") + "  " + after.slice(0, 12) + (after === want ? "  OK" : "  MISMATCH!"));
      else console.log("    [->] 已还原: " + rel.join("/"));
      restored++;
    }
    console.log("");
  }
  console.log("----");
  console.log("还原 " + restored + " 个文件, 原本已是原始 " + ok + " 个, 无备份目录 " + missing + " 个");
  if (restored > 0 && !dry) console.log("请完全退出并重启 Breezell 使改动生效。");
  return missing > 0 && restored === 0 ? 1 : 0;
}
process.exit(main());
