// ==UserScript==
// @name         抖音网页版精简版
// @namespace    https://github.com/Teristans/pure-live-plus
// @version      1.4.0
// @description  精简抖音网页版：去顶栏与左侧栏、过滤广告与弹窗，搜索/频道菜单移至左上角；智能把视频清晰度调到 1080；保留播放控制条、设置、点赞、评论、作者头像等互动元素。
// @author       Teristans
// @license      GPL-3.0-or-later
// @homepage     https://github.com/Teristans/pure-live-plus
// @match        *://www.douyin.com/*
// @exclude      *://www.douyin.com/search/*
// @exclude      *://www.douyin.com/user/*
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

/*
 * 抖音网页版精简版 (douyin-pure)
 * Copyright (C) 2026-present Teristans
 * 选择器参考抖音网页版实测结构（2026）：#douyin-header / #douyin-navigation /
 * #douyin-right-container / #slidelist / .basePlayerContainer .positionBox /
 * data-e2e 系列。许可证：GPL-3.0-or-later
 *
 * 设计原则：
 * 1) 只隐藏「chrome 类界面」（顶栏、左栏）与明确的广告/弹窗，不碰播放器内部任何元素，
 *    因此播放控制条、设置按钮、右侧点赞/评论/作者头像/收藏/分享均原样保留。
 * 2) 搜索栏用原生 DOM 搭建并提交到抖音官方搜索路径，不依赖抖音自身 React 事件，改版更稳。
 * 3) 频道切换【不依赖猜测的 class】。抖音 class 哈希化且频繁改版，.tab-recommend 之类
 *    极易失配。这里改为运行时自适应定位：
 *      a. 文本精确匹配（"推荐"/"精选"等文字，最稳）
 *      b. data-e2e 语义属性匹配
 *      c. 历史 class 兜底
 *    找到后调用原生 element.click() 走抖音自身路由；只有完全找不到入口时才回退 URL。
 * 4) 清晰度智能调到 1080：双保险——(a) 页面播放器读 sessionStorage["MANUAL_SWITCH"]，
 *    写入 1080P 档位 JSON 并轮询保持约 21s，不依赖菜单 DOM；(b) 若清晰度菜单
 *    [data-e2e="quality-selector"] 可见，按文本智能选 1080（没有 1080 就选不超过
 *    1080 的最高档）。用户手动切换后本脚本不再干预。
 * 5) 搜索栏与频道菜单固定在左上角（替代原左下角布局）。
 * 6) 暴露 diagnose() 供排查：在页面控制台运行 DouyinPure.diagnose() 打印真实 DOM 候选。
 */
(function () {
  "use strict";

  var SEARCH_PATH = "https://www.douyin.com/search/";
  var SEARCH_QUERY = "?type=general";
  var RECOMMEND_URL = "https://www.douyin.com/?is_from_mobile_home=1&recommend=1";
  var CHANNEL_MANUAL_KEY = "douyin-pure-channel-manual-v13";
  var CHANNEL_LAST_KEY = "douyin-pure-channel-v13";
  var AUTO_DONE_KEY = "douyin-pure-auto-done-v13";

  // 打开首页时是否自动进入推荐流。改成 false 可保留「打开即精选」。
  var AUTO_RECOMMEND = true;

  // 是否智能把视频清晰度调到 1080。改成 false 可关闭。
  var AUTO_QUALITY_1080 = true;

  // 抖音播放器读取的清晰度手动档位 key（实测）。写入后播放器据此切换。
  var QUALITY_STORAGE_KEY = "MANUAL_SWITCH";
  var QUALITY_MANUAL_KEY = "douyin-pure-quality-manual-v14";

  // 1080P 档位对象（来自抖音实测档位表：gearName "高清 1080P", qualityType 2）。
  var GEAR_1080 = {
    done: 1,
    gearClarity: "5",
    gearName: "高清 1080P",
    gearType: 1,
    qualityType: 2,
  };

  // 清晰度档位识别规则：rank 越大画质越高；target=1080 时优先选 <=1080 的最高档。
  // match 用正则从档位文本里提取档位值（P 前的数字，或 2K/4K）。
  var QUALITY_GEARS = [
    { id: "smart", test: /智能|自动/i, height: 0 },
    { id: "fast", test: /极速|流畅/i, height: 0 },
    { id: "360", test: /360/i, height: 360 },
    { id: "480", test: /480/i, height: 480 },
    { id: "540", test: /540/i, height: 540 },
    { id: "720", test: /720/i, height: 720 },
    { id: "1080", test: /1080/i, height: 1080 },
    { id: "2k", test: /2k|1440/i, height: 1440 },
    { id: "4k", test: /4k|2160/i, height: 2160 },
  ];

  // label 用于文本精确匹配（最稳）；e2e 用于语义属性匹配；classHints 仅作兜底。
  var CHANNELS = [
    {
      id: "recommend", label: "推荐", e2e: ["tab-recommend", "recommend-tab", "nav-recommend"],
      classHints: [".tab-recommend"], href: RECOMMEND_URL,
    },
    {
      id: "jingxuan", label: "精选", e2e: ["tab-discover", "tab-jingxuan", "discover-tab"],
      classHints: [".tab-discover", ".tab-jingxuan"], href: "https://www.douyin.com/jingxuan",
    },
    {
      id: "follow", label: "关注", e2e: ["tab-follow", "follow-tab"],
      classHints: [".tab-follow"], href: "https://www.douyin.com/follow",
    },
    {
      id: "friend", label: "朋友", e2e: ["tab-friend", "friend-tab"],
      classHints: [".tab-friend"], href: "https://www.douyin.com/friend",
    },
  ];

  // 精简样式：隐藏项集中在此，便于维护；被保留的播放/互动元素不出现在这里。
  var PURE_STYLE = [
    /* ---------- 1. 去除顶栏与左侧栏 ---------- */
    "#douyin-header,",
    '[id^="douyin-header-"],',
    "#component-header,",
    "#douyin-navigation,",
    '[data-e2e="douyin-navigation"] {',
    "  display: none !important;",
    "}",

    /* ---------- 2. 内容区铺满整屏 ---------- */
    "#douyin-right-container {",
    "  width: 100vw !important;",
    "  max-width: 100vw !important;",
    "  margin-left: 0 !important;",
    "  padding-top: 0 !important;",
    "  --header-height: 0px !important;",
    "}",
    "#slidelist,",
    '[data-e2e="slideList"] {',
    "  width: 100% !important;",
    "  height: 100vh !important;",
    "  height: 100dvh !important;",
    "  margin: 0 !important;",
    "}",

    /* ---------- 3. 过滤广告 / 登录与下载弹窗 / 推广卡 ---------- */
    '[id^="related-video-card-login-guide"],',
    '[class*="login-guide"],',
    '[class*="login-modal"],',
    '[class*="login-popup"],',
    '[class*="login-mask"],',
    '[data-e2e="login-modal"],',
    "#douyin-web-download-guide-container,",
    '[class*="download-guide"],',
    '[class*="app-download"],',
    '[class*="ad-banner"],',
    '[class*="promotion-card"],',
    '[data-is-ad="true"],',
    ".h5-ad-video-card,",
    '.card-item:has(.h5-ad-video-card),',
    '.card-item:has([data-is-ad="true"]),',
    'a[download*="douyin-downloader"] {',
    "  display: none !important;",
    "}",

    /* ---------- 4. 左上角悬浮搜索栏 ---------- */
    ".douyin-pure-search {",
    "  position: fixed;",
    "  left: 16px;",
    "  top: 18px;",
    "  z-index: 2147483000;",
    "  display: flex;",
    "  align-items: center;",
    "  gap: 6px;",
    "  width: 240px;",
    "  height: 36px;",
    "  padding: 0 10px;",
    "  box-sizing: border-box;",
    "  background: rgba(0, 0, 0, 0.42);",
    "  border: 1px solid rgba(255, 255, 255, 0.2);",
    "  border-radius: 18px;",
    "  backdrop-filter: blur(8px);",
    "  -webkit-backdrop-filter: blur(8px);",
    "  opacity: 0.45;",
    "  transition: opacity 0.2s ease;",
    "}",
    ".douyin-pure-search:hover,",
    ".douyin-pure-search:focus-within {",
    "  opacity: 1;",
    "}",
    ".douyin-pure-search input {",
    "  flex: 1;",
    "  min-width: 0;",
    "  border: 0;",
    "  outline: 0;",
    "  background: transparent;",
    "  color: #fff;",
    "  font-size: 13px;",
    "}",
    ".douyin-pure-search input::placeholder {",
    "  color: rgba(255, 255, 255, 0.72);",
    "}",
    ".douyin-pure-search button {",
    "  border: 0;",
    "  padding: 2px 4px;",
    "  background: transparent;",
    "  color: #fff;",
    "  font-size: 13px;",
    "  cursor: pointer;",
    "}",

    /* ---------- 5. 左上角频道导航（替代被隐藏的左侧栏） ---------- */
    ".douyin-pure-channels {",
    "  position: fixed;",
    "  left: 16px;",
    "  top: 62px;",
    "  z-index: 2147483000;",
    "  display: flex;",
    "  gap: 6px;",
    "  opacity: 0.45;",
    "  transition: opacity 0.2s ease;",
    "}",
    ".douyin-pure-channels:hover {",
    "  opacity: 1;",
    "}",
    ".douyin-pure-channels a {",
    "  display: inline-block;",
    "  padding: 4px 10px;",
    "  color: #fff;",
    "  background: rgba(0, 0, 0, 0.42);",
    "  border: 1px solid rgba(255, 255, 255, 0.2);",
    "  border-radius: 12px;",
    "  font-size: 12px;",
    "  line-height: 1.4;",
    "  cursor: pointer;",
    "  text-decoration: none;",
    "}",
    '.douyin-pure-channels a[aria-current="page"] {',
    "  background: rgba(255, 255, 255, 0.88);",
    "  color: #000;",
    "  border-color: rgba(255, 255, 255, 0.88);",
    "}",
  ].join("\n");

  function log() {
    try {
      if (typeof console !== "undefined" && console.log) {
        console.log.apply(console, ["[douyin-pure]"].concat([].slice.call(arguments)));
      }
    } catch (e) { /* 忽略 */ }
  }

  function injectStyle(css) {
    if (typeof GM_addStyle === "function") {
      GM_addStyle(css);
      return;
    }
    var style = document.createElement("style");
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  function buildSearchUrl(keyword) {
    return SEARCH_PATH + encodeURIComponent(keyword) + SEARCH_QUERY;
  }

  function mountSearch() {
    if (document.getElementById("douyin-pure-search")) return;
    var form = document.createElement("form");
    form.id = "douyin-pure-search";
    form.className = "douyin-pure-search";
    form.setAttribute("autocomplete", "off");
    var input = document.createElement("input");
    input.type = "search";
    input.placeholder = "搜索抖音";
    input.setAttribute("aria-label", "搜索抖音");
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var keyword = input.value.trim();
      if (!keyword) {
        input.focus();
        return;
      }
      window.location.href = buildSearchUrl(keyword);
    });
    var button = document.createElement("button");
    button.type = "submit";
    button.textContent = "搜索";
    form.appendChild(input);
    form.appendChild(button);
    (document.body || document.documentElement).appendChild(form);
  }

  function storageGet(key) {
    try {
      return window.sessionStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      window.sessionStorage.setItem(key, value);
    } catch (e) {
      /* 隐私模式等禁用 storage 的场景静默跳过 */
    }
  }

  function markManualChannel() {
    storageSet(CHANNEL_MANUAL_KEY, "1");
  }

  function getChannel(id) {
    for (var i = 0; i < CHANNELS.length; i++) {
      if (CHANNELS[i].id === id) return CHANNELS[i];
    }
    return null;
  }

  /* ==================== 自适应定位核心 ==================== */

  function navScope() {
    return document.querySelector('[data-e2e="douyin-navigation"]') ||
      document.getElementById("douyin-navigation") ||
      document.body;
  }

  function isOurUi(el) {
    return !!(el && el.closest && el.closest('[id^="douyin-pure-"]'));
  }

  // 取元素的直接文本（不含子节点），避免父容器 textContent 混入所有 tab 文字。
  function directText(el) {
    var out = "";
    var nodes = el.childNodes || [];
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].nodeType === 3) out += nodes[i].nodeValue;
    }
    return out;
  }

  function walkElements(root, visit) {
    var children = root && root.children ? root.children : [];
    for (var i = 0; i < children.length; i++) {
      if (visit(children[i])) return children[i];
      var found = walkElements(children[i], visit);
      if (found) return found;
    }
    return null;
  }

  // 策略 A：文本精确匹配"推荐"/"精选"等，最抗改版。
  function findByText(label, scope) {
    return walkElements(scope, function (el) {
      if (isOurUi(el)) return false;
      return directText(el).trim() === label;
    });
  }

  // 策略 B：data-e2e 语义属性匹配（抖音相对稳定的测试属性）。
  function findByE2e(tokens, scope) {
    var all = (scope.querySelectorAll ? scope.querySelectorAll("[data-e2e]") : []);
    for (var i = 0; i < all.length; i++) {
      if (isOurUi(all[i])) continue;
      var value = String(all[i].getAttribute("data-e2e") || "").toLowerCase();
      for (var j = 0; j < tokens.length; j++) {
        if (value.indexOf(tokens[j].toLowerCase()) !== -1) return all[i];
      }
    }
    return null;
  }

  // 策略 C：历史 class 兜底。
  function findByClass(hints, scope) {
    for (var i = 0; i < hints.length; i++) {
      var el = null;
      try { el = scope.querySelector(hints[i]); } catch (e) { /* 无效选择器忽略 */ }
      if (!el) {
        try { el = document.querySelector(hints[i]); } catch (e2) { /* 忽略 */ }
      }
      if (el && !isOurUi(el)) return el;
    }
    return null;
  }

  // 依次尝试三种策略定位原生入口。每种策略都先搜导航区，再搜整页
  // （抖音可能把 tab 放在顶栏或其他容器，不能只盯左栏）。
  function findChannelEntry(id) {
    var channel = getChannel(id);
    if (!channel) return null;
    var scope = navScope();
    var doc = document.body || document;
    var scopes = scope === doc ? [doc] : [scope, doc];
    var i;

    for (i = 0; i < scopes.length; i++) {
      var byText = findByText(channel.label, scopes[i]);
      if (byText) {
        log("findChannelEntry(%s) -> text match in scope %d", id, i);
        return byText;
      }
    }
    for (i = 0; i < scopes.length; i++) {
      var byE2e = findByE2e(channel.e2e, scopes[i]);
      if (byE2e) {
        log("findChannelEntry(%s) -> data-e2e match in scope %d", id, i);
        return byE2e;
      }
    }
    for (i = 0; i < scopes.length; i++) {
      var byClass = findByClass(channel.classHints, scopes[i]);
      if (byClass) {
        log("findChannelEntry(%s) -> class fallback in scope %d", id, i);
        return byClass;
      }
    }
    log("findChannelEntry(%s) -> NOT FOUND", id);
    return null;
  }

  // 点击期间临时恢复左栏可见，规避「隐藏元素不响应」的框架逻辑，随后立即还原。
  function temporarilyRevealNav() {
    var nodes = document.querySelectorAll('#douyin-navigation, [data-e2e="douyin-navigation"]');
    var saved = [];
    for (var i = 0; i < nodes.length; i++) {
      saved.push([nodes[i], nodes[i].style.display]);
      nodes[i].style.setProperty("display", "block", "important");
    }
    return function restore() {
      for (var j = 0; j < saved.length; j++) {
        var previous = saved[j][1];
        if (previous) saved[j][0].style.setProperty("display", previous, "important");
        else saved[j][0].style.removeProperty("display");
      }
    };
  }

  // 合成事件序列，作为 element.click() 失败时的兜底。
  function fireEvent(target, type) {
    var event = null;
    try {
      event = document.createEvent("MouseEvents");
      event.initEvent(type, true, true);
      try { event.button = 0; event.buttons = 1; } catch (e) { /* 只读时忽略 */ }
    } catch (e2) {
      try {
        event = document.createEvent("Event");
        event.initEvent(type, true, true);
      } catch (e3) { return; }
    }
    try { target.dispatchEvent(event); } catch (e4) { /* 忽略 */ }
  }

  function fireMouseSequence(target) {
    ["pointerover", "pointermove", "pointerdown", "mouseover", "mousemove",
      "mousedown", "pointerup", "mouseup", "click"].forEach(function (type) {
      fireEvent(target, type);
    });
  }

  // 切换频道：自适应找到原生入口后用 element.click() 触发抖音路由；找不到才回退 URL。
  function activateChannel(id, isAuto) {
    var channel = getChannel(id);
    if (!channel) return "none";
    if (!isAuto) {
      markManualChannel();
      storageSet(CHANNEL_LAST_KEY, id);
    }
    var entry = findChannelEntry(id);
    if (entry) {
      var target = entry.closest ? entry.closest("a") || entry : entry;
      var restore = temporarilyRevealNav();
      var via = "click";
      try {
        // 原生 .click() 最可靠，会触发 React/Next 的 onClick 与内部路由。
        target.click();
      } catch (e) {
        via = "synthetic";
        fireMouseSequence(target);
      }
      restore();
      log("activateChannel(%s) via %s on <%s>", id, via, target.tagName);
      if (isAuto) storageSet(AUTO_DONE_KEY, "1");
      return via;
    }
    log("activateChannel(%s) -> no native entry, fallback URL %s", id, channel.href);
    window.location.href = channel.href;
    return "url";
  }

  function currentChannelId() {
    var href = String(window.location.href || "");
    if (/\/follow(?:[/?#]|$)/.test(href)) return "follow";
    if (/\/friend(?:[/?#]|$)/.test(href)) return "friend";
    if (/\/jingxuan(?:[/?#]|$)/.test(href)) return "jingxuan";
    var saved = storageGet(CHANNEL_LAST_KEY);
    if (saved === "recommend" || saved === "jingxuan" || saved === "follow" || saved === "friend") return saved;
    return "recommend";
  }

  function isHomeLike() {
    var href = String(window.location.href || "");
    return /^https?:\/\/www\.douyin\.com\/(?:jingxuan\/?)?(?:[?#].*)?$/.test(href);
  }

  function shouldAutoEnter() {
    if (!AUTO_RECOMMEND || !isHomeLike()) return false;
    if (storageGet(CHANNEL_MANUAL_KEY) === "1") return false;
    if (storageGet(AUTO_DONE_KEY) === "1") return false;
    return true;
  }

  var autoTimer = null;

  // 首页自动进入推荐：原生入口可能晚于脚本渲染，轮询等待，最多约 10 秒后走兜底 URL。
  function autoEnterRecommend() {
    if (!shouldAutoEnter()) return;
    var tries = 0;
    function attempt() {
      tries++;
      if (findChannelEntry("recommend")) {
        activateChannel("recommend", true);
        refreshHighlight("recommend");
        return true;
      }
      if (tries >= 40) {
        storageSet(AUTO_DONE_KEY, "1");
        log("auto enter: native entry never appeared, fallback URL");
        window.location.href = RECOMMEND_URL;
        return true;
      }
      return false;
    }
    if (attempt()) return;
    autoTimer = setInterval(function () {
      if (attempt()) {
        clearInterval(autoTimer);
        autoTimer = null;
      }
    }, 250);
  }

  function refreshHighlight(id) {
    var nav = document.getElementById("douyin-pure-channels");
    if (!nav) return;
    var links = nav.querySelectorAll("a");
    for (var i = 0; i < links.length; i++) {
      if (links[i].getAttribute("data-channel") === id) links[i].setAttribute("aria-current", "page");
      else links[i].removeAttribute("aria-current");
    }
  }

  function mountChannels() {
    if (document.getElementById("douyin-pure-channels")) return;
    var nav = document.createElement("nav");
    nav.id = "douyin-pure-channels";
    nav.className = "douyin-pure-channels";
    nav.setAttribute("aria-label", "频道切换");
    var active = currentChannelId();
    CHANNELS.forEach(function (item) {
      var link = document.createElement("a");
      link.href = item.href;
      link.textContent = item.label;
      link.setAttribute("data-channel", item.id);
      if (item.id === active) link.setAttribute("aria-current", "page");
      link.addEventListener("click", function (event) {
        event.preventDefault();
        activateChannel(item.id, false);
        refreshHighlight(item.id);
      });
      nav.appendChild(link);
    });
    (document.body || document.documentElement).appendChild(nav);
  }

  /* ==================== 清晰度智能 1080 ==================== */

  // 页面 sessionStorage（油猴沙箱下 window.sessionStorage 指向页面同源存储）。
  function getPageStorage() {
    try {
      return window.sessionStorage || null;
    } catch (e) {
      return null;
    }
  }

  // 用户是否已手动改过清晰度（手动后本脚本不再干预）。
  function isQualityManual() {
    return storageGet(QUALITY_MANUAL_KEY) === "1";
  }

  // 从档位文本解析档位（如"高清 1080P" -> 1080 档）。
  function parseGearFromText(text) {
    var str = String(text || "");
    for (var i = 0; i < QUALITY_GEARS.length; i++) {
      if (QUALITY_GEARS[i].test.test(str)) return QUALITY_GEARS[i];
    }
    return null;
  }

  // 在不超过 1080 的档位里选最高的一档（智能：视频无 1080 时选最接近且不超 1080 的）。
  function pickBestQualityItem(items) {
    var best = null;
    var bestHeight = -1;
    for (var i = 0; i < items.length; i++) {
      var text = items[i].textContent || "";
      var gear = parseGearFromText(text);
      if (!gear) continue;
      if (gear.height > 1080) continue; // 跳过 2K/4K，避免超出目标
      if (gear.height > bestHeight) {
        bestHeight = gear.height;
        best = { el: items[i], gear: gear, text: String(text).trim() };
      }
    }
    return best;
  }

  // 写 MANUAL_SWITCH = 1080 档位 JSON，供抖音播放器读取切换。
  function writeQualityStorage() {
    var store = getPageStorage();
    if (!store) return false;
    try {
      store.setItem(QUALITY_STORAGE_KEY, JSON.stringify(GEAR_1080));
      return true;
    } catch (e) {
      return false;
    }
  }

  var qualityTimer = null;
  var qualityWrites = 0;
  var QUALITY_MAX_WRITES = 84; // 250ms * 84 ≈ 21s，覆盖播放器延迟读取与视频切换

  // 确保 1080：立即写一次，然后有限次数轮询保持；用户手动选择后停止。
  function ensureQuality1080(force) {
    if (!AUTO_QUALITY_1080) return "disabled";
    if (isQualityManual() && !force) return "manual";
    writeQualityStorage();
    // 菜单若可见，按文本智能点选（1080 或不超过 1080 的最高档），双保险。
    var pick = pickQualityFromMenu();
    if (pick) {
      try { pick.el.click(); } catch (e) { /* 忽略 */ }
    }
    if (qualityTimer) return "running";
    qualityWrites = 0;
    qualityTimer = setInterval(function () {
      if (isQualityManual()) {
        clearInterval(qualityTimer);
        qualityTimer = null;
        return;
      }
      qualityWrites++;
      writeQualityStorage();
      if (qualityWrites >= QUALITY_MAX_WRITES) {
        clearInterval(qualityTimer);
        qualityTimer = null;
      }
    }, 250);
    return "started";
  }

  // 从可见的清晰度菜单里找最佳档位元素（按文本匹配，不依赖 class）。
  function pickQualityFromMenu() {
    var selectors = [
      '[data-e2e="quality-selector"] > div',
      '.QualitySwitchNewPlugin [data-e2e="quality-selector"] > div',
      '.xgplayer-playclarity-setting [class*="item"]',
    ];
    for (var s = 0; s < selectors.length; s++) {
      var found = null;
      try { found = document.querySelectorAll(selectors[s]); } catch (e) { continue; }
      if (found && found.length) {
        var pick = pickBestQualityItem(found);
        if (pick) return pick;
      }
    }
    return null;
  }

  // 用户用鼠标操作清晰度菜单时打标记，脚本随即停止写入，保证手动优先。
  function watchManualQuality() {
    function onPointerDown(event) {
      try {
        var target = event.target;
        if (!target || !target.closest) return;
        if (target.closest('[data-e2e="quality-selector"]') ||
            target.closest(".xgplayer-playclarity-setting")) {
          storageSet(QUALITY_MANUAL_KEY, "1");
          if (qualityTimer) {
            clearInterval(qualityTimer);
            qualityTimer = null;
          }
          log("user manually changed quality; auto 1080 disabled this session");
        }
      } catch (e) { /* 忽略 */ }
    }
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
  }

  function stopQuality() {
    if (qualityTimer) {
      clearInterval(qualityTimer);
      qualityTimer = null;
    }
  }

  /* ==================== 诊断工具 ==================== */

  function describe(el) {
    if (!el) return null;
    var cls = el.className;
    if (cls && typeof cls !== "string") cls = cls.baseVal || String(cls);
    return {
      tag: el.tagName,
      id: el.id || null,
      class: cls || null,
      e2e: el.getAttribute ? el.getAttribute("data-e2e") : null,
      href: el.getAttribute ? el.getAttribute("href") : null,
      text: directText(el).trim(),
    };
  }

  // 在控制台运行 DouyinPure.diagnose() 可打印真实 DOM 候选，便于精确修复选择器。
  function diagnose() {
    var scope = navScope();
    var report = {
      url: String(window.location.href || ""),
      navScope: describe(scope),
      channelCandidates: {},
      textCandidates: [],
      e2eSamples: [],
      quality: {
        autoEnabled: AUTO_QUALITY_1080,
        manualFlag: isQualityManual(),
        storedManualSwitch: (function () {
          var store = getPageStorage();
          try { return store ? store.getItem(QUALITY_STORAGE_KEY) : null; } catch (e) { return null; }
        })(),
        menuBestPick: describe(pickQualityFromMenu() ? pickQualityFromMenu().el : null),
      },
    };
    CHANNELS.forEach(function (ch) {
      report.channelCandidates[ch.id] = describe(findChannelEntry(ch.id));
    });
    walkElements(document.body, function (el) {
      var text = directText(el).trim();
      if (text && /推荐|精选|关注|朋友/.test(text) && text.length <= 12 && !isOurUi(el)) {
        report.textCandidates.push(describe(el));
      }
      return false;
    });
    var all = document.querySelectorAll("[data-e2e]");
    for (var i = 0; i < Math.min(all.length, 60); i++) {
      report.e2eSamples.push(String(all[i].getAttribute("data-e2e")));
    }
    log("diagnose:", report);
    return report;
  }

  function boot() {
    injectStyle(PURE_STYLE);
    mountSearch();
    mountChannels();
    autoEnterRecommend();
    if (AUTO_QUALITY_1080) {
      watchManualQuality();
      ensureQuality1080(false);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  // 暴露给测试、诊断与小工具使用（不影响页面）。
  window.DouyinPure = {
    style: PURE_STYLE,
    buildSearchUrl: buildSearchUrl,
    mountSearch: mountSearch,
    mountChannels: mountChannels,
    currentChannelId: currentChannelId,
    isHomeLike: isHomeLike,
    shouldAutoEnter: shouldAutoEnter,
    autoEnterRecommend: autoEnterRecommend,
    activateChannel: activateChannel,
    findChannelEntry: findChannelEntry,
    findNativeTab: findChannelEntry, // 兼容旧调用
    diagnose: diagnose,
    // 清晰度模块
    writeQualityStorage: writeQualityStorage,
    ensureQuality1080: ensureQuality1080,
    pickQualityFromMenu: pickQualityFromMenu,
    pickBestQualityItem: pickBestQualityItem,
    parseGearFromText: parseGearFromText,
    isQualityManual: isQualityManual,
    gear1080: GEAR_1080,
    channels: CHANNELS,
    recommendUrl: RECOMMEND_URL,
    autoQualityEnabled: AUTO_QUALITY_1080,
    _stopAuto: function () {
      if (autoTimer) {
        clearInterval(autoTimer);
        autoTimer = null;
      }
    },
    _stopQuality: stopQuality,
  };
})();
