import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const sources = ["common/dom", "site/douyin/quality"]
  .map((path) =>
    readFileSync(new URL(`../src/${path}.js`, import.meta.url), "utf8")
      .replace(/^import .+;\r?\n/gm, "")
      .replace(/^export /gm, ""),
  )
  .join("\n");

const QUALITIES = ["原画", "蓝光", "超清", "高清", "标清"];

/**
 * 抖音直播画质控件的真实结构（与社区脚本交叉验证过）：
 *   .QualitySwitchNewPlugin > [data-e2e="quality-selector"] > 原画 / 蓝光 / 超清 / 高清 / 标清
 * 子节点 DOM 顺序即从高到低；部分版本要先 hover / 点击按钮才把列表渲染出来。
 *
 * @param {"inline"|"popup"} structure 画质列表直接挂在按钮里，还是点开后才出现
 */
function fixture({ controls = true, triggerText = "高清", structure = "popup", broken = false } = {}) {
  const dom = new JSDOM(
    `<div id="_douyin_live_scroll_container_">
       ${controls ? '<div class="douyin-player-controls-right"></div>' : ""}
     </div>`,
    { runScripts: "outside-only" },
  );
  const { window } = dom;
  const { document } = window;
  window.eval(`${sources}
    window.__watch = watchDouyinQuality;
    window.__label = qualityLabel;`);

  let clock = 1_000_000;
  const timers = new Map();
  let nextTimer = 0;
  window.Date.now = () => clock;
  window.setInterval = (fn) => {
    nextTimer += 1;
    timers.set(nextTimer, fn);
    return nextTimer;
  };
  window.clearInterval = (id) => timers.delete(id);

  const clicks = [];
  const plugin = document.createElement("div");
  let popup = null;

  function buildPlugin() {
    plugin.className = "QualitySwitchNewPlugin-8f3a";
    const label = document.createElement("div");
    label.className = "switch-text";
    label.textContent = triggerText;
    plugin.append(label);

    if (structure === "inline") {
      const list = document.createElement("div");
      list.setAttribute("data-e2e", "quality-selector");
      for (const text of QUALITIES) {
        const item = document.createElement("div");
        item.textContent = text;
        item.setAttribute("aria-selected", text === triggerText ? "true" : "false");
        item.addEventListener("click", () => {
          clicks.push(text);
          for (const sibling of list.children) {
            sibling.setAttribute("aria-selected", sibling === item ? "true" : "false");
          }
          label.textContent = text;
        });
        list.append(item);
      }
      plugin.append(list);
    } else if (!broken) {
      // 真实站点上：hover / 点击画质按钮才把选项列表渲染出来
      const open = () => {
        if (popup) return;
        popup = document.createElement("div");
        popup.className = "quality-popup";
        for (const text of QUALITIES) {
          const item = document.createElement("div");
          item.className = "option";
          item.textContent = text;
          if (text === label.textContent) item.setAttribute("aria-selected", "true");
          item.addEventListener("click", () => {
            clicks.push(text);
            label.textContent = text;
            popup.remove();
            popup = null;
          });
          popup.append(item);
        }
        document.body.append(popup);
      };
      plugin.addEventListener("mouseover", open);
      plugin.addEventListener("click", open);
    }

    document.querySelector(".douyin-player-controls-right").append(plugin);
  }

  /** 推进假时钟并触发所有轮询回调 */
  function tick(ms = 500, times = 1) {
    for (let i = 0; i < times; i += 1) {
      clock += ms;
      for (const fn of Array.from(timers.values())) fn();
    }
  }

  return {
    window,
    document,
    clicks,
    tick,
    mountPlugin: buildPlugin,
    get running() {
      return timers.size > 0;
    },
    triggerText: () => plugin.querySelector(".switch-text")?.textContent,
  };
}

test("抖音：播放器控件晚于脚本挂载时，依然会选到最高画质（按文字挑，而不是固定第 2 项）", () => {
  const f = fixture();
  f.window.__watch({ document: f.document, shouldSwitch: () => true });

  // 一开始控件区是空的，轮询若干次都不该出错
  f.tick(500, 4);
  assert.deepEqual(f.clicks, []);

  // 控件后挂载
  f.mountPlugin();
  f.tick(500, 1); // 先试 hover 打开菜单
  f.tick(500, 1); // 上一次动作没到间隔，等待
  f.tick(500, 1); // 再补一次点击
  f.tick(500, 1); // 看到菜单，选最高
  assert.deepEqual(f.clicks, ["原画"], "应选原画，而不是菜单里的第 2 项（蓝光）");

  f.tick(500, 3);
  assert.equal(f.triggerText(), "原画");
  assert.equal(f.running, false, "选好之后应当停止轮询，不再干涉手动切换");
});

test("抖音：已知结构（.QualitySwitchNewPlugin + quality-selector）直接点最高档", () => {
  const f = fixture({ structure: "inline" });
  f.mountPlugin();
  f.window.__watch({ document: f.document, shouldSwitch: () => true });
  f.tick(500, 3);

  assert.deepEqual(f.clicks, ["原画"]);
  assert.equal(f.triggerText(), "原画");
  assert.equal(f.running, false);
});

test("抖音：已经是最高画质时不做任何点击", () => {
  const f = fixture({ structure: "inline", triggerText: "原画" });
  f.mountPlugin();
  f.window.__watch({ document: f.document, shouldSwitch: () => true });
  f.tick(500, 5);
  assert.deepEqual(f.clicks, []);
  assert.equal(f.running, false);
});

test("抖音：关闭「自动最高画质」开关后立即停止，不点菜单", () => {
  const f = fixture();
  f.mountPlugin();
  f.window.__watch({ document: f.document, shouldSwitch: () => false });
  f.tick(500, 5);
  assert.deepEqual(f.clicks, []);
  assert.equal(f.running, false);
});

test("抖音：没有画质开关的直播间，等一会儿就收工，不无限轮询", () => {
  const f = fixture({ controls: false });
  f.window.__watch({ document: f.document, shouldSwitch: () => true });
  f.tick(500, 10);
  assert.equal(f.running, true, "刚开始应继续等待播放器");
  f.tick(500, 60); // 超过 25 秒无画质按钮 → 放弃
  assert.equal(f.running, false);
});

test("抖音：画质菜单打不开时不会一直闪，试十几次就收手", () => {
  const f = fixture({ broken: true });
  f.mountPlugin();
  f.window.__watch({ document: f.document, shouldSwitch: () => true });
  f.tick(500, 60);
  assert.equal(f.running, false, "要停下来，不能一直点画质按钮");
  assert.deepEqual(f.clicks, []);
});

test("抖音：画质文案识别（含需要登录的档位）", () => {
  const f = fixture();
  const label = f.window.__label;
  assert.equal(label("原画"), "原画");
  assert.equal(label(" 原画 "), "原画");
  assert.equal(label("蓝光4M"), "蓝光");
  assert.equal(label("超清1080P"), "超清");
  assert.equal(label("原画蓝光高清"), null, "整块菜单文本不能被当成单个选项");
  assert.equal(label("登录可看原画"), null, "需要登录的档位不算可选画质");
  assert.equal(label("关注"), null);
});
