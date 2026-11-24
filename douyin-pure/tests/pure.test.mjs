import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { JSDOM } from "jsdom";

const source = readFileSync(new URL("../douyin-pure.user.js", import.meta.url), "utf8");

function makeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); },
    clear() { data.clear(); },
  };
}

function loadScript({
  withGM = true,
  readyState = "complete",
  href = "https://www.douyin.com/?recommend=1",
  manualChannel = false,
} = {}) {
  const dom = new JSDOM(
    `<html><head></head><body><div id="douyin-header"></div><div id="douyin-navigation"></div><div id="douyin-right-container"><div class="basePlayerContainer"><div class="positionBox"></div></div></div></body></html>`,
    { url: "https://www.douyin.com/", runScripts: "outside-only" },
  );
  const realWindow = dom.window;
  Object.defineProperty(realWindow.document, "readyState", { value: readyState, configurable: true });

  // jsdom 的 location.href 拒绝跨源导航赋值，用一个可写的假 window 让导航可断言。
  const window = {
    document: realWindow.document,
    location: {
      href,
      replace(url) { this.href = url; this.replaced = url; },
    },
    sessionStorage: makeStorage(
      manualChannel ? { "douyin-pure-channel-manual": "1" } : {},
    ),
    Event: realWindow.Event,
    addEventListener: realWindow.addEventListener.bind(realWindow),
  };

  const styles = [];
  const sandbox = {
    window,
    document: realWindow.document,
    console,
    encodeURIComponent,
    GM_addStyle: withGM ? (css) => styles.push(css) : undefined,
  };
  // 让脚本内的裸 GM_addStyle 在未 grant 时确实 undefined
  if (!withGM) sandbox.GM_addStyle = undefined;
  runInNewContext(source, sandbox);
  return { dom, window, styles, api: window.DouyinPure };
}

test("userscript metadata is present and targets Douyu-free Douyin home", () => {
  const metadata = source.match(/^\/\/ ==UserScript==[\s\S]*?^\/\/ ==\/UserScript==/m)?.[0];
  assert.ok(metadata, "userscript metadata block must exist");
  assert.match(metadata, /@name\s+抖音网页版精简版/);
  assert.match(metadata, /@version\s+1\.1\.0/);
  assert.match(metadata, /@match\s+\*:\/\/www\.douyin\.com\/\*/);
  assert.match(metadata, /@grant\s+GM_addStyle/);
  assert.match(metadata, /@license\s+GPL-3\.0-or-later/);
});

test("hides top bar, left navigation and ads", () => {
  const { api } = loadScript();
  const css = api.style;
  for (const selector of [
    "#douyin-header",
    "#douyin-navigation",
    '[data-e2e="douyin-navigation"]',
    '[data-is-ad="true"]',
    "#douyin-web-download-guide-container",
    '[data-e2e="login-modal"]',
  ]) {
    assert.ok(css.includes(selector), `CSS should hide ${selector}`);
  }
});

test("keeps player controls, settings and interaction widgets intact", () => {
  const { api } = loadScript();
  const css = api.style;
  // 这些元素必须没有被加入隐藏规则（隐藏块以 display:none 结尾，逐个核对选择器不出现）
  for (const preserved of [
    ".positionBox",
    ".basePlayerContainer",
    ".xgplayer",
    "[data-e2e=\"like-icon\"]",
    "[data-e2e=\"comment-icon\"]",
    "[data-e2e=\"video-avatar\"]",
  ]) {
    assert.ok(!css.includes(preserved), `CSS must NOT hide preserved element ${preserved}`);
  }
  assert.match(css, /#douyin-right-container\s*\{[^}]*width:\s*100vw/);
});

test("mounts a bottom-left search dock with form and input", () => {
  const { window, styles } = loadScript();
  assert.equal(styles.length, 1, "CSS injected once via GM_addStyle");
  const form = window.document.getElementById("douyin-pure-search");
  assert.ok(form, "search dock mounted");
  assert.equal(form.tagName, "FORM");
  assert.equal(form.querySelector("input").getAttribute("type"), "search");
  assert.equal(form.querySelector("button").getAttribute("type"), "submit");
  assert.match(form.className, /douyin-pure-search/);
});

test("search dock is mounted idempotently", () => {
  const { window, api } = loadScript();
  api.mountSearch();
  api.mountSearch();
  assert.equal(window.document.querySelectorAll("#douyin-pure-search").length, 1);
});

test("buildSearchUrl encodes keywords and appends query", () => {
  const { api } = loadScript();
  assert.equal(
    api.buildSearchUrl("原神 攻略"),
    "https://www.douyin.com/search/%E5%8E%9F%E7%A5%9E%20%E6%94%BB%E7%95%A5?type=general",
  );
});

test("submitting the dock navigates to the official search page", () => {
  const { window } = loadScript();
  const form = window.document.getElementById("douyin-pure-search");
  form.querySelector("input").value = "搞笑视频";
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  assert.equal(
    window.location.href,
    "https://www.douyin.com/search/%E6%90%9E%E7%AC%91%E8%A7%86%E9%A2%91?type=general",
  );
});

test("empty keyword does not navigate", () => {
  const { window } = loadScript();
  const form = window.document.getElementById("douyin-pure-search");
  form.querySelector("input").value = "   ";
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  assert.equal(window.location.href, "https://www.douyin.com/?recommend=1");
});

test("falls back to injected style tag when GM_addStyle is unavailable", () => {
  const { window, styles } = loadScript({ withGM: false });
  assert.equal(styles.length, 0);
  const styleTags = window.document.querySelectorAll("style");
  assert.ok(styleTags.length >= 1, "a style element is appended");
  assert.ok(styleTags[0].textContent.includes("#douyin-header"));
});

test("DOMContentLoaded path also boots when readyState is loading", () => {
  const { dom, window } = loadScript({ readyState: "loading" });
  assert.equal(window.document.getElementById("douyin-pure-search"), null, "not mounted before DOM ready");
  dom.window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
  assert.ok(window.document.getElementById("douyin-pure-search"), "mounted after DOM ready");
});

test("mounts a channel dock replacing the hidden left navigation", () => {
  const { window } = loadScript();
  const nav = window.document.getElementById("douyin-pure-channels");
  assert.ok(nav, "channel dock mounted");
  assert.equal(nav.tagName, "NAV");
  const links = [...nav.querySelectorAll("a")];
  assert.deepEqual(links.map((a) => a.textContent), ["推荐", "精选", "关注", "朋友"]);
  assert.deepEqual(
    links.map((a) => a.getAttribute("href")),
    [
      "https://www.douyin.com/?recommend=1",
      "https://www.douyin.com/",
      "https://www.douyin.com/follow",
      "https://www.douyin.com/friend",
    ],
  );
});

test("channel dock highlights the current channel", () => {
  const cases = [
    ["https://www.douyin.com/?recommend=1", "recommend"],
    ["https://www.douyin.com/", "jingxuan"],
    ["https://www.douyin.com/follow", "follow"],
    ["https://www.douyin.com/friend", "friend"],
    ["https://www.douyin.com/video/123", "jingxuan"],
  ];
  for (const [href, expected] of cases) {
    // manualChannel 阻止自动跳转，保证此处的 href 用于断言高亮判断本身。
    const { window, api } = loadScript({ href, manualChannel: true });
    assert.equal(api.currentChannelId(), expected, `URL ${href} maps to ${expected}`);
    const active = window.document.querySelector("#douyin-pure-channels a[aria-current='page']");
    assert.equal(active?.getAttribute("data-channel"), expected);
  }
});

test("channel dock is mounted idempotently", () => {
  const { window, api } = loadScript();
  api.mountChannels();
  api.mountChannels();
  assert.equal(window.document.querySelectorAll("#douyin-pure-channels").length, 1);
});

test("clicking a channel marks manual choice so auto-redirect will not fight it", () => {
  const { window } = loadScript({ href: "https://www.douyin.com/?recommend=1" });
  const jingxuan = window.document.querySelector("#douyin-pure-channels a[data-channel='jingxuan']");
  jingxuan.dispatchEvent(new window.Event("click", { bubbles: true }));
  assert.equal(window.sessionStorage.getItem("douyin-pure-channel-manual"), "1");
});

test("bare home auto-redirects to the recommend feed", () => {
  const { window } = loadScript({ href: "https://www.douyin.com/" });
  assert.equal(window.location.replaced, "https://www.douyin.com/?recommend=1");
  assert.equal(window.location.href, "https://www.douyin.com/?recommend=1");
});

test("bare home does not redirect after a manual channel choice", () => {
  const { window } = loadScript({ href: "https://www.douyin.com/", manualChannel: true });
  assert.equal(window.location.replaced, undefined);
  assert.equal(window.location.href, "https://www.douyin.com/");
});

test("auto-redirect leaves non-home pages untouched", () => {
  for (const href of [
    "https://www.douyin.com/?recommend=1",
    "https://www.douyin.com/video/123",
    "https://www.douyin.com/follow",
  ]) {
    const { window } = loadScript({ href });
    assert.equal(window.location.replaced, undefined, `no redirect for ${href}`);
    assert.equal(window.location.href, href);
  }
});

test("channel dock styles are part of injected CSS", () => {
  const { api } = loadScript();
  assert.ok(api.style.includes(".douyin-pure-channels"));
  assert.ok(api.style.includes('[aria-current="page"]'));
});
