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

/** 抖音网页版推荐流（短视频），也就是 App 底部那个「推荐」页 */
export const RECOMMEND_FEED_URL = "https://www.douyin.com/?recommend=1";

/**
 * 直播首页：打开后抖音会自己进一个推荐直播间。
 * 接口取不到「下一个」时用它兜底，至少还是换一个直播间。
 */
export const LIVE_HOME_URL = "https://live.douyin.com/";

/** 直播间网址前缀：`live.douyin.com/<主播 short_id>` 就是那个主播的直播间 */
export const ROOM_URL_PREFIX = "https://live.douyin.com/";

/** 推荐直播间列表接口：免签名，带 cookie 直接 GET 就能拿到 room 列表 */
export const ROOM_FEED_PATH = "/webcast/feed/";

/** 记下本次浏览会话里点过「下一个」的房间，保证连点一直往新房间走 */
export const VISITED_KEY = "pure-live-visited-rooms";

/** 最多记这么多个，避免 sessionStorage 无限增长 */
const VISITED_LIMIT = 50;

/** 推荐流接口的公共查询参数（缺了会被返回 "url doesn't match"） */
const FEED_QUERY = {
  aid: "6383",
  app_name: "douyin_web",
  live_id: "1",
  device_platform: "web",
  language: "zh-CN",
  enter_from: "web_live",
  cookie_enabled: "true",
  screen_width: "1920",
  screen_height: "1080",
  browser_language: "zh-CN",
  browser_platform: "Win32",
  browser_name: "Mozilla",
  browser_version: "5.0",
  channel_id: "0",
  count: "15",
  offset: "0",
};

function resolveWindow(doc, win) {
  if (win) return win;
  if (doc?.defaultView) return doc.defaultView;
  return typeof window === "undefined" ? null : window;
}

/** 当前房间的短号（网址末段），拿不到返回空串 */
export function readCurrentShortId(win) {
  const path = win?.location?.pathname;
  if (typeof path !== "string") return "";
  const last = path.split("/").filter(Boolean).pop() ?? "";
  return /^\d+$/.test(last) ? last : "";
}

/** 拼推荐流接口地址；带上当前房间号，抖音会按它给相关推荐 */
export function buildFeedUrl(currentShortId) {
  const query = new URLSearchParams(FEED_QUERY);
  if (currentShortId) query.set("web_rid", currentShortId);
  return `${ROOM_FEED_PATH}?${query.toString()}`;
}

/** 读出这次会话已经刷过的房间号 */
export function loadVisited(win) {
  try {
    const raw = win?.sessionStorage?.getItem(VISITED_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.map(String) : [];
  } catch {
    return [];
  }
}

/** 记下一个刷过的房间号（放最后，超出上限丢最早的） */
export function rememberVisited(win, shortId) {
  const id = String(shortId ?? "").trim();
  if (!id) return;
  try {
    const list = loadVisited(win).filter((item) => item !== id);
    list.push(id);
    win?.sessionStorage?.setItem(VISITED_KEY, JSON.stringify(list.slice(-VISITED_LIMIT)));
  } catch {
    /* 隐私模式下 sessionStorage 可能不可写，忽略 */
  }
}

/**
 * 从推荐流接口的返回里挑出下一个直播间
 *
 * 接口里 `data[*].data` 是房间，主播短号在 `owner.short_id` ——
 * 实测这个值既能当进房接口的 web_rid，也就是 `live.douyin.com/<short_id>` 那个号。
 *
 * @param {object} payload 接口返回
 * @param {object} [options]
 * @param {string} [options.current] 当前房间号，要排除掉
 * @param {string[]} [options.visited] 这次会话已经看过的房间号
 * @returns {{shortId: string, nickname: string, roomId: string}|null}
 */
export function pickNextRoom(payload, { current = "", visited = [] } = {}) {
  const items = Array.isArray(payload?.data) ? payload.data : [];
  const skip = new Set([current, ...visited].map(String).filter(Boolean));
  for (const item of items) {
    const room = item?.data ?? item;
    const owner = room?.owner ?? {};
    const shortId = String(owner.short_id ?? "").trim();
    // 短号是纯数字才能拼成直播间地址；别的形式（空、自定义 id）跳过
    if (!/^\d+$/.test(shortId) || skip.has(shortId)) continue;
    return {
      shortId,
      nickname: String(owner.nickname ?? "").trim(),
      roomId: String(room?.id_str ?? ""),
    };
  }
  return null;
}

/**
 * 去抖音推荐流（短视频）
 * @returns {boolean} 是否发出跳转
 */
export function goRecommendFeed(win) {
  const target = resolveWindow(null, win);
  if (!target?.location) return false;
  target.location.href = RECOMMEND_FEED_URL;
  return true;
}

/**
 * 进入下一个推荐直播间
 *
 * 抖音直播间的上下滑是它自己接管的，合成滚轮在真实页面里不一定生效，
 * 所以这里不指望滑动，直接问接口要一个还没看过的房间号，然后整页开店。
 *
 * @param {object} [options]
 * @param {Document} [options.doc] 页面文档（测试注入）
 * @param {Window} [options.win] 页面窗口（测试注入）
 * @returns {Promise<{route: "room"|"live-home"|"no-window", shortId?: string, nickname?: string}>}
 *   route 说明走了哪条路，便于控制台排查
 */
export async function goNextRoom({ doc, win } = {}) {
  const window_ = resolveWindow(doc, win);
  if (!window_?.location) return { route: "no-window" };

  const current = readCurrentShortId(window_);
  let next = null;
  try {
    if (typeof window_.fetch === "function") {
      const res = await window_.fetch(buildFeedUrl(current), { credentials: "include" });
      if (res && res.ok !== false) {
        const payload = await res.json();
        next = pickNextRoom(payload, { current, visited: loadVisited(window_) });
      }
    }
  } catch {
    /* 网络被拦 / 风控 / 返回不是 JSON：都走兜底 */
  }

  if (!next) {
    window_.location.href = LIVE_HOME_URL;
    return { route: "live-home" };
  }

  rememberVisited(window_, next.shortId);
  window_.location.href = `${ROOM_URL_PREFIX}${next.shortId}`;
  return { route: "room", shortId: next.shortId, nickname: next.nickname };
}
