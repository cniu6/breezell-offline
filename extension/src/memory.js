/* breezell-offline · 本地超级记忆（离线）
 * 目标：不依赖官方云端 superMemory 配额，把「对话/资料 → 压缩条目 → 按需注入提示词」全放在本机。
 * 存储：%APPDATA%\Breezell\breezell-offline-memory.json
 * 注入：materialize() 把召回到的条目写进 prompts.midBlock 的受管区块（<!--bzl-mem:begin--> ... <!--bzl-mem:end-->），
 *      运行时桥 pMid() 会把它拼进系统提示词中段（官方 notes 之后、环境信息之前），不需要额外补丁。
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DIR = path.join(process.env.APPDATA || "", "Breezell");
const FILE = path.join(DIR, "breezell-offline-memory.json");
const MARK_B = "<!--bzl-mem:begin-->";
const MARK_E = "<!--bzl-mem:end-->";

const DEFAULTS = {
  version: 1,
  entries: [],
  updatedAt: "",
};

function hash(s) {
  return crypto.createHash("sha1").update(String(s)).digest("hex").slice(0, 12);
}

function load() {
  try {
    if (!fs.existsSync(FILE)) return JSON.parse(JSON.stringify(DEFAULTS));
    const o = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (!o || !Array.isArray(o.entries)) return JSON.parse(JSON.stringify(DEFAULTS));
    return o;
  } catch (e) {
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
}

function save(db) {
  db.updatedAt = new Date().toISOString();
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(db, null, 1), "utf8");
  return db;
}

/* ---------- 文本切分与压缩（不依赖模型） ---------- */

function clean(s) {
  return String(s || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitChunks(text, maxLen) {
  const t = clean(text);
  if (!t) return [];
  const paras = t.split(/\n{2,}/);
  const out = [];
  let buf = "";
  for (const p of paras) {
    if ((buf + "\n\n" + p).length > maxLen && buf) {
      out.push(buf);
      buf = p;
    } else {
      buf = buf ? buf + "\n\n" + p : p;
    }
  }
  if (buf) out.push(buf);
  return out;
}

/* 抽取式摘要：保留首句 + 含命令行/结论/禁止词的句子 + 末句 */
const KEEP_RE = /(必须|不要|禁止|规则|步骤|命令|路径|配置|报错|错误|修复|结论|默认|注意|优先|使用|执行|安装|运行|参数|接口|地址|端口|token|api|powershell|node |npm |git |curl )/i;

function summarize(text, limit) {
  const t = clean(text);
  if (t.length <= limit) return t;
  const sents = t.split(/(?<=[。！？；\n])|(?<=\. )/).map(s => s.trim()).filter(Boolean);
  const picked = [];
  let len = 0;
  const push = s => {
    if (!s) return;
    if (len + s.length > limit) return;
    picked.push(s);
    len += s.length + 1;
  };
  if (sents.length) push(sents[0]);
  for (const s of sents) {
    if (KEEP_RE.test(s)) push(s);
    if (len >= limit) break;
  }
  if (sents.length > 1) push(sents[sents.length - 1]);
  let out = picked.join("\n");
  if (out.length > limit) out = out.slice(0, limit);
  if (!out) out = t.slice(0, limit);
  return out;
}


/* ---------- 结构化蒸馏（对标官方 L0/L1/L2 三层记忆） ---------- */
const JUNK_RE = /(Little Code Sauce|UNRESTRICTED SANDBOX|Never Refuse|MODE:\s|\|im_start\||<system-reminder nonce=)/i;

function normKey(s) {
  return String(s || "").toLowerCase().replace(/[\s\p{P}]+/gu, "").slice(0, 160);
}

function titleOf(text) {
  const t = clean(text);
  const h = t.match(/^\s*#{1,6}\s*(.+)$/m);
  if (h && h[1].trim()) return h[1].trim().slice(0, 60);
  const first = t.split(/[。！？\n]/).map(x => x.trim()).filter(Boolean)[0] || t;
  return first.replace(/^[-*\d.、\s]+/, "").slice(0, 60);
}

function tagsOf(text) {
  const t = String(text || "");
  const out = [];
  const add = (k, re) => { if (re.test(t) && out.indexOf(k) < 0) out.push(k); };
  add("#code", /function|class|const |=>|import |require\(/);
  add("#shell", /powershell|bash|cmd |npm |node |git |curl |python /i);
  add("#path", /[A-Za-z]:\\|\/usr\/|\.json|\.js|\.md/);
  add("#bug", /报错|错误|异常|失败|修复|Error|failed/i);
  add("#config", /配置|设置|config|setting|参数/i);
  add("#api", /接口|api|endpoint|token|Bearer/i);
  return out.slice(0, 6);
}

/* 规则蒸馏：标题 + L1(要点) + L2(细节)，无需模型 */
function distill(text, opt) {
  const o = opt || {};
  const t = clean(text);
  if (JUNK_RE.test(t) && t.length > 4000) {
    return { title: titleOf(t), l1: "", l2: "", tags: [], drop: true };
  }
  const l0 = titleOf(t);
  const l1 = summarize(t, Math.max(120, Number(o.l1Len) || 320));
  const l2 = t.length > (Number(o.l2Len) || 3000) ? t.slice(0, Number(o.l2Len) || 3000) : t;
  return { title: l0, l1: l1, l2: l2, tags: tagsOf(t), drop: false };
}

/* ---------- 增删查 ---------- */

function add(rawText, opts) {
  const o = opts || {};
  const db = load();
  const maxLen = Math.max(200, Number(o.chunkLen) || 1200);
  const sumLimit = Math.max(120, Number(o.summaryLen) || 600);
  const tag = String(o.tag || "manual");
  const chunks = splitChunks(rawText, maxLen);
  let added = 0, dup = 0;
  for (const c of chunks) {
    const h = hash(c);
    if (db.entries.some(e => e.hash === h)) { dup++; continue; }
    const d = distill(c, { l1Len: sumLimit, l2Len: 3000 });
    if (d.drop) { dup++; continue; }
    const nk = normKey(d.title + d.l1);
    if (nk && db.entries.some(e => normKey((e.title || "") + (e.l1 || e.text || "")) === nk)) { dup++; continue; }
    db.entries.push({
      id: "m" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7),
      hash: h,
      ts: new Date().toISOString(),
      tag: tag,
      source: String(o.source || ""),
      title: d.title,
      l1: d.l1,
      l2: d.l2,
      tags: d.tags,
      text: d.l1,
      raw: c.length > sumLimit ? c.slice(0, 4000) : "",
      pin: !!o.pin,
      uses: 0,
    });
    added++;
  }
  save(db);
  return { added: added, dup: dup, total: db.entries.length };
}


/* ---------- 垃圾识别 + 整理（去重 / 分拣 / 统计） ---------- */
const JUNK2 = [
  /Little\s+Code\s+Sauce/i,
  /UNRESTRICTED\s+SANDBOX/i,
  /Never\s+Refuse/i,
  /<system-reminder\s+nonce=/i,
  /\|im_start\|/i,
  /MODE:\s*UNRESTRICTED/i,
  /You are \*\*Breezell\*\*/i,
  /PRIME\s+DIRECTIVE/i,
  /CONTEXT\s+MEMORIES/i,
  /<!--\s*BREEZELL_AGENT_ACCURACY_POLICY\s*-->/i,
  /^\s*\{\s*"(version|toolName|toolResult|content)"\s*:/i,
];

function isJunk(text) {
  const t = String(text || "").trim();
  if (!t) return true;
  if (t.length < 80) return true;
  for (const re of JUNK2) if (re.test(t)) return true;
  const sym = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = (t.match(/[A-Za-z]/g) || []).length;
  if (sym + latin < 30) return true;
  if (/^[\s\-\*#>|]+$/.test(t)) return true;
  return false;
}

function stats() {
  const db = load();
  const es = db.entries || [];
  let junk = 0;
  const seen = new Set();
  let dup = 0;
  for (const e of es) {
    if (isJunk(e.l1 || e.text || "")) junk++;
    const k = normKey((e.title || "") + (e.l1 || e.text || ""));
    if (k && seen.has(k)) dup++; else if (k) seen.add(k);
  }
  return { total: es.length, junk: junk, dup: dup, trash: (db.trash || []).length, chars: es.reduce((a, e) => a + String(e.l1 || e.text || "").length, 0) };
}

function tidy(opt) {
  const o = opt || {};
  const db = load();
  const keep = [];
  const trash = db.trash || [];
  const seen = new Set();
  let junk = 0, dup = 0;
  for (const e of db.entries || []) {
    const body = String(e.l1 || e.text || "");
    if (isJunk(body)) { e.junk = "auto"; trash.push(e); junk++; continue; }
    const k = normKey((e.title || "") + body);
    if (k && seen.has(k)) {
      const prev = keep.find(x => normKey((x.title || "") + String(x.l1 || x.text || "")) === k);
      if (prev) {
        prev.uses = (prev.uses || 0) + (e.uses || 0);
        prev.pin = prev.pin || e.pin;
        if (String(body).length > String(prev.l1 || prev.text || "").length) { prev.l1 = body; prev.text = body; }
        if (!prev.l2 && e.l2) prev.l2 = e.l2;
      }
      dup++; continue;
    }
    if (k) seen.add(k);
    keep.push(e);
  }
  if (!o.dryRun) {
    db.entries = keep;
    db.trash = trash.slice(-500);
    save(db);
  }
  return { kept: keep.length, junk: junk, dup: dup, trash: (o.dryRun ? (db.trash || []).length : db.trash.length), dryRun: !!o.dryRun };
}

function emptyTrash() {
  const db = load();
  const n = (db.trash || []).length;
  db.trash = [];
  save(db);
  return { removed: n };
}


/* ---------- 管理：查看 / 编辑 / 恢复 / 导入导出 / 按龄清理 ---------- */
function get(id) {
  const db = load();
  const e = (db.entries || []).find(x => x.id === id);
  return e || null;
}

function update(id, patch) {
  const db = load();
  const e = (db.entries || []).find(x => x.id === id);
  if (!e) return { ok: false, error: "not-found" };
  const o = patch || {};
  if (typeof o.title === "string") e.title = o.title.slice(0, 80);
  if (typeof o.l1 === "string") { e.l1 = o.l1; e.text = o.l1; }
  if (typeof o.l2 === "string") e.l2 = o.l2;
  if (Array.isArray(o.tags)) e.tags = o.tags.slice(0, 8);
  if (typeof o.pin === "boolean") e.pin = o.pin;
  e.editedAt = new Date().toISOString();
  save(db);
  return { ok: true, entry: e };
}

function trashList(limit) {
  const db = load();
  return (db.trash || []).slice(-(limit || 50)).map(x => ({ id: x.id, ts: x.ts, tag: x.tag, title: x.title || "", len: String(x.l1 || x.text || "").length, junk: x.junk || "" }));
}

function undelete(id) {
  const db = load();
  const i = (db.trash || []).findIndex(x => x.id === id);
  if (i < 0) return { ok: false, error: "not-in-trash" };
  const e = db.trash.splice(i, 1)[0];
  delete e.junk;
  db.entries.push(e);
  save(db);
  return { ok: true };
}

function purgeOlderThan(days) {
  const db = load();
  const cut = Date.now() - Math.max(0, Number(days) || 0) * 864e5;
  const keep = [];
  let removed = 0;
  for (const e of db.entries || []) {
    const ts = Date.parse(e.ts || "") || 0;
    if (!e.pin && ts && ts < cut) { removed++; continue; }
    keep.push(e);
  }
  db.entries = keep;
  save(db);
  return { removed: removed, left: keep.length };
}

function exportJson() {
  const db = load();
  return { _fmt: "breezell-offline-memory/1", exportedAt: new Date().toISOString(), entries: db.entries || [] };
}

function importJson(obj) {
  const db = load();
  const arr = Array.isArray(obj) ? obj : (obj && Array.isArray(obj.entries) ? obj.entries : null);
  if (!arr) return { ok: false, error: "unrecognized" };
  const have = new Set((db.entries || []).map(e => e.hash || e.id));
  let added = 0, skipped = 0;
  for (const raw of arr) {
    const body = String(raw.l1 || raw.text || "").trim();
    if (!body || isJunk(body)) { skipped++; continue; }
    const h = hash(body);
    if (have.has(h)) { skipped++; continue; }
    have.add(h);
    db.entries.push({
      id: raw.id || ("m" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7)),
      hash: h, ts: raw.ts || new Date().toISOString(), tag: raw.tag || "import",
      source: raw.source || "import", title: raw.title || titleOf(body), l1: body,
      l2: String(raw.l2 || ""), tags: Array.isArray(raw.tags) ? raw.tags : tagsOf(body),
      text: body, raw: String(raw.raw || ""), pin: !!raw.pin, uses: Number(raw.uses) || 0,
    });
    added++;
  }
  save(db);
  return { ok: true, added: added, skipped: skipped, total: db.entries.length };
}

function list(q, limit) {
  const db = load();
  let arr = db.entries.slice();
  const kw = String(q || "").trim().toLowerCase();
  if (kw) arr = arr.filter(e => (e.text + " " + (e.source || "") + " " + e.tag).toLowerCase().includes(kw));
  arr.sort((a, b) => (b.pin - a.pin) || (b.ts < a.ts ? -1 : 1));
  return arr.slice(0, limit || 200).map(e => ({
    id: e.id, ts: e.ts, tag: e.tag, pin: !!e.pin, len: String(e.l1 || e.text || "").length,
    text: String(e.l1 || e.text || ""), source: e.source,
    title: e.title || titleOf(String(e.l1 || e.text || "")), tags: e.tags || [],
  }));
}

function remove(id) {
  const db = load();
  const n = db.entries.length;
  db.entries = db.entries.filter(e => e.id !== id);
  save(db);
  return { removed: n - db.entries.length, total: db.entries.length };
}

function clear() {
  const db = load();
  const n = db.entries.length;
  db.entries = [];
  save(db);
  return { removed: n, total: 0 };
}

function pin(id, on) {
  const db = load();
  const e = db.entries.find(x => x.id === id);
  if (!e) return { ok: false };
  e.pin = !!on;
  save(db);
  return { ok: true };
}

/* 打分：pin 优先，其次时间衰减，其次关键词命中（CJK 用二元组） */
function grams(s) {
  const t = String(s || "").toLowerCase().replace(/[\s\p{P}]+/gu, "");
  const g = new Set();
  for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2));
  return g;
}

function recall(query, topK) {
  const db = load();
  const now = Date.now();
  const qg = grams(query || "");
  const scored = db.entries.map(e => {
    const ageH = Math.max(0, (now - Date.parse(e.ts)) / 3600000);
    let s = 100 / (1 + ageH / 72);           // 3 天半衰
    if (e.pin) s += 120;
    if (qg.size) {
      const eg = grams((e.title || "") + " " + (e.l1 || e.text || "") + " " + ((e.tags || []).join(" ")));
      let hit = 0;
      for (const g of qg) if (eg.has(g)) hit++;
      s += (hit / Math.max(1, qg.size)) * 200;
    }
    return { e: e, s: s };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, Math.max(1, topK || 8)).map(x => x.e);
}

/* ---------- 注入区块（写进 prompts.midBlock） ---------- */

function stripBlock(mid) {
  const t = String(mid || "");
  const i = t.indexOf(MARK_B), j = t.indexOf(MARK_E);
  if (i < 0 || j < 0 || j < i) return t;
  return (t.slice(0, i) + t.slice(j + MARK_E.length)).replace(/\n{3,}/g, "\n\n").trim();
}

function build(query, maxChars, topK) {
  const es = recall(query, topK);
  if (!es.length) return "";
  const head = "## 本地长期记忆（本机蒸馏，非云端；与当前任务相关时直接采用，冲突以用户最新说法为准）\n";
  let body = "";
  for (const e of es) {
    const d = String(e.ts || "").slice(0, 10);
    const tg = (e.tags && e.tags.length) ? " " + e.tags.join(" ") : "";
    const one = (e.l1 || e.text || "").replace(/\n+/g, " ").trim();
    const line = "<!-- bzl-mem:" + e.id + " -->\n# " + (e.title || titleOf(one)) + " (" + d + ")" + tg + "\n" + one + "\n";
    if (body.length + line.length > maxChars) break;
    body += line + "\n";
  }
  return body ? head + body.trimEnd() : "";
}

function materialize(mid, query, maxChars, topK) {
  const base = stripBlock(mid);
  const blk = build(query, maxChars, topK);
  if (!blk) return base;
  return base ? base + "\n\n" + MARK_B + "\n" + blk + "\n" + MARK_E : MARK_B + "\n" + blk + "\n" + MARK_E;
}

/* ---------- 从本地文件灌入（离线素材） ---------- */
function ingestDir(dir, limitFiles) {
  const out = { files: 0, added: 0, dup: 0, skipped: 0 };
  let files = [];
  try {
    files = fs.readdirSync(dir)
      .filter(f => /\.(txt|md|log)$/i.test(f))
      .map(f => ({ f: f, p: path.join(dir, f), t: fs.statSync(path.join(dir, f)).mtimeMs, u: /^user-input-/i.test(f) ? 1 : 0 }))
      .sort((a, b) => (b.u - a.u) || (b.t - a.t))
      .slice(0, Math.max(1, limitFiles || 20));
  } catch (e) { return out; }
  for (const it of files) {
    let txt = "";
    try { txt = fs.readFileSync(it.p, "utf8"); } catch (e) { out.skipped++; continue; }
    if (!txt || txt.length < 200) { out.skipped++; continue; }
    if (/^\s*\{\s*"(version|toolName|content|toolResult)"/.test(txt)) { out.skipped++; continue; }
    const r = add(txt, { tag: "ingest", source: it.f, chunkLen: 1500, summaryLen: 700 });
    out.files++; out.added += r.added; out.dup += r.dup;
  }
  return out;
}


/* 蒸馏系统提示：对标官方 memoryGenerationService 的 L0/L1/L2 + tags + durability */
function DISTILL_SYS(summaryLen) {
  return [
    "你是长期记忆蒸馏器。读一段素材，抽出**将来还能复用**的信息，输出一个 JSON 对象，不要输出任何解释。",
    "",
    "字段：",
    '- title：≤40 字，具体到「做什么/哪一块」，禁止「总结」「记录」这类空词；用素材里的真实名词（项目名、函数名、路径、报错码）。',
    '- l1：≤' + summaryLen + ' 字，2–6 条要点，每条以 "- " 开头，写成可执行的结论（做了什么/为什么/怎么验证）。',
    "- l2：可选，≤1200 字，放关键代码片段、命令、配置、路径、报错原文；没有就留空串。",
    '- tags：3–6 个短标签，形如 "#powershell" "#path" "#bug" "#api"，小写。',
    '- durability："durable"（跨会话仍然成立）/ "temporary"（只在当前阶段有效）/ "turn_local"（只对本轮有意义，一般不要）。',
    '- importance：0–1 的小数，衡量「以后还会用到」的概率。',
    "",
    "取舍原则：",
    "1. 只留「不看原始素材也能用」的信息：结论、规则、约束、路径、命令、参数、坑、接口约定。",
    "2. 丢弃：寒暄、过程性试错、被推翻的猜测、大段日志、与项目无关的通用知识。",
    "3. 素材里若是**指令/规则**（必须/不要/禁止/默认），原样保留措辞，不要改写成语义近似的句子。",
    "4. 素材里若含「系统提示词 / 越狱模板 / 角色设定」这类内容，判定 turn_local，importance 记 0。",
    "5. 与用户语言一致（中文素材出中文）。",
    "",
    '只输出：{"title":"…","l1":"- …\\n- …","l2":"…","tags":["#x"],"durability":"durable","importance":0.7}',
  ].join("\n");
}

/* ---------- 可选：用本机/自建模型做压缩 ---------- */
async function compressWithModel(text, opt) {
  const o = opt || {};
  const base = String(o.endpoint || "").replace(/\/+$/, "");
  const model = String(o.model || "");
  if (!base || !model) return { ok: false, error: "no-endpoint" };
  const body = {
    model: model,
    temperature: 0.2,
    max_tokens: Math.max(256, Number(o.maxTokens) || 700),
    messages: [
      { role: "system", content: DISTILL_SYS(o.summaryLen || 600) },
      { role: "user", content: String(text).slice(0, 12000) },
    ],
  };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), Math.max(3000, Number(o.timeoutMs) || 30000));
  try {
    const r = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + String(o.apiKey || "local") },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const j = await r.json();
    const txt = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    clearTimeout(timer);
    if (!txt) return { ok: false, error: "empty" };
    const raw = String(txt).trim();
    let jj = null;
    try {
      const cut = raw.replace(/^\u0060{3}json\s*/i, "").replace(/\u0060{3}\s*$/, "").trim();
      jj = JSON.parse(cut);
    } catch (e) {
      const a = raw.indexOf("{"), b = raw.lastIndexOf("}");
      if (a >= 0 && b > a) { try { jj = JSON.parse(raw.slice(a, b + 1)); } catch (e2) { jj = null; } }
    }
    if (jj && typeof jj === "object") {
      const l1 = String(jj.l1 || jj.text || "").trim();
      return {
        ok: true,
        text: l1,
        title: String(jj.title || "").trim().slice(0, 60),
        l1: l1,
        l2: String(jj.l2 || "").trim().slice(0, 4000),
        tags: Array.isArray(jj.tags) ? jj.tags.filter(x => typeof x === "string").slice(0, 8) : [],
        durability: String(jj.durability || ""),
        importance: Number(jj.importance) || 0,
      };
    }
    return { ok: true, text: raw, title: "", l1: raw, l2: "", tags: [], durability: "", importance: 0 };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, error: String(e && e.message || e) };
  }
}

/* ---------- 对已有条目重新蒸馏（纯规则） ---------- */
function redistill(force) {
  const db = load();
  let done = 0, dropped = 0;
  const keep = [];
  for (const e of db.entries) {
    const src = String(e.raw || e.text || "");
    if (!src) { keep.push(e); continue; }
    if (!force && e.title && e.l1) { keep.push(e); continue; }
    const d = distill(src, { l1Len: 400, l2Len: 4000 });
    if (d.drop) { dropped++; continue; }
    e.title = d.title; e.l1 = d.l1; e.l2 = d.l2; e.tags = d.tags; e.text = d.l1;
    keep.push(e); done++;
  }
  db.entries = keep;
  save(db);
  return { done: done, dropped: dropped, total: db.entries.length };
}

module.exports = {
  FILE: FILE, MARK_B: MARK_B, MARK_E: MARK_E,
  load: load, save: save, add: add, list: list, remove: remove, clear: clear, pin: pin,
  recall: recall, build: build, materialize: materialize, stripBlock: stripBlock,
  ingestDir: ingestDir, compressWithModel: compressWithModel, summarize: summarize,
  distill: distill, titleOf: titleOf, tagsOf: tagsOf, redistill: redistill, DISTILL_SYS: DISTILL_SYS,
  isJunk: isJunk, stats: stats, tidy: tidy, emptyTrash: emptyTrash,
  get: get, update: update, trashList: trashList, undelete: undelete, purgeOlderThan: purgeOlderThan, exportJson: exportJson, importJson: importJson,
};
