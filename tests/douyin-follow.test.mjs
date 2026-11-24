import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const sources = ["common/dom", "site/douyin/follow-api", "site/douyin/follow"]
  .map((path) =>
    readFileSync(new URL(`../src/${path}.js`, import.meta.url), "utf8")
      .replace(/^import .+;\r?\n/gm, "")
      .replace(/^export /gm, ""),
  )
  .join("\n");

// vue 的 ref 在测试里用最小实现代替
const PRELUDE = "const ref = (value) => ({ value });\n";

function setup(t, html) {
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://live.douyin.com/123" });
  t.after(() => dom.window.close());
  dom.window.eval(`${PRELUDE}${sources}
    window.__follow = douyinFollow;
    window.__find = findFollowControl;
    window.__state = readFollowState;`);
  return dom;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 造一个假的 fetch：模拟页面自己去调关注接口
function fakeFetch(window, payload, { verify = false, delay = 0 } = {}) {
  window.__fetchCalls = 0;
  const response = {
    headers: {
      get: (k) => (verify && k === "bdturing-verify" ? "1" : null),
    },
    clone: () => ({
      json: async () => payload,
    }),
  };
  window.fetch = async () => {
    window.__fetchCalls += 1;
    if (delay) await sleep(delay);
    return response;
  };
}

const HEADER = `<div id="HeaderLayout">
  <div class="nick">某主播</div>
  <div class="stat">关注 8</div>
  <button class="follow-btn"><span>关注</span></button>
  <a class="nav" href="https://www.douyin.com/follow?from_nav=1"><span>关注</span></a>
</div>`;

test("抖音：找到原生关注按钮，点击后状态同步为已关注", (t) => {
  const dom = setup(t, HEADER);
  const { document } = dom.window;
  let clicks = 0;
  const button = document.querySelector(".follow-btn");
  button.addEventListener("click", () => {
    clicks += 1;
    button.innerHTML = "<span>已关注</span>";
  });

  dom.window.__follow.start(document);
  assert.equal(dom.window.__follow.supported.value, true, "应当识别到关注按钮");
  assert.equal(dom.window.__follow.following.value, false);

  dom.window.__follow.toggle();
  assert.equal(clicks, 1, "应当点到原生关注按钮");
  assert.equal(dom.window.__follow.following.value, true, "点击后先乐观更新");

  dom.window.__follow.sync();
  assert.equal(dom.window.__follow.following.value, true, "以页面真实文案为准");
});

test("抖音：接口已关注成功，页面文案被轮询刷回也不会让图标变回空心", async (t) => {
  const dom = setup(t, HEADER);
  const { window } = dom;
  const { document } = window;
  const button = document.querySelector(".follow-btn");
  fakeFetch(window, { status_code: 0, data: { follow_status: 1 } });

  button.addEventListener("click", () => {
    button.innerHTML = "<span>已关注</span>";
    // 页面自己发关注请求（走被观测的那层 fetch）
    window.fetch("/webcast/user/relation/update/");
    // 1 秒内直播间信息轮询把文案刷回「关注」
    setTimeout(() => {
      button.innerHTML = "<span>关注</span>";
      window.__follow.sync();
    }, 20);
  });

  window.__follow.start(document, { grace: 200 });
  window.__follow.toggle();
  assert.equal(window.__follow.following.value, true, "点击后先乐观变蓝");

  await sleep(120);
  assert.equal(window.__fetchCalls, 1, "应当真的发出了关注请求");
  assert.equal(
    window.__follow.following.value,
    true,
    "接口说关注成功，页面文案被刷旧也不该退回空心",
  );
  assert.equal(window.__follow.lastError.value, "");
});

test("抖音：只看到「关注成功」提示、接口没拦到时，也按已关注处理", async (t) => {
  const dom = setup(t, HEADER);
  const { window } = dom;
  const { document } = window;
  const button = document.querySelector(".follow-btn");
  button.addEventListener("click", () => {
    button.innerHTML = "<span>已关注</span>";
    const toast = document.createElement("div");
    toast.textContent = "关注成功";
    document.body.append(toast);
    // 提示之后文案被轮询刷回「关注」
    setTimeout(() => {
      button.innerHTML = "<span>关注</span>";
      window.__follow.sync();
    }, 20);
  });

  window.__follow.start(document, { grace: 200 });
  window.__follow.toggle();
  await sleep(120);
  assert.equal(window.__follow.following.value, true, "有成功提示就该保持已关注");
  assert.equal(window.__follow.lastError.value, "");
});

test("抖音：换到别的主播直播间后，接口确认过的状态自动作废", async (t) => {
  const dom = setup(t, HEADER);
  const { window } = dom;
  const { document } = window;
  const button = document.querySelector(".follow-btn");
  fakeFetch(window, { status_code: 0, data: { follow_status: 1 } });
  button.addEventListener("click", () => window.fetch("/webcast/user/relation/update/"));

  window.__follow.start(document, { grace: 200 });
  window.__follow.toggle();
  await sleep(50);
  assert.equal(window.__follow.following.value, true);

  // 换直播间：主播名变了，新主播还没关注
  button.innerHTML = "<span>关注</span>";
  const nick = document.querySelector(".nick");
  nick.setAttribute("data-e2e", "live-room-nickname");
  nick.textContent = "另一个主播";
  window.__follow.sync();
  assert.equal(window.__follow.following.value, false, "换房间后要按新房间的真实状态显示");
});

test("抖音：接口返回失败时退回空心，并把原因挂出来", async (t) => {
  const dom = setup(t, HEADER);
  const { window } = dom;
  const { document } = window;
  const button = document.querySelector(".follow-btn");
  fakeFetch(window, { status_code: 10004, data: { prompts: "操作太频繁，请稍后再试" } });
  button.addEventListener("click", () => {
    window.fetch("/webcast/user/relation/update/");
  });

  window.__follow.start(document, { grace: 200 });
  window.__follow.toggle();
  await sleep(80);
  assert.equal(window.__follow.following.value, false, "没成功就不能显示已关注");
  assert.match(window.__follow.lastError.value, /操作太频繁/);
});

test("抖音：接口要求验证时提示手动确认", async (t) => {
  const dom = setup(t, HEADER);
  const { window } = dom;
  const { document } = window;
  document
    .querySelector(".follow-btn")
    .addEventListener("click", () => window.fetch("/webcast/user/relation/update/"));
  fakeFetch(window, { status_code: 0, data: {} }, { verify: true });

  window.__follow.start(document, { grace: 200 });
  window.__follow.toggle();
  await sleep(80);
  assert.match(window.__follow.lastError.value, /验证/);
});

test("抖音：接口一直没有回来，等一会儿后退回页面真实状态并提示", async (t) => {
  const dom = setup(t, HEADER);
  const { window } = dom;
  const { document } = window;
  document.querySelector(".follow-btn").addEventListener("click", () => {});

  window.__follow.start(document, { grace: 30 });
  window.__follow.toggle();
  assert.equal(window.__follow.following.value, true);
  await sleep(150);
  assert.equal(window.__follow.following.value, false, "没响应就该老实退回空心");
  assert.match(window.__follow.lastError.value, /没有响应/);
});

test("抖音：导航栏里指向「关注页」的入口不会被当成关注主播", (t) => {
  const dom = setup(
    t,
    `<div id="HeaderLayout"><a href="https://www.douyin.com/follow?from_nav=1"><span>关注</span></a></div>`,
  );
  assert.equal(dom.window.__find(dom.window.document), null);
});

test("抖音：脚本自己的悬浮按钮不会被当成原生关注按钮", (t) => {
  const dom = setup(t, `<body><div id="HeaderLayout"><div class="nick">某主播</div></div></body>`);
  const { document } = dom.window;
  const ui = document.createElement("div");
  ui.setAttribute("data-pure-live-ui", "");
  const btn = document.createElement("button");
  btn.textContent = "关注";
  ui.append(btn);
  document.body.append(ui);

  assert.equal(dom.window.__find(document), null);
});

test("抖音：找不到关注按钮时状态为未支持，不会崩", (t) => {
  const dom = setup(t, `<body><div id="HeaderLayout"><div>某主播</div></div></body>`);
  dom.window.__follow.start(dom.window.document);
  assert.equal(dom.window.__follow.supported.value, false);
  assert.equal(dom.window.__follow.toggle(), false);
});

test("抖音：按钮文案带尾部图标/数字（关注8）也能认出来，粉丝数统计不会误判", (t) => {
  const dom = setup(
    t,
    `<div id="HeaderLayout">
       <div class="stat">关注 1690</div>
       <button data-e2e="live-room-follow-btn">关注8</button>
     </div>`,
  );
  const found = dom.window.__find(dom.window.document);
  assert.equal(found?.state, "unfollowed");
  assert.equal(found?.element.getAttribute("data-e2e"), "live-room-follow-btn");
});

test("抖音：命中包裹容器时，点到里层的真实按钮", (t) => {
  const dom = setup(
    t,
    `<div id="HeaderLayout">
       <div data-e2e="live-room-follow-wrap"><button id="real">关注</button></div>
     </div>`,
  );
  const found = dom.window.__find(dom.window.document);
  assert.equal(found?.element.id, "real", "点不到按钮就等于没做功能");
});

test("抖音：关注状态文案识别", (t) => {
  const dom = setup(t, "<body></body>");
  const state = dom.window.__state;
  assert.equal(state("关注"), "unfollowed");
  assert.equal(state("已关注"), "followed");
  assert.equal(state("互相关注"), "followed");
  assert.equal(state("关注 8"), null, "默认（div/span）必须完全相等");
  assert.equal(state("关注8", { loose: true }), "unfollowed", "按钮上的宽松匹配");
  assert.equal(state("已关注", { loose: true }), "followed");
});
