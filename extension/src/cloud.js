"use strict";
/* breezell-offline :: cloud —— 官方在线数据客户端（会话复用 / 自动续期 / 请求去重 / 可中止）
 *
 * 只读：不改程序文件、不写 state.vscdb。
 * 会话来源：%APPDATA%\Breezell\User\globalStorage\state.vscdb 里的 breezell.sessions 明文键值。
 * 续期结果写旁路文件 breezell-offline-cloud.json（不碰编辑器数据库，避免并发写坏）。
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const crypto = require("crypto");

const APPDATA = process.env.APPDATA || "";
const STATE_DB = path.join(APPDATA, "Breezell", "User", "globalStorage", "state.vscdb");
const SIDECAR = path.join(APPDATA, "Breezell", "breezell-offline-cloud.json");

const BACKEND_DEFAULT = "https://api.breezell.com";
const API_ORIGIN_DEFAULT = "https://breezell.com";
const UA = "Breezell-Offline-Panel/2.0";

/* ---------------- 会话 ---------------- */

function readSessionFromDb() {
  let buf;
  try { buf = fs.readFileSync(STATE_DB); } catch (e) { return null; }
  const txt = buf.toString("utf8");
  const key = "breezell.sessions[";
  const starts = [];
  let from = 0;
  for (;;) {
    const at = txt.indexOf(key, from);
    if (at < 0) break;
    starts.push(at + key.length - 1); /* 指向 '[' */
    from = at + key.length;
    if (starts.length > 64) break;
  }
  const cands = [];
  for (let s = 0; s < starts.length; s++) {
    const start = starts[s];
    let depth = 0, end = -1;
    const limit = Math.min(txt.length, start + 400000);
    for (let i = start; i < limit; i++) {
      const c = txt[i];
      if (c === "[") depth++;
      else if (c === "]") { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    if (end < 0) continue;
    let arr;
    try { arr = JSON.parse(txt.slice(start, end)); } catch (e) { continue; }
    if (!Array.isArray(arr)) continue;
    arr.forEach(function (x) {
      if (!x || typeof x.accessToken !== "string" || !x.accessToken) return;
      cands.push(x);
    });
  }
  if (!cands.length) return null;
  /* 同一条会话在 WAL / 备份里会有多份历史版本：留 exp 最大的那份（页写入没落盘时最接近真值） */
  let best = null, bestExp = -1;
  for (const c of cands) {
    const p = jwtPayload(c.accessToken);
    const exp = p && typeof p.exp === "number" ? p.exp : 0;
    if (exp > bestExp) { best = c; bestExp = exp; }
  }
  if (!best) best = cands[cands.length - 1];
  return {
    id: String(best.id || ""),
    accessToken: best.accessToken,
    refreshToken: typeof best.refreshToken === "string" ? best.refreshToken : "",
    account: best.account || null,
    from: "state.vscdb",
    candidates: cands.length
  };
}

function loadSidecar() {
  try {
    const j = JSON.parse(fs.readFileSync(SIDECAR, "utf8"));
    if (j && typeof j.accessToken === "string" && j.accessToken) return j;
  } catch (e) {}
  return null;
}

function saveSidecar(s, extra) {
  try {
    const dir = path.dirname(SIDECAR);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const o = Object.assign({ at: new Date().toISOString() }, s || {}, extra || {});
    fs.writeFileSync(SIDECAR, JSON.stringify(o, null, 2), "utf8");
  } catch (e) {}
}

function jwtPayload(token) {
  try {
    const p = String(token).split(".");
    if (p.length !== 3) return null;
    return JSON.parse(Buffer.from(p[1], "base64url").toString("utf8"));
  } catch (e) { return null; }
}

function tokenState(token) {
  const p = jwtPayload(token);
  if (!p || typeof p.exp !== "number") return { known: false, exp: null, leftMs: null, expired: false };
  const exp = p.exp * 1000;
  return { known: true, exp: exp, leftMs: exp - Date.now(), expired: exp <= Date.now(), user: p.username || p.email || "" };
}

function pickSession() {
  const db = readSessionFromDb();
  const side = loadSidecar();
  if (db && side && side.id === db.id && side.accessToken) {
    const d = tokenState(db.accessToken), s = tokenState(side.accessToken);
    /* 旁路比数据库新（数据库里的已过期而旁路还没过期）就用旁路 */
    if (s.known && !s.expired && (!d.known || d.expired || s.exp > d.exp)) return Object.assign({}, db, side, { from: "sidecar" });
  }
  return db || side || null;
}

/* ---------------- HTTP ---------------- */

function request(url, opts) {
  opts = opts || {};
  return new Promise(function (resolve) {
    let u;
    try { u = new URL(url); } catch (e) { return resolve({ ok: false, status: 0, error: "bad-url", url: url }); }
    const lib = u.protocol === "https:" ? https : require("http");
    const headers = Object.assign({ "Accept": "application/json", "User-Agent": UA }, opts.headers || {});
    let body = null;
    if (opts.body !== undefined) {
      body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
      headers["Content-Type"] = headers["Content-Type"] || "application/json";
      headers["Content-Length"] = Buffer.byteLength(body);
    }
    const req = lib.request({
      protocol: u.protocol, hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + u.search, method: opts.method || (body ? "POST" : "GET"), headers: headers
    }, function (res) {
      const chunks = [];
      let size = 0;
      res.on("data", function (d) {
        size += d.length;
        if (size <= 4 * 1024 * 1024) chunks.push(d);
      });
      res.on("end", function () {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch (e) {}
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json: json, text: text });
      });
    });
    req.setTimeout(opts.timeoutMs || 20000, function () { req.destroy(new Error("timeout")); });
    req.on("error", function (e) {
      if (opts.signal && opts.signal.aborted) return resolve({ ok: false, status: 0, error: "aborted" });
      resolve({ ok: false, status: 0, error: String((e && e.message) || e) });
    });
    if (opts.signal) {
      if (opts.signal.aborted) { try { req.destroy(); } catch (e) {} return resolve({ ok: false, status: 0, error: "aborted" }); }
      opts.signal.addEventListener("abort", function () { try { req.destroy(); } catch (e) {} resolve({ ok: false, status: 0, error: "aborted" }); }, { once: true });
    }
    if (body) req.write(body);
    req.end();
  });
}

/* ---------------- 续期 ---------------- */

let _refreshInFlight = null;
function refreshSession(sess, origin) {
  if (_refreshInFlight) return _refreshInFlight;
  const base = origin || API_ORIGIN_DEFAULT;
  _refreshInFlight = request(base.replace(/\/$/, "") + "/api/auth/refresh", {
    method: "POST", body: { refreshToken: sess.refreshToken }, timeoutMs: 20000
  }).then(function (r) {
    if (!r.ok || !r.json || !r.json.success || !r.json.accessToken) return { ok: false, status: r.status, error: (r.json && r.json.message) || r.error || ("HTTP " + r.status) };
    const next = {
      id: sess.id, accessToken: r.json.accessToken,
      refreshToken: typeof r.json.refreshToken === "string" && r.json.refreshToken ? r.json.refreshToken : sess.refreshToken,
      account: sess.account || null
    };
    saveSidecar(next, { refreshedAt: r.json.refreshedAt || new Date().toISOString() });
    return { ok: true, session: next };
  }).finally(function () { _refreshInFlight = null; });
  return _refreshInFlight;
}

/* ---------------- 价格 / 折扣换算（与官方工作台同一套语义） ---------------- */

function normName(s) { return String(s || "").toLowerCase().replace(/[\s\-_./]/g, ""); }
function baseName(s) {
  const i = String(s).lastIndexOf("/");
  return i >= 0 ? String(s).slice(i + 1) : String(s);
}
function stripDateSuffix(s) { return String(s).replace(/\d{8,}$/, ""); }

/* 官方 yru(): 折扣百分比 -> 中国“折” */
function discountToZhe(pct) {
  const n = Number(pct);
  if (!isFinite(n)) return null;
  const z = (100 - n) / 10;
  return Number.isInteger(z) ? String(z) : z.toFixed(1);
}

/* 官方 P0e(): 促销后的单价 */
function applyPromo(price, promo) {
  if (!price) return null;
  const out = Object.assign({}, price);
  if (!promo) return out;
  if (promo.benefit === "free") { out.input = 0; out.output = 0; if ("cache_read" in out) out.cache_read = 0; if ("cache_write" in out) out.cache_write = 0; return out; }
  if (promo.benefit === "discount" && isFinite(Number(promo.discountPercent))) {
    const k = 1 - Number(promo.discountPercent) / 100;
    ["input", "output", "cache_read", "cache_write"].forEach(function (f) {
      if (typeof out[f] === "number") out[f] = Number((out[f] * k).toFixed(6));
    });
    return out;
  }
  return out;
}

function makePricingIndex(catalogModels) {
  const idx = { exact: {}, norm: {}, base: {} };
  (catalogModels || []).forEach(function (m) {
    if (!m || !m.id) return;
    if (m["in"] === null && m.out === null) return;
    const e = { input: m["in"], output: m.out, cache_read: m.cr, cache_write: m.cw };
    idx.exact[m.id] = e;
    idx.norm[normName(m.id)] = e;
    const b = normName(stripDateSuffix(baseName(m.id)));
    if (b && b.length > 2) idx.base[b] = e;
  });
  return idx;
}

function lookupPrice(idx, modelName) {
  const n = normName(modelName);
  if (idx.exact[modelName]) return { price: idx.exact[modelName], source: "bundled" };
  if (idx.norm[n]) return { price: idx.norm[n], source: "bundled" };
  const b = normName(stripDateSuffix(baseName(modelName)));
  if (idx.base[b]) return { price: idx.base[b], source: "bundled" };
  return null;
}

/* ---------------- 主视图 ---------------- */

function backendOf(product) {
  const b = (product && product.breezellBackendEndpoint) || BACKEND_DEFAULT;
  return String(b).replace(/\/$/, "");
}
function apiOriginOf(product) {
  const a = (product && product.breezellApiEndpoint) || API_ORIGIN_DEFAULT;
  return String(a).replace(/\/$/, "");
}

/**
 * @param {object} o
 *  - product: product.json 内容（取 breezellBackendEndpoint / breezellApiEndpoint / breezellVersion）
 *  - bundled: appPatcher.extractModels 的结果（用于离线基准价）
 *  - signal: AbortSignal
 */
async function fetchCloud(o) {
  o = o || {};
  const product = o.product || {};
  const backend = backendOf(product);
  const origin = apiOriginOf(product);
  const ver = product.breezellVersion || "";
  const bundled = o.bundled && o.bundled.models ? o.bundled : { models: [], count: 0, source: "none" };
  const idx = makePricingIndex(bundled.models);

  let sess = o.session || pickSession();
  if (!sess) {
    return { ok: false, at: new Date().toISOString(), code: "no-session",
      error: "没有找到 Breezell 登录会话（state.vscdb 里没有 breezell.sessions）。先在 Breezell 里登录一次再拉取。" };
  }
  const ts = tokenState(sess.accessToken);
  if (ts.expired && sess.refreshToken) {
    const rr = await refreshSession(sess, origin);
    if (rr.ok) sess = Object.assign({}, sess, rr.session, { from: "refreshed" });
  }

  const hdr = { "X-Breezell-Version": ver, "X-Breezell-Editor-Version": ver, "Authorization": "Bearer " + sess.accessToken };
  const call = function (url) { return request(url, { headers: hdr, timeoutMs: 25000, signal: o.signal }); };

  let cfgRes = await call(backend + "/api/model-config");
  let meRes = await call(backend + "/api/auth/me");
  let refreshed = false;
  if ((cfgRes.status === 401 || cfgRes.status === 403) && sess.refreshToken) {
    const rr = await refreshSession(sess, origin);
    if (rr.ok) {
      sess = Object.assign({}, sess, rr.session, { from: "refreshed" });
      refreshed = true;
      hdr.Authorization = "Bearer " + sess.accessToken;
      cfgRes = await call(backend + "/api/model-config");
      meRes = await call(backend + "/api/auth/me");
    }
  }
  if (o.signal && o.signal.aborted) return { ok: false, at: new Date().toISOString(), code: "aborted", error: "已取消" };

  const cfg = cfgRes.ok && cfgRes.json && cfgRes.json.code === 200 && cfgRes.json.data ? cfgRes.json.data : null;
  if (!cfg) {
    const msg = (cfgRes.json && (cfgRes.json.message || cfgRes.json.msg)) || cfgRes.error || ("HTTP " + cfgRes.status);
    return { ok: false, at: new Date().toISOString(), code: "api", status: cfgRes.status,
      error: "官方模型接口不可用：" + msg + (cfgRes.status === 403 ? "（该接口要求登录态，请确认当前账户已登录且未被限制）" : "") };
  }

  const me = meRes.ok && meRes.json && meRes.json.user ? meRes.json.user : null;
  const meErr = !me && meRes.json ? (meRes.json.code || meRes.json.error || "") : "";
  const side = loadSidecar();
  const status = (cfg.modelStatus && typeof cfg.modelStatus === "object") ? cfg.modelStatus : {};
  const statusMsg = (cfg.modelStatusMessages && typeof cfg.modelStatusMessages === "object") ? cfg.modelStatusMessages : {};
  const promos = (cfg.modelPromotions && typeof cfg.modelPromotions === "object") ? cfg.modelPromotions : {};
  const catalog = Array.isArray(cfg.modelCatalog) ? cfg.modelCatalog.filter(function (m) { return m && m.provider && m.modelName; }) : [];
  const pricingVisible = typeof cfg.pricingVisible === "boolean" ? cfg.pricingVisible : true;
  const serverPricing = (cfg.modelPricing && typeof cfg.modelPricing === "object") ? cfg.modelPricing : {};
  const serverIdx = makePricingIndex(Object.keys(serverPricing).map(function (k) {
    const v = serverPricing[k] || {};
    return { id: k, "in": v.input, out: v.output, cr: v.cache_read, cw: v.cache_write };
  }));

  function findKey(map, name) {
    if (!map) return null;
    if (map[name] !== undefined) return name;
    const n = normName(name);
    for (const k of Object.keys(map)) {
      const kk = normName(k);
      if (kk === n || kk.startsWith(n) || n.startsWith(kk)) return k;
    }
    return null;
  }

  const rows = catalog.map(function (m) {
    const name = m.modelName;
    const sk = findKey(status, name);
    const mk = findKey(promos, name);
    const promo = mk ? promos[mk] : null;
    let base = null, src = "none";
    const srv = pricingVisible ? lookupPrice(serverIdx, name) : null;
    if (srv) { base = srv.price; src = "server"; }
    else { const b = lookupPrice(idx, name); if (b) { base = b.price; src = "bundled"; } }
    const finalPrice = base ? applyPromo(base, promo) : (promo && promo.benefit === "free"
      ? { input: 0, output: 0, cache_read: 0, cache_write: 0, free: true }
      : null);
    return {
      name: name,
      provider: m.provider,
      listed: m.addToList !== false,
      hidden: m.hideInList === true,
      status: sk ? status[sk] : "unknown",
      statusText: sk && statusMsg[sk] ? (statusMsg[sk].zh || statusMsg[sk].en || "") : "",
      promo: promo ? { benefit: promo.benefit, zhe: promo.benefit === "discount" ? discountToZhe(promo.discountPercent) : null, pct: promo.discountPercent, limited: !!promo.limitedTime } : null,
      base: base, price: finalPrice, priceSource: src
    };
  });

  /* 官方目录里没列、但促销/状态里出现的模型也补上（便于看全） */
  const seen = new Set(rows.map(function (r) { return normName(r.name); }));
  Object.keys(promos).forEach(function (k) {
    if (seen.has(normName(k))) return;
    const p = promos[k] || {};
    const b = lookupPrice(idx, k);
    rows.push({ name: k, provider: "breezell", listed: false, hidden: false, status: status[k] || "unknown", statusText: "",
      promo: { benefit: p.benefit, zhe: p.benefit === "discount" ? discountToZhe(p.discountPercent) : null, pct: p.discountPercent, limited: !!p.limitedTime },
      base: b ? b.price : null, price: b ? applyPromo(b.price, p) : null, priceSource: b ? b.source : "none" });
  });

  rows.sort(function (a, b) {
    const rank = function (r) { return r.status === "available" ? 0 : r.status === "busy" ? 1 : r.status === "unknown" ? 2 : 3; };
    const d = rank(a) - rank(b);
    if (d) return d;
    if (a.listed !== b.listed) return a.listed ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return {
    ok: true,
    at: new Date().toISOString(),
    endpoint: backend,
    session: {
      id: sess.id, from: sess.from, refreshed: refreshed, candidates: sess.candidates || 1,
      username: (me && me.username) || (ts.user || ""),
      email: (me && me.email) || "",
      plan: me ? me.plan : "",
      role: me ? me.role : "",
      tokens: me ? me.tokens : null,
      expiresAt: ts.exp ? new Date(ts.exp).toISOString() : null,
      leftMs: ts.leftMs,
      /* /api/auth/me 可能因为设备租约（EDITOR_DEVICE_LEASE_EXPIRED）先失效，
       * 但 model-config 只看 token 本身；把这条偏差显式暴露出来。 */
      accountProbe: me ? "ok" : (meErr || ("HTTP " + meRes.status)),
      accountProbeHint: me ? "" : "账户详情接口返回 " + (meErr || ("HTTP " + meRes.status)) + "；模型/倍率不受影响，重新登录可恢复账户详情。"
    },
    account: me ? {
      status: me.status, planExpiresAt: me.plan_expires_at, createdAt: me.created_at,
      superMemory: me.superMemory || null, modeAccess: me.modeAccess || null,
      deviceBannedUntil: me.editor_device_banned_until || null
    } : null,
    pricingVisible: pricingVisible,
    serverPricingCount: Object.keys(serverPricing).length,
    bundled: { count: bundled.count || 0, source: bundled.source || "none" },
    maxPlus: cfg.maxPlus || null,
    rows: rows,
    counts: {
      total: rows.length,
      available: rows.filter(function (r) { return r.status === "available"; }).length,
      busy: rows.filter(function (r) { return r.status === "busy"; }).length,
      unavailable: rows.filter(function (r) { return r.status === "unavailable"; }).length,
      promo: rows.filter(function (r) { return !!r.promo; }).length
    }
  };
}

module.exports = {
  STATE_DB: STATE_DB, SIDECAR: SIDECAR,
  pickSession: pickSession, readSessionFromDb: readSessionFromDb, tokenState: tokenState,
  refreshSession: refreshSession, fetchCloud: fetchCloud,
  discountToZhe: discountToZhe, applyPromo: applyPromo, makePricingIndex: makePricingIndex, lookupPrice: lookupPrice,
  request: request, backendOf: backendOf, apiOriginOf: apiOriginOf
};
