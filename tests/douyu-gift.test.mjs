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

function setup(t) {
  const dom = new JSDOM(MARKUP, { runScripts: "outside-only" });
  t.after(() => dom.window.close());
  dom.window.eval(`${sources}
    window.__hide = hideDouyuGift;
    window.__entry = isGiftEntryText;
    window.__message = isGiftMessageText;`);
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
