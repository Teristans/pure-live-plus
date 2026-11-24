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
 * 抖音「关注 / 取关」的数据来源
 *
 * 两件事：
 *   1. 旁听 `/webcast/user/relation/update/`：点击后抖音自己发的接口，返回 follow_status，
 *      是「这次点击有没有生效」的唯一可信证据。按钮文案会被直播间信息轮询刷回旧值，不能当证据。
 *   2. 主动请求 `/webcast/room/web/enter/`：进房响应里 `data.user` 就是当前主播，
 *      `data.user.follow_info.follow_status` 就是「我 → 这个主播」的真实关系。
 *      实测该接口免签名，带页面 cookie 直接 GET 就能拿到，所以不依赖页面自己什么时候发请求
 *      ——脚本按 @run-at document-idle 执行，等它跑起来时进房请求早就发完了。
 *
 * 只读，不修改任何请求与响应；观测失败一律吞掉，绝不影响页面本身。
 */
const FOLLOW_ENDPOINT = "/webcast/user/relation/update/";

// 抖音关注关系：0 未关注、1 已关注、2 互相关注、3 对方关注了我
const FOLLOWING_STATUS = new Set([1, 2]);

/** follow_status → 是否已关注（不是数字就返回 undefined，表示不下结论） */
export function isFollowingStatus(status) {
  if (typeof status !== "number") return undefined;
  return FOLLOWING_STATUS.has(status);
}

/** 响应体 → 统一结果 */
export function toFollowResult(payload, { verifyRequired = false } = {}) {
  const statusCode = payload?.status_code;
  const followStatus = payload?.data?.follow_status;
  // 带验证标记说明抖音要人工过验证码，这一次点击不会生效
  const ok = statusCode === 0 && !verifyRequired;
  return {
    ok,
    statusCode,
    followStatus,
    following: !ok || followStatus === undefined ? undefined : FOLLOWING_STATUS.has(followStatus),
    verifyRequired: Boolean(verifyRequired),
    prompt: payload?.data?.prompts || payload?.data?.status_msg || "",
  };
}

/**
 * 从进房接口响应里读出「我 → 主播」的关注关系
 *
 * 只认主播那一份数据，不递归乱找：`data.similar_rooms[*].room.owner` 里同样带 follow_info，
 * 那是「推荐直播间」的主播，把它们当成当前主播就会永远读到 0。
 *
 * @returns {number|undefined} follow_status，取不到返回 undefined
 */
export function readAnchorFollowStatus(payload) {
  const data = payload?.data;
  if (!data || typeof data !== "object") return undefined;
  const owners = [data.user, data.data?.[0]?.owner, data.room?.owner];
  for (const owner of owners) {
    const status = owner?.follow_info?.follow_status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

/** 进房接口地址（web_rid 就是直播间 URL 末尾那串数字） */
function enterUrl(webRid) {
  const query = [
    "aid=6383",
    "app_name=douyin_web",
    "live_id=1",
    "device_platform=web",
    "language=zh-CN",
    "enter_from=web_live",
    "cookie_enabled=true",
    "screen_width=1920",
    "screen_height=1080",
    "browser_language=zh-CN",
    "browser_platform=Win32",
  ].join("&");
  return `/webcast/room/web/enter/?${query}&web_rid=${encodeURIComponent(webRid)}`;
}

/**
 * 主动问一次「我关注这个主播了吗」
 * @param {Window} win 页面窗口（document.defaultView）
 * @param {string} webRid 直播间 URL 末尾的号
 * @returns {Promise<{fetched: boolean, status?: number}>} fetched 表示请求本身有没有成功
 */
export async function requestRoomFollowStatus(win, webRid) {
  if (!win || typeof win.fetch !== "function" || !webRid) return { fetched: false };
  try {
    const res = await win.fetch(enterUrl(webRid), { credentials: "include" });
    if (!res || res.ok === false) return { fetched: false };
    const payload = await res.json();
    return { fetched: true, status: readAnchorFollowStatus(payload) };
  } catch {
    return { fetched: false };
  }
}

/** 响应头里出现验证标记，说明抖音要求人工验证，关注不会生效 */
function needsVerify(headers) {
  try {
    if (!headers || typeof headers.get !== "function") return false;
    return Boolean(
      headers.get("bdturing-verify") || headers.get("x-tt-verify-passport-decision"),
    );
  } catch {
    return false;
  }
}

/**
 * 读取 XHR 响应体
 * @returns {object|null|undefined} undefined 表示读不出来，不要据此判断成败
 */
function readXhrPayload(xhr) {
  try {
    if (xhr.responseType === "json") return xhr.response ?? null;
    if (xhr.responseType === "" || xhr.responseType === "text") {
      const text = typeof xhr.responseText === "string" ? xhr.responseText : "";
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return undefined;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * 开始观测「关注 / 取关」接口
 * @param {Window} win 页面窗口（document.defaultView，不用脚本沙箱里的 window）
 * @param {object} handlers
 * @param {(result: object) => void} [handlers.onResult] 收到「关注 / 取关」响应时回调
 * @returns {() => void} 取消观测
 */
export function watchFollowApi(win, { onResult } = {}) {
  if (!win || typeof onResult !== "function") return () => {};
  const restores = [];

  // —— fetch ——
  try {
    // eslint-disable-next-line typescript/unbound-method -- 下面用 rawFetch.call(this, ...) 把调用方传回去
    const rawFetch = win.fetch;
    if (typeof rawFetch === "function") {
      const patched = function (input, init) {
        const promise = rawFetch.call(this, input, init);
        let url = "";
        try {
          url = String(input?.url ?? input ?? "");
        } catch {
          url = "";
        }
        if (!url.includes(FOLLOW_ENDPOINT) || !promise?.then) return promise;
        return promise.then((res) => {
          try {
            const verifyRequired = needsVerify(res?.headers);
            res
              ?.clone?.()
              .json?.()
              .then((payload) => onResult(toFollowResult(payload, { verifyRequired })))
              // 拿不到响应体就不下结论，免得把「读不到」当成「关注失败」
              .catch(() => {
                if (verifyRequired) onResult(toFollowResult(null, { verifyRequired }));
              });
          } catch {
            /* 观测失败不影响页面 */
          }
          return res;
        });
      };
      win.fetch = patched;
      restores.push(() => {
        if (win.fetch === patched) win.fetch = rawFetch;
      });
    }
  } catch {
    /* 有的环境不允许改写 fetch，忽略 */
  }

  // —— XMLHttpRequest ——
  try {
    const proto = win.XMLHttpRequest?.prototype;
    if (proto && typeof proto.open === "function" && typeof proto.send === "function") {
      const rawOpen = proto.open;
      const rawSend = proto.send;
      const patchedOpen = function (method, url, ...rest) {
        try {
          this.__pureLiveUrl = String(url ?? "");
        } catch {
          /* ignore */
        }
        return rawOpen.call(this, method, url, ...rest);
      };
      const patchedSend = function (...args) {
        try {
          if (String(this.__pureLiveUrl || "").includes(FOLLOW_ENDPOINT)) {
            this.addEventListener("load", () => {
              const payload = readXhrPayload(this);
              // undefined 表示响应体读不出来（如 arraybuffer），此时不下结论
              if (payload !== undefined) onResult(toFollowResult(payload));
            });
          }
        } catch {
          /* ignore */
        }
        return rawSend.apply(this, args);
      };
      proto.open = patchedOpen;
      proto.send = patchedSend;
      restores.push(() => {
        if (proto.open === patchedOpen) proto.open = rawOpen;
        if (proto.send === patchedSend) proto.send = rawSend;
      });
    }
  } catch {
    /* ignore */
  }

  return () => {
    for (const restore of restores) {
      try {
        restore();
      } catch {
        /* ignore */
      }
    }
  };
}
