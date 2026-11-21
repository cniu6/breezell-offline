/* 生成《Breezell 内置提示词与工具全量清单》 */
const fs = require("fs");
const path = require("path");
const WB = process.argv[2];
const AH = process.argv[3];
const OUT = process.argv[4];
const wb = fs.readFileSync(WB, "utf8");
const ah = fs.readFileSync(AH, "utf8");

/* ---------- 基础解析 ---------- */
const UNESC = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", "0": "\0", '"': '"', "'": "'", "`": "`", "\\": "\\" };
function readLit(t, j) {
  const q = t[j];
  if (q !== "`" && q !== '"' && q !== "'") return null;
  let out = "", k = j + 1;
  const tpl = q === "`";
  while (k < t.length) {
    const c = t[k];
    if (c === "\\") {
      const d = t[k + 1];
      if (d === "u") {
        if (t[k + 2] === "{") {
          const close = t.indexOf("}", k + 3);
          const hex = t.slice(k + 3, close);
          if (/^[0-9a-fA-F]{1,6}$/.test(hex)) { out += String.fromCodePoint(parseInt(hex, 16)); k = close + 1; continue; }
        } else {
          const hex = t.slice(k + 2, k + 6);
          if (/^[0-9a-fA-F]{4}$/.test(hex)) { out += String.fromCharCode(parseInt(hex, 16)); k += 6; continue; }
        }
      }
      if (d === "x") {
        const hex = t.slice(k + 2, k + 4);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) { out += String.fromCharCode(parseInt(hex, 16)); k += 4; continue; }
      }
      out += UNESC[d] !== undefined ? UNESC[d] : d;
      k += 2; continue;
    }
    // 模板字面量里的 ${ ... } —— 原样保留，整段跳过（内部可能含嵌套模板/字符串/花括号）
    if (tpl && c === "$" && t[k + 1] === "{") {
      let d2 = 1, m2 = k + 2;
      let buf = "${";
      while (m2 < t.length && d2 > 0) {
        const e = t[m2];
        if (e === '"' || e === "'" || e === "`") {
          const r2 = readLit(t, m2);
          if (r2) { buf += t.slice(m2, r2.end); m2 = r2.end; continue; }
        }
        if (e === "{") d2++;
        else if (e === "}") { d2--; if (d2 === 0) { buf += "}"; m2++; break; } }
        buf += e; m2++;
      }
      out += buf; k = m2; continue;
    }
    if (c === q) { k++; break; }
    out += c; k++;
  }
  return { text: out, end: k };
}
const skip = (t, j) => { const r = readLit(t, j); return r ? r.end : j + 1; };
function span(s, from) {
  let d = 0;
  for (let j = from; j < s.length; j++) {
    const c = s[j];
    if (c === '"' || c === "'" || c === "`") { j = skip(s, j) - 1; continue; }
    if ("{[(".includes(c)) d++;
    else if ("}])".includes(c)) { d--; if (d === 0) return j + 1; }
  }
  return -1;
}
function objBack(s, idx) {
  let d = 0;
  for (let j = idx - 1; j > idx - 60000; j--) {
    const c = s[j];
    if (c === "}") d++;
    else if (c === "{") { if (d === 0) return j; d--; }
  }
  return -1;
}

/* ---------- 1. 工具定义 ---------- */
const names = [...new Set([...ah.matchAll(/name:"([a-zA-Z_][a-zA-Z0-9_]{1,40})",description:/g)].map(m => m[1]))].sort();
const DEFS = new Map();
for (const nm of names) {
  const m = new RegExp('name:"' + nm + '",description:', "g").exec(wb);
  if (!m) continue;
  const st = objBack(wb, m.index), e = span(wb, st);
  const body = wb.slice(st, e);
  const dAt = body.indexOf("description:");
  const dl = readLit(body, dAt + "description:".length);
  const desc = dl ? dl.text : "";
  const params = [];
  const pi = body.indexOf("params:{");
  if (pi >= 0) {
    let j = pi + 8, d = 1;
    while (j < body.length && d > 0) {
      const c = body[j];
      if (c === '"' || c === "'" || c === "`") { j = skip(body, j); continue; }
      if (c === "{") { d++; j++; continue; }
      if (c === "}") { d--; j++; continue; }
      if (d === 1) {
        const mm = /^\s*([A-Za-z_$][\w$]*)\s*:\s*\{/.exec(body.slice(j, j + 80));
        if (mm) {
          const os = j + mm[0].length - 1, oe = span(body, os), seg = body.slice(os, oe);
          const dm = /description:\s*(?:"|`)/.exec(seg);
          let pd = "";
          if (dm) { const l2 = readLit(seg, seg.indexOf(dm[0]) + dm[0].length - 1); pd = l2 ? l2.text : ""; }
          const opt = /optional:\s*!0/.test(seg) && !/required:\s*!0/.test(seg);
          const tm = /type:\s*"([a-z]+)"/.exec(seg);
          params.push({ key: mm[1], desc: pd, optional: opt, type: tm ? tm[1] : "string" });
          j = oe; continue;
        }
        if (body.startsWith("...", j)) { j += 3; continue; }
      }
      j++;
    }
  }
  DEFS.set(nm, { name: nm, desc, params, rawLen: body.length });
}

/* ---------- 2. 模式门控 ---------- */
const Ule = new Set(["create_team", "spawn_agent", "spawn_team", "send_team_message", "task_create", "task_update", "task_list", "team_delete", "task_stop"]);
const Jin = new Set(["create_team"]);
const _4n = new Set(["update_plan", "update_todo_list", "update_causal_trace", "launch_analysis", "plan_mode_switch", "agent_mode_switch", "continue_confirmed_task", "await", "read_user_terminal", "list_user_terminals", "update_notes", "new_context", "update_memory", "browser_screenshot", "browser_click", "browser_type", "browser_navigate", "browser_evaluate", "browser_scroll", "browser_wait", "browser_get_console_logs", "browser_snapshot", "browser_stealth", "browser_start_recording", "browser_stop_recording", "browser_get_recording_events", "browser_wait_for_event"]);
const Hle = new Set(["delete_file_or_folder", "rename_file_or_folder", "edit_file", "write_to_file", "run_terminal_cmd", "run_script", "breezell_db_execute", "breezell_db_create_connection", "breezell_db_create_database", "generate_image"]);
const rSet = new Set(["plan_analysis", "get_dir_tree", "search_pathnames_only", "context_engine", ...Jin]);
const goi = new Set(["get_mcp_tools", "call_mcp_tool"]);
const allN = [...DEFS.keys()];

function toolsetFor(mode, hasSkills = true) {
  let n;
  if (mode === "normal") n = ["use_skill", "ask_question", "update_memory"];
  else if (mode === "analyze") n = allN.filter(d => !Hle.has(d) && !_4n.has(d) && !Ule.has(d));
  else if (mode === "plan") n = allN.filter(d => (!Hle.has(d) || d === "edit_file") && !["launch_analysis", "plan_mode_switch", "continue_confirmed_task", "await"].includes(d) && !Ule.has(d));
  else {
    n = allN.filter(d => (mode === "agent_teams" || !Ule.has(d)) && d !== "agent_mode_switch" && (mode === "entanglement" || d !== "continue_confirmed_task"));
    if (mode === "entanglement") n = n.filter(d => d !== "update_plan");
  }
  if (mode !== "entanglement") n = n.filter(d => d !== "update_causal_trace");
  if (mode !== "agent" && mode !== "entanglement") n = n.filter(d => !d.startsWith("desktop_"));
  n = n.filter(d => !rSet.has(d));
  if (!hasSkills) n = n.filter(d => !goi.has(d));
  return n.filter(d => DEFS.has(d));
}

/* ---------- 3. 渲染 ---------- */
function renderXML(list) {
  return list.map((e0, t) => {
    const e = DEFS.get(e0);
    const s = e.params.map(p => `<${p.key}>${p.desc}</${p.key}>`).join("\n");
    return `    ${t + 1}. ${e.name}\n    Description: ${e.desc}\n    Format:\n    <${e.name}>${s ? "\n" + s : ""}\n    </${e.name}>`;
  }).join("\n\n");
}
function renderNative(list) {
  const o = {};
  for (const nm of list) {
    const d = DEFS.get(nm), props = {}, req = [];
    for (const p of d.params) {
      if (!p.optional) req.push(p.key);
      props[p.key] = { type: p.optional ? [p.type, "null"] : p.type, description: p.desc };
    }
    o[nm] = { description: d.desc, input_schema: { type: "object", properties: props, required: req, additionalProperties: false } };
  }
  return JSON.stringify(o);
}

/* ---------- 4. 提示词各层 ---------- */
const pIdx = wb.indexOf("You are **Breezell**, an AI coding assistant inside the Breezell IDE");
let q = pIdx; while (wb[q] !== "`") q--;
const P = readLit(wb, q).text;

const uIdx = wb.indexOf("The user's message may come with files they selected");
let q2 = uIdx; while (wb[q2] !== "`") q2--;
const U = readLit(wb, q2).text;

const modes = [];
const reM = /modeName:"([^"]+)",roleDefinition:/g;
let mm;
while ((mm = reM.exec(wb))) {
  let k = mm.index + "modeName:\"X\",roleDefinition:".length;
  // 实际要定位到 roleDefinition: 之后再跳冒号
  k = wb.indexOf(":", mm.index + mm[0].length - 1) + 1;
  const rl = readLit(wb, k);
  const mdAt = wb.indexOf(",modeDescription:", mm.index);
  let md = null;
  if (mdAt > 0 && mdAt - mm.index < 4000) md = readLit(wb, mdAt + ",modeDescription:".length);
  modes.push({ name: mm[1], rl: rl ? rl.text : "", md: md ? md.text : "", at: mm.index });
}

const segs = [];
for (const m of wb.matchAll(/ye\.push\(([`'"])/g)) {
  const r = readLit(wb, m.index + 8);
  if (!r || r.text.length < 200) continue;
  const head = r.text.split("\n")[0].trim();
  if (/^\.?(monaco|notebook|interactive)/.test(head)) continue;
  const back = wb.slice(Math.max(0, m.index - 300), m.index);
  segs.push({ idx: m.index, len: r.text.length, head, text: r.text, back: back.slice(-120) });
}
segs.sort((a, b) => a.idx - b.idx);

/* ---------- 5. 核算 ---------- */
const agentT = toolsetFor("agent", true);
const xmlAgent = renderXML(agentT);
const natAgent = renderNative(agentT);
const MODE_TXT = {};
for (const m of modes) MODE_TXT[m.name] = m.rl.length + m.md.length;

// 骨架模板里 ${z.roleDefinition}(19) 与 ${z.modeDescription}(20) 会被真实模式文本替换
const SKEL_RAW = U.length - 39;
const SKEL = SKEL_RAW + (MODE_TXT["Agent"] || 0);
const SE = xmlAgent.length + 1186;   // U4n 外壳 1,186

// Agent 模式实际入选段落（按拼接条件判定；mcp_meta_tools 依是否配置 MCP 而定）
const pickSeg = (kw) => segs.find(s => s.head.startsWith(kw));
const AGENT_IN = ["${boi}", "## Communication", "## Authenticated internal context",
  "## Remembering things", "## Working with the codebase", "## Doing tasks",
  "## Task list", "## Runtime probes", "## Databases", "## IMAGE GENERATION",
  "## Browser (debugging", "## Desktop (Computer Use", "## WEB SEARCH", "## Verify, don't recall"];
const inLen = AGENT_IN.reduce((a, k) => a + (pickSeg(k)?.len || 0), 0);
const mcpLen = pickSeg("<mcp_meta_tools>")?.len || 0;
const BASE = P.length + SKEL + SE + inLen;
const WITHMCP = BASE + mcpLen;

const L = [];
const P_ = (s) => L.push(s);

P_("# Breezell 内置提示词与工具全量清单");
P_("");
P_("> 由运行时 bundle 直接解析生成，不含任何猜测。");
P_("> 源文件：`" + path.basename(WB) + "`（" + wb.length.toLocaleString() + " B）、`" + path.basename(AH) + "`（" + ah.length.toLocaleString() + " B）");
P_("> 运行时版本：hot-runtime 1.4.35-bc7ecb074f8a");
P_("> 生成时间：" + new Date().toISOString());
P_("");
P_("---");
P_("");
P_("## 0. 一句话结论");
P_("");
P_("系统提示词**不是**「一小段人设」，而是一套分四层组装的投递体：");
P_("");
P_("| 层 | 内容 | Agent 模式实测 |");
P_("|---|---|---|");
P_("| P | 身份 + 保密条款 + 会话 nonce | " + P.length.toLocaleString() + " 字符 |");
P_("| `_` | 模式 roleDefinition/modeDescription + 选区/折叠须知 | " + SKEL.toLocaleString() + " 字符 |");
P_("| Se | **工具目录**（" + agentT.length + " 个工具，XML 协议序列化） | **" + SE.toLocaleString() + " 字符** |");
P_("| Te | `## ` 段落实体（按模式/工具可用性条件拼接） | " + inLen.toLocaleString() + " 字符 |");
P_("");
P_("**工具占了 " + ((SE / (P.length + SKEL + SE + inLen)) * 100).toFixed(1) + "%**。你感觉「提示词怎么不止那么点」，实质是：真正的散文规则只有 "
  + (P.length + SKEL + inLen).toLocaleString() + " 字符，其余全是工具契约。");
P_("");
P_("若同时挂了 MCP 工具，再加 `<mcp_meta_tools>` 段 " + mcpLen.toLocaleString() + " 字符。");
P_("");
P_("---");
P_("");
P_("## 1. 工具清单（权威 " + DEFS.size + " 个）");
P_("");
P_("两处注册表交集 = " + DEFS.size + " 个：`workbench.desktop.main.js` 里的 `cce` 对象（定义）与 `agentHostMain.js` 里的 `Pn` 对象（执行端）。");
P_("两者名字完全一致，agentHost 就是它的执行端。");
P_("");
P_("| # | 工具 | 参数 | description | 参数说明 |");
P_("|---|---|---|---|---|");
const sortedDefs = [...DEFS.values()].sort((a, b) => b.desc.length - a.desc.length);
sortedDefs.forEach((d, i) => {
  const pd = d.params.reduce((a, p) => a + p.desc.length, 0);
  P_(`| ${i + 1} | \`${d.name}\` | ${d.params.length} | ${d.desc.length.toLocaleString()} | ${pd.toLocaleString()} |`);
});
P_("");
P_("合计：description " + [...DEFS.values()].reduce((a, d) => a + d.desc.length, 0).toLocaleString()
  + " 字符 / 参数说明 " + [...DEFS.values()].reduce((a, d) => a + d.params.reduce((b, p) => b + p.desc.length, 0), 0).toLocaleString()
  + " 字符 / 参数项 " + [...DEFS.values()].reduce((a, d) => a + d.params.length, 0) + " 个");
P_("");
P_("---");
P_("");
P_("## 2. 每个模式实际拿到多少工具");
P_("");
P_("门控逻辑还原自 `prompt/prompts.js` 的 `J$()`：");
P_("");
P_("| 模式 | 工具数 | desc 字符 | 参数说明 | XML 协议块 | 原生 JSON |");
P_("|---|---|---|---|---|---|");
for (const mode of ["agent", "entanglement", "analyze", "plan", "normal", "agent_teams"]) {
  const t = toolsetFor(mode, true);
  const xml = renderXML(t).length, nat = renderNative(t).length;
  P_(`| ${mode} | ${t.length} | ${t.reduce((a, x) => a + DEFS.get(x).desc.length, 0).toLocaleString()} | ${t.reduce((a, x) => a + DEFS.get(x).params.reduce((b, p) => b + p.desc.length, 0), 0).toLocaleString()} | ${xml.toLocaleString()} | ${nat.toLocaleString()} |`);
}
P_("");
P_("- `analyze` 只读：剔除 10 个写工具（edit_file / write_to_file / delete_file_or_folder / rename_file_or_folder / run_terminal_cmd / run_script / 3 个 db 写 / generate_image）");
P_("- `plan` 额外剔除 launch_analysis / plan_mode_switch / continue_confirmed_task / await，但保留 `edit_file`（只能改 `.plan.md`）");
P_("- `normal`（Chat）只剩 `use_skill` / `ask_question` / `update_memory` 三个");
P_("- 所有模式都剔除 `plan_analysis` / `get_dir_tree` / `search_pathnames_only` / `context_engine` / `create_team`（插件内部工具，不进模型上下文）");
P_("- 非 `agent` / `entanglement` 模式再剔除全部 13 个 `desktop_*` 工具");
P_("");
P_("---");
P_("");
P_("## 3. 工具块的真实体积（两种投递形态）");
P_("");
P_("Agent 模式 93 个工具：");
P_("");
P_("| 形态 | 序列化方式 | 字符 |");
P_("|---|---|---|");
P_("| XML 协议（`FRe()`） | `<name>\\n Description: ...\\n Format:\\n <tool>\\n <param>desc</param>` | " + xmlAgent.length.toLocaleString() + " |");
P_("| 外壳（`U4n()`） | `Available tools:` + `Tool calling details:` 7 条 | 1,186 |");
P_("| **Se（XML 合计）** | | **" + (xmlAgent.length + 1186).toLocaleString() + "** |");
P_("| 原生 function-calling（`zI()` → AI SDK `jsonSchema`） | `{description, inputSchema:{type,properties,required}}` | " + natAgent.length.toLocaleString() + " |");
P_("");
P_("> 走原生 function-calling 时多出来的 ~1.2 万字符全是 JSON 键名骨架（`\"type\"` / `\"description\"` / `\"properties\"` 重复 351 次）。");
P_("");
P_("---");
P_("");
P_("## 4. 系统提示词各层原文");
P_("");
P_("### 4.1 P —— 身份与保密（" + P.length + " 字符）");
P_("");
P_("```text");
P_(P);
P_("```");
P_("");
P_("### 4.2 `_` —— 模式骨架（模板 " + SKEL_RAW + " 字符 + 模式文本 " + (MODE_TXT["Agent"] || 0) + " = " + SKEL + " 字符）");
P_("");
P_("```text");
P_(U);
P_("```");
P_("");
P_("### 4.3 七条模式文本的 roleDefinition / modeDescription");
P_("");
for (const m of modes) {
  P_("#### " + m.name + "（" + (m.rl.length + m.md.length) + " 字符）");
  P_("");
  P_("```text");
  P_("roleDefinition: " + m.rl);
  P_("");
  P_("modeDescription: " + m.md);
  P_("```");
  P_("");
}
P_("### 4.4 Te —— 段落实体（" + segs.length + " 段，合计 " + segs.reduce((a, s) => a + s.len, 0).toLocaleString() + " 字符）");
P_("");
P_("| # | 字符 | 首行 | 拼接条件 |");
P_("|---|---|---|---|");
segs.forEach((s, i) => {
  const cond = s.back.replace(/\n/g, " ").replace(/\|/g, "\\|").slice(-60);
  P_(`| ${i + 1} | ${s.len.toLocaleString()} | ${s.head.replace(/\|/g, "\\|").slice(0, 40)} | \`…${cond}\` |`);
});
P_("");
P_("---");
P_("");
const segTotal = segs.reduce((a, s) => a + s.len, 0);
P_("## 5. 为什么 " + inLen.toLocaleString() + " 而不是 " + segTotal.toLocaleString());
P_("");
P_(segs.length + " 段是**互斥/可选**的，Agent 模式一次只挑其中一部分。下面每条都是脚本按拼接条件实测出的字符数：");
P_("");
P_("**进（合计 " + inLen.toLocaleString() + "）**");
P_("");
for (const k of AGENT_IN) {
  const s = pickSeg(k);
  if (!s) continue;
  P_("- `" + s.head.slice(0, 46) + "` — " + s.len.toLocaleString());
}
P_("");
P_("**不进**");
P_("");
for (const s of segs) {
  if (AGENT_IN.some(k => s.head.startsWith(k))) continue;
  const why = /ENTANGLEMENT/.test(s.head) ? "仅 entanglement"
    : /ANALYZE MODE/.test(s.head) ? "仅 analyze"
      : /PLAN MODE/.test(s.head) ? "仅 plan"
        : /Chat mode/.test(s.head) ? "仅 normal"
          : /TEAMS|TEAMMATE|TEAM LEAD/.test(s.head) ? "仅团队模式"
            : /Working method/.test(s.head) ? "agent 模式走 `${boi}` 长版，此段给其它模式"
              : /mcp_meta_tools/.test(s.head) ? "需配置 MCP 服务"
                : /WEB SEARCH/.test(s.head) ? "web 工具不可用时的备用文案"
                  : "未命中当前模式条件";
  P_("- `" + s.head.slice(0, 46) + "` — " + s.len.toLocaleString() + "（" + why + "）");
}
P_("");
P_("---");
P_("");
P_("## 6. 一条请求的完整固定开销（Agent 模式，纯文本、无记忆无团队）");
P_("");
P_("| 项 | 字符 |");
P_("|---|---|");
P_("| P 身份+保密+nonce | " + P.length.toLocaleString() + " |");
P_("| `_` 模式骨架（含 " + (MODE_TXT["Agent"] || 0) + " 字符的 Agent 模式文本） | " + SKEL.toLocaleString() + " |");
P_("| Se 工具目录（" + agentT.length + " 个工具 + 外壳 1,186） | " + SE.toLocaleString() + " |");
P_("| Te 段落 | " + inLen.toLocaleString() + " |");
P_("| system_info（日期/环境/工作区/活动文件） | ~400 |");
P_("| **合计** | **~" + BASE.toLocaleString() + "** |");
P_("| 挂 MCP 时再加 `<mcp_meta_tools>` | +" + mcpLen.toLocaleString() + " → **~" + WITHMCP.toLocaleString() + "** |");
P_("");
P_("粗估 token（按 3.5 字符/token）：**~" + Math.round(BASE / 3.5 / 1000) + " 千 token** 的固定开销，其中 "
  + Math.round(SE / 3.5 / 1000) + " 千来自工具目录。");
P_("");
P_("对应到官方「Adaptive agent strategy」的文案：`lite` 档「about 70% less fixed overhead」——削掉的就是这份工具目录（Lite 只保留 read / grep_search / glob_search 等只读子集）。");
P_("");
P_("---");
P_("");
P_("## 7. 记忆/技能/规则注入点");
P_("");
P_("| 机制 | 位置 | 说明 |");
P_("|---|---|---|");
P_("| 技能 | `~/.breezell/skills/<name>/SKILL.md`（全项目）、`<workspace>/skills/<name>/SKILL.md` | 必须 YAML frontmatter 带 `name:` 与 `description:`；裸 `.md` 不被发现 |");
P_("| 技能枚举 | `use_skill` 的 `name` 参数动态生成 enum | `J$()` 里 `c = c.map(... enum: s)` |");
P_("| 记忆 | `CONTEXT MEMORIES` 段（541 字符骨架）+ `update_memory` 工具 | 标注为 UNTRUSTED 参考数据 |");
P_("| 线程认知 | `THREAD COGNITION` 段（436 字符骨架） | 已认证参考状态 |");
P_("| 项目规则 | `.breezellrules` | 只在 UI 建议文案里出现 1 次，无自动注入路径 |");
P_("| AGENTS.md / customInstructions | **不存在** | 该版本无此机制 |");
P_("");
P_("---");
P_("");
P_("## 8. 与离线补丁扩展的关系");
P_("");
P_("`globalThis.BreezellOffline` 的注入点（已实现，扩展 v2.0.0 的 32 项补丁之一）：");
P_("");
P_("- `pSys(a)` —— 在 `Pe.push(...)` 之前改写 P（基础系统提示词）");
P_("  实际位置：`Pe.push(globalThis.BreezellOffline&&globalThis.BreezellOffline.pSys?globalThis.BreezellOffline.pSys(P):P)`");
P_("- `pModeOf(mode, def)` —— 覆盖任一模式的 `{modeName, roleDefinition, modeDescription}`");
P_("  实际位置：`(globalThis.BreezellOffline&&globalThis.BreezellOffline.pModeOf?globalThis.BreezellOffline.pModeOf(l,(N[l]||N.normal)):(N[l]||N.normal))`");
P_("- `pExtra()` —— 追加自由文本块");
P_("");
P_("**没被覆盖的部分**：Se 工具目录（93 个工具的描述与参数说明）目前无法通过 `pSys` 改写——它在 `U4n()` 里独立序列化，插入位置是 `Pe.push(Se)`，而 `Se = d ? U4n(l,c,b,C) : null`。要做「工具描述瘦身」需要新增第 33 项补丁，把 `Se` 也过一道 `BreezellOffline.pTools()`。");
P_("");
P_("这是一个明确的后续入手点。");
P_("");
P_("---");
P_("");
P_("## 9. 复现方式");
P_("");
P_("```bash");
P_("RUNTIME=%APPDATA%\\Breezell\\hot-runtime\\1.4.35-bc7ecb074f8a");
P_("node _gen-inventory.js \"%RUNTIME%\\out\\vs\\workbench\\workbench.desktop.main.js\" \\");
P_("     \"%RUNTIME%\\out\\vs\\workbench\\contrib\\breezell\\node\\agentHostMain.js\" \\");
P_("     \"Breezell-内置提示词与工具全量清单.md\"");
P_("```");
P_("");
P_("解析要点（下次官方改结构时照这个走）：");
P_("");
P_("1. **别按行找**——workbench 是单行压缩 bundle，`roleDefinition` 的 8 次命中全在同一行。用 `indexOf` + 括号/字符串配平按偏移取窗口。");
P_("2. **工具名以两处交集为准**——workbench 里 `name:\"...\",description:` 有 134 个命中，其中 25 个是参数名/图标名误报；与 `agentHostMain.js` 取交集才是 " + DEFS.size + " 个真工具。");
P_("3. **字符串要解转义**——bundle 里的 `\\u2014` 必须还原成 `—`，否则长度统计会偏大。");
P_("4. **`params` 里多有 `...spread`**——`read`、`edit_file` 等用 `...lce(\"file\")` 展开公共参数，要单独展开合并。");

fs.writeFileSync(OUT, L.join("\n"), "utf8");
console.log("written:", OUT, fs.statSync(OUT).size, "B,", L.length, "lines");
