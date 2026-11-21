"use strict";
/* breezell-offline :: 内置浏览器工作台桥（v2.3.0）
 *
 * Breezell 自带一个完整的内置浏览器（browser editor），命令面 ~30 条，
 * 注册在 workbench 的 breezell.browserView.* 命名空间里。扩展宿主可以直接
 * executeCommand 到这些 id —— 它们跑在渲染进程，返回值经 RPC 回到这里。
 *
 * 设计原则：
 *  1. 每个入口都包 try/catch，返回 {ok, data, error} 形状，绝不把异常抛给面板；
 *  2. 打开用 ensureBreezellBrowserOpen（幂等，不会把已开的窗口关掉），
 *     toggle 留给面板上单独一个「开关」按钮；
 *  3. 没有内置浏览器 / 命令被裁剪时返回 ok:false + 明确 error，面板显示原文。
 */
const vscode = require("vscode");

/* 默认首页：cn.bing.com（用户可选，可在面板「浏览器」页改成任意地址） */
const DEFAULT_HOME = "https://cn.bing.com";

/* 面板上的候选首页（可选，不限于这些） */
const HOME_PRESETS = [
  { key: "cn.bing.com", url: "https://cn.bing.com", label: "必应（中国）" },
  { key: "www.bing.com", url: "https://www.bing.com", label: "必应（国际）" },
  { key: "www.google.com", url: "https://www.google.com", label: "Google" },
  { key: "www.baidu.com", url: "https://www.baidu.com", label: "百度" },
  { key: "github.com", url: "https://github.com", label: "GitHub" },
  { key: "breezell.com", url: "https://breezell.com", label: "Breezell 官网" },
  { key: "blank", url: "about:blank", label: "空白页" }
];

function normUrl(u) {
  var s = String(u || "").trim();
  if (!s) return "";
  if (s === "blank") return "about:blank";
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) return s;
  if (s.indexOf(".") > 0 && s.indexOf(" ") < 0) return "https://" + s;
  return "https://www.bing.com/search?q=" + encodeURIComponent(s);
}

async function call(id, ...args) {
  try {
    var r = await vscode.commands.executeCommand(id, ...args);
    return { ok: true, data: r === undefined ? null : r };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), id: id };
  }
}

/* 幂等打开：已有 browser editor 就激活，没有再建一个 */
function open(home) {
  return call("workbench.action.ensureBreezellBrowserOpen").then(function (r) {
    if (!r.ok) return r;
    var u = normUrl(home);
    if (!u) return r;
    /* 打开后延迟导航，等 editor 实例就绪（官方 toggle 命令里也是 50ms） */
    return new Promise(function (res) {
      setTimeout(function () {
        call("breezell.browserView.navigate", u).then(function (n2) {
          res({ ok: true, data: r.data, nav: n2 });
        });
      }, 120);
    });
  });
}

/* 开关语义：再点一次收起 */
function toggle() {
  return call("workbench.action.toggleBreezellBrowser");
}

function newTab(url) {
  var u = normUrl(url);
  return u ? call("breezell.browserView.newTab", u) : call("breezell.browserView.newTab");
}

function switchTab(id) { return call("breezell.browserView.switchTab", id); }
function closeTab(id) { return call("breezell.browserView.closeTab", id); }
function navigate(url) { return call("breezell.browserView.navigate", normUrl(url)); }
function navigateTab(id, url) { return call("breezell.browserView.navigateTab", id, normUrl(url)); }
function back() { return call("breezell.browserView.goBack"); }
function forward() { return call("breezell.browserView.goForward"); }
function reload() { return call("breezell.browserView.reload"); }
function muteAll(on) { return call("breezell.browserView.setMuteAll", !!on); }
function muteTab(id, on) { return call("breezell.browserView.setTabMuted", id, !!on); }
function currentUrl() { return call("breezell.browserView.getURL"); }
function navState() { return call("breezell.browserView.getNavigationState"); }

/* 汇总给面板：标签列表 + 当前 URL + 是否可见。任一子项失败不影响整体。 */
async function state() {
  var tabs = await call("breezell.browserView.getTabs");
  var out = { ok: !!tabs.ok, tabs: [], url: null, error: tabs.ok ? null : tabs.error, at: Date.now() };
  if (tabs.ok && tabs.data) {
    var arr = tabs.data;
    if (!Array.isArray(arr) && arr && Array.isArray(arr.tabs)) arr = arr.tabs;
    if (Array.isArray(arr)) {
      out.tabs = arr.map(function (t) {
        return {
          id: (t && t.id !== undefined) ? t.id : null,
          title: String((t && (t.title || t.url)) || "(untitled)"),
          url: String((t && t.url) || ""),
          active: !!(t && t.active),
          muted: !!(t && (t.muted || t.muteAll))
        };
      });
    }
  }
  var u = await currentUrl();
  if (u.ok) {
    var d = u.data;
    out.url = (d && typeof d === "object" && "url" in d) ? String(d.url || "") : (d == null ? "" : String(d));
  }
  var ns = await navState();
  if (ns.ok && ns.data && typeof ns.data === "object") {
    out.canGoBack = !!ns.data.canGoBack;
    out.canGoForward = !!ns.data.canGoForward;
  }
  return out;
}

module.exports = {
  DEFAULT_HOME: DEFAULT_HOME,
  HOME_PRESETS: HOME_PRESETS,
  normUrl: normUrl,
  call: call,
  open: open,
  toggle: toggle,
  newTab: newTab,
  switchTab: switchTab,
  closeTab: closeTab,
  navigate: navigate,
  navigateTab: navigateTab,
  back: back,
  forward: forward,
  reload: reload,
  muteAll: muteAll,
  muteTab: muteTab,
  currentUrl: currentUrl,
  navState: navState,
  state: state
};
