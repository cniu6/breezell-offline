#!/usr/bin/env node
/**
 * sync-repo.js — 把工作副本镜像进 Git 仓库（单向）
 *
 *   源：patch\breezell-offline\pkg                （真正在用的源码）
 *   目标：repo\breezell-offline                    （要提交的仓库）
 *
 * 用法：
 *   node tools\sync-repo.js              只同步扩展本体（extension/ + 两个根文件）
 *   node tools\sync-repo.js --docs       同时同步 docs（分析报告/清单/生成器）
 *   node tools\sync-repo.js --release    同时同步最新 vsix 到 release/
 *   node tools\sync-repo.js --all --check  全量比对，只报差异不写盘
 *
 * 规则：
 *   - 单向：pkg 是权威，仓库里多出来的文件会被删除（镜像语义）
 *   - 只镜像 extension/ 与两个根文件；README / CHANGELOG / docs / tools / release 不受影响
 *   - 写盘前先验版本三处一致（appPatcher VERSION / package.json / vsixmanifest 两处）
 *   - 有未提交改动只提示，不阻断
 */
"use strict";

const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const REPO = path.resolve(__dirname, "..");
const WORK = path.resolve(REPO, "..", "..");
const PKG = path.join(WORK, "patch", "breezell-offline", "pkg");
const DELIVERY = path.join(WORK, "离线破解插件成品");

const argv = process.argv.slice(2);
const has = (f) => argv.indexOf(f) >= 0;
const CHECK = has("--check");
const DOCS = has("--docs") || has("--all");
const RELEASE = has("--release") || has("--all");

/* ---------- 小工具 ---------- */

function read(p) {
  return fs.readFileSync(p, "utf8");
}
function stat(p) {
  try {
    return fs.statSync(p);
  } catch (e) {
    return null;
  }
}
function walk(dir, base, out) {
  base = base || dir;
  out = out || [];
  if (!stat(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else out.push(path.relative(base, p).split(path.sep).join("/"));
  }
  return out;
}
function same(a, b) {
  const sa = stat(a), sb = stat(b);
  if (!sa || !sb) return false;
  if (sa.size !== sb.size) return false;
  return Buffer.compare(fs.readFileSync(a), fs.readFileSync(b)) === 0;
}
function ensureDir(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}
function die(msg) {
  console.error("✗ " + msg);
  process.exit(1);
}

/* ---------- 版本一致性 ---------- */

function checkVersions() {
  const pkgJson = path.join(PKG, "extension", "package.json");
  const patcher = path.join(PKG, "extension", "src", "appPatcher.js");
  const manifest = path.join(PKG, "extension.vsixmanifest");
  for (const p of [pkgJson, patcher, manifest]) if (!stat(p)) die("缺少文件：" + p);

  const pkgVer = JSON.parse(read(pkgJson)).version;
  const patcherVer = (read(patcher).match(/const VERSION\s*=\s*"([^"]+)"/) || [])[1];
  const manifestVers = read(manifest).match(/Version="([^"]+)"/g) || [];
  const ids = manifestVers.map((s) => s.replace(/Version="|"/g, ""));

  const uniq = Array.from(new Set(ids));
  const ok = pkgVer && patcherVer && uniq.length === 1 && uniq[0] === pkgVer && patcherVer === pkgVer;

  console.log("版本：package.json=" + pkgVer + "  appPatcher=" + patcherVer + "  vsixmanifest=" + uniq.join("/"));
  if (!ok) {
    die(
      "三处版本不一致，先统一：\n" +
        "  extension/src/appPatcher.js   const VERSION = \"" + pkgVer + "\";\n" +
        "  extension/package.json        \"version\": \"" + pkgVer + "\"\n" +
        "  extension.vsixmanifest        两处 Version=\"" + pkgVer + "\""
    );
  }
  return pkgVer;
}

/* ---------- 镜像 ---------- */

const plan = []; // {src, dst, rel}

function addTree(srcRoot, dstRoot, prefix) {
  for (const rel of walk(srcRoot)) {
    plan.push({
      src: path.join(srcRoot, rel),
      dst: path.join(dstRoot, rel),
      rel: (prefix || "") + rel,
    });
  }
}

function buildPlan() {
  addTree(path.join(PKG, "extension"), path.join(REPO, "extension"), "extension/");
  plan.push({
    src: path.join(PKG, "extension.vsixmanifest"),
    dst: path.join(REPO, "extension.vsixmanifest"),
    rel: "extension.vsixmanifest",
  });
  plan.push({
    src: path.join(PKG, "[Content_Types].xml"),
    dst: path.join(REPO, "Content_Types_.xml"),
    rel: "Content_Types_.xml",
  });

  if (DOCS) {
    const docsMap = {
      "Breezell离线补丁-分析报告.md": "ANALYSIS.md",
      "Breezell-内置提示词与工具全量清单.md": "PROMPT-INVENTORY.md",
      "_gen-inventory.js": "gen-inventory.js",
    };
    for (const [src, dst] of Object.entries(docsMap)) {
      const sp = path.join(WORK, "patch", src);
      if (stat(sp)) plan.push({ src: sp, dst: path.join(REPO, "docs", dst), rel: "docs/" + dst });
    }
    for (const [src, dst] of Object.entries({
      "Breezell离线补丁-3.4.3-交付索引.md": "DELIVERY-INDEX-3.4.3.md",
    })) {
      const sp = path.join(WORK, "patch", src);
      if (stat(sp)) plan.push({ src: sp, dst: path.join(REPO, "docs", dst), rel: "docs/" + dst });
    }
  }

  if (RELEASE) {
    const ver = JSON.parse(read(path.join(PKG, "extension", "package.json"))).version;
    const vsix = path.join(DELIVERY, "breezell-offline-" + ver + ".vsix");
    if (!stat(vsix)) {
      console.log("· release 跳过：未找到 " + path.basename(vsix));
    } else {
      plan.push({ src: vsix, dst: path.join(REPO, "release", path.basename(vsix)), rel: "release/" + path.basename(vsix) });
    }
  }
}

/**
 * 上一次同步留下的清单（只记同步器写过的路径）。
 * 用清单而不是"扫目录算差集"，才不会误删手写的 docs/ARCHITECTURE.md 之类。
 */
const MANIFEST = path.join(REPO, ".sync-manifest.json");

function readManifest() {
  try {
    const o = JSON.parse(read(MANIFEST));
    return Array.isArray(o.files) ? o.files : [];
  } catch (e) {
    return [];
  }
}

/** 上次同步过、这次源里已经没有了 → 需要删 */
function findStale() {
  const wanted = new Set(plan.map((p) => p.rel));
  return readManifest()
    .filter((rel) => !wanted.has(rel))
    .map((rel) => path.join(REPO, rel.split("/").join(path.sep)))
    .filter((abs) => !!stat(abs));
}

function gitDirty() {
  try {
    const r = cp.execFileSync("git", ["status", "--porcelain"], { cwd: REPO, encoding: "utf8" });
    return r.trim().length > 0;
  } catch (e) {
    return false;
  }
}

/* ---------- 主流程 ---------- */

console.log("源  ：" + PKG);
console.log("目标：" + REPO);
console.log("模式：" + (CHECK ? "仅比对" : "写入") + (DOCS ? " +docs" : "") + (RELEASE ? " +release" : ""));
console.log("");

const ver = checkVersions();
buildPlan();

if (!CHECK && gitDirty()) {
  console.log("· 提示：仓库有未提交改动，建议先 git commit，便于看清这次同步的 diff。\n");
}

let added = 0,
  changed = 0,
  unchanged = 0;
const changes = [];

for (const item of plan) {
  if (!stat(item.src)) {
    console.log("! 源缺失，跳过：" + item.rel);
    continue;
  }
  if (!stat(item.dst)) {
    added++;
    changes.push("A  " + item.rel);
  } else if (same(item.src, item.dst)) {
    unchanged++;
    continue;
  } else {
    changed++;
    changes.push("M  " + item.rel);
  }
  if (!CHECK) {
    ensureDir(item.dst);
    fs.copyFileSync(item.src, item.dst);
  }
}

const stale = findStale();
for (const abs of stale) {
  changes.push("D  " + path.relative(REPO, abs).split(path.sep).join("/"));
}

if (!CHECK) {
  for (const abs of stale) {
    try {
      fs.unlinkSync(abs);
    } catch (e) {
      console.log("! 删除失败：" + abs + "  " + e.message);
    }
  }
  // 清掉空目录（docs/release 被清空时）
  for (const d of [path.join(REPO, "docs"), path.join(REPO, "release")]) {
    try {
      if (stat(d) && fs.readdirSync(d).length === 0) fs.rmdirSync(d);
    } catch (e) {}
  }
  fs.writeFileSync(
    MANIFEST,
    JSON.stringify({ updatedAt: new Date().toISOString(), version: ver, files: plan.map((p) => p.rel).sort() }, null, 2) + "\n",
    "utf8"
  );
}

console.log("---- 变更 ----");
if (!changes.length) console.log("（无差异）");
else for (const c of changes) console.log(c);
console.log("---- 汇总 ----");
console.log(
  "新增 " + added + " / 修改 " + changed + " / 删除 " + stale.length + " / 未变 " + unchanged + "   （共 " + plan.length + " 项，版本 " + ver + "）"
);

if (CHECK) {
  console.log("\n提示：这是 --check 模式，未写盘。去掉 --check 即执行同步。");
} else if (added + changed + stale.length > 0) {
  console.log("\n下一步：");
  console.log('  git add -A && git commit -m "chore: 同步 v' + ver + '" && git push');
} else {
  console.log("\n仓库已是最新，无需提交。");
}
