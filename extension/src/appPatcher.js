"use strict";
/* breezell-offline :: appPatcher v1 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cp = require("child_process");
const VERSION = "3.4.13";
/* 固定声明：本版补丁锚点针对的 Breezell 版本（换版本时这里要跟着改） */
const BREEZELL_SUPPORTED = "1.4.64";
const MARK = "/*bzl-offline:v1*/";
const CHECKSUM_KEY = "vs/workbench/workbench.desktop.main.js";
const MAIN_REL = ["out", "main.app.js"];
const WB_REL = ["out", "vs", "workbench", "workbench.desktop.main.js"];
const PROD_REL = ["product.json"];
const AGENT_REL = ["out", "vs", "workbench", "contrib", "breezell", "node", "agentHostMain.js"];
const GATE_RE = /if\(\w+!=="breezell"\)\{/;
/* --- anti-poll (v1.1) --- */
const UPDATE_GETTER_ON = 'get disableUpdates(){return!!this.args["disable-updates"]}';
const UPDATE_GETTER_OFF = "get disableUpdates(){return!0}";
const HOTDEF_ON = "hotUpdateAutoCheck:!0,hotUpdateAutoCheckSeconds:10";
const HOTDEF_OFF = "hotUpdateAutoCheck:!1,hotUpdateAutoCheckSeconds:86400";
const ACMIN_ON = "const s=Math.max(1e3,e.intervalMs-1e3);";
const ACMIN_OFF = "const s=Math.max(18e5,e.intervalMs-1e3);";
const MCFG_OFF = "if(!(s-this.a<18e5)){this.a=s;";
const MCFG_RE = /if\(!\(s-this\.a<[0-9eE.*+\-]+\)\)\{this\.a=s;/;
const SCHED5M_ON = "this.j.trigger(()=>{},1e3*60*5)";
const SCHED5M_OFF = "this.j.trigger(()=>{},216e5)";
const SCHED10S_OFF = "u(e){return}";
const SCHED10S_ON_RE = /u\(e\)\{this\.w\(\),this\.a=\w+\.setTimeout\(\(\)=>\{this\.z\(\)\},e\)\}/;
const GATE30_ON = "setInterval(()=>{n()},3e4)";
const GATE30_OFF = "setInterval(()=>{n()},3e5)";
const GATE120_ON = "setInterval(()=>{c()},2*6e4)";
const GATE120_OFF = "setInterval(()=>{c()},6e5)";
const POLL10_RE = /(\w+)=!1,(\w+)=1e4,(\w+)=new Set/;
const POLL10_DONE_RE = /\w+=!1,\w+=6e5,\w+=new Set/;
const POLL10_DONE_ANY_RE = /\w+=!1,\w+=(?:6e5|3e5|12e5|6e6|36e5),\w+=new Set/;
const BANNER_RE = /(\w+)=6e4,(\w+)=this\.c\.breezellBackendEndpoint,/;
const BANNER_DONE_RE = /\w+=6e5,\w+=this\.c\.breezellBackendEndpoint,/
const CTRL_ON = '"controlUrl": "https://main.vscode-cdn.net/extensions/marketplace.json"';
const CTRL_OFF = '"controlUrl": ""';
const MB_ON_RE = /Mb\(\)\{return this\.\w+\.getValue\(\w+\)\}/;
const UPDATE_GETTER_ON_RE = /get disableUpdates\(\)\{return!!this\.args\["disable-updates"\]\}/;
const HOTDEF_ON_RE = /hotUpdateAutoCheck:!0,hotUpdateAutoCheckSeconds:\d+/;
const ACMIN_ON_RE = /const \w+=Math\.max\(1e3,e\.intervalMs-1e3\);/;
const MB_OFF = "Mb(){return!1}";
const MB_DONE_RE = /Mb\(\)\{return!1\}/;
const VIK_ON = 'async t(){const e=this.g.breezellBackendEndpoint;if(!e)return null;const s=(await this.h.getSessions("breezell"))?.[0]?.accessToken;return s?{endpoint:e,token:s}:null}';
const VIK_OFF = "async t(){if(!(globalThis.BreezellOffline&&globalThis.BreezellOffline.allowViking))return null;const e=this.g.breezellBackendEndpoint;if(!e)return null;const s=(await this.h.getSessions(\"breezell\"))?.[0]?.accessToken;return s?{endpoint:e,token:s}:null}";
const CAPS_ANY_RE = /\{hasSuperMemory:!1,hasCustomProvider:!1,plan:"[^"]*",sub:"[^"]*",exp:\d+\}/;
const CAPS_ANY_RE2 = /\{hasSuperMemory:(?:!1|!0),hasCustomProvider:(?:!1|!0),plan:"[^"]*",sub:"[^"]*",exp:\d+\}/;
/* 1.4.37 起能力对象多了 hasCloudTelemetry 字段，锚点需容忍 */
const CAPS_ANY_RE3 = /\{hasSuperMemory:(?:!1|!0),hasCustomProvider:(?:!1|!0)(?:,hasCloudTelemetry:(?:!1|!0))?,plan:"[^"]*",sub:"[^"]*",exp:\d+\}/;
const CAPS_DONE_RE = /hasSuperMemory:!0,hasCustomProvider:!0(?:,hasCloudTelemetry:(?:!0|!1))?,plan:"pro",sub:"pro",exp:0\}/;
const CAPS_DEF_RE3 = /\{hasSuperMemory:!1,hasCustomProvider:!1(?:,hasCloudTelemetry:!1)?,plan:"[^"]*",sub:"[^"]*",exp:\d+\}/;
const STUDIO_ANY_RE = /\{hasCustomProvider:(?:!1|!0),reason:"[^"]*",plan:"[^"]*"\}/;
const CTRL_ANY_RE = /"controlUrl"\s*:\s*"[^"]*"/;
const SESS_POLL_RE = /setInterval\(\(\)=>this\.O\(\),60\*1e3\)/;
const TERM_POLL_RE = /setInterval\(\(\)=>\{this\.[A-Za-z_$][\w$]*\(\)\.catch\(\(\)=>\{\}\)\},6e4\)/;
const PRES_POLL_RE = /setInterval\(\(\)=>this\.[A-Za-z_$][\w$]*\(\),2500\)/;
const SESS_POLL_DONE_RE = /setInterval\(\(\)=>this\.[A-Za-z_$][\w$]*\(\),6e5\)/;
const TERM_POLL_DONE_RE = /setInterval\(\(\)=>\{this\.[A-Za-z_$][\w$]*\(\)\.catch\(\(\)=>\{\}\)\},6e5\)/;
const PRES_POLL_DONE_RE = /setInterval\(\(\)=>this\.[A-Za-z_$][\w$]*\(\),3e4\)/;
/* --- v1.9.1: 从运行时里抽取官方模型目录（bundled catalogue 的离线快照） --- */
var MODEL_RE = /"([A-Za-z0-9][A-Za-z0-9._:\/+\-]{2,60})":\{([^{}]{0,600}?)cost:\{([^{}]*?)\}/g;

function _num(x) {
  var t = String(x).trim();
  if (!t) return null;
  var v = Number(t);
  return isNaN(v) ? null : v;
}

/* roots: [{root,label}]，按序尝试；第一个能抽出 >0 条的胜出。
 * 返回 {count, models, source}；全失败返回 {count:0, models:[], source:"none"}。 */
function extractModels(roots) {
  for (var r = 0; r < (roots || []).length; r++) {
    var wb = path.join(roots[r].root, "out", "vs", "workbench", "workbench.desktop.main.js");
    var s;
    try { s = read(wb); } catch (e) { continue; }
    if (!s) continue;
    var out = [], seen = {}, m;
    MODEL_RE.lastIndex = 0;
    while ((m = MODEL_RE.exec(s)) !== null) {
      var id = m[1];
      if (seen[id]) continue;
      seen[id] = 1;
      var mid = m[2], cost = m[3];
      var cw = /contextWindow:([0-9.e+]+)/.exec(mid);
      var rs = /reservedOutputTokenSpace:([0-9.e+]+)/.exec(mid);
      var d = {};
      var parts = cost.split(",");
      for (var i = 0; i < parts.length; i++) {
        var kv = parts[i].split(":");
        if (kv.length !== 2) continue;
        d[kv[0].trim()] = _num(kv[1]);
      }
      out.push({
        id: id,
        ctx: cw ? _num(cw[1]) : null,
        res: rs ? _num(rs[1]) : null,
        "in": d.input === undefined ? null : d.input,
        out: d.output === undefined ? null : d.output,
        cr: d.cache_read === undefined ? null : d.cache_read,
        cw: d.cache_write === undefined ? null : d.cache_write
      });
    }
    if (out.length > 0) return { count: out.length, models: out, source: roots[r].label || roots[r].root };
  }
  return { count: 0, models: [], source: "none" };
}

/* --- F14: vikingRetriever.y() vector-search guard (v1.4.1) --- */
const VIK_QS_ON = "async y(e,t,s,n){const u=await this.h.getAllEmbeddings();";
const VIK_QS_OFF = "async y(e,t,s,n){if(!(globalThis.BreezellOffline&&globalThis.BreezellOffline.allowViking))return[];const u=await this.h.getAllEmbeddings();";
const VIK_QS_DONE_RE = /async y\([A-Za-z_$][\w$]*(?:,[A-Za-z_$][\w$]*){3}\)\{if\(!\!?\(?globalThis\.BreezellOffline/;
/* --- v1.5.0: prompt override + offline config (H1/F15/F16/B4) --- */
const CFG_REL = ["Breezell", "breezell-offline-config.json"];
const PM_CAP_CASE = 'case"pushPrompt":{try{const _p=(arguments[2]&&arguments[2][0])||{},_b=String(_p.body||""),_fs=await import("fs"),_pt=await import("path"),_d=_pt.join(process.env.APPDATA||"","Breezell");_fs.mkdirSync(_d,{recursive:!0});_fs.writeFileSync(_pt.join(_d,"breezell-offline-lastreq.json"),JSON.stringify({at:(new Date).toISOString(),url:String(_p.url||""),len:_b.length,body:_b}),"utf8");return{ok:!0,len:_b.length}}catch(_e){return{ok:!1,error:String(_e&&_e.message)}}}';
const PM_CAP_DONE_RE = /case"pushPrompt"/;
const PM_CQ_SWITCH = 'default:throw new Error(`[CapabilityChannel] Unknown command: ${e}`)}}';
const PM_CQ_EXTRA = 'case"pushSettings":{try{const _p=(arguments[2]&&arguments[2][0])||{},_fs=await import("fs"),_pt=await import("path"),_d=_pt.join(process.env.APPDATA||"","Breezell"),_f=_pt.join(_d,"breezell-offline-settings.json");_fs.mkdirSync(_d,{recursive:!0});_fs.writeFileSync(_f,JSON.stringify({at:(new Date).toISOString(),settings:_p}),"utf8");return{ok:!0}}catch(_e){return{ok:!1,error:String(_e&&_e.message)}}}case"readOps":{try{const _fs=await import("fs"),_pt=await import("path"),_f=_pt.join(process.env.APPDATA||"","Breezell","breezell-offline-ops.json");let _raw=null;try{_raw=_fs.readFileSync(_f,"utf8")}catch(_e){return{ok:!0,ops:[]}}let _o=JSON.parse(_raw);return{ok:!0,ops:(_o&&_o.ops)||[]}}catch(_e){return{ok:!1,ops:[],error:String(_e&&_e.message)}}}case"ackOps":{try{const _fs=await import("fs"),_pt=await import("path"),_f=_pt.join(process.env.APPDATA||"","Breezell","breezell-offline-ops.json"),_id=String((s&&s[0]&&s[0].id)||"");if(!_id)return{ok:!1};let _o={ops:[]};try{_o=JSON.parse(_fs.readFileSync(_f,"utf8"))||{ops:[]}}catch(_e){}_o.ops=(_o.ops||[]).filter(function(_x){return _x&&_x.id!==_id});_fs.writeFileSync(_f,JSON.stringify(_o),"utf8");return{ok:!0}}catch(_e){return{ok:!1,error:String(_e&&_e.message)}}}';

// —— 3.3.0 模型选择：复用 Breezell 自己配置的 provider（设置里的「专用模型」同源）——
const PM_PROV_ANCHOR = ',pRefresh:function(){';
const PM_PROV_ON = ',pProv:function(){try{var k=g.BreezellOffline.__ch;if(!k)return;var st=s.state||{},so=st.settingsOfProvider||{},out=[];for(var id in so){try{var o=so[id]||{},ms=[];var arr=o.models||[];for(var i=0;i<arr.length;i++){var m0=arr[i]||{};if(m0.isHidden)continue;ms.push({id:String(m0.modelName||m0.id||m0.name||""),name:String(m0.modelName||m0.name||m0.id||"")});}out.push({id:String(id),apiKey:String(o.apiKey||""),baseUrl:String(o.baseUrl||o.endpoint||""),defaultModel:String(o.defaultModel||""),models:ms});}catch(e){}}k.call("pushProviders",[{at:(new Date).toISOString(),providers:out}]).catch(function(){})}catch(e){}}';
const PM_PROV_DONE_RE = /,pProv:function\(\)\{try\{var k=g\.BreezellOffline\.__ch/;
const PM_PROV_IV_ANCHOR = 'pPush:function(){try{var k=g.BreezellOffline.__ch;if(!k)return;';
const PM_PROV_IV_ON = PM_PROV_IV_ANCHOR + 'try{g.BreezellOffline.pProv()}catch(e){}';
const PM_PROV_IV_DONE_RE = /pPush:function\(\)\{try\{var k=g\.BreezellOffline\.__ch;if\(!k\)return;try\{g\.BreezellOffline\.pProv\(\)\}/;
const PM_CAP_PROV = 'case"pushProviders":{try{var _p=(arguments[2]&&arguments[2][0])||{},_fs=await import("fs"),_pt=await import("path"),_d=_pt.join(process.env.APPDATA||"","Breezell"),_f=_pt.join(_d,"breezell-offline-providers.json");_fs.mkdirSync(_d,{recursive:!0});_fs.writeFileSync(_f,JSON.stringify({at:_p.at||(new Date).toISOString(),providers:_p.providers||[]}),"utf8");return{ok:!0,count:(_p.providers||[]).length}}catch(_e){return{ok:!1,error:String(_e&&_e.message)}}}';
const PM_CQ_ADD = PM_CAP_PROV + 'case"readPrompts":{try{const _fs=await import("fs"),_pt=await import("path"),_cf=_pt.join(process.env.APPDATA||"","Breezell","breezell-offline-config.json");return JSON.parse(_fs.readFileSync(_cf,"utf8"))}catch(_e){return null}}' + PM_CQ_EXTRA
  + 'case"pushNonce":{try{const _p=(arguments[2]&&arguments[2][0])||{},_n=String(_p.nonce||""),_fs=await import("fs"),_pt=await import("path"),_d=_pt.join(process.env.APPDATA||"","Breezell"),_f=_pt.join(_d,"breezell-offline-nonce.json");if(!_n)return{ok:!1,error:"empty"};if(globalThis.__bzlNonce===_n)return{ok:!0,dup:!0};globalThis.__bzlNonce=_n;const _o={at:(new Date).toISOString(),nonce:_n,mode:String(_p.mode||""),chatMode:String(_p.chatMode||""),fallback:!!_p.fallback};_fs.mkdirSync(_d,{recursive:!0});_fs.writeFileSync(_f,JSON.stringify(_o),"utf8");return{ok:!0}}catch(_e){return{ok:!1,error:String(_e&&_e.message)}}}';
const PM_CQ_DONE_RE = /case"readOps"/;
/* nonce 抓钩：跨版本兼容。不同构建里 T 的右值变量名会变（1.4.35 是 E，1.4.31/1.4.34 是 v），
 * 但 `,T=<x>.trim()||"NO_AUTHENTICATED_INTERNAL_NONCE",` 这一声明的形状稳定。 */
const PM_NONCE_ANCHOR_RE = /,([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\??\.trim\(\)\|\|"NO_AUTHENTICATED_INTERNAL_NONCE",/;
const PM_NONCE_TAIL = '_bzlN=void(globalThis.BreezellOffline&&globalThis.BreezellOffline.pNonce?globalThis.BreezellOffline.pNonce($T,F,l):0),';
const PM_NONCE_DONE_RE = /,_bzlN=void\(globalThis\.BreezellOffline&&globalThis\.BreezellOffline\.pNonce\?/;
/* --- v2.2.0: DevTools（F12）解锁 ---
 * 官方门禁链路：远端 /api/editor-client-config 的 enableDevTools -> workbench Xss.refresh() -> this.b
 *   -> isAllowed() -> 主进程 setDevToolsAllowed(!!x) -> 策略 getter -> toggleDevTools 的 if(bw())
 * 两处都钉住：workbench 的 isAllowed() 恒 true，主进程策略 setter 恒写 !0。60s 轮询也拉不回去。
 * 门禁类与命令类在不同构建里换过变量名（dar/dor/cor/kur），所以全程用形状匹配。 */
const PM_DT_ALLOW_RE = /async isAllowed\(\)\{return await this\.refresh\(\),this\.([A-Za-z_$][\w$]*)\}/;
const PM_DT_ALLOW_ON = "async isAllowed(){return" + MARK + "!0}";
const PM_DT_ALLOW_DONE_RE = /async isAllowed\(\)\{return\/\*bzl-offline:v1\*\/!0\}/;
const PM_DT_SET_RE = /setDevToolsAllowed\(([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*)\)\{([A-Za-z_$][\w$]*)\(!!\2\)\}/;
const PM_DT_SET_ON = 'setDevToolsAllowed($1,$2){$3(/*bzl-offline:v1*/!0)}';
const PM_DT_SET_DONE_RE = /setDevToolsAllowed\([A-Za-z_$][\w$]*,[A-Za-z_$][\w$]*\)\{[A-Za-z_$][\w$]*\(\/\*bzl-offline:v1\*\/!0\)\}/;
/* --- v2.3.0: titlebar 内置浏览器按钮（Breezell 浏览器工作台） ---
 * 扩展侧 contributes.menus 的 76 个合法 key 里没有 titleBar / layoutControl / commandCenter，
 * 所以只能在 workbench 里往 titlebar 的 pane-toggle 组前面插一项（order 0 < 原有 1）。
 * 组内命令支持字符串 id（bundle 里 7 处如此用），直接借官方 workbench.action.ensureBreezellBrowserOpen，
 * 不再自注册命令 —— 少一处跨版本变量依赖。
 * when 用 notEquals(config key, false)：config 未注册时值 undefined 也不会隐藏按钮。 */
const PM_TB_RE = /([A-Za-z_$][\w$]*)\.appendMenuItems\(\[\{id:([A-Za-z_$][\w$]*)\.LayoutControlMenu,item:\{group:"2_pane_toggles",command:\{id:([A-Za-z_$][\w$]*)\.ID,title:f\(3969,null\),icon:([A-Za-z_$][\w$]*),toggled:\{condition:([A-Za-z_$][\w$]*),icon:([A-Za-z_$][\w$]*)\}\},when:([A-Za-z_$][\w$]*)\.or\(/;
const PM_TB_ITEM = '{id:$MENU.LayoutControlMenu,item:{group:"2_pane_toggles",command:{id:"workbench.action.ensureBreezellBrowserOpen",title:"浏览器工作台 (Breezell Browser)",icon:$ICONX},when:$CTX.notEquals("config.breezellOffline.toolbarBrowserButton",!1),order:0}},/*bzl-offline:browserbar*/';
/* 1.4.4 起 codicon 模块变量从 ce 改名为 se（ce.globe 已不存在，直接引用会让整个 workbench 白屏）。
   按「锚点里那个图标变量的定义」反查 codicon 模块名：<iconVar>=<fn>("name",<COD>.xxx,...)。 */
function codiconVarOf(text, iconVar) {
  var iv = String(iconVar || "");
  if (!iv) return "";
  var re = /[,\s;]([A-Za-z_$][\w$]*)\s*=\s*[A-Za-z_$][\w$]*\("([^"]*)",\s*([A-Za-z_$][\w$]*)\./g;
  var t = String(text || ""), m, out = "";
  while ((m = re.exec(t))) { if (m[1] === iv) { out = m[3]; break; } }
  return out;
}
const PM_TB_DONE_RE = /\/\*bzl-offline:browserbar\*\//;
/* F21：`workbench.layoutControl.enabled=false` 时 TitlebarPart 会把整个 LayoutControlMenu 置 void 0，
   地球按钮随之消失。TitleBar 主菜单（V.TitleBar）无条件创建并渲染（`this.rb` + `ec()` 里 Xae），
   所以把同一个按钮再挂一份到 TitleBar，只在「布局控件被关掉」时显示，正好补上空档。 */
const PM_TBF_RE = /([A-Za-z_$][\w$]*)\.appendMenuItem\(([A-Za-z_$][\w$]*)\.LayoutControlMenu,\{submenu:\2\.LayoutControlMenuSubmenu,title:f\(3018,null\),icon:([A-Za-z_$][\w$]*),group:"1_workbench_layout",when:([A-Za-z_$][\w$]*)\.equals\("config\.workbench\.layoutControl\.type","menu"\)\}\)/;
const PM_TBF_ITEM = '/*bzl-offline:browserbar-fallback*/,$REG.appendMenuItem($MENU.TitleBar,{command:{id:"workbench.action.ensureBreezellBrowserOpen",title:"浏览器工作台 (Breezell Browser)",icon:$ICONX},group:"0_bzl_browser",when:$CTX.and($CTX.notEquals("config.breezellOffline.toolbarBrowserButton",!1),$CTX.or($CTX.notEquals("config.workbench.layoutControl.enabled",!0),$CTX.equals("config.workbench.layoutControl.type","menu"))),order:0})';
const PM_TBF_DONE_RE = /\/\*bzl-offline:browserbar-fallback\*\//;

/* ---- 1.4.4 (v3.0.0) 新锚点 ---- */
const PM_B2_V3_TAIL = 'return await this._fetchCaps(e,t,o)}';
const PM_B3_V3 = 'constructor(e,t,o,r,s){super();this.settingsService=t;this.logService=o;this.productService=r;this.authenticationService=s;';
const PM_B2_V3 = 'async getCapabilities(){let{backend:e,token:t}=await this._getBackendAndToken()';
const PM_B2_V3_ON = 'async getCapabilities(){return/*bzl-offline:caps*/{...OCi,hasSuperMemory:!0,hasCustomProvider:!0,hasCloudTelemetry:!0,plan:"pro",sub:"pro",exp:0}}';
const PM_B2_V3_DONE_RE = /async getCapabilities\(\)\{return\/\*bzl-offline:caps\*\//;
/* titlebar 兼容写法：标题 id 数字与图标变量都可变 */
const PM_TB_RE3 = /([A-Za-z_$][\w$]*)\.appendMenuItems\(\[\{id:([A-Za-z_$][\w$]*)\.LayoutControlMenu,item:\{group:"2_pane_toggles",command:\{id:([A-Za-z_$][\w$]*)\.ID,title:([A-Za-z_$][\w$]*)\((\d+),null\),icon:([A-Za-z_$][\w$]*),toggled:\{condition:([A-Za-z_$][\w$]*),icon:([A-Za-z_$][\w$]*)\}\},when:([A-Za-z_$][\w$]*)\.or\(/;
/* 1.4.4 已移除/换形，跳过而不报错 */
const OBSOLETE_IDS = {
  "E3-autocheck-min-interval": 1, "E4-model-config-throttle": 1,
  "F2-sched-10s-off": 1, "F3-marketplace-5m": 1, "F5-banner-60s": 1,
  "F8-ext-autocheck-off": 1, "F9-viking-endpoint-off": 1, "F10-viking-batch-off": 1,
  "F11-session-poll-10m": 1, "F14-viking-query-guard": 1, "F16-mode-override": 1,
  "F17-suppress-14056": 1, "F21-titlebar-fallback": 1,
  "F22-stream-firstbyte": 1, "F23-stream-text": 1,
  /* 1.4.63 起失效 */
  "F4-model-config-10s": 1, "A3-token-view-pro": 1
};
const PM_ST_RE = /const ks=300\*1e3,Gs=40\*1e3,Cn=15\*1e3,Ur=240\*1e3,\$a=60\*1e3,Hh=90\*1e3,Pd=30\*1e3,P4=240\*1e3,qb=45\*1e3,/;
const PM_ST_ON = 'const _bzS=globalThis.BreezellOffline&&globalThis.BreezellOffline.ms?globalThis.BreezellOffline.ms:null/*bzl-offline:stream*/,ks=_bzS?_bzS("total",3e5):3e5,Gs=_bzS?_bzS("firstByte",4e4):4e4,Cn=_bzS?_bzS("firstByteWarn",15e3):15e3,Ur=240*1e3,$a=60*1e3,Hh=90*1e3,Pd=30*1e3,P4=240*1e3,qb=45*1e3,';
const PM_ST_DONE_RE = /\/\*bzl-offline:stream\*\//;
const PM_ST_OLD_RE = /Efn=4e3,yfn=\{firstToken:12e4,idle:45e3,total:36e4\}/;
const PM_ST_ON_B = '_bzM=globalThis.BreezellOffline&&globalThis.BreezellOffline.ms?globalThis.BreezellOffline.ms:null/*bzl-offline:stream*/,yfn={firstToken:_bzM?_bzM("firstByte",12e4):12e4,idle:_bzM?_bzM("text",45e3):45e3,total:_bzM?_bzM("total",36e4):36e4}';
const PM_STT_RE = /yN=\/glm\/i\.test\(t\?\.modelName\?\?""\)\?30\*1e3:60\*1e3/;
const PM_STT_ON = 'yN=_bzS?_bzS("text",6e4):(/glm/i.test(t?.modelName??"")?30*1e3:60*1e3)';
const PM_STT_DONE_RE = /_bzS\?_bzS\("text"/;
const PM_MODE_RE = /([A-Za-z_$][\w$]*)\[([A-Za-z_$][\w$]*)\]\|\|\1\.normal/;
const PM_MODE_DONE_RE = /\.pModeOf\?/;
const PM_BR_HEAD = "(function(s){try{var g=globalThis;";
const PM_BR_TAIL = "})}catch(e){}})(t)";
const PM_BR_DONE_RE = /pModeOf:function/;
const PM_F15_RE = /,([A-Za-z_$][\w$]*)=\[\];\1\.push\(([A-Za-z_$][\w$]*)\),\1\.push\(([A-Za-z_$][\w$]*)\),/;
const PM_F15_ON = ",$N=[];$N.push(globalThis.BreezellOffline&&globalThis.BreezellOffline.pSys?globalThis.BreezellOffline.pSys($S):$S),$N.push($M),";
const PM_PURGE_RE = /bzl-offline:hm-gate|bzl-offline:gate3|BreezellOffline\.__hm/;
const PM_F15_DONE_RE = /pSys\?globalThis\.BreezellOffline\.pSys\(|_g\.pSys\?_g\.pSys\(|\/\*bzl-offline:hm-gate\*\//;
/* --- v3.0.4: 尾部指令块（放在系统提示词最末尾，权重最高） --- */
const PM_TAIL_RE = /\$\{([A-Za-z_$][\w$]*)\}`\.trim\(\)\.replaceAll\("\t","  "\)/;
const PM_TAIL_DONE_RE = /BreezellOffline\.pTail\?/;
const PM_PTAIL_ANCHOR = ",pOps:function(){";
const PM_PTAIL_SEG = ",pMid:function(){try{var c=g.BreezellOffline.pCfg;if(!c)return \"\";if(c.midEnabled===!1)return \"\";return c.midBlock?String(c.midBlock):\"\"}catch(e){return \"\"}},pTail:function(){try{var c=g.BreezellOffline.pCfg;if(!c)return \"\";if(c.tailEnabled===!1)return \"\";return c.tailBlock?String(c.tailBlock):\"\"}catch(e){return \"\"}}";
const PM_PTAIL_DONE_RE = /pMid:function\(\)\{try\{var c=g\.BreezellOffline\.pCfg/;
const PM_PSYS_OLD = "if(s)return e?s+NL+e:s;return e?a+NL+e:a";
const PM_PSYS_NEW = 'var r=String(a==null?"":a);if(s)r+=(r?NL:"")+String(s);if(e)r+=(r?NL:"")+String(e);return r';
const PM_PSYS_MERGED_RE = /var r=String\(a==null\?"":a\);if\(s\)r\+=/;
const PM_PMODE_OLD = "if(o)return Object.assign({},a,o)";
const PM_PMODE_NEW = 'if(!o)return a;var r=Object.assign({},a||{}),NL=String.fromCharCode(10)+String.fromCharCode(10);if(o.roleDefinition)r.roleDefinition=(r.roleDefinition?String(r.roleDefinition)+NL:"")+String(o.roleDefinition);if(o.modeDescription)r.modeDescription=(r.modeDescription?String(r.modeDescription)+NL:"")+String(o.modeDescription);return r';
const PM_PMODE_MERGED_RE = /if\(o\.roleDefinition\)r\.roleDefinition=/;
const PM_SNIFF_ANCHOR = "g.BreezellOffline.__iv3=setInterval(function(){g.BreezellOffline.pPush()},6e4)";
const PM_SNIFF_ON = ',(function(){try{var F=globalThis.fetch;if(!F||F.__bzl)return;F.__bzl=1;globalThis.fetch=function(u,o){try{var b=o&&o.body;if(b&&typeof b=="string"&&b.indexOf("BREEZELL_CACHE_BOUNDARY")>=0){var k=g.BreezellOffline.__ch;k&&k.call("pushPrompt",[{body:b.slice(0,4e5),url:String(u)}]).catch(function(){})}}catch(e){}return F.apply(this,arguments)}}catch(e){}})()';
const PM_SNIFF_DONE_RE = /__bzl=1;globalThis\.fetch=/;
const PM_SPILL_RE = /_LARGE_PASTE_SPILL_MIN_CHARS=32e3/;
const PM_SPILL_ON = "_LARGE_PASTE_SPILL_MIN_CHARS=2e6";
const PM_SPILL_DONE_RE = /_LARGE_PASTE_SPILL_MIN_CHARS=2e6/;
const PM_SPILLH_RE = /_LARGE_PASTE_LLM_HEAD_CHARS=2e3/;
const PM_SPILLH_ON = "_LARGE_PASTE_LLM_HEAD_CHARS=2e5";
const PM_SPILLH_DONE_RE = /_LARGE_PASTE_LLM_HEAD_CHARS=2e5/;
const PM_SPILLT_RE = /_LARGE_PASTE_LLM_TAIL_CHARS=1e3/;
const PM_SPILLT_ON = "_LARGE_PASTE_LLM_TAIL_CHARS=1e5";
const PM_SPILLT_DONE_RE = /_LARGE_PASTE_LLM_TAIL_CHARS=1e5/;
const PM_SEC_ORIG = 'function FAn(n,i,e,t,o){if(o?.(i,YSs(e)),n?.delivery==="server")';
const PM_SEC_ON = 'function FAn(n,i,e,t,o){try{var _b=globalThis.BreezellOffline;if(_b&&_b.pSection){var _s=_b.pSection(i);if(_s!==void 0)return(mfo.exec(e)?.[0]??"")+_s}}catch(_x){}if(o?.(i,YSs(e)),n?.delivery==="server")';
const PM_SEC_DONE_RE = /function FAn\(n,i,e,t,o\)\{try\{var _b=globalThis\.BreezellOffline;if\(_b&&_b\.pSection\)/;
const PM_SECS_ORIG = ',pOps:function(){';
const PM_SECS_ON = ',pSection:function(n){try{var c=g.BreezellOffline.pCfg;if(!c||!c.sections)return;var S=c.sections;if(S.strip!==!0)return;var m=S.map||{},v=m[String(n)];return v===void 0?"":String(v)}catch(e){return}},pOps:function(){';
const PM_SECS_DONE_RE = /,pSection:function\(n\)\{try\{var c=g\.BreezellOffline\.pCfg/;
const PM_MID_RE = /([A-Za-z_$][\w$]*)\.push\(([A-Za-z_$][\w$]*)\);let ([A-Za-z_$][\w$]*)=\[\];\3\.push\(`Current date: /;
const PM_MID_DONE_RE = /BreezellOffline\.pMid\?/;
const PM_TAIL_ON = '${$V}`+(globalThis.BreezellOffline&&globalThis.BreezellOffline.pTail?(globalThis.BreezellOffline.pTail()||""):"").trim().replaceAll("\\t","  ")';
const PM_F16_ON = "(globalThis.BreezellOffline&&globalThis.BreezellOffline.pModeOf?globalThis.BreezellOffline.pModeOf($I,($N[$I]||$N.normal)):($N[$I]||$N.normal))";
const PM_F16_DONE_RE = /pModeOf\?globalThis\.BreezellOffline\.pModeOf\(/;
/* --- v1.8.0: 抑制 nls 14056「Extensions have been modified on disk」 --- */
const PM_NO14_RE = /if\(!(\w+)\)\{const (\w+)=this\.(\w+)\.onDidChangeCache\(\(\)=>\{\2\.dispose\(\),this\.(\w+)\.prompt\((\w+)\.Error,(\w+)\(14056,null\)/;
const PM_NO14_ON = "if(!1){const $2=this.$3.onDidChangeCache(()=>{$2.dispose(),this.$4.prompt($5.Error,$6(14056,null)";
const PM_NO14_DONE_RE = /if\(!1\)\{const \w+=this\.\w+\.onDidChangeCache/;
/* 1.4.37 起改用 logger.warn(f(14056,...))，不再走 prompt */
const NO14056_WARN_RE = /[A-Za-z_$][\w$]*\.warn\([A-Za-z_$][\w$]*\(14056,null,[^()]*\)\)/;
const NO14056_WARN_OFF = "void 0/*bzl-offline:no14056*/";
const NO14056_WARN_DONE_RE = /\/\*bzl-offline:no14056\*\//;
const BK_DIR = ".breezell-offline-backup";
const CAPS_OFF = '{hasSuperMemory:!1,hasCustomProvider:!1,plan:"unknown",sub:"",exp:0}';
const CAPS_PRO = '{hasSuperMemory:!0,hasCustomProvider:!0,plan:"pro",sub:"pro",exp:0}';
/* 把匹配到的能力对象原地升级为 pro，保留它原有的额外字段（如 hasCloudTelemetry） */
function capsProOf(txt) {
  var t = String(txt || "");
  t = t.replace(/hasSuperMemory:(?:!1|!0)/, "hasSuperMemory:!0");
  t = t.replace(/hasCustomProvider:(?:!1|!0)/, "hasCustomProvider:!0");
  t = t.replace(/plan:"[^"]*"/, 'plan:"pro"');
  t = t.replace(/sub:"[^"]*"/, 'sub:"pro"');
  t = t.replace(/exp:\d+/, "exp:0");
  return t;
}
const STUDIO_OFF = '{hasCustomProvider:!1,reason:"verify_failed",plan:"free"}';
const STUDIO_PRO = '{hasCustomProvider:!0,reason:"ok",plan:"pro"}';
const GATE_HEAD = 'if(G!=="breezell"){';
const GATE_TAIL = "}catch{}";
const GATE_OFF = MARK + "if(!1){}";
const TOK_VIEW = 'sm:!0,cp:!0,plan:"pro",sub:"",dev:void 0}}';
const BRIDGE_MARK = "g.BreezellOffline=Object.assign";

const BRIDGE = '(function(s,mp){try{var g=globalThis,ch=null;try{ch=mp.getChannel("breezell-channel-capability")}catch(_c){}g.BreezellOffline=Object.assign(g.BreezellOffline||{},{version:"' + VERSION + '"'
  + ',settingsOf:function(a){try{return s.state.settingsOfProvider[a]}catch(e){return null}}'
  + ',dump:function(){try{return JSON.parse(JSON.stringify(s.state))}catch(e){return null}}'
  + ',setProvider:function(a,b,c){try{return s.setSettingOfProvider(a,b,c)}catch(e){return String(e&&e.message)}}'
  + ',setGlobal:function(a,b){try{return s.setGlobalSetting(a,b)}catch(e){return String(e&&e.message)}}'
  + ',setModel:function(a,b){try{return s.setModelSelectionOfFeature(a,b)}catch(e){return String(e&&e.message)}}'
  + ',listProviders:function(){try{return Object.keys(s.state.settingsOfProvider||{})}catch(e){return[]}}'
  + ',pCfg:null,allowViking:!1,__ch:ch'
  + ',pSys:function(a){try{var c=g.BreezellOffline.pCfg;if(!c)return a;var s=c.systemPrompt,e=c.extraBlock,seed=c.seed,md=c.promptMode||"append",NL=String.fromCharCode(10)+String.fromCharCode(10),h=String(a==null?"":a),parts=[],cut={md:md,hostLen:h.length,cutLen:0,outLen:0,hostHead:h.slice(0,240)};if(md==="strict"||md==="replace-hard"){var keep=[],ls=h.split(String.fromCharCode(10)),RX=/(?:^|\\b)(you are|you are a)\\b[^\\n]{0,140}?(breezell|assistant|coding agent|ai\\b)/i,k=0;for(;k<ls.length;k++){if(!RX.test(ls[k]))keep.push(ls[k]);}var h2=keep.join(String.fromCharCode(10));cut.cutLen=h.length-h2.length;h=h2;}if(seed)parts.push(String(seed));if(md==="append")parts.push(h);if(s)parts.push(String(s));if(md!=="strict"&&e)parts.push(String(e));if(md==="replace-hard")parts.push(h);cut.outLen=parts.join(NL).length;try{g.BreezellOffline.__lastCut=cut;}catch(_){ }return parts.join(NL);}catch(e){return a}},pModeOf:function(m,a){try{var c=g.BreezellOffline.pCfg,o=c&&c.modes&&c.modes[m];if(!o)return a;var r=Object.assign({},a||{}),NL=String.fromCharCode(10)+String.fromCharCode(10);if(o.roleDefinition)r.roleDefinition=(r.roleDefinition?String(r.roleDefinition)+NL:"")+String(o.roleDefinition);if(o.modeDescription)r.modeDescription=(r.modeDescription?String(r.modeDescription)+NL:"")+String(o.modeDescription);return r}catch(e){}return a}'
  + ',pExtra:function(){try{var c=g.BreezellOffline.pCfg;return c&&c.extraBlock?c.extraBlock:""}catch(e){return""}}'
  + ',ms:function(k,d){try{var c=g.BreezellOffline.__stream||{},fb=Number(c.firstByte)||0;if(fb>0){if(k==="firstByte")return fb*1e3;if(k==="firstByteWarn")return fb*375;if(k==="text")return fb*1e3;if(k==="total")return fb*7500}return d}catch(e){return d}}'
  + ',pStop:function(){try{clearInterval(g.BreezellOffline.__iv)}catch(e){}}'
  + ',pNonce:function(n,m,c){try{var k=g.BreezellOffline.__ch;if(!k)return;var s=String(n||"");if(s&&g.BreezellOffline.__lastNonce===s)return;s&&(g.BreezellOffline.__lastNonce=s);k.call("pushNonce",[{nonce:s,mode:String(m||""),chatMode:String(c||""),fallback:s==="NO_AUTHENTICATED_INTERNAL_NONCE"}]).catch(function(){})}catch(e){}}'
  + ',pMid:function(){try{var c=g.BreezellOffline.pCfg;if(!c)return "";if(c.midEnabled===!1)return "";return c.midBlock?String(c.midBlock):""}catch(e){return ""}}'
  + ',pTail:function(){try{var c=g.BreezellOffline.pCfg;if(!c)return "";if(c.tailEnabled===!1)return "";return c.tailBlock?String(c.tailBlock):""}catch(e){return ""}}'
  + ',pVars:function(k){try{var c=g.BreezellOffline.pCfg;if(!c)return null;if(c.stripServerMarks===!1)return null;return ""}catch(e){return null}},pOps:function(){try{var k=g.BreezellOffline.__ch;if(!k||g.BreezellOffline.__opsBusy)return;g.BreezellOffline.__opsBusy=!0;k.call("readOps",[]).then(function(r){var ops=(r&&r.ops)||[];for(var i=0;i<ops.length;i++){var o=ops[i];if(!o||!o.k)continue;try{s.setGlobalSetting(o.k,o.v)}catch(e){}try{k.call("ackOps",[{id:o.id}])}catch(e){}}g.BreezellOffline.__opsBusy=!1}).catch(function(){g.BreezellOffline.__opsBusy=!1})}catch(e){}}'
  + ',pPush:function(){try{var k=g.BreezellOffline.__ch;if(!k)return;var G=(s&&s.state&&s.state.globalSettings)||{};var out={};for(var i=0;i<g.BreezellOffline.KEYS.length;i++){var kk=g.BreezellOffline.KEYS[i];if(G[kk]!==void 0)out[kk]=G[kk]}k.call("pushSettings",[out]).catch(function(){})}catch(e){}}'
  + ',KEYS:["chatFirstByteTimeoutSeconds","superpowersEnabled","memoryPreflightEnabled","adaptiveStrategyEnabled","interactionDesignEnabled","computerUseEnabled","browserHeadless","allowExternalFileAccess","allowExternalFileReadAccess","allowExternalFileWriteAccess","includeDiagnosticMessages","includeToolLintErrors","terminalNetActivityEnabled","autoAcceptLLMChanges","nativeWebSearch","maxReadFileLine","maxOpenTabsContext","maxWorkspaceFiles","maxConcurrentFileReads","useSystemProxy","disableSystemMessage","enablePostEditDebugCheck"]'
  + ',pRefresh:function(){try{var k=g.BreezellOffline.__ch;if(!k)return;k.call("readPrompts",[]).then(function(r){if(!r)return;r.stream&&(g.BreezellOffline.__stream=r.stream);r.prompts&&(g.BreezellOffline.pCfg=r.prompts),r.flags&&r.flags.allowViking!==void 0&&(g.BreezellOffline.allowViking=!!r.flags.allowViking),r.flags&&r.flags.noPoll?(g.BreezellOffline.noPoll=!0,g.BreezellOffline.pStop()):g.BreezellOffline.noPoll=!1}).catch(function(){})}catch(e){}}'
  + '});try{g.BreezellOffline.pRefresh(),g.BreezellOffline.pPush(),g.BreezellOffline.__iv=setInterval(function(){g.BreezellOffline.noPoll||g.BreezellOffline.pRefresh()},3e4),g.BreezellOffline.__iv2=setInterval(function(){g.BreezellOffline.pOps()},4e3),g.BreezellOffline.__iv3=setInterval(function(){g.BreezellOffline.pPush()},6e4)}catch(_t){}}catch(e){}})(t,e)';

function sha256b64(buf) { return crypto.createHash("sha256").update(buf).digest("base64").replace(/=+$/, ""); }
function read(p) { return fs.readFileSync(p, "utf8"); }
function writeSafe(file, text) {
  var tmp = path.join(path.dirname(file), "." + path.basename(file) + ".bzl.tmp");
  fs.writeFileSync(tmp, text, "utf8");
  try { fs.copyFileSync(tmp, file); } finally { try { fs.unlinkSync(tmp); } catch (e) {} }
}
function log(c, lv, msg) { var line = "[" + new Date().toISOString() + "] [" + lv + "] " + msg; if (c) c.push(line); if (lv === "ERROR") console.error(line); else console.log(line); }
function rx(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function once(s, needle) { if (!needle) return 0; var n = 0, i = 0; for (;;) { var p = s.indexOf(needle, i); if (p < 0) return n; n++; i = p + needle.length; } }

function patchesMainApp() {
  return [
    { id: "A1-caps-default-pro", desc: "capabilityManager 归一化 null 分支 -> pro",
      replacement: "", doneRe: CAPS_DONE_RE,
      validate: function (t) { return CAPS_DEF_RE3.test(t); },
      find: function (s) { var m = CAPS_DEF_RE3.exec(s); if (!m) return null; if (s.charAt(m.index - 1) !== ":") return null; return { start: m.index, end: m.index + m[0].length, v: [m[0]] }; },
      render: function (rep, loc) { return capsProOf((loc.v || [])[0]); } },
    { id: "A2-send-gate-off", desc: "发消息前订阅门 -> 短路",
      replacement: GATE_OFF, done: GATE_OFF,
      validate: function (t) { return /^if\([A-Za-z_$][\w$]*!=="breezell"\)\{/.test(t) && t.slice(-GATE_TAIL.length) === GATE_TAIL; },
      find: function (s) { var m = GATE_RE.exec(s); if (!m) return null; var p = m.index, q = s.indexOf(GATE_TAIL, p); if (q < 0) return null; return { start: p, end: q + GATE_TAIL.length }; } },
    { id: "A3-token-view-pro", soft: 1, desc: "缓存 token 视图 -> pro（1.4.59 起该缓存对象已被移除，无锚点即跳过）",
      replacement: 'function $FN(){return' + MARK + '{exp:Math.floor(Date.now()/1e3)+86400,sm:!0,cp:!0,plan:"pro",sub:"",dev:void 0}}', done: TOK_VIEW,
      find: function (s) { var m = /function (\w+)\(\)\{return \w+\?\w+\(\w+\.raw\):null\}/.exec(s); return m ? { start: m.index, end: m.index + m[0].length, fn: m[1] } : null; },
      render: function (rep, loc) { return rep.replace("$FN", loc.fn); } },
    { id: "A4-studio-default-pro", desc: "Image Studio 默认能力 -> 已授权",
      replacement: STUDIO_PRO, done: STUDIO_PRO,
      validate: function (t) { return STUDIO_ANY_RE.test(t) && t.indexOf("verify_failed") >= 0; },
      find: function (s) { var m = STUDIO_ANY_RE.exec(s); if (!m) return null; if (m[0].indexOf("verify_failed") < 0) return null; return { start: m.index, end: m.index + m[0].length }; } }
    ,{ id: "E1-disable-updates", desc: "update service 恒走 Disabled 分支",
      replacement: UPDATE_GETTER_OFF, done: UPDATE_GETTER_OFF,
      validate: function (t) { return UPDATE_GETTER_ON_RE.test(t); },
      find: function (s) { var m = UPDATE_GETTER_ON_RE.exec(s); return m ? { start: m.index, end: m.index + m[0].length } : null; } }
    ,{ id: "E2-hotdef-off", desc: "热更新自检默认关闭 10s -> 86400s",
      replacement: HOTDEF_OFF, done: HOTDEF_OFF,
      validate: function (t) { return HOTDEF_ON_RE.test(t); },
      find: function (s) { var m = HOTDEF_ON_RE.exec(s); return m ? { start: m.index, end: m.index + m[0].length } : null; } }
    ,{ id: "E3-autocheck-min-interval", desc: "autoCheck 最小间隔 1s -> 30min",
      replacement: ACMIN_OFF, done: ACMIN_OFF,
      validate: function (t) { return ACMIN_ON_RE.test(t); },
      find: function (s) { var m = ACMIN_ON_RE.exec(s); return m ? { start: m.index, end: m.index + m[0].length } : null; } }
    ,{ id: "E4-model-config-throttle", desc: "model-config 节流 30s -> 30min",
      replacement: MCFG_OFF, done: MCFG_OFF,
      validate: function (t) { return MCFG_RE.test(t); },
      find: function (s) { var m = MCFG_RE.exec(s); return m ? { start: m.index, end: m.index + m[0].length } : null; } }

    ,{ id: "H1-cq-read-config", desc: "capability 通道新增 readPrompts(读离线配置/提示词覆盖)",
      expected: PM_CQ_SWITCH, replacement: PM_CQ_ADD + PM_CQ_SWITCH, doneRe: PM_CQ_DONE_RE,
      find: function (s) { var p = s.indexOf(PM_CQ_SWITCH); return p < 0 ? null : { start: p, end: p + PM_CQ_SWITCH.length }; } }

    ,{ id: "H5-providers-case", desc: "capability 通道新增 pushProviders（落盘 provider/模型清单）", soft: 1,
  replacement: PM_CAP_PROV, doneRe: /case"pushProviders"/,
  validate: function (tt) { return tt.indexOf('case"readPrompts"') >= 0; },
  find: function (s) { var i = s.indexOf('case"readPrompts":'); return i < 0 ? null : { start: i, end: i, v: [] }; },
  render: function (rep2) { return String(rep2 || ""); } },
{ id: "H3-prompt-capture", desc: "把实际发出的 system 提示词落到 breezell-offline-lastreq.json（自检用）",
      replacement: PM_CAP_CASE, doneRe: PM_CAP_DONE_RE,
      find: function (s) { var i = s.indexOf("default:throw new Error(`[CapabilityChannel] Unknown command: ${e}`)}}"); return i < 0 ? null : { start: i, end: i, v: [] }; } }
    ,{ id: "H2-devtools-policy-on", desc: "DevTools 主进程策略 -> 恒允许（远端 60s 刷新拉不回去）",
      replacement: PM_DT_SET_ON, doneRe: PM_DT_SET_DONE_RE,
      validate: function (t) { return PM_DT_SET_RE.test(t); },
      find: function (s) { var m = PM_DT_SET_RE.exec(s); return m ? { start: m.index, end: m.index + m[0].length, v: [m[1], m[2], m[3]] } : null; },
      render: function (rep, loc) { var v = loc.v || []; return rep.split("$1").join(v[0]).split("$2").join(v[1]).split("$3").join(v[2]); } }
  ];
}

const BATCH_ON = "gb(e=1e4){const t=";
const BATCH_OFF = "gb(e=1e4){if(!(globalThis.BreezellOffline&&globalThis.BreezellOffline.allowViking))return;const t=";
const BATCH_DONE_RE = /gb\(e=1e4\)\{if\(!\!?\(?globalThis\.BreezellOffline/;

function patchesWorkbench() {
  return [
    { id: "B1-default-caps-pro", desc: "capabilityService 默认能力 -> pro",
      replacement: "", doneRe: CAPS_DONE_RE,
      validate: function (t) { return CAPS_DEF_RE3.test(t); },
      find: function (s) { var m = CAPS_DEF_RE3.exec(s); return m ? { start: m.index, end: m.index + m[0].length, v: [m[0]] } : null; },
      render: function (rep, loc) { return capsProOf((loc.v || [])[0]); } },
    { id: "B2-gate-short-circuit", desc: "capabilityService.getCapabilities() -> 恒 pro/allowed",
      replacement: PM_B2_V3_ON, done: PM_B2_V3_ON, doneRe: PM_B2_V3_DONE_RE,
      find: function (s) {
        var p = s.indexOf(PM_B2_V3);
        if (p < 0) return null;
        var q = s.indexOf(PM_B2_V3_TAIL, p);
        if (q < 0) return null;
        return { start: p, end: q + PM_B2_V3_TAIL.length };
      } },
    { id: "B3-settings-bridge", desc: "构造器注入 BreezellOffline 桥 (v2)",
      replacement: BRIDGE + ";",
      done: "pOps:function",
      find: function (s) {
        var p = s.indexOf(PM_B3_V3);
        if (p < 0) return null;
        var at = p + PM_B3_V3.length;
        if (s.slice(at, at + 12).indexOf("(function(") === 0) return { start: at, end: at };
        return { start: at, end: at };
      } }
    
    ,{ id: "B4-bridge-version", desc: "桥内 version 与扩展版本对齐",
      doneRe: new RegExp('g\\.BreezellOffline=Object\\.assign\\(g\\.BreezellOffline\\|\\|\\{\\},\\{version:"' + VERSION.replace(/\./g, "\\.") + '"'),
      replacement: 'g.BreezellOffline=Object.assign(g.BreezellOffline||{},{version:"' + VERSION + '"',
      find: function (s) { var m = /g\.BreezellOffline=Object\.assign\(g\.BreezellOffline\|\|\{\},\{version:"[^"]*"/.exec(s); return m ? { start: m.index, end: m.index + m[0].length } : null; } }
    ,{ id: "F1-hotdef-off", desc: "workbench 热更新自检默认关闭",
      expected: HOTDEF_ON, replacement: HOTDEF_OFF, done: HOTDEF_OFF,
      find: function (s) { var p = s.indexOf(HOTDEF_ON); return p < 0 ? null : { start: p, end: p + HOTDEF_ON.length }; } }
    ,{ id: "F2-sched-10s-off", desc: "10s 自检调度器停用",
      replacement: SCHED10S_OFF, done: SCHED10S_OFF,
      validate: function (t) { return SCHED10S_ON_RE.test(t); },
      find: function (s) { var m = SCHED10S_ON_RE.exec(s); return m ? { start: m.index, end: m.index + m[0].length } : null; } }
    ,{ id: "F3-marketplace-5m", desc: "扩展市场清单自检 5min -> 6h",
      expected: SCHED5M_ON, replacement: SCHED5M_OFF, done: SCHED5M_OFF,
      find: function (s) { var p = s.indexOf(SCHED5M_ON); return p < 0 ? null : { start: p, end: p + SCHED5M_ON.length }; } }
    ,{ id: "F4-model-config-10s", desc: "model-config 轮询 10s -> 10min",
      replacement: "$1=!1,$2=6e5,$3=new Set", doneRe: POLL10_DONE_ANY_RE,
      validate: function (t) { return POLL10_RE.test(t); },
      find: function (s) { var m = POLL10_RE.exec(s); return m ? { start: m.index, end: m.index + m[0].length, v: m.slice(1) } : null; },
      render: function (rep, loc) { var v = loc.v || []; return rep.replace("$1", v[0]).replace("$2", v[1]).replace("$3", v[2]); } }
    ,{ id: "F5-banner-60s", desc: "公告栏轮询 60s -> 10min",
      replacement: "$1=6e5,$2=this.c.breezellBackendEndpoint,", doneRe: /,\w+=6e5,\w+=this\.c\.breezellBackendEndpoint,/,
      validate: function (t) { return BANNER_RE.test(t); },
      find: function (s) { var m = BANNER_RE.exec(s); return m ? { start: m.index, end: m.index + m[0].length, v: m.slice(1) } : null; },
      render: function (rep, loc) { var v = loc.v || []; return rep.replace("$1", v[0]).replace("$2", v[1]); } }
    ,{ id: "F6-gate30", desc: "provider 门控轮询 30s -> 5min",
      replacement: "", doneRe: /setInterval\(\(\)=>\{\w+\(\)\},3e5\)/,
      validate: function (t) { return /setInterval\(\(\)=>\{\w+\(\)\},3e4\)/.test(t); },
      find: function (s) { var m = /setInterval\(\(\)=>\{(\w+)\(\)\},3e4\)/.exec(s); return m ? { start: m.index, end: m.index + m[0].length, v: [m[1]] } : null; },
      render: function (rep, loc) { return "setInterval(()=>{" + ((loc.v || [])[0] || "n") + "()},3e5)"; } }
    ,{ id: "F7-gate120", desc: "超记忆门控轮询 2min -> 10min",
      expected: GATE120_ON, replacement: GATE120_OFF, done: GATE120_OFF,
      find: function (s) { var p = s.indexOf(GATE120_ON); return p < 0 ? null : { start: p, end: p + GATE120_ON.length }; } }
    ,{ id: "F8-ext-autocheck-off", desc: "扩展自动更新检查循环停用",
      replacement: MB_OFF, doneRe: MB_DONE_RE,
      validate: function (t) { return MB_ON_RE.test(t); },
      find: function (s) { var m = MB_ON_RE.exec(s); return m ? { start: m.index, end: m.index + m[0].length } : null; } }
    ,{ id: "F9-viking-endpoint-off", desc: "Viking 记忆嵌入端点 -> null(停重试)",
      expected: VIK_ON, replacement: VIK_OFF, done: VIK_OFF,
      find: function (s) { var p = s.indexOf(VIK_ON); return p < 0 ? null : { start: p, end: p + VIK_ON.length }; } }

  
    ,{ id: "F10-viking-batch-off", desc: "Viking 批量同步嵌入定时任务停用",
      replacement: BATCH_OFF, doneRe: BATCH_DONE_RE,
      validate: function (t) { return t.indexOf(BATCH_ON) >= 0; },
      find: function (s) { var p = s.indexOf(BATCH_ON); return p < 0 ? null : { start: p, end: p + BATCH_ON.length }; } }

    ,{ id: "F11-session-poll-10m", desc: "sessions 鉴权轮询 60s -> 10min",
      replacement: "", doneRe: /setInterval\(\(\)=>this\.\w+\(\),6e5\)/,
      validate: function (t) { return SESS_POLL_RE.test(t); },
      find: function (s) { var m = SESS_POLL_RE.exec(s); if (!m) return null; var v = /this\.(\w+)\(/.exec(m[0]); return { start: m.index, end: m.index + m[0].length, v: v ? v[1] : "O" }; },
      render: function (rep, loc) { return "setInterval(()=>this." + loc.v + "(),6e5)"; } }
    ,{ id: "F12-terminal-poll-10m", desc: "终端跟踪轮询 60s -> 10min",
      replacement: "", doneRe: /setInterval\(\(\)=>\{this\.\w+\(\)\.catch\(\(\)=>\{\}\)\},6e5\)/,
      validate: function (t) { return TERM_POLL_RE.test(t); },
      find: function (s) { var m = TERM_POLL_RE.exec(s); if (!m) return null; var v = /this\.(\w+)\(\)/.exec(m[0]); return { start: m.index, end: m.index + m[0].length, v: v ? v[1] : "Cb" }; },
      render: function (rep, loc) { return "setInterval(()=>{this." + loc.v + "().catch(()=>{})},6e5)"; } }
    ,{ id: "F13-presence-poll-30s", desc: "presence 轮询 2.5s -> 30s",
      replacement: "", doneRe: PRES_POLL_DONE_RE,
      validate: function (t) { return PRES_POLL_RE.test(t); },
      find: function (s) { var m = PRES_POLL_RE.exec(s); if (!m) return null; var v = /this\.(\w+)\(/.exec(m[0]); return { start: m.index, end: m.index + m[0].length, v: v ? v[1] : "u" }; },
      render: function (rep, loc) { return "setInterval(()=>this." + loc.v + "(),3e4)"; } }
    ,{ id: "F14-viking-query-guard", desc: "Viking vector search -> guard (offline: skip embed, no log noise)",
      replacement: "", doneRe: /async y\(e,t,s,\w+\)\{if\(!\(globalThis\.BreezellOffline/,
      validate: function (t) { return /async y\(e,t,s,\w+\)\{const \w+=await this\.h\.getAllEmbeddings\(\);/.test(t); },
      find: function (s) { var m = /async y\(e,t,s,(\w+)\)\{const (\w+)=await this\.h\.getAllEmbeddings\(\);/.exec(s); return m ? { start: m.index, end: m.index + m[0].length, v: [m[1], m[2]] } : null; },
      render: function (rep, loc) {
        var v = loc.v || [];
        return "async y(e,t,s," + (v[0] || "n") + "){if(!(globalThis.BreezellOffline&&globalThis.BreezellOffline.allowViking))return[];const " + (v[1] || "u") + "=await this.h.getAllEmbeddings();";
      } }
    ,{ id: "F15-prompt-override", desc: "主系统提示词可覆盖(pSys)",
      replacement: PM_F15_ON, doneRe: PM_F15_DONE_RE,
      find: function (s) {
        var k = s.indexOf("Important notes:");
        if (k < 0) return null;
        var m = PM_F15_RE.exec(s.slice(k, k + 2000));
        if (!m) return null;
        var st = k + m.index;
        return { start: st, end: st + m[0].length, v: [m[1], m[2], m[3]] };
      },
      render: function (rep, loc) { var v = loc.v || []; return rep.split("$N").join(v[0]).split("$S").join(v[1]).split("$M").join(v[2]); } }
    ,{ id: "F16-mode-override", desc: "模式 roleDefinition/modeDescription 可覆盖(pModeOf)",
      replacement: PM_F16_ON, doneRe: PM_F16_DONE_RE,
      find: function (s) { var m = PM_MODE_RE.exec(s); return m ? { start: m.index, end: m.index + m[0].length, v: [m[1], m[2]] } : null; },
      render: function (rep, loc) { var v = loc.v || []; return rep.split("$N").join(v[0]).split("$I").join(v[1]); } }
    ,{ id: "F17-suppress-14056", desc: "抑制「Extensions have been modified on disk」提示(14056)",
      replacement: PM_NO14_ON, doneRe: /if\(!1\)\{const \w+=this\.\w+\.onDidChangeCache|\/\*bzl-offline:no14056\*\//,
      validate: function (t) { return PM_NO14_RE.test(t) || NO14056_WARN_RE.test(t); },
      find: function (s) {
        var m = PM_NO14_RE.exec(s);
        if (m) return { start: m.index, end: m.index + m[0].length, mode: "prompt", v: [m[1], m[2], m[3], m[4], m[5], m[6]] };
        var w = NO14056_WARN_RE.exec(s);
        if (w) return { start: w.index, end: w.index + w[0].length, mode: "warn", v: [w[0]] };
        return null;
      },
      render: function (rep, loc) {
        if (loc.mode === "warn") return NO14056_WARN_OFF;
        var v = loc.v || [];
        return rep.split("$2").join(v[1]).split("$3").join(v[2]).split("$4").join(v[3]).split("$5").join(v[4]).split("$6").join(v[5]);
      } }
    ,{ id: "F18-nonce-capture", desc: "会话 nonce 落盘(pNonce) -> 面板可见",
      replacement: PM_NONCE_TAIL, doneRe: PM_NONCE_DONE_RE,
      find: function (s) { var m = PM_NONCE_ANCHOR_RE.exec(s); return m ? { start: m.index, end: m.index + m[0].length, v: [m[0], m[1]] } : null; },
      render: function (rep, loc) {
        var v = loc.v || [];
        return String(v[0] || "") + rep.split("$T").join(String(v[1] || ""));
      } }
    ,{ id: "F19-devtools-unlock", desc: "DevTools 门禁 isAllowed() -> 恒 true (F12 可用)",
      replacement: PM_DT_ALLOW_ON, doneRe: PM_DT_ALLOW_DONE_RE,
      validate: function (t) { return PM_DT_ALLOW_RE.test(t); },
      find: function (s) { var m = PM_DT_ALLOW_RE.exec(s); return m ? { start: m.index, end: m.index + m[0].length, v: [m[1]] } : null; } }
    ,{ id: "F20-titlebar-browser", desc: "titlebar 增加「浏览器工作台」按钮（切换面板左侧，order 0）",
      replacement: PM_TB_ITEM, doneRe: PM_TB_DONE_RE,
      validate: function (t) { return PM_TB_RE3.test(t) || PM_TB_DONE_RE.test(t); },
      find: function (s) { var m = PM_TB_RE3.exec(s); return m ? { start: m.index, end: m.index + m[0].length, v: [m[0], m[2], m[9], codiconVarOf(s, m[6]), m[6]] } : null; },
      render: function (rep, loc) {
        var v = loc.v || [];
        var a = String(v[0] || ""), key = "appendMenuItems([", k = a.indexOf(key);
        var head = k < 0 ? a : a.slice(0, k + key.length), tail = k < 0 ? "" : a.slice(k + key.length);
        var cod = String(v[3] || ""), iv = String(v[4] || "");
        var expr = cod ? (cod + ".globe") : (iv || "void 0");
        return head + rep.split("$MENU").join(String(v[1] || "")).split("$CTX").join(String(v[2] || "")).split("$ICONX").join(expr) + tail;
      } }
    ,{ id: "F21-titlebar-fallback", desc: "layoutControl.enabled=false 时地球按钮回落到 TitleBar 主菜单",
      replacement: PM_TBF_ITEM, doneRe: PM_TBF_DONE_RE,
      validate: function (t) { return PM_TBF_RE.test(t); },
      find: function (s) { var m = PM_TBF_RE.exec(s); return m ? { start: m.index, end: m.index + m[0].length, v: [m[0], m[1], m[2], m[4], codiconVarOf(s, m[3]), m[3]] } : null; },
      render: function (rep, loc) {
        var v = loc.v || [];
        var cod = String(v[4] || ""), iv = String(v[5] || "");
        var expr = cod ? (cod + ".globe") : (iv || "void 0");
        return String(v[0] || "") + rep.split("$REG").join(String(v[1] || ""))
          .split("$MENU").join(String(v[2] || "")).split("$CTX").join(String(v[3] || ""))
          .split("$ICONX").join(expr);
      } }
    ,{ id: "F22-stream-firstbyte", desc: "流式首字节/总时长阈值 -> 可配置（两种形态）",
      replacement: PM_ST_ON, doneRe: PM_ST_DONE_RE,
      validate: function (t) { return PM_ST_RE.test(t) || PM_ST_OLD_RE.test(t); },
      find: function (s) {
        var m = PM_ST_RE.exec(s);
        if (m) return { start: m.index, end: m.index + m[0].length, v: ["new"] };
        var o = PM_ST_OLD_RE.exec(s);
        if (o) return { start: o.index, end: o.index + o[0].length, v: ["old"] };
        return null;
      },
      render: function (rep, loc) { return ((loc.v || [])[0] === "old") ? PM_ST_ON_B : rep; } }
    ,{ id: "F23-stream-text", soft: true, desc: "正文流空间阈值 -> 可配置（1.4.37+ 独有；1.4.3 由 F22 的 idle 覆盖）",
      replacement: PM_STT_ON, doneRe: PM_STT_DONE_RE,
      validate: function (t) { return PM_STT_RE.test(t); },
      find: function (s) { var m = PM_STT_RE.exec(s); return m ? { start: m.index, end: m.index + m[0].length } : null; } }
    ,{ id: "B3b-bridge-tail", desc: "已注入的旧桥补上 pTail()（B3 幂等跳过时用）",
      replacement: PM_PTAIL_SEG,
      doneRe: PM_PTAIL_DONE_RE,
      find: function (s) { var k = s.indexOf(PM_PTAIL_ANCHOR); return k < 0 ? null : { start: k, end: k + PM_PTAIL_ANCHOR.length, v: [] }; },
      render: function (rep2, loc) { return String(rep2 || "") + PM_PTAIL_ANCHOR; } }
    ,{ id: "B3c-bridge-psys-merge", desc: "旧桥的 pSys 改为纯叠加（官方身份段永不丢）", soft: 1,
      replacement: PM_PSYS_NEW,
      doneRe: PM_PSYS_MERGED_RE,
      validate: function (t) { return String(t).indexOf(PM_PSYS_OLD) >= 0; },
      find: function (s) { var k = s.indexOf(PM_PSYS_OLD); return k < 0 ? null : { start: k, end: k + PM_PSYS_OLD.length, v: [] }; } }
    ,{ id: "B3d-bridge-pmode-merge", desc: "旧桥的 pModeOf 改为字段叠加（不整体覆盖模式对象）", soft: 1,
      replacement: PM_PMODE_NEW,
      doneRe: PM_PMODE_MERGED_RE,
      validate: function (t) { return String(t).indexOf(PM_PMODE_OLD) >= 0; },
      find: function (s) { var k = s.indexOf(PM_PMODE_OLD); return k < 0 ? null : { start: k, end: k + PM_PMODE_OLD.length, v: [] }; } }
    ,{ id: "F29-prompt-sniff", desc: "抓取实际发出的 system 提示词（判断尾部槽位到底进没进请求）", soft: 1,
      replacement: PM_SNIFF_ON, doneRe: PM_SNIFF_DONE_RE,
      validate: function (t) { return t.indexOf(PM_SNIFF_ANCHOR) >= 0; },
      find: function (s) { var i = s.indexOf(PM_SNIFF_ANCHOR); return i < 0 ? null : { start: i + PM_SNIFF_ANCHOR.length, end: i + PM_SNIFF_ANCHOR.length, v: [] }; } }
    ,{ id: "F26-paste-inline", desc: "大段粘贴不再转存成文件（32e3 -> 2e6），内容留在用户消息里", soft: 1,
      replacement: PM_SPILL_ON, doneRe: PM_SPILL_DONE_RE,
      validate: function (t) { return PM_SPILL_RE.test(t); },
      find: function (s) { var m = PM_SPILL_RE.exec(s); return m ? { start: m.index, end: m.index + m[0].length, v: [] } : null; } }
    ,{ id: "F27-paste-head", desc: "转存时保留的头部字符 2e3 -> 2e5", soft: 1,
      replacement: PM_SPILLH_ON, doneRe: PM_SPILLH_DONE_RE,
      validate: function (t) { return PM_SPILLH_RE.test(t); },
      find: function (s) { var m = PM_SPILLH_RE.exec(s); return m ? { start: m.index, end: m.index + m[0].length, v: [] } : null; } }
    ,{ id: "F28-paste-tail", desc: "转存时保留的尾部字符 1e3 -> 1e5", soft: 1,
      replacement: PM_SPILLT_ON, doneRe: PM_SPILLT_DONE_RE,
      validate: function (t) { return PM_SPILLT_RE.test(t); },
      find: function (s) { var m = PM_SPILLT_RE.exec(s); return m ? { start: m.index, end: m.index + m[0].length, v: [] } : null; } }
    ,{ id: "B3c-bridge-section", desc: "桥增加 pSection（按段剥离/替换云端提示词段，服务端注入的身份/规则可为空）",
  soft: 1,
  replacement: PM_SECS_ON, doneRe: PM_SECS_DONE_RE,
  validate: function (t) { return t.indexOf(PM_SECS_ORIG) >= 0; },
  find: function (s) { var i = s.indexOf(PM_SECS_ORIG); return i < 0 ? null : { start: i, end: i + PM_SECS_ORIG.length, v: [] }; },
  render: function (rep) { return rep; } }
,{ id: "F30-cloud-section-strip", desc: "云端提示词段可剥离（FAn 拦截，delivery=server 时改为本地文本）",
  soft: 1,
  replacement: PM_SEC_ON, doneRe: PM_SEC_DONE_RE,
  validate: function (t) { return t.indexOf(PM_SEC_ORIG) >= 0; },
  find: function (s) { var i = s.indexOf(PM_SEC_ORIG); return i < 0 ? null : { start: i, end: i + PM_SEC_ORIG.length, v: [] }; },
  render: function (rep) { return rep; } },
    { id: "B3d-bridge-providers", desc: "桥新增 pProv()：上报 Breezell 已配置的 provider / 模型 / 密钥，供面板选模型", soft: 1,
      replacement: PM_PROV_ON, doneRe: PM_PROV_DONE_RE,
      find: function (s) { var i = s.indexOf(PM_PROV_ANCHOR); return i < 0 ? null : { start: i, end: i + PM_PROV_ANCHOR.length, v: [] }; },
      render: function (rep) { return String(rep || "") + PM_PROV_ANCHOR; } },
    { id: "F31-providers-push", desc: "启动即上报一次 provider 列表，之后每 2 分钟刷新", soft: 1,
      replacement: PM_PROV_IV_ON, doneRe: PM_PROV_IV_DONE_RE,
      find: function (s) { var i = s.indexOf(PM_PROV_IV_ANCHOR); return i < 0 ? null : { start: i, end: i + PM_PROV_IV_ANCHOR.length, v: [] }; },
      render: function (rep) { return String(rep || ""); } },
    { id: "F25-prompt-mid", soft: 1, desc: "中段槽位：官方 notes 之后、环境信息之前追加自定义指令",
      replacement: "",
      doneRe: PM_MID_DONE_RE,
      validate: function (t) { return PM_MID_RE.test(t); },
      find: function (s) { var m = PM_MID_RE.exec(s); return m ? { start: m.index, end: m.index + m[0].length, v: [m[1], m[2], m[3]] } : null; },
      render: function (rep2, loc) {
        var v = loc.v || [], A = String(v[0] || ""), NZ = String(v[1] || ""), SI = String(v[2] || "");
        return A + ".push(" + NZ + ");try{var _bzlM=globalThis.BreezellOffline&&globalThis.BreezellOffline.pMid?globalThis.BreezellOffline.pMid():\"\";if(_bzlM)" + A + ".push(_bzlM)}catch(e){}let " + SI + "=[];" + SI + ".push(" + "`" + "Current date: ";
      } }
    ,{ id: "F24-prompt-tail", desc: "尾部指令块：自定义指令放到系统提示词最后（权重最高）",
      replacement: "", doneRe: PM_TAIL_DONE_RE,
      validate: function (t) { return PM_TAIL_RE.test(t); },
      find: function (s) { var m = PM_TAIL_RE.exec(s); return m ? { start: m.index, end: m.index + m[0].length, v: [m[1]] } : null; },
      render: function (rep2, loc) { var v = loc.v || []; return PM_TAIL_ON.split("$V").join(String(v[0] || "")); } }

];
}

function patchesAgentHost() {
  return [
    { id: "D1-caps-default-pro", desc: "agentHost capability 归一化默认 -> pro",
      replacement: "", doneRe: CAPS_DONE_RE,
      validate: function (t) { return CAPS_DEF_RE3.test(t); },
      find: function (s) { var m = CAPS_DEF_RE3.exec(s); return m ? { start: m.index, end: m.index + m[0].length, v: [m[0]] } : null; },
      render: function (rep, loc) { return capsProOf((loc.v || [])[0]); } },
    { id: "D2-agenthost-gate-off", desc: "agentHost 发送前订阅门 -> 旁路",
      replacement: GATE_OFF, done: GATE_OFF,
      validate: function (t) { return GATE_RE.test(t) && t.slice(-GATE_TAIL.length) === GATE_TAIL; },
      find: function (s) { var m = GATE_RE.exec(s); if (!m) return null; var p = m.index, q = s.indexOf(GATE_TAIL, p); if (q < 0) return null; return { start: p, end: q + GATE_TAIL.length }; } },
    { id: "D3-token-view-pro", desc: "agentHost 缓存 token 视图 -> pro",
      replacement: 'function $FN(){return' + MARK + '{exp:Math.floor(Date.now()/1e3)+86400,sm:!0,cp:!0,plan:"pro",sub:"",dev:void 0}}', done: TOK_VIEW,
      find: function (s) { var m = /function (\w+)\(\)\{return \w+\?\w+\(\w+\.raw\):null\}/.exec(s); return m ? { start: m.index, end: m.index + m[0].length, fn: m[1] } : null; },
      render: function (rep, loc) { return rep.replace("$FN", loc.fn); } }
  ];
}

function patchesProduct() {
  return [
    { id: "G1-control-url-off", desc: "扩展市场清单控制 URL 置空(停 5min 轮询)",
      replacement: CTRL_OFF, done: CTRL_OFF,
      validate: function (t) { return CTRL_ANY_RE.test(t) && t.indexOf("marketplace.json") >= 0; },
      find: function (s) { var m = CTRL_ANY_RE.exec(s); if (!m) return null; if (m[0].indexOf("marketplace.json") < 0) return null; return { start: m.index, end: m.index + m[0].length }; } }
  ];
}

/* ---- 语法自检：写入后用 node --check 验证目标文件，失败即自动回滚该文件 ---- */
function nodeCandidates() {
  var out = [], p;
  try { if (process.execPath) out.push(process.execPath); } catch (e) {}
  var fixed = [
    "C:\\Program Files\\nodejs\\node.exe",
    "C:\\Program Files (x86)\\nodejs\\node.exe"
  ], i;
  for (i = 0; i < fixed.length; i++) out.push(fixed[i]);
  try {
    p = process.env.USERPROFILE || process.env.HOME || "";
    if (p) out.push(path.join(p, ".dsh", "dsh-runtimes", "dsh-primary-runtime", "dependencies", "node", "bin", "node.exe"));
  } catch (e) {}
  try {
    p = process.env.ProgramFiles || "";
    if (p) out.push(path.join(p, "nodejs", "node.exe"));
  } catch (e) {}
  return out;
}

var CHECKER = null;
function findChecker() {
  var i, c, cands;
  if (CHECKER && fs.existsSync(CHECKER)) return CHECKER;
  cands = nodeCandidates();
  for (i = 0; i < cands.length; i++) {
    c = cands[i];
    if (!c || !fs.existsSync(c)) continue;
    if (c.toLowerCase() === (process.execPath || "").toLowerCase()) { CHECKER = c; return c; }
    try {
      var r = cp.spawnSync(c, ["-e", "1"], { timeout: 15000, windowsHide: true, maxBuffer: 1 << 20 });
      if (!r.error && r.status === 0) { CHECKER = c; return c; }
    } catch (e) {}
  }
  CHECKER = process.execPath || null;
  return CHECKER;
}

function checkText(file, text) {
  var bin = findChecker(), r, env = null, k, probe = null;
  if (!bin) return { ok: false, err: "no-node-binary", bin: null };
  try {
    probe = path.join(path.dirname(file), "." + path.basename(file) + ".bzlcheck.js");
    writeSafe(probe, text);
  } catch (e0) { return { ok: false, bin: bin, err: "probe-write-failed: " + String(e0 && e0.message) }; }
  if (bin.toLowerCase() === (process.execPath || "").toLowerCase()) {
    env = {};
    for (k in process.env) { try { env[k] = process.env[k]; } catch (e) {} }
    env.ELECTRON_RUN_AS_NODE = "1";
  }
  try {
    r = cp.spawnSync(bin, ["--check", probe], { env: env || process.env, timeout: 120000, windowsHide: true, maxBuffer: 1 << 24 });
  } catch (e) {
    try { fs.unlinkSync(probe); } catch (e1) {}
    return { ok: false, bin: bin, err: String(e && e.message) };
  }
  try { fs.unlinkSync(probe); } catch (e1) {}
  if (r.error) return { ok: false, bin: bin, err: String(r.error.message) };
  if (r.status === 0) return { ok: true, bin: bin };
  return { ok: false, bin: bin, err: String(r.stderr || r.stdout || "exit " + r.status).split("\n").slice(0, 6).join(" | ") };
}

function syntaxCheck(file) {
  var bin = findChecker(), r, env = null, k, probe = null, target = file;
  if (!bin) return { ok: false, err: "no-node-binary", bin: null };
  if (bin.toLowerCase() === (process.execPath || "").toLowerCase()) {
    env = {};
    for (k in process.env) { try { env[k] = process.env[k]; } catch (e) {} }
    env.ELECTRON_RUN_AS_NODE = "1";
  }
  try {
    try { probe = path.join(path.dirname(file), "." + path.basename(file) + ".bzlcheck.js"); fs.copyFileSync(file, probe); target = probe; } catch (e0) { probe = null; }
    /* node --check 只认 .js/.cjs/.mjs，用同目录 .js 探针副本，避开 ERR_UNKNOWN_FILE_EXTENSION */
    r = cp.spawnSync(bin, ["--check", target], { env: env || process.env, timeout: 120000, windowsHide: true, maxBuffer: 1 << 24 });
    if (probe) { try { fs.unlinkSync(probe); } catch (e1) {} }
  } catch (e) { return { ok: false, bin: bin, err: String(e && e.message) }; }
  if (r.error) return { ok: false, bin: bin, err: String(r.error.message) };
  if (r.status === 0) return { ok: true, bin: bin };
  return { ok: false, bin: bin, err: String(r.stderr || r.stdout || "exit " + r.status).split("\n").slice(0, 5).join(" | ") };
}

function applyAll(src, patches, lines, label) {
  var out = src, res = [], i, pt, loc, slice, rep;
  for (i = 0; i < patches.length; i++) {
    pt = patches[i];
    if (OBSOLETE_IDS[pt.id]) pt.soft = 1;
    if (pt.done && out.indexOf(pt.done) >= 0) { res.push({ id: pt.id, status: "already" }); log(lines, "INFO", label + " " + pt.id + ": 已打过"); continue; }
    if (!pt.done && pt.doneRe && pt.doneRe.test(out)) { res.push({ id: pt.id, status: "already" }); log(lines, "INFO", label + " " + pt.id + ": 已打过"); continue; }
    loc = pt.find(out);
    if (!loc) {
      if (pt.soft) { res.push({ id: pt.id, status: "skipped" }); log(lines, "INFO", label + " " + pt.id + ": 本版本无此锚点，跳过"); continue; }
      res.push({ id: pt.id, status: "notfound" }); log(lines, "ERROR", label + " " + pt.id + ": 锚点未找到 | " + pt.desc); continue;
    }
    if (loc.end < loc.start) { res.push({ id: pt.id, status: "badrange" }); log(lines, "ERROR", label + " " + pt.id + ": 范围非法"); continue; }
    slice = out.slice(loc.start, loc.end);
    var bad = false;
    if (loc.end > loc.start) {
      if (pt.expected && slice !== pt.expected) bad = true;
      if (pt.validate) { try { if (!pt.validate(slice)) bad = true; } catch (e) { bad = true; } }
    }
    if (bad) { res.push({ id: pt.id, status: "mismatch" }); log(lines, "ERROR", label + " " + pt.id + ": 锚点内容不符"); continue; }
    rep = pt.replacement;
    if (pt.render) rep = pt.render(rep, loc);
    out = out.slice(0, loc.start) + rep + out.slice(loc.end);
    res.push({ id: pt.id, status: "patched" });
    log(lines, "INFO", label + " " + pt.id + ": OK | " + pt.desc);
  }
  return { text: out, results: res };
}

function backup(root, rels, lines) {
  var dir = path.join(root, BK_DIR), i, src, dst;
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  for (i = 0; i < rels.length; i++) {
    src = path.join(root, rels[i].join(path.sep));
    dst = path.join(dir, rels[i].join("__"));
    if (!fs.existsSync(src)) continue;
    if (fs.existsSync(dst)) { log(lines, "INFO", "备份已在: " + dst); continue; }
    fs.copyFileSync(src, dst);
    log(lines, "INFO", "已备份: " + src + "  ->  " + dst);
  }
  var note = path.join(dir, "README.txt");
  if (!fs.existsSync(note)) fs.writeFileSync(note, "breezell-offline 自动备份：打补丁前的原始文件；文件名中的 __ 表示路径分隔符。\n恢复方式：把文件拷回原路径，或运行命令 Breezell Offline: Restore。\n", "utf8");
  return dir;
}

var THEME_REL = ["extensions", "theme-seti", "icons", "vs-seti-icon-theme.json"];
var THEME_EXT = {
  txt: "_info", log: "_info", out: "_info", err: "_info", trace: "_info",
  db: "_db_1", sqlite: "_db_1", sqlite3: "_db_1", "db-shm": "_db_1", "db-wal": "_db_1", "db-journal": "_db_1",
  sh: "_shell", bash: "_shell", zsh: "_shell", ksh: "_shell", fish: "_shell",
  ps1: "_powershell", psm1: "_powershell", psd1: "_powershell", bat: "_windows", cmd: "_windows",
  ini: "_config", conf: "_config", cfg: "_config", properties: "_config", editorconfig: "_config", reg: "_config", plist: "_config", xaml: "_xml",
  lock: "_lock", sum: "_lock", mod: "_lock",
  tar: "_zip", gz: "_zip", tgz: "_zip", bz2: "_zip", xz: "_zip", "7z": "_zip_1", rar: "_zip_1", iso: "_zip",
  exe: "_windows", dll: "_windows", sys: "_windows", so: "_wasm", dylib: "_wasm", pdb: "_windows", apk: "_zip_1",
  tsv: "_csv", xls: "_xls", xlsm: "_xls", ppt: "_word", pptx: "_word", rtf: "_word", odt: "_word",
  manifest: "_config", envrc: "_config", gitignore: "_git", gitattributes: "_git",
  mdx: "_markdown", rst: "_markdown", adoc: "_markdown", http: "_config"
};
var THEME_NAMES = {
  dockerfile: "_docker", "docker-compose.yml": "_docker", "docker-compose.yaml": "_docker",
  "go.mod": "_go2", "go.sum": "_lock", "go.work": "_go2",
  makefile: "_makefile", "cmakelists.txt": "_config",
  ".gitignore": "_git", ".gitattributes": "_git", ".gitmodules": "_git",
  ".npmrc": "_npm", ".npmignore": "_npm_ignored", ".nvmrc": "_config",
  ".env": "_config", ".env.local": "_config", ".env.example": "_config",
  "cargo.toml": "_rust", "cargo.lock": "_lock",
  "package-lock.json": "_npm", "yarn.lock": "_yarn", "pnpm-lock.yaml": "_lock",
  "requirements.txt": "_python", pipfile: "_python", "pyproject.toml": "_python",
  "tsconfig.json": "_tsconfig", "vite.config.ts": "_vite", "webpack.config.js": "_webpack",
  license: "_license", "license.txt": "_license", notice: "_license"
};
function augmentTheme(root) {
  var out = { file: null, added: 0, skipped: 0, exists: false };
  try {
    var f = path.join(root, THEME_REL.join(path.sep));
    out.file = f;
    if (!fs.existsSync(f)) return out;
    out.exists = true;
    var j = JSON.parse(read(f));
    var fe = j.fileExtensions || (j.fileExtensions = {});
    var fn2 = j.fileNames || (j.fileNames = {});
    var defs = j.iconDefinitions || {};
    var k, v;
    for (k in THEME_EXT) { v = THEME_EXT[k]; if (!defs[v]) continue; if (fe[k] === v) { out.skipped++; continue; } fe[k] = v; out.added++; }
    for (k in THEME_NAMES) { v = THEME_NAMES[k]; if (!defs[v]) continue; if (fn2[k] === v) { out.skipped++; continue; } fn2[k] = v; out.added++; }
    if (out.added > 0) {
      try { if (!fs.existsSync(f + ".bak")) fs.copyFileSync(f, f + ".bak"); } catch (e) {}
      writeSafe(f, JSON.stringify(j, null, 2));
    }
    return out;
  } catch (e) { out.error = String(e && e.message); return out; }
}

function patchRoot(root, lines) {
  var report = { root: root, changed: [], results: [], errors: [] };
  if (!fs.existsSync(root)) { log(lines, "ERROR", "根目录不存在: " + root); report.errors.push("no-root"); return report; }
  var mainApp = path.join(root, MAIN_REL.join(path.sep));
  var wb = path.join(root, WB_REL.join(path.sep));
  var prod = path.join(root, PROD_REL.join(path.sep));
  backup(root, [MAIN_REL, WB_REL, PROD_REL, AGENT_REL], lines);

  if (fs.existsSync(mainApp)) {
    var s1 = read(mainApp);
    var r1 = applyAll(s1, patchesMainApp(), lines, "main.app.js");
    report.results = report.results.concat(r1.results);
    if (r1.text !== s1) {
      var ck1 = checkText(mainApp, r1.text);
      if (!ck1.ok) {
        log(lines, "ERROR", "语法预检失败，未写盘 " + mainApp + " :: " + ck1.err);
        report.errors.push("syntax:" + path.relative(root, mainApp));
      } else {
        writeSafe(mainApp, r1.text);
        report.changed.push(path.relative(root, mainApp)); log(lines, "INFO", "写入 " + mainApp + " (语法预检 OK)");
      }
    }
  } else { log(lines, "ERROR", "缺少 " + mainApp); report.errors.push("no-mainapp"); }

  var wbChanged = false;
  if (fs.existsSync(wb)) {
    var s2 = read(wb);
    var r2 = applyAll(s2, patchesWorkbench(), lines, "workbench");
    report.results = report.results.concat(r2.results);
    if (r2.text !== s2) {
      var ck2 = checkText(wb, r2.text);
      if (!ck2.ok) {
        log(lines, "ERROR", "语法预检失败，未写盘 " + wb + " :: " + ck2.err);
        report.errors.push("syntax:" + path.relative(root, wb));
      } else {
        writeSafe(wb, r2.text);
        report.changed.push(path.relative(root, wb)); wbChanged = true; log(lines, "INFO", "写入 " + wb + " (语法预检 OK)");
      }
    }
  } else { log(lines, "ERROR", "缺少 " + wb); report.errors.push("no-workbench"); }

  if (fs.existsSync(prod)) {
    var pj = read(prod), prodOrig = pj;
    var rp = applyAll(pj, patchesProduct(), lines, "product.json");
    report.results = report.results.concat(rp.results);
    pj = rp.text;
    if (wbChanged) {
      var sum = sumOf(wb);
      var m = new RegExp('("' + rx(CHECKSUM_KEY) + '"\\s*:\\s*")([A-Za-z0-9+/]+=*)(")').exec(pj);
      if (!m) { log(lines, "ERROR", "product.json 无校验和键"); report.errors.push("no-checksum-key"); }
      else if (m[2] === sum) { log(lines, "INFO", "校验和已最新"); }
      else {
        pj = pj.slice(0, m.index) + m[1] + sum + m[3] + pj.slice(m.index + m[0].length);
        log(lines, "INFO", "校验和同步 -> " + sum);
      }
    }
    if (pj !== prodOrig) { writeSafe(prod, pj); report.changed.push(path.relative(root, prod)); log(lines, "INFO", "写入 " + prod); }
  } else { log(lines, "WARN", "缺少 " + prod); report.errors.push("no-product"); }
  var agent = path.join(root, AGENT_REL.join(path.sep));
  if (fs.existsSync(agent)) {
    var s3 = read(agent);
    var r3 = applyAll(s3, patchesAgentHost(), lines, "agentHost");
    report.results = report.results.concat(r3.results);
    if (r3.text !== s3) {
      var ck3 = checkText(agent, r3.text);
      if (!ck3.ok) {
        log(lines, "ERROR", "语法预检失败，未写盘 " + agent + " :: " + ck3.err);
        report.errors.push("syntax:" + path.relative(root, agent));
      } else {
        writeSafe(agent, r3.text);
        report.changed.push(path.relative(root, agent)); log(lines, "INFO", "写入 " + agent + " (语法预检 OK)");
      }
    }
  } else { log(lines, "WARN", "缺失 " + agent); report.errors.push("no-agenthost"); }
  try {
    var th = augmentTheme(root);
    if (th.exists) {
      if (th.added) { report.changed.push(path.relative(root, th.file)); log(lines, "INFO", "图标映射 +" + th.added + " 条"); }
      else log(lines, "INFO", "图标映射已完整");
    }
  } catch (e) { log(lines, "WARN", "图标映射处理失败: " + (e && e.message)); }
  return report;
}

function syncChecksum(root, lines) {
  var wb = path.join(root, WB_REL.join(path.sep));
  var prod = path.join(root, PROD_REL.join(path.sep));
  var out = { root: root, synced: false, sum: null };
  if (!fs.existsSync(wb) || !fs.existsSync(prod)) { log(lines, "WARN", "缺少 workbench 或 product.json"); return out; }
  var sum = sumOf(wb);
  out.sum = sum;
  var pj = read(prod);
  var m = new RegExp('("' + rx(CHECKSUM_KEY) + '"\\s*:\\s*")([A-Za-z0-9+/]+=*)(")').exec(pj);
  if (!m) { log(lines, "ERROR", "product.json 无校验和键"); return out; }
  if (m[2] === sum) { log(lines, "INFO", "校验和已最新"); return out; }
  pj = pj.slice(0, m.index) + m[1] + sum + m[3] + pj.slice(m.index + m[0].length);
  writeSafe(prod, pj);
  out.synced = true;
  log(lines, "INFO", "校验和同步 -> " + sum);
  return out;
}

function restoreRoot(root, lines) {
  var dir = path.join(root, BK_DIR), report = { root: root, restored: [] };
  if (!fs.existsSync(dir)) { log(lines, "ERROR", "无备份目录: " + dir); return report; }
  var rels = [MAIN_REL, WB_REL, PROD_REL, AGENT_REL], i, bak, dst;
  for (i = 0; i < rels.length; i++) {
    bak = path.join(dir, rels[i].join("__"));
    if (!fs.existsSync(bak)) continue;
    dst = path.join(root, rels[i].join(path.sep));
    fs.copyFileSync(bak, dst);
    report.restored.push(path.relative(root, dst));
    log(lines, "INFO", "还原: " + dst);
  }
  return report;
}

/* ---------------- 检测缓存（性能） ----------------
   背景：inspectRoot 需读 main.app.js(2.2MB) + workbench(27MB) + agentHost(1MB)，并对 27MB 做 sha256，
   单根约 580ms；7 个根 = 4s 同步阻塞扩展宿主，窗口会明显卡。
   这里按「文件 size+mtime」签名缓存：文件没变就直接返回上次结果（≈1ms）。 */
var _sumCache = Object.create(null);
function sumOf(file) {
  try {
    var st = fs.statSync(file);
    var key = st.size + ':' + Math.floor(st.mtimeMs);
    var c = _sumCache[file];
    if (c && c.key === key) return c.sum;
    var sum = sha256b64(fs.readFileSync(file));
    _sumCache[file] = { key: key, sum: sum };
    return sum;
  } catch (e) { return null; }
}

var INSP_CACHE_FILE = (function () {
  try { return path.join(process.env.APPDATA || '', 'Breezell', 'breezell-offline-inspect.json'); } catch (e) { return ''; }
})();
var _diskInsp = null;
function loadDiskInsp() {
  if (_diskInsp) return _diskInsp;
  _diskInsp = Object.create(null);
  try {
    if (INSP_CACHE_FILE && fs.existsSync(INSP_CACHE_FILE)) {
      var o = JSON.parse(fs.readFileSync(INSP_CACHE_FILE, 'utf8'));
      if (o && typeof o === 'object') _diskInsp = o;
    }
  } catch (e) {}
  return _diskInsp;
}
var _diskDirty = false;
function saveDiskInsp(force) {
  if (!_diskDirty && !force) return;
  try {
    var keys = Object.keys(_diskInsp || {});
    if (keys.length > 24) { for (var i = 0; i < keys.length - 24; i++) delete _diskInsp[keys[i]]; }
    if (INSP_CACHE_FILE) fs.writeFileSync(INSP_CACHE_FILE, JSON.stringify(_diskInsp), 'utf8');
    _diskDirty = false;
  } catch (e) {}
}
var _inspCache = Object.create(null);
function rootSig(root) {
  var rels = [MAIN_REL, WB_REL, PROD_REL, AGENT_REL], out = [];
  for (var i = 0; i < rels.length; i++) {
    try {
      var st = fs.statSync(path.join(root, rels[i].join(path.sep)));
      out.push(st.size + ':' + Math.floor(st.mtimeMs));
    } catch (e) { out.push('-'); }
  }
  return out.join('|');
}
function dropInspect(root) {
  if (root) { delete _inspCache[root]; try { delete loadDiskInsp()[root]; _diskDirty = true; saveDiskInsp(true); } catch (e) {} }
  else {
    _inspCache = Object.create(null); _sumCache = Object.create(null);
    _diskInsp = Object.create(null); _diskDirty = true; saveDiskInsp(true);
  }
}

function inspectRoot(root) {
  var sig = rootSig(root);
  var hit = _inspCache[root];
  if (hit && hit.sig === sig) return hit.val;
  var d = loadDiskInsp(), dh = d[root];
  if (dh && dh.sig === sig && dh.val) {
    _inspCache[root] = { sig: sig, val: dh.val };
    return dh.val;
  }
  var out = inspectRootUncached(root);
  _inspCache[root] = { sig: sig, val: out };
  d[root] = { sig: sig, val: out };
  _diskDirty = true;
  try { saveDiskInsp(true); } catch (e) {}
  return out;
}

function inspectRootUncached(root) {
  var out = { root: root, exists: fs.existsSync(root), state: {} };
  if (!out.exists) return out;
  var mainApp = path.join(root, MAIN_REL.join(path.sep));
  var wb = path.join(root, WB_REL.join(path.sep));
  var prod = path.join(root, PROD_REL.join(path.sep));
  try {
    var s = read(mainApp);
    out.state.mainApp = { capsPro: CAPS_DONE_RE.test(s), gateOff: s.indexOf(GATE_OFF) >= 0, tokenViewPro: s.indexOf(TOK_VIEW) >= 0, studioPro: s.indexOf(STUDIO_PRO) >= 0,
      updatesOff: s.indexOf(UPDATE_GETTER_OFF) >= 0, hotAutoOff: s.indexOf(HOTDEF_OFF) >= 0, acMin30m: s.indexOf(ACMIN_OFF) >= 0, mcfg30m: s.indexOf(MCFG_OFF) >= 0,
      cqPrompts: PM_CQ_DONE_RE.test(s), dtPolicy: PM_DT_SET_DONE_RE.test(s) };
  } catch (e) { out.state.mainApp = { error: String(e && e.message) }; }
  try {
    var w = read(wb);
    out.state.workbench = { capsPro: CAPS_DONE_RE.test(w), gateShort: PM_B2_V3_DONE_RE.test(w) || w.indexOf("async C(e){return" + MARK) >= 0, bridge: w.indexOf(BRIDGE_MARK) >= 0,
      hotAutoOff: w.indexOf(HOTDEF_OFF) >= 0, schedOff: w.indexOf(SCHED10S_OFF) >= 0, market6h: w.indexOf(SCHED5M_OFF) >= 0, poll10m: POLL10_DONE_RE.test(w), banner10m: BANNER_DONE_RE.test(w),
      sess10m: SESS_POLL_DONE_RE.test(w), term10m: TERM_POLL_DONE_RE.test(w), pres30s: PRES_POLL_DONE_RE.test(w),
      vikGuard: VIK_QS_DONE_RE.test(w), vikBatchOff: BATCH_DONE_RE.test(w),
      bridgeV2: PM_BR_DONE_RE.test(w), promptSys: PM_F15_DONE_RE.test(w), modeOver: PM_F16_DONE_RE.test(w),
      nonceHook: PM_NONCE_DONE_RE.test(w), extNo14056: PM_NO14_DONE_RE.test(w) || NO14056_WARN_DONE_RE.test(w),
      dtUnlock: PM_DT_ALLOW_DONE_RE.test(w), browserBar: PM_TB_DONE_RE.test(w), purge: PM_PURGE_RE.test(w), browserBarFb: PM_TBF_DONE_RE.test(w),
      streamTmo: PM_ST_DONE_RE.test(w), streamText: PM_STT_DONE_RE.test(w) };
  } catch (e) { out.state.workbench = { error: String(e && e.message) }; }
  try {
    var a = read(path.join(root, AGENT_REL.join(path.sep)));
    out.state.agentHost = { capsPro: CAPS_DONE_RE.test(a), gateOff: a.indexOf(GATE_OFF) >= 0, tokenViewPro: a.indexOf(TOK_VIEW) >= 0 };
  } catch (e) { out.state.agentHost = { error: String(e && e.message) }; }
  try {
    var sum = sumOf(wb);
    var m = new RegExp('"' + rx(CHECKSUM_KEY) + '"\\s*:\\s*"([A-Za-z0-9+/]+=*)"').exec(read(prod));
    out.state.checksum = { actual: sum, declared: m ? m[1] : null, match: !!m && m[1] === sum };
  } catch (e) { out.state.checksum = { error: String(e && e.message) }; }
  var _ptxt = read(prod);
  var _pver = (new RegExp('"breezellVersion"\\s*:\\s*"([^"]+)"').exec(_ptxt) || [])[1] || "";
  try { out.state.product = { controlUrlOff: _ptxt.indexOf(CTRL_OFF) >= 0, breezellVersion: _pver, supported: BREEZELL_SUPPORTED, versionOk: _pver === BREEZELL_SUPPORTED }; }
  catch (e) { out.state.product = { error: String(e && e.message) }; }
  /* 内建扩展完整性：extensions 目录条目数 + theme-seti 是否在
     （历史事故：旧版清理穿过 junction 把安装目录该目录清空 -> 文件图标主题消失） */
  try { out.state.builtin = builtinInfo(root); }
  catch (e) { out.state.builtin = { error: String(e && e.message) }; }
  return out;
}

/* 统计某个运行时根的 extensions 目录；热更新根上它是 junction，读到的是安装目录真实内容 */
function builtinInfo(root) {
  var dir = path.join(root, "extensions");
  var names = [];
  try { names = fs.readdirSync(dir); } catch (e) { return { dir: dir, count: 0, seti: false, missing: true }; }
  var seti = false;
  try { seti = fs.existsSync(path.join(dir, "theme-seti", "icons", "vs-seti-icon-theme.json")); } catch (e) {}
  return { dir: dir, count: names.length, seti: seti, missing: names.length === 0 };
}


/* 生成状态报告（JSON + 人类可读 txt），供管理面板与排错使用 */
function naText(ids, txt) {
  for (var i = 0; i < ids.length; i++) if (!OBSOLETE_IDS[ids[i]]) return txt;
  return "n/a";
}

function describeRoot(st) {
  var m = st.state.mainApp || {}, w = st.state.workbench || {}, c = st.state.checksum || {};
  var pd = st.state.product || {}, ag = st.state.agentHost || {};
  return {
    mainApp: "caps=" + (m.capsPro ? "PRO" : "off") + " sendGate=" + (m.gateOff ? "OFF" : "on") +
             " tokenView=" + (m.tokenViewPro ? "PRO" : "raw") + " studio=" + (m.studioPro ? "PRO" : "free"),
    workbench: "caps=" + (w.capsPro ? "PRO" : "off") + " gate=" + (w.gateShort ? "SHORT" : "on") +
               " bridge=" + (w.bridge ? "ON" : "off"),
    antiPoll: "updates=" + (m.updatesOff ? "OFF" : "on") + " hotAuto=" + (m.hotAutoOff ? "OFF" : "on") +
              " acMin=" + naText(["E3-autocheck-min-interval"], m.acMin30m ? "30m" : "1s") + " modelCfg=" + naText(["E4-model-config-throttle"], m.mcfg30m ? "30m" : "30s"),
    poll: "hotAuto=" + (w.hotAutoOff ? "OFF" : "on") + " sched10s=" + naText(["F2-sched-10s-off"], w.schedOff ? "OFF" : "on") +
          " market=" + naText(["F3-marketplace-5m"], w.market6h ? "6h" : "5m") + " modelCfg=" + (w.poll10m ? "10m" : "10s") +
          " banner=" + naText(["F5-banner-60s"], w.banner10m ? "10m" : "60s"),
    poll2: "sess=" + naText(["F11-session-poll-10m"], w.sess10m ? "10m" : "60s") + " term=" + (w.term10m ? "10m" : "60s") +
           " presence=" + (w.pres30s ? "30s" : "2.5s"),
    viking: "endpoint=" + naText(["F9-viking-endpoint-off"], w.vikGuard ? "GUARD" : "on") + " batch=" + naText(["F10-viking-batch-off"], w.vikBatchOff ? "OFF" : "on"),
    prompts: "sys=" + (w.promptSys ? "EDITABLE" : "fixed") + " mode=" + naText(["F16-mode-override"], w.modeOver ? "EDITABLE" : "fixed") +
             " cfgChannel=" + (m.cqPrompts ? "ON" : "off") + " bridge=" + (w.bridgeV2 ? "v2" : "v1") +
             " nonce=" + (w.nonceHook ? "HOOK" : "off"),
    devtools: "f12=" + ((w.dtUnlock && m.dtPolicy) ? "FORCED" : (w.dtUnlock || m.dtPolicy) ? "HALF" : "gated"),
    browserBar: "browserBar=" + (w.browserBar ? "ON" : "off") + (w.browserBarFb ? "+fb" : ""),
      compat: "compat=" + (w.purge ? "SHARED(hm)" : "clean"),
    stream: "stream=" + naText(["F22-stream-firstbyte", "F23-stream-text"], w.streamTmo ? "TUNABLE" : "fixed"),
    extNoise: "no14056=" + naText(["F17-suppress-14056"], w.extNo14056 ? "OFF" : "on"),
    product: "controlUrl=" + (pd.controlUrlOff ? "OFF" : "on"),
    breezell: "breezell=" + (pd.breezellVersion || "?") + (pd.versionOk ? " (supported)" : " (untested, built for " + BREEZELL_SUPPORTED + ")"),
    builtin: defaultBuiltinText(st.state.builtin),
    agentHost: "caps=" + (ag.capsPro ? "PRO" : "off") + " gate=" + (ag.gateOff ? "OFF" : "on") +
               " tokenView=" + (ag.tokenViewPro ? "PRO" : "raw"),
    checksum: (c.match ? "OK" : "MISMATCH") + (c.declared ? "" : " (not declared)")
  };
}

/* 内建扩展一句话摘要："builtin=OK seti=OK" / "builtin=MISSING seti=LOST"（明细见 state.builtin） */
function defaultBuiltinText(b) {
  if (!b || b.error) return "builtin=unknown";
  if (!b.count) return "builtin=MISSING seti=LOST";
  return "builtin=OK seti=" + (b.seti ? "OK" : "LOST");
}

function writeReport(list, dir) {
  var rep = { tool: "breezell-offline", version: VERSION, at: new Date().toISOString(), roots: [], files: [] };
  list.forEach(function (t) {
    var st = inspectRoot(t.root);
    var d = describeRoot(st);
    rep.roots.push({ label: t.label, root: t.root, exists: st.exists, summary: d, state: st.state });
  });
  var L = [];
  L.push("breezell-offline v" + VERSION + "   状态报告   " + rep.at);
  L.push("");
  var allOk = true;
  rep.roots.forEach(function (r, idx) {
    L.push("=== [" + r.label + "] " + r.root);
    if (!r.exists) { L.push("  (目录不存在)"); allOk = false; return; }
    L.push("  " + r.summary.mainApp);
    L.push("  " + r.summary.workbench);
    L.push("  " + r.summary.antiPoll);
    L.push("  " + r.summary.poll);
    L.push("  " + r.summary.poll2);
    L.push("  " + r.summary.viking);
    L.push("  " + r.summary.prompts);
    L.push("  " + r.summary.devtools);
    L.push("  " + r.summary.extNoise);
    L.push("  " + r.summary.product);
    L.push("  " + r.summary.agentHost);
    L.push("  " + r.summary.checksum);
    L.push("");
    if (r.summary.checksum.indexOf("OK") !== 0) allOk = false;
    if (idx === 0) {
      if (r.summary.mainApp.indexOf("caps=PRO") < 0) allOk = false;
      if (r.summary.workbench.indexOf("gate=SHORT") < 0) allOk = false;
    }
  });
  L.push("总体： " + (allOk ? "全部已生效" : "存在未生效项（见上）"));
  rep.allOk = allOk;
  try {
    if (dir) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      var pJson = path.join(dir, "breezell-offline-report.json");
      var pTxt = path.join(dir, "Breezell离线补丁-状态报告.txt");
      fs.writeFileSync(pJson, JSON.stringify(rep, null, 2), "utf8");
      fs.writeFileSync(pTxt, L.join("\r\n"), "utf8");
      rep.files = [pTxt, pJson];
    }
  } catch (e) { rep.error = String(e && e.message); }
  rep.text = L.join("\n");
  return rep;
}

function planRoot(root, lines) {
  var out = { root: root, items: [] };
  function run(file, patches, label) {
    var src;
    try { src = read(file); } catch (e) { log(lines, "ERROR", label + ": 读取失败 " + file); return; }
    patches.forEach(function (pt) {
      var loc = null, status = "ok", snippet = "";
      if (pt.done && src.indexOf(pt.done) >= 0) { out.items.push({ label: label, id: pt.id, status: "already" }); log(lines, "INFO", label + " " + pt.id + ": 已打过"); return; }
      if (!pt.done && pt.doneRe && pt.doneRe.test(src)) { out.items.push({ label: label, id: pt.id, status: "already" }); log(lines, "INFO", label + " " + pt.id + ": 已打过"); return; }
      try { loc = pt.find(src); } catch (e) { status = "find-error"; }
      if (!loc) { out.items.push({ label: label, id: pt.id, status: "notfound", desc: pt.desc }); log(lines, "ERROR", label + " " + pt.id + ": 锚点未找到 | " + pt.desc); return; }
      snippet = src.slice(loc.start, loc.end);
      if (loc.end > loc.start) {
        if (pt.expected && snippet !== pt.expected) status = "mismatch";
        if (pt.validate) { try { if (!pt.validate(snippet)) status = "mismatch"; } catch (e) { status = "mismatch"; } }
      }
      var rep = pt.replacement;
      if (pt.render) { try { rep = pt.render(rep, loc); } catch (e) { status = "render-error"; } }
      out.items.push({ label: label, id: pt.id, status: status, start: loc.start, end: loc.end, oldLen: snippet.length, newLen: rep.length, old: snippet.slice(0, 400), neu: String(rep).slice(0, 400) });
      log(lines, status === "ok" ? "INFO" : "ERROR", label + " " + pt.id + " [" + status + "] @" + loc.start + " len " + snippet.length + " -> " + String(rep).length + " | " + pt.desc);
    });
  }
  run(path.join(root, MAIN_REL.join(path.sep)), patchesMainApp(), "main.app.js");
  run(path.join(root, WB_REL.join(path.sep)), patchesWorkbench(), "workbench");
  run(path.join(root, AGENT_REL.join(path.sep)), patchesAgentHost(), "agentHost");
  run(path.join(root, PROD_REL.join(path.sep)), patchesProduct(), "product.json");
  return out;
}

module.exports = {
  sumOf: sumOf, dropInspect: dropInspect, rootSig: rootSig,
  syntaxCheck: syntaxCheck,
  checkText: checkText,
  findChecker: findChecker,
  VERSION: VERSION, MARK: MARK, BK_DIR: BK_DIR,
  CAPS_OFF: CAPS_OFF, CAPS_PRO: CAPS_PRO,
  sha256b64: sha256b64, patchRoot: patchRoot, restoreRoot: restoreRoot, syncChecksum: syncChecksum,
  patchesMainApp: patchesMainApp, patchesWorkbench: patchesWorkbench, patchesProduct: patchesProduct,
  AGENT_REL: AGENT_REL, patchesAgentHost: patchesAgentHost,
  inspectRoot: inspectRoot, planRoot: planRoot, backup: backup, log: log, once: once,
  describeRoot: describeRoot, writeReport: writeReport,
  extractModels: extractModels,
  BREEZELL_SUPPORTED: BREEZELL_SUPPORTED,
  builtinInfo: builtinInfo,
  PM_PURGE_RE: PM_PURGE_RE, defaultBuiltinText: defaultBuiltinText, augmentTheme: augmentTheme
};
