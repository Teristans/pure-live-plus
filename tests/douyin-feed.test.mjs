import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const source = readFileSync(new URL("../src/site/douyin/feed.js", import.meta.url), "utf8").replace(
  /^export /gm,
  "",
);

function load(t) {
  const dom = new JSDOM("<body></body>", {
    runScripts: "outside-only",
    url: "https://live.douyin.com/111",
  });
  t.after(() => dom.window.close());
  dom.window.eval(`${source}
    window.__api = {
      buildFeedUrl, pickNextRoom, goNextRoom, goRecommendFeed,
      readCurrentShortId, loadVisited, rememberVisited,
      RECOMMEND_FEED_URL, LIVE_HOME_URL, ROOM_FEED_PATH, VISITED_KEY,
    };`);
  return dom.window.__api;
}

/** 造一个假窗口：可控地址、可控接口返回、sessionStorage 用内存 Map */
function fakeWindow({ pathname = "/111", feed = null, fail = false } = {}) {
  const store = new Map();
  const win = {
    location: { pathname, href: `https://live.douyin.com${pathname}` },
    sessionStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
    },
    fetchCalls: 0,
    lastUrl: "",
  };
  win.fetch = async (url) => {
    win.fetchCalls += 1;
    win.lastUrl = url;
    if (fail) throw new Error("blocked");
    return { ok: true, json: async () => feed };
  };
  return win;
}

/** 造推荐流接口的返回：只保留测量出来的关键字段（房间号在 owner.short_id） */
function feedPayload(rooms) {
  return {
    status_code: 0,
    data: rooms.map((room) => ({
      type: 1,
      data: {
        id_str: room.roomId ?? "",
        owner: { short_id: room.shortId, nickname: room.nick ?? "" },
      },
    })),
  };
}

test("抖音：推荐流按钮去的是抖音推荐流，不是直播间", (t) => {
  const api = load(t);
  assert.equal(api.RECOMMEND_FEED_URL, "https://www.douyin.com/?recommend=1");
  const win = fakeWindow();
  assert.equal(api.goRecommendFeed(win), true);
  assert.equal(win.location.href, "https://www.douyin.com/?recommend=1");
});

test("抖音：推荐流接口地址带齐参数，并带上当前房间号", (t) => {
  const api = load(t);
  const url = api.buildFeedUrl("369324308707");
  assert.ok(url.startsWith(`${api.ROOM_FEED_PATH}?`), "走的是 /webcast/feed/");
  const query = new URLSearchParams(url.split("?")[1]);
  for (const key of ["aid", "app_name", "device_platform", "count", "channel_id"]) {
    assert.ok(query.get(key), `缺少必要参数 ${key}（缺了会被判 url doesn't match）`);
  }
  assert.equal(query.get("web_rid"), "369324308707");
  assert.equal(query.get("count"), "15");
});

test("抖音：从推荐列表里挑下一个，跳过当前房间", (t) => {
  const api = load(t);
  const next = api.pickNextRoom(
    feedPayload([
      { shortId: "111", nick: "当前主播" },
      { shortId: "222", nick: "下一个主播" },
    ]),
    { current: "111" },
  );
  assert.equal(next?.shortId, "222");
  assert.equal(next?.nickname, "下一个主播");
});

test("抖音：跳过这次会话已经刷过的房间，连点会一直往新房间走", (t) => {
  const api = load(t);
  const next = api.pickNextRoom(
    feedPayload([{ shortId: "111" }, { shortId: "222" }, { shortId: "333", nick: "第三个" }]),
    { current: "111", visited: ["222"] },
  );
  assert.equal(next?.shortId, "333");
});

test("抖音：短号不是纯数字或全都看过时，不硬凑一个", (t) => {
  const api = load(t);
  const payload = feedPayload([
    { shortId: "dehua66888" }, // 自定义 id，拼不成直播间地址
    { shortId: "" },
    { shortId: "222" },
  ]);
  assert.equal(api.pickNextRoom(payload, { current: "111", visited: ["222"] }), null);
  assert.equal(api.pickNextRoom({ status_code: 0 }, { current: "111" }), null);
});

test("抖音：点「下一个」直接进下一个直播间的地址", async (t) => {
  const api = load(t);
  const win = fakeWindow({
    pathname: "/111",
    feed: feedPayload([{ shortId: "111", nick: "当前" }, { shortId: "222", nick: "下一个" }]),
  });

  const result = await api.goNextRoom({ win });

  assert.equal(result.route, "room");
  assert.equal(result.shortId, "222");
  assert.equal(win.location.href, "https://live.douyin.com/222");
  assert.ok(win.lastUrl.includes("web_rid=111"), "请求时带上当前房间号，推荐才相关");
});

test("抖音：接口被拦时退回直播首页，而不是抖音推荐流", async (t) => {
  const api = load(t);
  const win = fakeWindow({ pathname: "/111", fail: true });

  const result = await api.goNextRoom({ win });

  assert.equal(result.route, "live-home");
  assert.equal(win.location.href, "https://live.douyin.com/");
});

test("抖音：接口返回空列表时也走兜底，不会跳到空地址", async (t) => {
  const api = load(t);
  const win = fakeWindow({ pathname: "/111", feed: { status_code: 0, data: [] } });

  const result = await api.goNextRoom({ win });

  assert.equal(result.route, "live-home");
  assert.equal(win.location.href, api.LIVE_HOME_URL);
});

test("抖音：刷过的房间记进 sessionStorage，刷新后仍生效", async (t) => {
  const api = load(t);
  const win = fakeWindow({
    pathname: "/111",
    feed: feedPayload([{ shortId: "222" }, { shortId: "333" }]),
  });

  await api.goNextRoom({ win });

  // 数组来自 jsdom 的另一个 realm，直接比内容
  assert.equal(api.loadVisited(win).join(","), "222");
  // 已经在 222，再点一次要换到 333，而不是原地重复
  const second = fakeWindow({ pathname: "/222", feed: feedPayload([{ shortId: "222" }, { shortId: "333" }]) });
  second.sessionStorage = win.sessionStorage;
  const result = await api.goNextRoom({ win: second });
  assert.equal(result.shortId, "333");
});

test("抖音：网址里不是纯数字（首页等）时读不到当前房间号", (t) => {
  const api = load(t);
  assert.equal(api.readCurrentShortId({ location: { pathname: "/369324308707" } }), "369324308707");
  assert.equal(api.readCurrentShortId({ location: { pathname: "/" } }), "");
  assert.equal(api.readCurrentShortId({ location: { pathname: "/user/self" } }), "");
  assert.equal(api.readCurrentShortId({}), "");
});
