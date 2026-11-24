// ==UserScript==
// @name         抖音网页版精简版
// @namespace    https://github.com/Teristans/pure-live-plus
// @version      1.0.0
// @description  精简抖音网页版：去顶栏与左侧栏、过滤广告与弹窗，搜索栏移至左下角；保留播放控制条、设置、点赞、评论、作者头像等互动元素。
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
 * #douyin-right-container / #slidelist / .basePlayerContainer .positionBox / data-e2e 系列。
 * 许可证：GPL-3.0-or-later
 *
 * 设计原则：
 * 1) 只隐藏「 chrome 类界面」（顶栏、左栏）与明确的广告/弹窗，不碰播放器内部任何元素，
 *    因此播放控制条、设置按钮、右侧点赞/评论/作者头像/收藏/分享均原样保留。
 * 2) 搜索栏用原生 DOM 搭建并提交到抖音官方搜索路径，不依赖抖音自身 React 事件，改版更稳。
 */
(function () {
  "use strict";

  var SEARCH_PATH = "https://www.douyin.com/search/";
  var SEARCH_QUERY = "?type=general";

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

  function boot() {
    injectStyle(PURE_STYLE);
    mountSearch();
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
  };
})();
