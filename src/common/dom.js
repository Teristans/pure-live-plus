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

// 空白字符 + 零宽字符，页面文本里经常夹带
const BLANK_RE = /[\s\u200b-\u200f\ufeff]+/g;

/** 归一化文本：去掉所有空白和零宽字符 */
export function normalizeText(value) {
  return String(value ?? "")
    .replace(BLANK_RE, "")
    .trim();
}

/** 元素的归一化文本 */
export function elementText(el) {
  return el ? normalizeText(el.textContent) : "";
}

/**
 * 模拟一次接近真实的点击。
 * 站点的画质菜单多为 React / 自研事件系统，只派发 click 有时不生效，
 * 这里按 指针按下 → 抬起 → 点击 的顺序补齐。
 */
export function simulateClick(el, view) {
  if (!el) return false;
  const win = view || el.ownerDocument?.defaultView;
  if (!win || typeof el.dispatchEvent !== "function") return false;
  const rect =
    typeof el.getBoundingClientRect === "function"
      ? el.getBoundingClientRect()
      : { x: 0, y: 0, width: 0, height: 0 };
  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: win,
    button: 0,
    clientX: Math.round(rect.x + rect.width / 2),
    clientY: Math.round(rect.y + rect.height / 2),
  };
  const pointer = win.PointerEvent || win.MouseEvent;
  for (const [Ctor, type] of [
    [pointer, "pointerover"],
    [pointer, "pointerdown"],
    [win.MouseEvent, "mousedown"],
    [pointer, "pointerup"],
    [win.MouseEvent, "mouseup"],
    [win.MouseEvent, "click"],
  ]) {
    if (typeof Ctor !== "function") continue;
    el.dispatchEvent(new Ctor(type, init));
  }
  return true;
}

/** 鼠标移入：部分菜单是 hover 打开的 */
export function simulateHover(el, view) {
  if (!el) return false;
  const win = view || el.ownerDocument?.defaultView;
  if (!win || typeof el.dispatchEvent !== "function") return false;
  const init = { bubbles: true, cancelable: true, composed: true, view: win };
  const pointer = win.PointerEvent || win.MouseEvent;
  el.dispatchEvent(new pointer("pointerover", init));
  el.dispatchEvent(new win.MouseEvent("mouseover", init));
  el.dispatchEvent(new win.MouseEvent("mousemove", init));
  return true;
}

/**
 * 等待元素出现
 * @returns {Promise<Element|null>} 超时返回 null
 */
export function waitForElement(doc, selector, { timeoutMs = 10000, interval = 200 } = {}) {
  const win = doc?.defaultView;
  return new Promise((resolve) => {
    if (!doc || !win) return resolve(null);
    const exist = doc.querySelector(selector);
    if (exist) return resolve(exist);
    const deadline = Date.now() + timeoutMs;
    const timer = win.setInterval(() => {
      const el = doc.querySelector(selector);
      if (el) {
        win.clearInterval(timer);
        return resolve(el);
      }
      if (Date.now() > deadline) {
        win.clearInterval(timer);
        resolve(null);
      }
    }, interval);
  });
}
