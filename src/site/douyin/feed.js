/*
 * pure-live, a script that makes live webpages pure.
 * Copyright (C) 2025-present ljezio and contributors
 *
 * This program is free software: you can redistribute it and/or modify it under the
 * terms of the GNU General Public License as published by the Free Software Foundation,
 * either version 3 of the License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY;
 * without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with this program.
 * If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * 抖音直播的推荐流入口。
 *
 * 抖音自己的导航栏里「直播」就是这个地址；脚本把 `#douyin-navigation` 整个隐藏了，
 * 所以面板上补一个按钮把它还回来。
 */
export const RECOMMEND_FEED_URL = "https://live.douyin.com/?from_nav=1";

/** 抖音直播间上下滑动切换推荐流直播间时，装房间的那个竖滑容器 */
export const FEED_SCROLL_CONTAINER = "#_douyin_live_scroll_container_";

// 先让抖音自己处理滚轮；它没反应再用原生滚动；都没反应才退回推荐流首页。
// 抖音切房后会把地址改成新房号，所以「地址变没变」就是最省事的成功判据。
const WHEEL_GRACE_MS = 500;
const SCROLL_GRACE_MS = 900;

/** 没有下一个可切时，最少还得有这么多可滚距离才认为抖音预加载了下一个直播间 */
const MIN_SCROLLABLE_GAP = 48;

function resolveWindow(doc, win) {
  if (win) return win;
  if (doc?.defaultView) return doc.defaultView;
  return typeof window === "undefined" ? null : window;
}

/**
 * 回直播推荐流首页
 * @returns {boolean} 是否发出跳转
 */
export function goRecommendFeed(win) {
  const target = resolveWindow(null, win);
  if (!target?.location) return false;
  target.location.href = RECOMMEND_FEED_URL;
  return true;
}

/**
 * 派发一次合成滚轮事件，尽量走抖音自己的切换逻辑
 *
 * 抖音的竖滑多半是自己监听 wheel 再接管（否则滚动过程会撕裂出两个画面），
 * 所以「派发 wheel」比「改 scrollTop」更接近用户真实操作。
 */
function dispatchWheel(container, win) {
  const Wheel = win?.WheelEvent;
  if (typeof Wheel !== "function" || typeof container.dispatchEvent !== "function") return false;
  const rect = container.getBoundingClientRect?.();
  const clientX = rect ? rect.left + rect.width / 2 : 0;
  const clientY = rect ? rect.top + rect.height / 2 : 0;
  container.dispatchEvent(
    new Wheel("wheel", {
      deltaY: container.clientHeight || 800,
      deltaMode: 0,
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
    }),
  );
  return true;
}

/**
 * 切到推荐流的下一个直播间
 *
 * 三级降级，保证按钮按下去一定有反应：
 * 1. 有竖滑容器且能往下滚 → 派发 wheel，交给抖音自己切；
 * 2. 抖音没接 → 原生 scrollBy 一屏；
 * 3. 还是没切 → 回推荐流首页（对用户来说同样是「换一个直播间」）。
 *
 * @param {object} [options]
 * @param {Document} [options.doc] 页面文档（测试注入）
 * @param {Window} [options.win] 页面窗口（测试注入）
 * @param {() => void} [options.onGiveUp] 彻底失败时的动作，默认回推荐流首页
 * @returns {"wheel"|"navigate"} 走了哪条路，便于控制台排查
 */
export function goNextRoom({ doc, win, onGiveUp } = {}) {
  const document_ = doc ?? (typeof document === "undefined" ? null : document);
  const window_ = resolveWindow(document_, win);
  const giveUp =
    typeof onGiveUp === "function" ? onGiveUp : () => goRecommendFeed(window_);

  const container = document_?.querySelector?.(FEED_SCROLL_CONTAINER) ?? null;
  if (!container) {
    giveUp();
    return "navigate";
  }

  const step = container.clientHeight || window_?.innerHeight || 0;
  const gap = container.scrollHeight - container.clientHeight;
  // 容器里只有当前这一个房间时，抖音没预加载下一个，滑动必然无效果 —— 直接换房间
  if (gap < Math.max(MIN_SCROLLABLE_GAP, step / 2)) {
    giveUp();
    return "navigate";
  }

  const before = window_?.location?.pathname ?? "";
  const switched = () => (window_?.location?.pathname ?? "") !== before;

  dispatchWheel(container, window_);
  window_?.setTimeout?.(() => {
    if (switched()) return;
    container.scrollBy?.({ top: step, behavior: "smooth" });
    window_?.setTimeout?.(() => {
      if (!switched()) giveUp();
    }, SCROLL_GRACE_MS);
  }, WHEEL_GRACE_MS);

  return "wheel";
}
