import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const sources = ["common/dom", "site/douyin/follow"]
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
