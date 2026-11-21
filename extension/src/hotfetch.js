"use strict";
/* breezell-offline :: hotfetch —— 官方热更新跟进（下载/校验/解包/挂接/回滚） 
 *
 * 关键事实（逆向自 out/main.app.js 的 hotRuntime / hotUpdateInstaller 模块）：
 *   GET  {backend}/api/hot-updates/versions?baseVersion=&platform=&quality=
 *   GET  {backend}/api/hot-updates/latest?baseVersion=&current=&platform=&quality=&rollback=1
 *   zip 解到 %APPDATA%\Breezell\hot-runtime\<version>-<sha256[0..12]>\，写 .ready
 *   runtime 内 extensions / node_modules / resources 是指向安装目录的 junction（真实新增的只有 out/ + package.json + product.json）
 *   current.json 由主进程拾取；bootAttempts>=2 会自动回退
 *
 * 本模块把这条链复刻成「离线可审计」的版本：下载->sha256 校验->解包->补 junction->写 .ready->原子切换 current.json。
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cp = require("child_process");
const https = require("https");

const APP = function () { return process.env.APPDATA || ""; };
const HOT_ROOT = function () { return path.join(APP(), "Breezell", "hot-runtime"); };
const LINKS = ["extensions", "node_modules", "resources"];
const MAX_BOOT_ATTEMPTS = 2;

/* ---------------- current.json ---------------- */

function currentPath() { return path.join(HOT_ROOT(), "current.json"); }

function readCurrent() {
  try {
    const j = JSON.parse(fs.readFileSync(currentPath(), "utf8"));
    if (j && typeof j === "object") return Object.assign({ version: "", baseVersion: "", dir: "", bootAttempts: 0, failedVersions: [] }, j);
  } catch (e) {}
  return { version: "", baseVersion: "", dir: "", bootAttempts: 0, failedVersions: [] };
}

function writeCurrent(obj) {
  const p = currentPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, "\t"), "utf8");
  fs.renameSync(tmp, p);
}

function dirNameFor(version, sha) {
  return /^[0-9a-f]{64}$/i.test(String(sha || "")) ? version + "-" + String(sha).slice(0, 12) : version;
}

function listRuntimes() {
  const base = HOT_ROOT();
  let names = [];
  try { names = fs.readdirSync(base, { withFileTypes: true }).filter(function (d) { return d.isDirectory(); }).map(function (d) { return d.name; }); } catch (e) { return []; }
  return names.map(function (n) {
    const full = path.join(base, n);
    const complete = fs.existsSync(path.join(full, "out", "main.app.js")) && fs.existsSync(path.join(full, ".ready"));
    const half = fs.existsSync(path.join(full, "out", "main.app.js")) && !fs.existsSync(path.join(full, ".ready"));
    let version = n;
    let m = /^([0-9]+(?:\.[0-9]+){1,3})(?:-([0-9a-f]{12}))?$/.exec(n);
    if (m) version = m[1];
    let sizeBytes = 0;
    try { sizeBytes = dirSize(full); } catch (e) {}
    return { name: n, dir: full, version: version, complete: complete, halfInstalled: half, sizeBytes: sizeBytes };
  }).sort(function (a, b) { return cmpVersion(b.version, a.version); });
}

function dirSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let ents = [];
    try { ents = fs.readdirSync(cur, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of ents) {
      const f = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(f);
      else { try { total += fs.statSync(f).size; } catch (er) {} }
    }
  }
  return total;
}

/* ---------------- 版本比较 ---------------- */

function cmpVersion(a, b) {
  const pa = String(a || "").split(".").map(function (x) { return parseInt(x, 10) || 0; });
  const pb = String(b || "").split(".").map(function (x) { return parseInt(x, 10) || 0; });
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

function isVersion(s) { return typeof s === "string" && /^[0-9]+(?:\.[0-9]+){1,3}$/.test(s); }

/* ---------------- 下载 ---------------- */

function download(url, dest, opts) {
  opts = opts || {};
  return new Promise(function (resolve) {
    const tmp = dest + ".part";
    const file = fs.createWriteStream(tmp);
    let done = false;
    const finish = function (r) {
      if (done) return;
      done = true;
      file.close(function () {
        if (r.ok) { try { fs.renameSync(tmp, dest); } catch (e) { return resolve({ ok: false, error: "rename: " + e.message }); } }
        else { try { fs.unlinkSync(tmp); } catch (e) {} }
        resolve(r);
      });
    };
    let u;
    try { u = new URL(url); } catch (e) { return resolve({ ok: false, error: "bad-url" }); }
    const req = (u.protocol === "https:" ? https : require("http")).get(u, {
      headers: Object.assign({ "User-Agent": "Breezell-Offline-Panel/2.0" }, opts.headers || {}),
      timeout: opts.timeoutMs || 120000
    }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, u).toString();
        return download(next, dest, opts).then(finish);
      }
      if (res.statusCode !== 200) { res.resume(); return finish({ ok: false, status: res.statusCode, error: "HTTP " + res.statusCode }); }
      const total = Number(res.headers["content-length"] || 0);
      let got = 0, lastTick = 0;
      res.on("data", function (d) {
        got += d.length;
        const now = Date.now();
        if (opts.onProgress && (now - lastTick > 400 || got === total)) { lastTick = now; opts.onProgress({ got: got, total: total }); }
      });
      res.pipe(file);
      res.on("end", function () { finish({ ok: true, bytes: got, total: total }); });
      res.on("error", function (e) { finish({ ok: false, error: String(e.message || e) }); });
    });
    req.on("timeout", function () { req.destroy(new Error("timeout")); });
    req.on("error", function (e) {
      if (opts.signal && opts.signal.aborted) return finish({ ok: false, error: "aborted" });
      finish({ ok: false, error: String((e && e.message) || e) });
    });
    if (opts.signal) {
      opts.signal.addEventListener("abort", function () { try { req.destroy(); } catch (e) {} finish({ ok: false, error: "aborted" }); }, { once: true });
    }
  });
}

function sha256File(file) {
  return new Promise(function (resolve, reject) {
    const h = crypto.createHash("sha256");
    const st = fs.createReadStream(file);
    st.on("data", function (d) { h.update(d); });
    st.on("end", function () { resolve(h.digest("hex")); });
    st.on("error", reject);
  });
}

/* ---------------- 解包（优先用运行时自带的 yauzl，退化为 PowerShell） ---------------- */

function nodeModulesDirs() {
  const dirs = [];
  const appRoot = path.join(process.env.LOCALAPPDATA || "", "Programs", "Breezell", "resources", "app", "node_modules");
  dirs.push(appRoot);
  return dirs;
}

function findYauzl() {
  const cands = [];
  try { cands.push(require.resolve("yauzl")); } catch (e) {}
  nodeModulesDirs().forEach(function (d) {
    cands.push(path.join(d, "yauzl"));
  });
  for (const c of cands) {
    try { const m = require(c); if (m && (m.openPromise || m.open)) return m; } catch (e) {}
  }
  return null;
}

async function extractZip(zipPath, destDir, onProgress) {
  fs.mkdirSync(destDir, { recursive: true });
  const yauzl = findYauzl();
  if (yauzl) {
    try {
      const zip = await (yauzl.openPromise ? yauzl.openPromise(zipPath, { lazyEntries: true }) : new Promise(function (res, rej) {
        yauzl.open(zipPath, { lazyEntries: true }, function (e, z) { e ? rej(e) : res(z); });
      }));
      let count = 0;
      await new Promise(function (resolve, reject) {
        zip.on("error", reject);
        zip.on("end", resolve);
        zip.on("entry", function (entry) {
          const name = entry.fileName;
          if (/\/$/.test(name)) {
            zip.readEntry();
            return;
          }
          const target = path.join(destDir, name);
          if (!target.startsWith(destDir)) { zip.readEntry(); return; }
          zip.openReadStream(entry, function (err, rs) {
            if (err) return reject(err);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            const ws = fs.createWriteStream(target);
            rs.pipe(ws);
            ws.on("close", function () {
              count++;
              if (onProgress && count % 50 === 0) onProgress({ entries: count });
              zip.readEntry();
            });
            ws.on("error", reject);
          });
        });
        zip.readEntry();
      });
      return { ok: true, entries: count, via: "yauzl" };
    } catch (e) { /* 落到 PowerShell */ }
  }
  try {
    cp.execFileSync("powershell", ["-NoProfile", "-Command",
      "Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory('" + zipPath.replace(/'/g, "''") + "','" + destDir.replace(/'/g, "''") + "')"],
      { stdio: "ignore", timeout: 300000 });
    return { ok: true, entries: -1, via: "powershell" };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

/* ---------------- 目录链接（junction） ---------------- */

function ensureLink(linkPath, target) {
  try {
    const lst = fs.lstatSync(linkPath);
    if (lst.isSymbolicLink()) return { ok: true, existed: true };
    if (fs.existsSync(target)) {
      /* 已存在实体目录且目标也在：保留实体，不链接（更安全） */
      return { ok: true, existed: true, real: true };
    }
  } catch (e) {
    /* 不存在，创建 */
  }
  if (!fs.existsSync(target)) return { ok: false, error: "target missing: " + target };
  try {
    fs.symlinkSync(target, linkPath, "junction");
    return { ok: true, created: true };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

/* 判断某个重解析点是否指向安装目录（保护目标） */
const PROTECTED_ROOTS = (function () {
  const out = [];
  try {
    const local = process.env.LOCALAPPDATA || "";
    if (local) {
      const app = path.join(local, "Programs", "Breezell");
      out.push(path.resolve(app));
      out.push(path.resolve(path.join(app, "resources", "app")));
    }
  } catch (e) {}
  return out;
})();

function isUnderProtected(p) {
  let abs;
  try { abs = path.resolve(p); } catch (e) { return true; }
  for (const r of PROTECTED_ROOTS) {
    if (abs === r) return true;
    if (abs.startsWith(r + path.sep)) return true;
  }
  return false;
}

/*
 * 安全删除单个条目：绝不跟随 junction / symlink。
 * 修复点：旧实现用 fs.rmSync(recursive:true)，在 Windows 上会穿过 junction
 * 递归删除链接目标（即安装目录 node_modules / resources 的真实内容）。
 */
function removeEntryNoFollow(p) {
  let st;
  try { st = fs.lstatSync(p); } catch (e) { return; }

  /* junction / symlink：只摘链接本身 */
  if (st.isSymbolicLink()) {
    try { fs.rmdirSync(p); return; } catch (e) {}
    try { fs.unlinkSync(p); return; } catch (e) {}
    return;
  }

  if (st.isDirectory()) {
    let names = [];
    try { names = fs.readdirSync(p); } catch (e) { return; }
    for (const n of names) removeEntryNoFollow(path.join(p, n));
    try { fs.rmdirSync(p); } catch (e) {}
    return;
  }

  try { fs.unlinkSync(p); } catch (e) {}
}

function removeDirSafe(dir, onLog) {
  /* 目录不存在：视为已清理 */
  let st;
  try { st = fs.lstatSync(dir); } catch (e) { return true; }

  /* 保护：绝不删除安装目录本体或其上级 */
  if (isUnderProtected(dir) && PROTECTED_ROOTS.indexOf(path.resolve(dir)) !== -1) {
    return false;
  }

  /* 保险丝：删除前后对 junction 目标做文件数快照，任何减少都视为事故 */
  const before = protectedSnapshot();
  try { removeEntryNoFollow(dir); } catch (e) {}
  const diffs = protectedDelta(before);
  if (diffs.length) {
    if (onLog) onLog("!! [ERROR] 删除后安装目录文件数减少：" + diffs.join(", ") + "（已中止，请立即用官方安装包恢复内建扩展）");
  }

  /* 以“是否真的消失”作为成功判据 */
  try { fs.lstatSync(dir); return false; } catch (e) { return diffs.length ? false : true; }
}

/* ---- 保护目标快照：junction 指向的安装目录真实内容，删除前后必须一致 ---- */
const PROTECTED_SUBDIRS = ["extensions", "node_modules", "resources", "out"];
function countFilesDeep(dir) {
  let n = 0;
  const walk = function (p) {
    let s;
    try { s = fs.lstatSync(p); } catch (e) { return; }
    if (s.isSymbolicLink()) return; /* 不穿过链接，避免把外部内容算进来 */
    if (s.isDirectory()) {
      let names = [];
      try { names = fs.readdirSync(p); } catch (e) { return; }
      for (const x of names) walk(path.join(p, x));
      return;
    }
    n++;
  };
  walk(dir);
  return n;
}
function protectedSnapshot() {
  const out = {};
  const appRoot = PROTECTED_ROOTS.filter(function (r) { return /[\\\/]app$/.test(r); })[0];
  if (!appRoot) return out;
  for (const sub of PROTECTED_SUBDIRS) {
    const p = path.join(appRoot, sub);
    if (fs.existsSync(p)) out[sub] = countFilesDeep(p);
  }
  return out;
}
function protectedDelta(before) {
  const diffs = [];
  const after = protectedSnapshot();
  for (const k in before) {
    if (typeof after[k] === "number" && after[k] < before[k]) diffs.push(k + " " + before[k] + "->" + after[k]);
  }
  return diffs;
}

/* ---------------- 清单查询 ---------------- */

function requestJson(url, headers) {
  return new Promise(function (resolve) {
    let u;
    try { u = new URL(url); } catch (e) { return resolve({ ok: false, error: "bad-url" }); }
    const req = (u.protocol === "https:" ? https : require("http")).get(u, { headers: Object.assign({ "Accept": "application/json", "User-Agent": "Breezell-Offline-Panel/2.0" }, headers || {}), timeout: 25000 }, function (res) {
      const c = [];
      res.on("data", function (d) { c.push(d); });
      res.on("end", function () {
        const t = Buffer.concat(c).toString("utf8");
        let j = null;
        try { j = JSON.parse(t); } catch (e) {}
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json: j, text: t });
      });
    });
    req.on("timeout", function () { req.destroy(new Error("timeout")); });
    req.on("error", function (e) { resolve({ ok: false, status: 0, error: String(e.message || e) }); });
  });
}

async function listVersions(o) {
  o = o || {};
  const base = String(o.backend || "https://api.breezell.com").replace(/\/$/, "");
  const qs = new URLSearchParams({ baseVersion: o.baseVersion || "", platform: o.platform || "win32-x64", quality: o.quality || "stable" });
  const r = await requestJson(base + "/api/hot-updates/versions?" + qs.toString(), { "X-Breezell-Version": o.version || "" });
  if (!r.ok || !r.json) return { ok: false, error: r.error || ("HTTP " + r.status) };
  const d = r.json.data || r.json;
  const versions = Array.isArray(d.versions) ? d.versions : [];
  return { ok: true, versions: versions, withdrawn: Array.isArray(d.withdrawn) ? d.withdrawn : [] };
}

async function latestVersion(o) {
  o = o || {};
  const base = String(o.backend || "https://api.breezell.com").replace(/\/$/, "");
  const qs = new URLSearchParams({
    baseVersion: o.baseVersion || "", current: o.current || "",
    platform: o.platform || "win32-x64", quality: o.quality || "stable", rollback: "1"
  });
  if (o.sha256) qs.set("sha256", o.sha256);
  const r = await requestJson(base + "/api/hot-updates/latest?" + qs.toString(), { "X-Breezell-Version": o.version || "" });
  if (!r.ok) return { ok: false, error: r.error || ("HTTP " + r.status) };
  if (r.status === 204) return { ok: true, manifest: null };
  const d = (r.json && (r.json.data || r.json)) || null;
  return { ok: true, manifest: d };
}

/* ---------------- 安装 / 切换 ---------------- */

async function install(o) {
  o = o || {};
  const manifest = o.manifest;
  if (!manifest || !isVersion(manifest.version) || !manifest.url) return { ok: false, error: "清单不完整（缺 version/url）" };
  const baseVer = o.baseVersion || manifest.baseVersion;
  if (manifest.baseVersion && baseVer && manifest.baseVersion !== baseVer) {
    return { ok: false, error: "该热更新基于 " + manifest.baseVersion + "，当前程序基底是 " + baseVer + "，不能安装（需先装整包）" };
  }
  const dirName = dirNameFor(manifest.version, manifest.sha256);
  const dest = path.join(HOT_ROOT(), dirName);
  const cacheZip = path.join(APP(), "Breezell", "hot-cache", "breezell-hot-" + manifest.version + ".zip");
  fs.mkdirSync(path.dirname(cacheZip), { recursive: true });

  const steps = [];
  const log = function (m) { steps.push("[" + new Date().toISOString() + "] " + m); if (o.onLog) o.onLog(m); };

  let zipOk = false;
  if (fs.existsSync(cacheZip)) {
    const cur = await sha256File(cacheZip);
    if (!manifest.sha256 || cur === String(manifest.sha256).toLowerCase()) { zipOk = true; log("本地缓存命中（sha256 校验通过）"); }
    else { log("本地缓存 sha256 不符，重新下载"); try { fs.unlinkSync(cacheZip); } catch (e) {} }
  }
  if (!zipOk) {
    log("下载 " + manifest.url);
    const dl = await download(manifest.url, cacheZip, { onProgress: o.onProgress, signal: o.signal });
    if (!dl.ok) return { ok: false, error: "下载失败：" + dl.error, steps: steps };
    log("下载完成 " + (dl.bytes || 0) + " B");
    if (manifest.sha256) {
      const h = await sha256File(cacheZip);
      if (h !== String(manifest.sha256).toLowerCase()) {
        try { fs.unlinkSync(cacheZip); } catch (e) {}
        return { ok: false, error: "sha256 校验失败：期望 " + manifest.sha256 + " 实际 " + h, steps: steps };
      }
      log("sha256 校验通过");
    } else {
      log("清单未给 sha256，跳过校验");
    }
  }

  if (fs.existsSync(dest)) {
    log("目标目录已存在，先清理：" + dest);
    if (!removeDirSafe(dest, log)) return { ok: false, error: "无法清理旧目录（可能正在运行，或清理触及受保护目录已被保险丝中止）", steps: steps };
  }
  fs.mkdirSync(dest, { recursive: true });
  log("解包到 " + dest);
  const ex = await extractZip(cacheZip, dest, o.onProgress);
  if (!ex.ok) { removeDirSafe(dest, log); return { ok: false, error: "解包失败：" + ex.error, steps: steps }; }
  log("解包完成（" + ex.via + "，" + ex.entries + " 项）");

  /* 完整性闸门：缺任一关键文件即视为半装，绝不写 .ready */
  const required = ["package.json", "product.json", path.join("out", "main.js"), path.join("out", "main.app.js"), path.join("out", "vs", "workbench", "workbench.desktop.main.js")];
  const missing = required.filter(function (rel) { return !fs.existsSync(path.join(dest, rel)); });
  if (missing.length) {
    log("!! [ERROR] 解包不完整，缺少：" + missing.join(", "));
    removeDirSafe(dest, log);
    return { ok: false, error: "解包不完整（缺少 " + missing.join(", ") + "），已丢弃该目录", steps: steps };
  }

  /* 补 junction：runtime 需要 extensions / node_modules / resources */
  const appOut = o.installAppRoot; /* ...\resources\app */
  if (appOut && fs.existsSync(appOut)) {
    for (const name of LINKS) {
      const target = path.join(appOut, name);
      const linkPath = path.join(dest, name);
      if (!fs.existsSync(target)) continue;
      if (fs.existsSync(linkPath)) continue;
      const r = ensureLink(linkPath, target);
      log("链接 " + name + " -> " + target + " : " + (r.ok ? (r.created ? "created" : "existed") : ("FAIL " + r.error)));
    }
  }

  /* 版本一致性检查（与官方 installer 同规则） */
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    if (pkg.breezellVersion && pkg.breezellVersion !== manifest.version) {
      log("警告：package.json breezellVersion=" + pkg.breezellVersion + " 与清单 " + manifest.version + " 不一致");
    }
    if (pkg.breezellBaseVersion && baseVer && pkg.breezellBaseVersion !== baseVer) {
      removeDirSafe(dest, log);
      return { ok: false, error: "包内 baseVersion 是 " + pkg.breezellBaseVersion + "，与当前 " + baseVer + " 不符", steps: steps };
    }
  } catch (e) { log("读取 package.json 失败：" + e.message); }

  fs.writeFileSync(path.join(dest, ".ready"), new Date().toISOString(), "utf8");
  log("已写 .ready");

  if (o.writeCurrent !== false) {
    const cur = readCurrent();
    const next = {
      version: manifest.version,
      baseVersion: baseVer,
      dir: dirName,
      bootAttempts: 0,
      failedVersions: (cur.failedVersions || []).filter(function (v) { return v !== manifest.version && v !== dirName; }),
      previousVersion: cur.version && cur.version !== manifest.version ? cur.version : cur.previousVersion,
      sha256: manifest.sha256 || ""
    };
    writeCurrent(next);
    log("current.json 已切换 -> " + dirName + "（下次启动生效）");
  }
  return { ok: true, dir: dest, dirName: dirName, version: manifest.version, cached: cacheZip, steps: steps };
}

function switchTo(dirName) {
  const dest = path.join(HOT_ROOT(), dirName);
  if (!fs.existsSync(path.join(dest, "out", "main.app.js")) || !fs.existsSync(path.join(dest, ".ready"))) {
    return { ok: false, error: "该运行时未完整安装（缺 out/main.app.js 或 .ready）" };
  }
  const cur = readCurrent();
  const m = /^([0-9]+(?:\.[0-9]+){1,3})/.exec(dirName);
  const next = Object.assign({}, cur, {
    version: m ? m[1] : cur.version, dir: dirName, bootAttempts: 0,
    previousVersion: cur.dir && cur.dir !== dirName ? cur.version : cur.previousVersion
  });
  writeCurrent(next);
  return { ok: true, current: next };
}

function removeRuntime(dirName) {
  const dir = path.join(HOT_ROOT(), dirName);
  const cur = readCurrent();
  if (cur.dir === dirName) return { ok: false, error: "当前正在使用该运行时，不能删除" };
  if (!fs.existsSync(dir)) return { ok: false, error: "目录不存在" };
  const ok = removeDirSafe(dir, function (m) { try { log(m); } catch (e) {} });
  return ok ? { ok: true } : { ok: false, error: "删除失败（文件被占用？）" };
}

function status(o) {
  o = o || {};
  const cur = readCurrent();
  const runtimes = listRuntimes();
  return {
    ok: true,
    hotRoot: HOT_ROOT(),
    current: cur,
    runningDir: cur.dir ? path.join(HOT_ROOT(), cur.dir) : "",
    runningComplete: cur.dir ? runtimes.some(function (r) { return r.name === cur.dir && r.complete; }) : false,
    runtimes: runtimes,
    baseVersion: o.baseVersion || cur.baseVersion || "",
    version: o.version || cur.version || ""
  };
}

module.exports = {
  HOT_ROOT: HOT_ROOT, readCurrent: readCurrent, writeCurrent: writeCurrent, listRuntimes: listRuntimes,
  listVersions: listVersions, latestVersion: latestVersion, install: install, switchTo: switchTo,
  removeRuntime: removeRuntime, status: status, dirNameFor: dirNameFor, cmpVersion: cmpVersion,
  sha256File: sha256File, download: download, extractZip: extractZip, ensureLink: ensureLink,
  removeDirSafe: removeDirSafe, MAX_BOOT_ATTEMPTS: MAX_BOOT_ATTEMPTS, protectedSnapshot: protectedSnapshot, protectedDelta: protectedDelta, countFilesDeep: countFilesDeep
};
