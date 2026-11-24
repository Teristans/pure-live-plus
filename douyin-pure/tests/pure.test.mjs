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
  withNativeTabs = true,
  manualChannel = false,
  autoDone = false,
} = {}) {
  const tabsHtml = withNativeTabs
    ? `<div id="douyin-navigation" data-e2e="douyin-navigation">
         <div class="tab-recommend">推荐</div>
         <div class="tab-discover">精选</div>
         <div class="tab-follow">关注</div>
         <div class="tab-friend">朋友</div>
       </div>`
    : "";
  const dom = new JSDOM(
    `<html><head></head><body>${tabsHtml}<div id="douyin-header"></div><div id="douyin-right-container"><div class="basePlayerContainer"><div class="positionBox"></div></div></div></body></html>`,
    { url: "https://www.douyin.com/", runScripts: "outside-only" },
  );
  const realWindow = dom.window;
  Object.defineProperty(realWindow.document, "readyState", { value: readyState, configurable: true });

  // jsdom 的 location.href 拒绝跨源导航赋值，用可写的假 window 让导航可断言。
  const window = {
    document: realWindow.document,
    location: {
      href,
      assign(url) { this.href = url; this.assigned = url; },
      replace(url) { this.href = url; this.replaced = url; },
    },
    sessionStorage: makeStorage({
      ...(manualChannel ? { "douyin-pure-channel-manual": "1" } : {}),
      ...(autoDone ? { "douyin-pure-auto-done": "1" } : {}),
    }),
    PointerEvent: realWindow.MouseEvent,
    MouseEvent: realWindow.MouseEvent,
    Event: realWindow.Event,
    setInterval: realWindow.setInterval.bind(realWindow),
    clearInterval: realWindow.clearInterval.bind(realWindow),
    addEventListener: realWindow.addEventListener.bind(realWindow),
  };

  const styles = [];
  const sandbox = {
    window,
    document: realWindow.document,
    console,
    encodeURIComponent,
    setInterval: window.setInterval,
    clearInterval: window.clearInterval,
    GM_addStyle: withGM ? (css) => styles.push(css) : undefined,
  };
  if (!withGM) sandbox.GM_addStyle = undefined;
  runInNewContext(source, sandbox);
  return { dom, window, styles, api: window.DouyinPure };
}

test("userscript metadata targets Douyin home with GPL license", () => {
  const metadata = source.match(/^\/\/ ==UserScript==[\s\S]*?^\/\/ ==\/UserScript==/m)?.[0];
  assert.ok(metadata, "userscript metadata block must exist");
  assert.match(metadata, /@name\s+抖音网页版精简版/);
  assert.match(metadata, /@version\s+1\.2\.0/);
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
  for (const preserved of [
    ".positionBox",
    ".basePlayerContainer",
    ".xgplayer",
    '[data-e2e="like-icon"]',
    '[data-e2e="comment-icon"]',
    '[data-e2e="video-avatar"]',
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
  assert.ok(styleTags.length >= 1);
  assert.ok(styleTags[0].textContent.includes("#douyin-header"));
});

test("DOMContentLoaded path also boots when readyState is loading", () => {
  const { dom, window } = loadScript({ readyState: "loading" });
  assert.equal(window.document.getElementById("douyin-pure-search"), null, "not mounted before DOM ready");
  dom.window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
  assert.ok(window.document.getElementById("douyin-pure-search"), "mounted after DOM ready");
});

test("mounts a channel dock with four native-tab-backed links", () => {
  const { window } = loadScript();
  const nav = window.document.getElementById("douyin-pure-channels");
  assert.ok(nav, "channel dock mounted");
  assert.equal(nav.tagName, "NAV");
  assert.deepEqual(
    [...nav.querySelectorAll("a")].map((a) => a.textContent),
    ["推荐", "精选", "关注", "朋友"],
  );
  for (const id of ["recommend", "jingxuan", "follow", "friend"]) {
    assert.ok(nav.querySelector(`a[data-channel="${id}"]`), `link ${id} exists`);
  }
});

test("finds native tabs even though they are visually hidden", () => {
  const { api } = loadScript();
  assert.equal(api.findNativeTab("recommend").textContent.trim(), "推荐");
  assert.equal(api.findNativeTab("jingxuan").textContent.trim(), "精选");
  assert.equal(api.findNativeTab("follow").textContent.trim(), "关注");
  assert.equal(api.findNativeTab("friend").textContent.trim(), "朋友");
});

test("clicking 推荐 fires native tab click sequence, not a URL rewrite", () => {
  const { window } = loadScript({ href: "https://www.douyin.com/jingxuan" });
  const seen = [];
  window.document.querySelector(".tab-recommend").addEventListener("click", () => seen.push("click"));
  window.document.querySelector(".tab-recommend").addEventListener("mousedown", () => seen.push("mousedown"));
  const link = window.document.querySelector('#douyin-pure-channels a[data-channel="recommend"]');
  link.dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
  assert.ok(seen.includes("click"), "native tab received click");
  assert.ok(seen.includes("mousedown"), "native tab received mousedown");
  assert.equal(window.location.href, "https://www.douyin.com/jingxuan", "URL untouched: uses native router");
  assert.equal(window.sessionStorage.getItem("douyin-pure-channel-manual"), "1");
  assert.equal(window.sessionStorage.getItem("douyin-pure-channel"), "recommend");
});

test("clicking each channel dispatches events on its own native tab", () => {
  const cases = [
    ["jingxuan", ".tab-discover"],
    ["follow", ".tab-follow"],
    ["friend", ".tab-friend"],
  ];
  for (const [id, selector] of cases) {
    const { window } = loadScript();
    let clicked = 0;
    window.document.querySelector(selector).addEventListener("click", () => clicked++);
    window.document.querySelector(`#douyin-pure-channels a[data-channel="${id}"]`)
      .dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    assert.equal(clicked, 1, `${id} native tab clicked`);
  }
});

test("falls back to URL navigation when native tabs are absent", () => {
  const { window, api } = loadScript({ withNativeTabs: false });
  assert.equal(api.findNativeTab("recommend"), null);
  assert.equal(api.activateChannel("recommend", false), "url");
  assert.equal(window.location.href, "https://www.douyin.com/?recommend=1");
});

test("channel dock highlights the activated channel", () => {
  const { window } = loadScript();
  window.document.querySelector('#douyin-pure-channels a[data-channel="follow"]')
    .dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
  assert.equal(
    window.document.querySelector('#douyin-pure-channels a[aria-current="page"]').getAttribute("data-channel"),
    "follow",
  );
});

test("channel dock is mounted idempotently", () => {
  const { window, api } = loadScript();
  api.mountChannels();
  api.mountChannels();
  assert.equal(window.document.querySelectorAll("#douyin-pure-channels").length, 1);
});

test("auto enter recommend clicks native tab immediately on home", () => {
  // readyState=loading 让 boot 延后，先断言初始状态，再派发 DOMContentLoaded 触发自动进入。
  const { dom, window, api } = loadScript({ href: "https://www.douyin.com/", readyState: "loading" });
  let clicked = 0;
  window.document.querySelector(".tab-recommend").addEventListener("click", () => clicked++);
  assert.equal(api.shouldAutoEnter(), true, "home should auto-enter before boot");
  dom.window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
  api._stopAuto();
  assert.equal(clicked, 1, "native recommend tab clicked on boot");
  assert.equal(window.sessionStorage.getItem("douyin-pure-auto-done"), "1");
  assert.equal(window.sessionStorage.getItem("douyin-pure-channel-manual"), null, "auto does not mark manual");
});

test("auto enter recommend is skipped after manual choice or prior auto", () => {
  for (const opts of [{ manualChannel: true }, { autoDone: true }]) {
    const { api } = loadScript({ href: "https://www.douyin.com/", ...opts });
    assert.equal(api.shouldAutoEnter(), false);
    api.autoEnterRecommend();
    api._stopAuto();
  }
});

test("auto enter recommend is skipped on non-home pages", () => {
  for (const href of [
    "https://www.douyin.com/video/123",
    "https://www.douyin.com/follow",
    "https://www.douyin.com/user/abc",
  ]) {
    const { api } = loadScript({ href });
    assert.equal(api.shouldAutoEnter(), false, `no auto for ${href}`);
    api._stopAuto();
  }
});

test("isHomeLike recognizes root and jingxuan paths only", () => {
  for (const href of ["https://www.douyin.com/", "https://www.douyin.com/jingxuan"]) {
    const { api } = loadScript({ href });
    assert.equal(api.isHomeLike(), true);
  }
  for (const href of ["https://www.douyin.com/video/1", "https://www.douyin.com/search/x"]) {
    const { api } = loadScript({ href });
    assert.equal(api.isHomeLike(), false);
  }
});

test("channel dock styles are part of injected CSS", () => {
  const { api } = loadScript();
  assert.ok(api.style.includes(".douyin-pure-channels"));
  assert.ok(api.style.includes('[aria-current="page"]'));
});
