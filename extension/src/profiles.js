"use strict";
/* breezell-offline :: 配置管理（profiles）v2.6.0
 *
 * 目的：把「这个插件能改的所有东西」做成可命名的多套配置，下拉切换、增删改复制、
 * 导入导出、整包迁移，而不是每次手改同一个 json。
 *
 * 一份配置（profile）现在覆盖四块：
 *   1) prompts  —— 系统提示词 / 追加块 / 6 个模式覆盖
 *   2) flags    —— 配置文件里的所有布尔开关（自动遍历，新增 flag 自动带上）
 *   3) browser  —— 内置浏览器首页
 *   4) settings —— VS Code 设置里的 9 个 breezellOffline.* 键
 * 第 4 块是 v2.6.0 新增的：以前切配置不动编辑器设置，导致「复制到另一台机器」缺一半。
 *
 * 落盘位置：%APPDATA%\Breezell\breezell-offline-profiles\<name>.json
 * 其中 <name> 经过 sanitize（只保留字母数字-_和中文，避免路径穿越）。
 *
 * 与现网配置的关系：breezell-offline-config.json 仍然是「当前生效」的唯一载体
 * （F15/F16 桥和 30s 轮询只读它），profile 只是它的快照仓库。切换 profile =
 * 把该 profile 的内容写进 config（+ 写 vscode 设置）。这样热更新/重载窗口行为不变。
 *
 * 整包（bundle）用于跨机器迁移：一个 json 里装下所有 profile + 当前 config + 当前设置。
 */
const fs = require("fs");
const path = require("path");

var DIR = path.join(process.env.APPDATA || "", "Breezell", "breezell-offline-profiles");
var META = path.join(DIR, "_index.json");
var MAX_NAME = 60;

function sanitize(name) {
  var s = String(name || "").trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_");
  s = s.replace(/^\.+/, "").slice(0, MAX_NAME);
  return s || "";
}

function ensureDir() {
  try { fs.mkdirSync(DIR, { recursive: true }); } catch (e) {}
  return DIR;
}

function fileOf(name) {
  var s = sanitize(name);
  if (!s) return null;
  return path.join(DIR, s + ".json");
}

function list() {
  ensureDir();
  var out = [];
  var names = [];
  try { names = fs.readdirSync(DIR); } catch (e) { names = []; }
  for (var i = 0; i < names.length; i++) {
    var f = names[i];
    if (!/\.json$/i.test(f)) continue;
    if (f.charAt(0) === "_") continue;
    var p = path.join(DIR, f);
    var st;
    try { st = fs.statSync(p); } catch (e) { continue; }
    if (!st.isFile()) continue;
    var obj = null;
    try { obj = JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { obj = null; }
    out.push({
      name: f.replace(/\.json$/i, ""),
      file: p,
      size: st.size,
      at: st.mtime.toISOString(),
      valid: !!obj,
      sysLen: obj && obj.prompts && typeof obj.prompts.systemPrompt === "string" ? obj.prompts.systemPrompt.length : 0,
      extraLen: obj && obj.prompts && typeof obj.prompts.extraBlock === "string" ? obj.prompts.extraBlock.length : 0,
      modes: obj && obj.prompts && obj.prompts.modes ? Object.keys(obj.prompts.modes).length : 0,
      updatedAt: (obj && obj.updatedAt) || null
    });
  }
  out.sort(function (a, b) { return a.name.localeCompare(b.name); });
  return out;
}

function readMeta() {
  try { return JSON.parse(fs.readFileSync(META, "utf8")) || {}; } catch (e) { return {}; }
}

function writeMeta(o) {
  ensureDir();
  try { fs.writeFileSync(META, JSON.stringify(o || {}, null, 1), "utf8"); return true; } catch (e) { return false; }
}

function active() {
  var m = readMeta();
  return m && m.active ? String(m.active) : "";
}

function setActive(name) {
  var m = readMeta();
  m.active = sanitize(name);
  return writeMeta(m);
}

function load(name) {
  var p = fileOf(name);
  if (!p) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return null; }
}

/* 只保存「可移植」的部分：prompts + flags + browser + settings，外加元信息。
 * settings 由调用方传进来（本模块不认识 vscode API），v2.6.0 新增。 */
function snapshot(cfgObj, note, settings) {
  var o = {
    _fmt: "breezell-offline-profile/2",
    name: "",
    note: String(note || ""),
    updatedAt: new Date().toISOString(),
    prompts: {
      systemPrompt: (cfgObj && cfgObj.prompts && cfgObj.prompts.systemPrompt) || "",
      extraBlock: (cfgObj && cfgObj.prompts && cfgObj.prompts.extraBlock) || "",
      modes: (cfgObj && cfgObj.prompts && cfgObj.prompts.modes) || {}
    },
    flags: {},
    browser: { home: (cfgObj && cfgObj.browser && cfgObj.browser.home) || "" },
    settings: {}
  };
  var fl = (cfgObj && cfgObj.flags) || {};
  for (var k in fl) if (Object.prototype.hasOwnProperty.call(fl, k)) o.flags[k] = !!fl[k];
  var se = settings || {};
  for (var s in se) if (Object.prototype.hasOwnProperty.call(se, s)) o.settings[s] = se[s];
  return o;
}

function save(name, cfgObj, note, settings) {
  var p = fileOf(name);
  if (!p) return { ok: false, error: "invalid-name" };
  ensureDir();
  var o = snapshot(cfgObj, note, settings);
  o.name = sanitize(name);
  try {
    fs.writeFileSync(p, JSON.stringify(o, null, 2), "utf8");
    return { ok: true, file: p, name: o.name };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

function writeRaw(name, obj) {
  var p = fileOf(name);
  if (!p) return { ok: false, error: "invalid-name" };
  if (!obj || typeof obj !== "object") return { ok: false, error: "invalid-content" };
  ensureDir();
  try {
    fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
    return { ok: true, file: p, name: sanitize(name) };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

function remove(name) {
  var p = fileOf(name);
  if (!p) return { ok: false, error: "invalid-name" };
  try {
    if (!fs.existsSync(p)) return { ok: false, error: "not-found" };
    fs.unlinkSync(p);
    if (active() === sanitize(name)) setActive("");
    return { ok: true };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

function rename(oldName, newName) {
  var a = fileOf(oldName), b = fileOf(newName);
  if (!a || !b) return { ok: false, error: "invalid-name" };
  if (!fs.existsSync(a)) return { ok: false, error: "not-found" };
  if (fs.existsSync(b)) return { ok: false, error: "exists" };
  try {
    fs.renameSync(a, b);
    var obj = null;
    try { obj = JSON.parse(fs.readFileSync(b, "utf8")); } catch (e) { obj = null; }
    if (obj) { obj.name = sanitize(newName); try { fs.writeFileSync(b, JSON.stringify(obj, null, 2), "utf8"); } catch (e2) {} }
    if (active() === sanitize(oldName)) setActive(newName);
    return { ok: true, name: sanitize(newName) };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

function duplicate(srcName, dstName) {
  var o = load(srcName);
  if (!o) return { ok: false, error: "not-found" };
  var p = fileOf(dstName || (sanitize(srcName) + "-copy"));
  if (!p) return { ok: false, error: "invalid-name" };
  if (fs.existsSync(p)) return { ok: false, error: "exists" };
  return writeRaw(path.basename(p, ".json"), o);
}

/* 导入：接受 profile 文件本体，也接受整份 breezell-offline-config.json */
function importObj(raw, name) {
  var o = raw;
  if (typeof o === "string") { try { o = JSON.parse(o); } catch (e) { return { ok: false, error: "invalid-json" }; } }
  if (!o || typeof o !== "object") return { ok: false, error: "invalid-content" };
  var prof;
  if (o._fmt === "breezell-offline-profile/1" || o._fmt === "breezell-offline-profile/2" || (o.prompts && !o.flags && !o.updatedAt)) {
    prof = snapshot(o, o.note, o.settings);
  } else if (o.prompts || o.flags) {
    prof = snapshot(o, o.note, o.settings);   /* 整份 cfg */
  } else {
    return { ok: false, error: "unrecognized-format" };
  }
  var nm = name || o.name || prof.name || "imported";
  var r = writeRaw(nm, prof);
  if (r.ok) { return { ok: true, name: r.name, file: r.file }; }
  return r;
}

function exportObj(name) {
  var o = load(name);
  if (!o) return null;
  var c = JSON.parse(JSON.stringify(o));
  c.exportedAt = new Date().toISOString();
  c._fmt = "breezell-offline-profile/2";
  return c;
}

/* ---- 整包（跨机器迁移用）：所有 profile + 当前 config + 当前 vscode 设置 ---- */
var BUNDLE_FMT = "breezell-offline-bundle/1";

function bundle() {
  var items = list(), out = [];
  for (var i = 0; i < items.length; i++) {
    var o = load(items[i].name);
    if (o) out.push(o);
  }
  return {
    _fmt: BUNDLE_FMT,
    exportedAt: new Date().toISOString(),
    platform: process.platform,
    active: active(),
    profiles: out
  };
}

/* 恢复整包：profiles 全部写入（同名覆盖），返回写入的名字列表 */
function restoreBundle(obj) {
  if (!obj || typeof obj !== "object") return { ok: false, error: "invalid-content" };
  var arr = obj.profiles;
  if (!Array.isArray(arr)) return { ok: false, error: "no-profiles" };
  var wrote = [], failed = [];
  for (var i = 0; i < arr.length; i++) {
    var o = arr[i];
    if (!o || typeof o !== "object") { failed.push("#" + i); continue; }
    var nm = sanitize(o.name || ("imported-" + (i + 1)));
    if (!nm) { failed.push("#" + i + "(bad-name)"); continue; }
    var r = writeRaw(nm, o);
    if (r.ok) wrote.push(r.name); else failed.push(nm);
  }
  if (obj.active && wrote.indexOf(sanitize(obj.active)) >= 0) setActive(obj.active);
  return { ok: true, wrote: wrote, failed: failed, active: active() };
}

function bundleInfo(obj) {
  if (!obj || typeof obj !== "object" || !Array.isArray(obj.profiles)) return null;
  return { fmt: obj._fmt || "", count: obj.profiles.length, active: obj.active || "", exportedAt: obj.exportedAt || "" };
}

module.exports = {
  DIR: DIR,
  sanitize: sanitize,
  list: list,
  load: load,
  save: save,
  writeRaw: writeRaw,
  remove: remove,
  rename: rename,
  duplicate: duplicate,
  importObj: importObj,
  exportObj: exportObj,
  active: active,
  setActive: setActive,
  snapshot: snapshot,
  bundle: bundle,
  restoreBundle: restoreBundle,
  bundleInfo: bundleInfo,
  BUNDLE_FMT: BUNDLE_FMT
};
