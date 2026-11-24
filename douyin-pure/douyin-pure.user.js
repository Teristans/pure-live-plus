// ==UserScript==
// @name         抖音网页版精简版
// @namespace    https://github.com/Teristans/pure-live-plus
// @version      1.2.0
// @description  精简抖音网页版：去顶栏与左侧栏、过滤广告与弹窗，搜索栏移至左下角；左下角悬浮频道导航通过点击抖音原生 tab 切换推荐/精选/关注/朋友（不依赖已失效的 URL 参数），自动进入推荐流；保留播放控制条、设置、点赞、评论、作者头像等互动元素。
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
 * .tab-recommend / .tab-discover / .tab-follow / .tab-friend / data-e2e 系列。
 * 许可证：GPL-3.0-or-later
 *
 * 设计原则：
 * 1) 只隐藏「 chrome 类界面」（顶栏、左栏）与明确的广告/弹窗，不碰播放器内部任何元素，
 *    因此播放控制条、设置按钮、右侧点赞/评论/作者头像/收藏/分享均原样保留。
 * 2) 搜索栏用原生 DOM 搭建并提交到抖音官方搜索路径，不依赖抖音自身 React 事件，改版更稳。
 * 3) 频道切换优先「点击左栏原生 tab」走抖音自己的路由。抖音已会把 ?recommend=1
 *    重写回精选页，URL 参数不可靠；原生 tab 即使被 CSS 隐藏，DOM 仍在，程序化点击有效。
 *    URL 跳转仅作为原生 tab 不存在时的兜底。
 */
(function () {
  "use strict";

  var SEARCH_PATH = "https://www.douyin.com/search/";
  var SEARCH_QUERY = "?type=general";
  var RECOMMEND_URL = "https://www.douyin.com/?recommend=1";
  var CHANNEL_MANUAL_KEY = "douyin-pure-channel-manual";
  var CHANNEL_LAST_KEY = "douyin-pure-channel";
  var AUTO_DONE_KEY = "douyin-pure-auto-done";

  // 打开首页时是否自动进入推荐流。改成 false 可保留「打开即精选」。
  var AUTO_RECOMMEND = true;

  // tabs 为左栏原生 tab 的 class 选择器（来自实测脚本 .tab-recommend/.tab-discover 等）；
  // href 只在原生 tab 找不到时作为兜底跳转。
  var CHANNELS = [
    { id: "recommend", label: "推荐", href: RECOMMEND_URL, tabs: [".tab-recommend"] },
    { id: "jingxuan", label: "精选", href: "https://www.douyin.com/jingxuan", tabs: [".tab-discover", ".tab-jingxuan"] },
    { id: "follow", label: "关注", href: "https://www.douyin.com/follow", tabs: [".tab-follow"] },
    { id: "friend", label: "朋友", href: "https://www.douyin.com/friend", tabs: [".tab-friend"] },
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

    /* ---------- 4. 左下角悬浮搜索栏 ---------- */
    ".douyin-pure-search {",
    "  position: fixed;",
    "  left: 16px;",
    "  bottom: 18px;",
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

    /* ---------- 5. 左下角频道导航（替代被隐藏的左侧栏） ---------- */
    ".douyin-pure-channels {",
    "  position: fixed;",
    "  left: 16px;",
    "  bottom: 62px;",
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

  // 找到左栏里抖音原生的 tab 元素（即使被 CSS 隐藏，DOM 仍存在）。
  function findNativeTab(id) {
    var channel = getChannel(id);
    if (!channel) return null;
    var scope = document.querySelector('[data-e2e="douyin-navigation"]') || document;
    for (var i = 0; i < channel.tabs.length; i++) {
      var found = scope.querySelector(channel.tabs[i]) || document.querySelector(channel.tabs[i]);
      if (found) return found;
    }
    return null;
  }

  // 派发完整的鼠标事件序列，兼容 React 基于 pointerdown / mousedown / click 的处理器。
  // 用 document.createEvent 而不是 new MouseEvent：后者在部分沙箱/油猴环境会因 view 参数报错。
  function fireEvent(target, type) {
    var event = null;
    try {
      event = document.createEvent("MouseEvents");
      event.initEvent(type, true, true);
      try { event.button = 0; event.buttons = 1; } catch (e) { /* 只读时忽略 */ }
    } catch (e) {
      try {
        event = document.createEvent("Event");
        event.initEvent(type, true, true);
      } catch (e2) { return; }
    }
    try { target.dispatchEvent(event); } catch (e) { /* 事件不被接受时忽略 */ }
  }

  function fireMouseSequence(target) {
    ["pointerover", "pointermove", "pointerdown", "mouseover", "mousemove",
     "mousedown", "pointerup", "mouseup", "click"].forEach(function (type) {
      fireEvent(target, type);
    });
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

  // 切换频道：优先点击原生 tab（返回 "native"），找不到时才整页跳转（返回 "url"）。
  function activateChannel(id, isAuto) {
    var channel = getChannel(id);
    if (!channel) return "none";
    if (!isAuto) {
      markManualChannel();
      storageSet(CHANNEL_LAST_KEY, id);
    }
    var tab = findNativeTab(id);
    if (tab) {
      var target = tab.closest ? tab.closest("a") || tab : tab;
      var restore = temporarilyRevealNav();
      fireMouseSequence(target);
      restore();
      if (isAuto) storageSet(AUTO_DONE_KEY, "1");
      return "native";
    }
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

  // 首页自动进入推荐：原生 tab 由 React 渲染，可能晚于脚本执行，故轮询等待，最多约 10 秒。
  function autoEnterRecommend() {
    if (!shouldAutoEnter()) return;
    var tries = 0;
    function attempt() {
      tries++;
      if (findNativeTab("recommend")) {
        activateChannel("recommend", true);
        refreshHighlight("recommend");
        return true;
      }
      if (tries >= 40) {
        storageSet(AUTO_DONE_KEY, "1");
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

  function boot() {
    injectStyle(PURE_STYLE);
    mountSearch();
    mountChannels();
    autoEnterRecommend();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  // 暴露给测试与小工具使用（不影响页面）。
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
    findNativeTab: findNativeTab,
    channels: CHANNELS,
    recommendUrl: RECOMMEND_URL,
    _stopAuto: function () {
      if (autoTimer) {
        clearInterval(autoTimer);
        autoTimer = null;
      }
    },
  };
})();
