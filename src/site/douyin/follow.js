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
import { ref } from "vue";
import { elementText, normalizeText, simulateClick } from "@/common/dom";

/**
 * 抖音直播的关注按钮
 *
 * 思路：不自己调关注接口（需要签名 + 风控），而是「借用」页面上原生的关注按钮。
 * 脚本把顶部信息栏隐藏了，但节点还在 DOM 里，点它和用户手点效果完全一致，
 * 关注状态也从原生按钮的文字同步（关注 / 已关注 / 互相关注）。
 */
const FOLLOW_LABEL = "关注";
const FOLLOWED_LABELS = ["已关注", "互相关注", "相互关注"];

// 只在这些区域里找，避免把导航栏、弹幕里的「关注」当成按钮
const SCOPE_SELECTORS = [
  "#HeaderLayout",
  "#room_info_bar",
  '[data-e2e*="room" i]',
  '[class*="room-info" i]',
  '[class*="RoomInfo" i]',
  '[class*="roomInfo" i]',
];

// 关注按钮上的标记，命中一个就基本可以确定
const BTN_SELECTORS = [
  '[data-e2e*="follow-btn" i]',
  '[data-e2e*="follow" i]',
  '[class*="follow-btn" i]',
  '[class*="FollowBtn" i]',
];

// 弹幕 / 评论区里的「关注」不是按钮
const EXCLUDE_SELECTORS = '[class*="chat" i],[class*="comment" i],[class*="danmu" i],[class*="barrage" i]';

/**
 * 文字 → 关注状态：followed / unfollowed / null
 *
 * 抖音关注按钮的实际文案是「关注」+ 尾部小图标/数字（形如「关注8」「关注 G」），
 * 所以按钮类元素允许尾部有 1~2 个字符；普通 div/span 仍要求完全相等，
 * 免得把「关注 1690」这种粉丝数统计当成按钮点开粉丝列表。
 */
export function readFollowState(value, { loose = false } = {}) {
  const text = normalizeText(value);
  if (!text) return null;
  for (const label of FOLLOWED_LABELS) {
    if (text === label) return "followed";
    if (loose && text.startsWith(label) && text.length <= label.length + 2) return "followed";
  }
  if (text === FOLLOW_LABEL) return "unfollowed";
  if (loose && text.startsWith(FOLLOW_LABEL) && text.length <= FOLLOW_LABEL.length + 2)
    return "unfollowed";
  return null;
}

function isExcluded(el) {
  if (!el || typeof el.closest !== "function") return false;
  if (el.closest("[data-pure-live-ui]")) return true;
  if (el.closest(EXCLUDE_SELECTORS)) return true;
  const anchor = el.closest("a");
  const href = anchor?.getAttribute("href") || "";
  // 顶部导航里指向「关注」页的入口，不是关注主播
  return /(^|\/)follow(\/|\?|$)/.test(href);
}

function resolveClickable(el) {
  if (!el) return null;
  if (typeof el.matches === "function" && el.matches('button,[role="button"],a')) return el;
  // 命中的可能是包一层的容器，往上找到按钮，找不到就往下找
  return (
    el.closest?.('button,[role="button"],a') || el.querySelector?.('button,[role="button"],a') || el
  );
}

function searchScope(scope) {
  if (!scope) return null;
  // 先按 data-e2e / class 里带 follow-btn 的标记找，最可靠
  for (const el of scope.querySelectorAll(BTN_SELECTORS.join(","))) {
    const state = readFollowState(elementText(el), { loose: true });
    if (!state || isExcluded(el)) continue;
    const clickable = resolveClickable(el);
    if (clickable) return { element: clickable, state };
  }
  // 按钮/链接上的「关注xxx」可以宽松匹配，普通节点要求完全相等
  const groups = [
    [scope.querySelectorAll('button,a,[role="button"]'), true],
    [scope.querySelectorAll("div,span"), false],
  ];
  for (const [candidates, loose] of groups) {
    for (const el of candidates) {
      const state = readFollowState(elementText(el), { loose });
      if (!state) continue;
      if (isExcluded(el)) continue;
      const clickable = resolveClickable(el);
      if (clickable) return { element: clickable, state };
    }
  }
  return null;
}

/** 在页面里找原生关注按钮 */
export function findFollowControl(doc) {
  if (!doc) return null;
  let hasScope = false;
  for (const selector of SCOPE_SELECTORS) {
    for (const scope of doc.querySelectorAll(selector)) {
      hasScope = true;
      const found = searchScope(scope);
      if (found) return found;
    }
  }
  // 头部区域还没渲染出来的兜底：只扫按钮/链接，不遍历整页节点
  if (hasScope) return null;
  for (const el of doc.querySelectorAll('button,a,[role="button"]')) {
    const state = readFollowState(elementText(el));
    if (!state || isExcluded(el)) continue;
    return { element: el, state };
  }
  return null;
}

/**
 * 关注控制器（单例）。抖音以外的平台不调用 start()，supported 一直是 false，
 * 悬浮按钮也就不会出现。
 */
export const douyinFollow = (() => {
  const supported = ref(false);
  const following = ref(false);
  let doc = null;
  let observer = null;
  let lastSync = 0;

  function sync() {
    if (!doc) return null;
    const found = findFollowControl(doc);
    supported.value = Boolean(found);
    following.value = found?.state === "followed";
    return found;
  }

  function start(document) {
    if (doc || !document) return;
    doc = document;
    sync();
    const win = doc.defaultView;
    if (!win?.MutationObserver) return;
    observer = new win.MutationObserver(() => {
      const now = Date.now();
      if (now - lastSync < 300) return;
      lastSync = now;
      sync();
    });
    observer.observe(doc.documentElement, { childList: true, subtree: true, characterData: true });
  }

  function toggle() {
    if (!doc) return false;
    const found = findFollowControl(doc);
    if (!found) {
      sync();
      return false;
    }
    simulateClick(found.element, doc.defaultView);
    // 乐观更新，稍后以页面真实状态为准
    following.value = found.state !== "followed";
    const win = doc.defaultView;
    win.setTimeout(sync, 600);
    win.setTimeout(sync, 1600);
    return true;
  }

  function stop() {
    observer?.disconnect();
    observer = null;
    doc = null;
    supported.value = false;
    following.value = false;
  }

  return { supported, following, start, toggle, stop, sync };
})();
