import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const source = readFileSync(new URL("../src/site/douyin/feed.js", import.meta.url), "utf8").replace(
  /^export /gm,
  "",
);

const CONTAINER = "#_douyin_live_scroll_container_";

function setup(t, html) {
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://live.douyin.com/123" });
  t.after(() => dom.window.close());
  dom.window.eval(`${source}
    window.__goNextRoom = goNextRoom;
    window.__goRecommendFeed = goRecommendFeed;
    window.__feedUrl = RECOMMEND_FEED_URL;`);
  return dom;
}

// jsdom 没有布局，高度得手工给
function sizeContainer(window, { clientHeight = 900, scrollHeight = 900 } = {}) {
  const el = window.document.querySelector(CONTAINER);
  Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
  window.__scrollByCalls = [];
  el.scrollBy = (options) => window.__scrollByCalls.push(options);
  return el;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("抖音：推荐流首页地址与导航栏「直播」入口一致", (t) => {
  const { window } = setup(t, "<body></body>");
  assert.equal(window.__feedUrl, "https://live.douyin.com/?from_nav=1");
});

test("抖音：回推荐流首页会跳转", (t) => {
  const { window } = setup(t, "<body></body>");
  const fakeWin = { location: { href: "" } };
  assert.equal(window.__goRecommendFeed(fakeWin), true);
  assert.equal(fakeWin.location.href, window.__feedUrl);
});

test("抖音：页面没有竖滑容器时，直接回推荐流首页", (t) => {
  const { window } = setup(t, "<body></body>");
  let gaveUp = 0;
  const route = window.__goNextRoom({ onGiveUp: () => (gaveUp += 1) });
  assert.equal(route, "navigate");
  assert.equal(gaveUp, 1);
});

test("抖音：竖滑容器里只有当前直播间时，回推荐流首页", (t) => {
  const { window } = setup(t, `<div id="_douyin_live_scroll_container_"><div></div></div>`);
  // 高度相等 = 抖音没预加载下一个，滑动必然无效
  sizeContainer(window, { clientHeight: 900, scrollHeight: 900 });
  let gaveUp = 0;
  const route = window.__goNextRoom({ onGiveUp: () => (gaveUp += 1) });
  assert.equal(route, "navigate");
  assert.equal(gaveUp, 1);
});

test("抖音：有下一个可滚时先派发滚轮，交给抖音自己切", (t) => {
  const { window } = setup(t, `<div id="_douyin_live_scroll_container_"></div>`);
  const el = sizeContainer(window, { clientHeight: 900, scrollHeight: 1800 });
  let wheel = null;
  el.addEventListener("wheel", (e) => (wheel = e));

  let gaveUp = 0;
  const route = window.__goNextRoom({ onGiveUp: () => (gaveUp += 1) });

  assert.equal(route, "wheel");
  assert.ok(wheel, "应当派发 wheel 事件");
  assert.equal(wheel.deltaY, 900, "滚动距离取一屏");
  assert.equal(gaveUp, 0, "不能立刻降级");
});

test("抖音：滚轮生效（房间号变了）就不再降级", async (t) => {
  const { window } = setup(t, `<div id="_douyin_live_scroll_container_"></div>`);
  const el = sizeContainer(window, { clientHeight: 900, scrollHeight: 1800 });
  // 模拟抖音收到滚轮后把地址换成新房间
  el.addEventListener("wheel", () => window.history.pushState({}, "", "/999"));

  let gaveUp = 0;
  window.__goNextRoom({ onGiveUp: () => (gaveUp += 1) });
  await sleep(1500);

  assert.equal(window.location.pathname, "/999");
  assert.equal(window.__scrollByCalls.length, 0, "已经切房，不该再补原生滚动");
  assert.equal(gaveUp, 0, "已经切房，不该再降级");
});

test("抖音：滚轮和原生滚动都没换房时，最后回推荐流首页", async (t) => {
  const { window } = setup(t, `<div id="_douyin_live_scroll_container_"></div>`);
  sizeContainer(window, { clientHeight: 900, scrollHeight: 1800 });

  let gaveUp = 0;
  window.__goNextRoom({ onGiveUp: () => (gaveUp += 1) });
  await sleep(1700);

  assert.equal(window.__scrollByCalls.length, 1, "滚轮无效后应补一次原生滚动");
  assert.equal(gaveUp, 1, "都没反应才回推荐流首页");
});
