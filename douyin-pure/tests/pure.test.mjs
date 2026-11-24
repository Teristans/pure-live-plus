import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { JSDOM } from "jsdom";

const source = readFileSync(new URL("../douyin-pure.user.js", import.meta.url), "utf8");

// 收集所有脚本实例，测试结束后兜底清理定时器，避免 node:test 退出时悬挂。
const allApis = [];
test.after(() => {
  for (const api of allApis) {
    try { api && api._stopQuality && api._stopQuality(); } catch (e) { /* 忽略 */ }
    try { api && api._stopAuto && api._stopAuto(); } catch (e) { /* 忽略 */ }
  }
});

function makeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); },
    clear() { data.clear(); },
  };
}

// tabsHtml 可自定义，用于模拟抖音改版后 class 完全变化的情况。
function loadScript({
  withGM = true,
  readyState = "complete",
  href = "https://www.douyin.com/?is_from_mobile_home=1&recommend=1",
  tabsHtml = `<div id="douyin-navigation" data-e2e="douyin-navigation">
       <div class="tab-recommend"><span>推荐</span></div>
       <div class="tab-discover"><span>精选</span></div>
       <div class="tab-follow"><span>关注</span></div>
       <div class="tab-friend"><span>朋友</span></div>
     </div>`,
  manualChannel = false,
  autoDone = false,
  logSink = null,
  keepQualityTimer = false,
} = {}) {
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
      ...(manualChannel ? { "douyin-pure-channel-manual-v13": "1" } : {}),
      ...(autoDone ? { "douyin-pure-auto-done-v13": "1" } : {}),
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
    console: logSink ? { log: (...a) => logSink.push(a) } : console,
    encodeURIComponent,
    setInterval: window.setInterval,
    clearInterval: window.clearInterval,
    GM_addStyle: withGM ? (css) => styles.push(css) : undefined,
  };
  if (!withGM) sandbox.GM_addStyle = undefined;
  runInNewContext(source, sandbox);
  const api = window.DouyinPure;
  allApis.push(api);
  // boot 会启动清晰度 21s 轮询与频道自动跳转 10s 轮询；默认都停掉，
  // 以免测试进程挂起。依赖这些行为的测试自行在派发事件后停止。
  if (!keepQualityTimer && api && api._stopQuality) api._stopQuality();
  if (api && api._stopAuto) api._stopAuto();
  return { dom, window, styles, api };
}

test("userscript metadata targets Douyin home with GPL license", () => {
  const metadata = source.match(/^\/\/ ==UserScript==[\s\S]*?^\/\/ ==\/UserScript==/m)?.[0];
  assert.ok(metadata, "userscript metadata block must exist");
  assert.match(metadata, /@name\s+抖音网页版精简版/);
  assert.match(metadata, /@version\s+1\.4\.0/);
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
  const before = window.location.href;
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  assert.equal(window.location.href, before);
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

test("mounts a channel dock with four links", () => {
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

// ===== 新增：自适应定位，不依赖猜测的 class =====

test("finds native entry by TEXT even when classes are totally different", () => {
  // 模拟抖音改版：class 全部哈希化，旧的 .tab-* 选择器完全失效。
  const hashedTabs = `<div id="douyin-navigation" data-e2e="douyin-navigation">
    <div class="x8f2a"><span>推荐</span></div>
    <div class="k9d1c"><span>精选</span></div>
    <div class="q3j7b"><span>关注</span></div>
    <div class="z5m2x"><span>朋友</span></div>
  </div>`;
  const { api } = loadScript({ tabsHtml: hashedTabs });
  assert.equal(api.findChannelEntry("recommend").textContent.trim(), "推荐");
  assert.equal(api.findChannelEntry("jingxuan").textContent.trim(), "精选");
  assert.equal(api.findChannelEntry("follow").textContent.trim(), "关注");
  assert.equal(api.findChannelEntry("friend").textContent.trim(), "朋友");
});

test("finds native entry by text even outside the left navigation container", () => {
  // 抖音可能把频道 tab 放在顶栏或其他容器；左栏内没有时要能全页兜底。
  const movedTabs = `<div id="douyin-navigation" data-e2e="douyin-navigation"></div>
    <div id="somewhere-else"><div class="h1"><span>推荐</span></div><div class="h2"><span>关注</span></div></div>`;
  const { api } = loadScript({ tabsHtml: movedTabs });
  assert.equal(api.findChannelEntry("recommend").textContent.trim(), "推荐");
  assert.equal(api.findChannelEntry("follow").textContent.trim(), "关注");
});

test("finds native entry by data-e2e when no text node matches", () => {
  // 图标型 tab：没有文字，但有语义化的 data-e2e。
  const iconTabs = `<div id="douyin-navigation" data-e2e="douyin-navigation">
    <a data-e2e="tab-recommend" href="/?recommend=1"></a>
    <a data-e2e="tab-follow" href="/follow"></a>
  </div>`;
  const { api } = loadScript({ tabsHtml: iconTabs });
  assert.equal(api.findChannelEntry("recommend").getAttribute("data-e2e"), "tab-recommend");
  assert.equal(api.findChannelEntry("follow").getAttribute("data-e2e"), "tab-follow");
});

test("clicking 推荐 calls native click() on the matched entry, not a URL rewrite", () => {
  const { window, logSink } = (() => {
    const sink = [];
    const loaded = loadScript({
      href: "https://www.douyin.com/jingxuan",
      logSink: sink,
    });
    return { window: loaded.window, logSink: sink };
  })();
  const tab = window.document.querySelector("#douyin-navigation > div");
  let clicked = 0;
  tab.addEventListener("click", () => clicked++);
  const link = window.document.querySelector('#douyin-pure-channels a[data-channel="recommend"]');
  link.dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
  assert.equal(clicked, 1, "native entry received a click()");
  assert.equal(window.location.href, "https://www.douyin.com/jingxuan", "URL untouched: uses native router");
  assert.equal(window.sessionStorage.getItem("douyin-pure-channel-manual-v13"), "1");
  assert.equal(window.sessionStorage.getItem("douyin-pure-channel-v13"), "recommend");
  // log() 输出形如 ["[douyin-pure]", "activateChannel(%s) via %s on <%s>", id, via, tag]。
  assert.ok(
    logSink.some((a) => String(a[1] || "").includes("activateChannel") && a.includes("click")),
    "logs native click path",
  );
});

test("clicking each channel activates its own entry", () => {
  const cases = ["jingxuan", "follow", "friend"];
  for (const id of cases) {
    const { window, api } = loadScript();
    const entry = api.findChannelEntry(id);
    let clicked = 0;
    entry.addEventListener("click", () => clicked++);
    window.document.querySelector(`#douyin-pure-channels a[data-channel="${id}"]`)
      .dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    assert.equal(clicked, 1, `${id} native entry clicked`);
  }
});

test("falls back to full URL when no native entry exists at all", () => {
  const { window, api } = loadScript({ tabsHtml: "", href: "https://www.douyin.com/video/123" });
  api._stopAuto(); // boot 会在类首页触发轮询，这里用非首页 href 并主动停止，避免 40 次轮询拖慢测试。
  assert.equal(api.findChannelEntry("recommend"), null);
  assert.equal(api.activateChannel("recommend", false), "url");
  assert.equal(
    window.location.href,
    "https://www.douyin.com/?is_from_mobile_home=1&recommend=1",
    "fallback URL includes is_from_mobile_home and recommend params",
  );
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

test("auto enter recommend clicks native entry immediately on home", () => {
  const { dom, window, api } = loadScript({ href: "https://www.douyin.com/", readyState: "loading" });
  let clicked = 0;
  window.document.querySelector("#douyin-navigation > div").addEventListener("click", () => clicked++);
  assert.equal(api.shouldAutoEnter(), true, "home should auto-enter before boot");
  dom.window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
  api._stopAuto();
  assert.equal(clicked, 1, "native recommend entry clicked on boot");
  assert.equal(window.sessionStorage.getItem("douyin-pure-auto-done-v13"), "1");
  assert.equal(window.sessionStorage.getItem("douyin-pure-channel-manual-v13"), null, "auto does not mark manual");
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

test("diagnose() lists real DOM candidates for troubleshooting", () => {
  const hashedTabs = `<div id="douyin-navigation" data-e2e="douyin-navigation">
    <div class="abc123"><span>推荐</span></div>
    <div class="def456"><span>精选</span></div>
  </div>`;
  const sink = [];
  const { api } = loadScript({ tabsHtml: hashedTabs, logSink: sink });
  const report = api.diagnose();
  assert.equal(report.url, "https://www.douyin.com/?is_from_mobile_home=1&recommend=1");
  assert.equal(report.channelCandidates.recommend.text, "推荐");
  assert.equal(report.channelCandidates.jingxuan.text, "精选");
  assert.ok(report.textCandidates.some((c) => c.text === "推荐"));
  assert.ok(sink.some((a) => String(a[1]).includes("diagnose")), "diagnose logs to console");
});

// ===== 清晰度智能 1080 =====

test("boot writes 1080 gear JSON into sessionStorage MANUAL_SWITCH", () => {
  const { window, api } = loadScript();
  const stored = window.sessionStorage.getItem("MANUAL_SWITCH");
  assert.ok(stored, "MANUAL_SWITCH written on boot");
  const gear = JSON.parse(stored);
  assert.equal(gear.gearName, "高清 1080P");
  assert.equal(gear.qualityType, 2);
  assert.equal(gear.gearClarity, "5");
  assert.equal(gear.gearType, 1);
  // 跨 vm realm 的对象 prototype 不同，用逐字段比较而非 deepEqual。
  for (const key of Object.keys(api.gear1080)) {
    assert.equal(gear[key], api.gear1080[key], `stored gear.${key} matches preset`);
  }
});

test("parseGearFromText recognizes common definition labels", () => {
  const { api } = loadScript();
  const cases = [
    ["高清 1080P", "1080"],
    ["1080P 60帧", "1080"],
    ["高清 720P", "720"],
    ["标清 540P", "540"],
    ["超清 2K", "2k"],
    ["4K 超高清", "4k"],
    ["智能", "smart"],
  ];
  for (const [text, id] of cases) {
    const gear = api.parseGearFromText(text);
    assert.ok(gear, `parsed ${text}`);
    assert.equal(gear.id, id, `${text} -> ${id}`);
  }
  assert.equal(api.parseGearFromText("随便什么文字"), null);
});

test("pickBestQualityItem picks 1080 when available", () => {
  const { api } = loadScript();
  const mk = (text) => ({ textContent: text });
  const items = [mk("智能"), mk("高清 720P"), mk("高清 1080P"), mk("超清 4K")];
  const pick = api.pickBestQualityItem(items);
  assert.ok(pick, "a pick exists");
  assert.equal(pick.gear.id, "1080", "1080 selected");
  assert.equal(pick.text, "高清 1080P");
});

test("pickBestQualityItem falls back to highest under 1080 and skips 2K/4K", () => {
  const { api } = loadScript();
  const mk = (text) => ({ textContent: text });
  // 没有 1080，2K/4K 超过目标应跳过，选 720。
  const items = [mk("极速"), mk("标清 540P"), mk("高清 720P"), mk("超清 2K"), mk("超清 4K")];
  const pick = api.pickBestQualityItem(items);
  assert.ok(pick);
  assert.equal(pick.gear.id, "720", "720 is best not exceeding 1080");
});

test("pickBestQualityItem returns null when no recognizable gear", () => {
  const { api } = loadScript();
  assert.equal(api.pickBestQualityItem([{ textContent: "广告" }, { textContent: "设置" }]), null);
});

test("pickQualityFromMenu finds best item by text, not class", () => {
  const menuHtml = `<div id="douyin-navigation" data-e2e="douyin-navigation"></div>
    <div data-e2e="quality-selector">
      <div class="hash1">高清 720P</div>
      <div class="hash2">高清 1080P</div>
      <div class="hash3">超清 4K</div>
    </div>`;
  const { api } = loadScript({ tabsHtml: menuHtml });
  const pick = api.pickQualityFromMenu();
  assert.ok(pick, "menu pick found");
  assert.equal(pick.text, "高清 1080P", "1080 chosen via text despite hashed classes");
});

test("manual quality flag stops auto and forces 1080 respects override", () => {
  const { window, api } = loadScript({
    tabsHtml: "",
    manualChannel: false,
    href: "https://www.douyin.com/video/123",
  });
  // 模拟用户手动选择：写入手动标记。
  window.sessionStorage.setItem("douyin-pure-quality-manual-v14", "1");
  assert.equal(api.isQualityManual(), true);
  assert.equal(api.ensureQuality1080(false), "manual", "auto skipped when manual");
  // force 情况下仍可写入。
  assert.equal(api.ensureQuality1080(true), "started");
  api._stopQuality();
});

test("diagnose() reports quality state", () => {
  const { api } = loadScript();
  const report = api.diagnose();
  assert.ok(report.quality, "quality section exists");
  assert.equal(report.quality.autoEnabled, true);
  assert.equal(report.quality.manualFlag, false);
  const gear = JSON.parse(report.quality.storedManualSwitch);
  assert.equal(gear.gearName, "高清 1080P");
});

// ===== 菜单移到左上角 =====

test("search dock and channel dock are anchored to top-left", () => {
  const { api } = loadScript();
  const css = api.style;
  // 搜索栏：left + top，不再使用 bottom。
  const searchBlock = css.match(/\.douyin-pure-search \{[^}]*\}/)[0];
  assert.match(searchBlock, /left:\s*16px/);
  assert.match(searchBlock, /top:\s*18px/);
  assert.doesNotMatch(searchBlock, /bottom\s*:/);
  // 频道导航：left + top:62px，不再使用 bottom。
  const channelsBlock = css.match(/\.douyin-pure-channels \{[^}]*\}/)[0];
  assert.match(channelsBlock, /left:\s*16px/);
  assert.match(channelsBlock, /top:\s*62px/);
  assert.doesNotMatch(channelsBlock, /bottom\s*:/);
});
