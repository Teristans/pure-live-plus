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
import { watchFollowApi } from "@/site/douyin/follow-api";

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
 *
 * 状态来源的优先级（这是本模块最容易出错的点）：
 *   1. 关注接口的返回值——唯一可信（status_code + follow_status）
 *   2. 点击后的乐观状态——只在等接口这一小段时间里用
 *   3. 原生按钮文案——兜底，但会被直播间信息轮询刷旧，不能当成实时状态
 * 旧实现只用了第 3 条，于是「点完变蓝、一秒后又变回空心」。
 */
const DEFAULT_GRACE_MS = 5000;

// 抖音关注成功后的提示文案（页面上真正发生过的证据，比按钮文案可靠）
const FOLLOW_OK_TEXT = "关注成功";
const UNFOLLOW_OK_TEXT = "取消关注成功";

export const douyinFollow = (() => {
  const supported = ref(false);
  const following = ref(false);
  // 关注失败 / 页面没响应时的说明，给按钮 title 用
  const lastError = ref("");
  let doc = null;
  let observer = null;
  let lastSync = 0;
  let stopApi = null;
  let graceMs = DEFAULT_GRACE_MS;
  // 点过之后、还没拿到接口结果的时间窗
  let pendingUntil = 0;
  let awaitingClick = false;
  let gotApiResult = false;
  // 接口确认过的状态：页面文案还没追上（被轮询刷旧）时，以它为准
  let confirmedFollowing = null;
  let confirmedUntil = 0;
  // 点击前的状态，用来识别「点了但没变化」
  let beforeFollowing = false;
  // 点击时所在直播间的主播名，换房间后要把确认状态作废
  let anchorAtClick = "";

  function anchorKey() {
    const el = doc?.querySelector('[data-e2e="live-room-nickname"]');
    return normalizeText(el?.textContent);
  }

  /** 拿到成功证据（接口或提示文案）：以它为准，并压住被刷旧的按钮文案 */
  function confirmState(value) {
    awaitingClick = false;
    gotApiResult = true;
    pendingUntil = 0;
    lastError.value = "";
    following.value = value;
    confirmedFollowing = value;
    confirmedUntil = Date.now() + 600000;
  }

  /** 确认失败：退回页面真实状态，并把原因挂出来 */
  function failWith(message) {
    awaitingClick = false;
    gotApiResult = true;
    pendingUntil = 0;
    confirmedFollowing = null;
    following.value = findFollowControl(doc)?.state === "followed";
    lastError.value = message;
  }

  /** 从新插入/改写的节点里找「关注成功 / 取消关注成功」提示 */
  function scanToasts(mutations) {
    if (!awaitingClick) return;
    for (const mutation of mutations) {
      const nodes =
        mutation.type === "characterData"
          ? [mutation.target?.parentElement].filter(Boolean)
          : [...(mutation.addedNodes || [])];
      for (const node of nodes) {
        const el = node.nodeType === 1 ? node : node.parentElement;
        const text = normalizeText(el?.textContent);
        if (!text || text.length > 30 || !text.includes("关注")) continue;
        if (text.includes(UNFOLLOW_OK_TEXT)) return confirmState(false);
        if (text.includes(FOLLOW_OK_TEXT)) return confirmState(true);
      }
    }
  }

  function sync() {
    if (!doc) return null;
    const found = findFollowControl(doc);
    supported.value = Boolean(found);
    const domState = found?.state === "followed";
    const now = Date.now();
    // 刚点过关注：文案可能是「乐观更新 → 被轮询刷回」，等接口结果为准
    if (now < pendingUntil) return found;
    if (confirmedFollowing !== null) {
      // 证据有效期内不看文案：页面可能「先变已关注、再被轮询刷回关注」
      if (now > confirmedUntil || anchorAtClick !== anchorKey()) confirmedFollowing = null;
      else {
        following.value = confirmedFollowing;
        return found;
      }
    }
    following.value = domState;
    return found;
  }

  /** 收到关注接口的响应 */
  function handleResult(result) {
    if (!doc || !awaitingClick || !result) return;
    if (result.ok && result.following !== undefined) {
      const unchanged = result.following === beforeFollowing;
      confirmState(result.following);
      if (unchanged) lastError.value = "抖音没有改变关注状态，请再试一次";
      return;
    }
    if (result.ok) {
      // 成功但没带 follow_status：保留乐观值，不再回退
      awaitingClick = false;
      gotApiResult = true;
      pendingUntil = 0;
      lastError.value = "";
      return;
    }
    failWith(
      result.verifyRequired
        ? "抖音要求人工验证，关注没有生效，请在页面上手动确认一次"
        : result.prompt || `抖音返回异常（status_code=${result.statusCode}），关注没有生效`,
    );
  }

  function start(document, { grace = DEFAULT_GRACE_MS } = {}) {
    if (doc || !document) return;
    doc = document;
    graceMs = grace;
    sync();
    const win = doc.defaultView;
    try {
      stopApi = watchFollowApi(win, handleResult);
    } catch (e) {
      console.error("[pure-live] 关注接口观测失败", e);
    }
    if (!win?.MutationObserver) return;
    observer = new win.MutationObserver((mutations) => {
      scanToasts(mutations);
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
    const win = doc.defaultView;
    awaitingClick = true;
    gotApiResult = false;
    beforeFollowing = following.value;
    anchorAtClick = anchorKey();
    // 新的一次点击优先，之前接口确认的结论作废
    confirmedFollowing = null;
    lastError.value = "";
    simulateClick(found.element, win);
    // 乐观更新，等接口结果覆盖
    following.value = found.state !== "followed";
    pendingUntil = Date.now() + graceMs;
    win?.setTimeout?.(() => {
      if (!awaitingClick) return;
      awaitingClick = false;
      pendingUntil = 0;
      if (!gotApiResult) {
        // 接口一次都没回来：点击没被抖音接收，实话实说，别让图标一直假装已关注
        lastError.value = "抖音没有响应关注请求，可能被风控拦截或页面结构变了";
      }
      sync();
    }, graceMs + 50);
    return true;
  }

  function stop() {
    observer?.disconnect();
    observer = null;
    stopApi?.();
    stopApi = null;
    doc = null;
    supported.value = false;
    following.value = false;
    lastError.value = "";
    pendingUntil = 0;
    awaitingClick = false;
    confirmedFollowing = null;
  }

  return { supported, following, lastError, start, toggle, stop, sync };
})();
