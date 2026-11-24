import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const sources = ["common/dom", "site/douyu/gift"]
  .map((path) =>
    readFileSync(new URL(`../src/${path}.js`, import.meta.url), "utf8")
      .replace(/^import .+;\r?\n/gm, "")
      .replace(/^export /gm, ""),
  )
  .join("\n");

const MARKUP = `<div id="js-player-main">
  <div id="js-player-effect"><div class="giftEffectFull">礼物特效</div></div>
  <div id="js-player-barrage">
    <div class="row">张三：这波打得不错</div>
    <div class="row">李四 送出 超级火箭 x1</div>
    <div class="row"><span class="text">王五 抢到了福袋</span></div>
  </div>
  <div id="js-player-toolbar">
    <div class="ToolBar-Fudai"><span>福袋</span></div>
    <div class="ToolBar-Share"><span>分享</span></div>
  </div>
</div>`;

function isHidden(el) {
  return el?.getAttribute("data-pure-live-hidden") === "1" || el?.style.display === "none";
}

// 斗鱼播放器「弹幕设置」里的屏蔽项，类名照抄真实页面（哈希后缀会变，所以代码只按文案定位）
const SHIELD_TEXTS = [
  "屏蔽全部礼物",
  "屏蔽消息通知",
  "屏蔽视频广播",
  "屏蔽小礼物",
  "屏蔽进场特效",
  "屏蔽礼物音效",
  "屏蔽弹幕皮肤",
];

function shieldMarkup(checkedTexts = []) {
  const items = SHIELD_TEXTS.map((text) => {
    const cls = checkedTexts.includes(text) ? "checked-13adb7" : "unchecked-b96102";
    return `<div class="shieldSettingItem-4b3b84">
      <i class="checkButton-98c84e"><svg fill="none" viewBox="0 0 16 16" class="${cls}"><rect x="0.5" y="0.5" width="15" height="15" rx="3.5" stroke="currentColor"></rect></svg></i>
      <label class="shieldSettingLabel-be2859">${text}</label>
    </div>`;
  }).join("");
  return `<div id="js-player-controlbar"><div class="setting-1b1924">${items}</div></div>`;
}

/** 模拟斗鱼：点 label 之后由页面自己把勾选框切过去，并记下点了哪几项 */
function bindShieldToggle(window) {
  window.__clicks = [];
  for (const label of window.document.querySelectorAll("label")) {
    label.addEventListener("click", () => {
      const svg = label.parentElement?.querySelector("svg");
      if (!svg) return;
      const on = String(svg.getAttribute("class")).includes("unchecked");
      svg.setAttribute("class", on ? "checked-13adb7" : "unchecked-b96102");
      window.__clicks.push((label.textContent || "").trim());
    });
  }
}

function setup(t, extraMarkup = "") {
  const dom = new JSDOM(MARKUP + extraMarkup, { runScripts: "outside-only" });
  t.after(() => dom.window.close());
  dom.window.eval(`${sources}
    window.__hide = hideDouyuGift;
    window.__entry = isGiftEntryText;
    window.__message = isGiftMessageText;
    window.__applyShield = applyShieldSettings;
    window.__isShieldChecked = isShieldChecked;
    window.__findShieldRow = findShieldRow;`);
  return dom;
}

test("斗鱼：弹幕里的送礼消息和福袋消息被隐藏，普通弹幕保留", (t) => {
  const dom = setup(t);
  const { document } = dom.window;
  dom.window.__hide({ document });

  const rows = Array.from(document.querySelectorAll("#js-player-barrage .row"));
  assert.equal(isHidden(rows[0]), false, "普通弹幕要保留");
  assert.equal(isHidden(rows[1]), true, "「送出 超级火箭」应隐藏");
  assert.equal(isHidden(rows[2]), true, "「抢到了福袋」应隐藏");
});

test("斗鱼：工具栏上的福袋入口被隐藏，其它按钮保留", (t) => {
  const dom = setup(t);
  const { document } = dom.window;
  dom.window.__hide({ document });

  assert.equal(isHidden(document.querySelector(".ToolBar-Fudai")), true);
  assert.equal(isHidden(document.querySelector(".ToolBar-Share")), false);
});

test("斗鱼：新出现的送礼消息同样会被隐藏", async (t) => {
  const dom = setup(t);
  const { document } = dom.window;
  dom.window.__hide({ document });

  const row = document.createElement("div");
  row.className = "row";
  row.textContent = "赵六 开通了 骑士";
  document.querySelector("#js-player-barrage").append(row);
  await new Promise((resolve) => dom.window.setTimeout(resolve, 30));

  assert.equal(isHidden(row), true);
});

test("斗鱼：不会把弹幕列表容器本身藏掉", (t) => {
  const dom = setup(t);
  const { document } = dom.window;
  dom.window.__hide({ document });

  assert.equal(isHidden(document.querySelector("#js-player-barrage")), false);
  assert.equal(isHidden(document.querySelector("#js-player-main")), false);
});

test("斗鱼：送礼文案识别", (t) => {
  const dom = setup(t);
  const isMessage = dom.window.__message;
  const isEntry = dom.window.__entry;

  assert.equal(isMessage("李四 送出 超级火箭 x1"), true);
  assert.equal(isMessage("李四送给主播 飞机"), true);
  assert.equal(isMessage("王五 开通了 皇帝"), true);
  assert.equal(isMessage("抢到福袋 x1"), true);
  assert.equal(isMessage("今天直播真好笑"), false);
  assert.equal(isEntry("福袋"), true);
  assert.equal(isEntry("礼物"), true);
  assert.equal(isEntry("分享"), false);
});

test("斗鱼：未勾选的播放器屏蔽项会被自动勾上", (t) => {
  const dom = setup(t, shieldMarkup());
  const { window } = dom;
  const { document } = window;
  bindShieldToggle(window);

  const first = window.__applyShield(document, window);
  assert.equal(first.found, 7, "七项都要找得到");
  assert.equal(first.checked, 0, "初始都没勾");
  assert.equal(first.clicked, 7, "全部点上");
  assert.equal(window.__clicks.length, 7);

  // 再跑一次：已经全勾上，不该再点（重复点会把它们关掉）
  const second = window.__applyShield(document, window);
  assert.equal(second.checked, 7);
  assert.equal(second.clicked, 0);
  assert.equal(window.__clicks.length, 7, "不能重复点");
});

test("斗鱼：已经勾上的项不会被点成未勾", (t) => {
  const dom = setup(t, shieldMarkup(["屏蔽全部礼物", "屏蔽小礼物"]));
  const { window } = dom;
  bindShieldToggle(window);

  const stats = window.__applyShield(window.document, window);
  assert.equal(stats.found, 7);
  assert.equal(stats.checked, 2);
  assert.equal(stats.clicked, 5);
  assert.ok(!window.__clicks.includes("屏蔽全部礼物"), "已勾的项不该被点");
  assert.ok(!window.__clicks.includes("屏蔽小礼物"), "已勾的项不该被点");
});

test("斗鱼：勾不上时冷却期内不会反复点（避免来回切换）", (t) => {
  const dom = setup(t, shieldMarkup());
  const { window } = dom;
  const { document } = window;
  // 故意不挂点击监听：模拟斗鱼拒绝了这次勾选，状态始终不变
  const clickedAt = new Map();

  const first = window.__applyShield(document, window, clickedAt);
  assert.equal(first.clicked, 7);

  const second = window.__applyShield(document, window, clickedAt);
  assert.equal(second.clicked, 0, "冷却期内不能再点，否则会点成未勾");
  assert.equal(clickedAt.size, 7);
});

test("斗鱼：unchecked 里含 checked，不能误判为已勾选", (t) => {
  const dom = setup(t, shieldMarkup(["屏蔽全部礼物"]));
  const { window } = dom;
  const { document } = window;

  const on = window.__findShieldRow(document, "屏蔽全部礼物");
  const off = window.__findShieldRow(document, "屏蔽礼物音效");
  assert.equal(window.__isShieldChecked(on.row), true);
  assert.equal(window.__isShieldChecked(off.row), false, "unchecked-b96102 不能被当成已勾选");
});

test("斗鱼：播放器设置面板还没渲染时不报错，交给后续重试", (t) => {
  const dom = setup(t); // 没有设置面板
  const { window } = dom;
  const stats = window.__applyShield(window.document, window);
  assert.equal(stats.found, 0);
  assert.equal(stats.clicked, 0);
  assert.equal(window.__findShieldRow(window.document, "屏蔽全部礼物"), null);
});

test("斗鱼：样式表里带上了礼物特效 / 福袋的结构选择器", () => {
  const css = readFileSync(new URL("../src/site/douyu/restyle.css", import.meta.url), "utf8");
  for (const selector of [
    "#js-player-effect",
    '[class*="GiftEffect" i]',
    '[class*="fudai" i]',
    '[class*="LuckyBag" i]',
    '[data-pure-live-hidden]',
  ]) {
    assert.ok(css.includes(selector), `restyle.css 缺少 ${selector}`);
  }
});
