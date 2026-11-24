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
 * 抖音「关注 / 取关」接口的观测器
 *
 * 为什么需要它：页面上那个原生关注按钮点下去之后，按钮文案可能会先变成「已关注」
 * 再被直播间信息轮询刷回「关注」，只靠 DOM 文案判断会跟着来回跳。
 * 真正可靠的是接口返回：status_code 为 0 且 data.follow_status ∈ {1,2} 就是已关注。
 *
 * 这里只做「旁听」：包一层 fetch / XHR，把响应复制一份读出来，原样返回给页面，
 * 不改请求、不改响应、出错一律吞掉，绝不因为观测失败影响页面本身。
 */
const FOLLOW_ENDPOINT = "/webcast/user/relation/update/";

// 进房接口：它的响应里带着「我和这个主播」的关注关系，是进入直播间时唯一可信的状态来源
const ENTER_ENDPOINT_RE = /\/webcast\/room\/(?:web\/)?enter\//;

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
 * 从进房接口的响应里挖出「当前用户 → 主播」的关注关系
 *
 * 抖音把关注关系放在 `owner.follow_info.follow_status` 这类结构里，
 * 层级随版本变，所以按键名递归找 follow_info，连同主播的 web_rid 一起带回来
 * （web_rid 就是直播间 URL 里那串数字，用来挡掉「预加载别的直播间」的数据）。
 *
 * @returns {{followStatus: number, webRid: string}|null} 找不到就返回 null
 */
export function extractRoomRelation(payload) {
  if (!payload || typeof payload !== "object") return null;
  const stack = [{ node: payload, depth: 0 }];
  let budget = 4000;
  while (stack.length && budget > 0) {
    budget -= 1;
    const { node, depth } = stack.pop();
    if (!node || typeof node !== "object" || depth > 6) continue;
    const info = node.follow_info;
    if (info && typeof info === "object" && typeof info.follow_status === "number") {
      const rid = node.web_rid ?? node.webRid ?? "";
      return { followStatus: info.follow_status, webRid: rid === 0 ? "" : String(rid) };
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") stack.push({ node: value, depth: depth + 1 });
    }
  }
  return null;
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
 * 开始观测关注接口
 * @param {Window} win 页面窗口（document.defaultView，不用脚本沙箱里的 window）
 * @param {object} handlers
 * @param {(result: object) => void} [handlers.onResult] 收到「关注 / 取关」响应时回调
 * @param {(relation: object) => void} [handlers.onSnapshot] 收到进房接口里的关注关系时回调
 * @returns {() => void} 取消观测
 */
export function watchFollowApi(win, { onResult, onSnapshot } = {}) {
  if (!win) return () => {};
  const hasResult = typeof onResult === "function";
  const hasSnapshot = typeof onSnapshot === "function";
  if (!hasResult && !hasSnapshot) return () => {};
  const restores = [];

  const reportSnapshot = (payload) => {
    if (!hasSnapshot) return;
    const relation = extractRoomRelation(payload);
    if (!relation) return;
    try {
      onSnapshot(relation);
    } catch {
      /* 回调异常不影响页面 */
    }
  };

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
        const isFollow = hasResult && url.includes(FOLLOW_ENDPOINT);
        const isEnter = hasSnapshot && ENTER_ENDPOINT_RE.test(url);
        if ((!isFollow && !isEnter) || !promise?.then) return promise;
        return promise.then((res) => {
          try {
            if (isFollow) {
              const verifyRequired = needsVerify(res?.headers);
              res
                ?.clone?.()
                .json?.()
                .then((payload) => onResult(toFollowResult(payload, { verifyRequired })))
                // 拿不到响应体就不下结论，免得把「读不到」当成「关注失败」
                .catch(() => {
                  if (verifyRequired) onResult(toFollowResult(null, { verifyRequired }));
                });
            } else {
              res?.clone?.().json?.().then(reportSnapshot).catch(() => {});
            }
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
          const url = String(this.__pureLiveUrl || "");
          const isFollow = hasResult && url.includes(FOLLOW_ENDPOINT);
          const isEnter = hasSnapshot && ENTER_ENDPOINT_RE.test(url);
          if (isFollow || isEnter) {
            this.addEventListener("load", () => {
              const payload = readXhrPayload(this);
              // undefined 表示响应体读不出来（如 arraybuffer），此时不下结论
              if (payload === undefined || payload === null) return;
              if (isFollow) onResult(toFollowResult(payload));
              else reportSnapshot(payload);
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
