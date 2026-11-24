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

// 抖音关注关系：0 未关注、1 已关注、2 互相关注、3 对方关注了我
const FOLLOWING_STATUS = new Set([1, 2]);

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
 * 开始观测关注接口
 * @param {Window} win 页面窗口（document.defaultView，不用脚本沙箱里的 window）
 * @param {(result: object) => void} onResult 收到关注接口响应时回调
 * @returns {() => void} 取消观测
 */
export function watchFollowApi(win, onResult) {
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
              .catch(() => onResult(toFollowResult(null, { verifyRequired })));
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
              try {
                const text = typeof this.responseText === "string" ? this.responseText : "";
                const payload = text ? JSON.parse(text) : null;
                onResult(toFollowResult(payload));
              } catch {
                onResult(toFollowResult(null));
              }
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
