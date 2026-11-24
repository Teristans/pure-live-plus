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
import { elementText, normalizeText } from "@/common/dom";

/**
 * 斗鱼：送礼物信息 / 礼物特效 / 福袋
 *
 * 分两层：
 * 1) restyle.css 里的结构选择器负责藏掉礼物特效层、礼物面板、福袋入口（静态、零开销）；
 * 2) 这里负责「结构改名了也能兜住」的部分：按文字找福袋 / 礼物入口，
 *    并过滤弹幕、聊天区里的送礼消息。
 */
const HIDDEN_ATTR = "data-pure-live-hidden";

// 单独成词的入口文案（福袋、礼物图标等）
const ENTRY_TEXT_RE = /^(福袋|幸运福袋|礼物|送礼|抽奖|红包|宝箱|礼盒|盲盒|幸运礼物)$/;

// 送礼 / 福袋类消息文案
const MESSAGE_TEXT_RE =
  /(送出了?|送给|赠送|投喂|打赏|开通了?(?:国王|皇帝|超级皇帝|公爵|伯爵|子爵|男爵|骑士|守护|贵族|游侠)|续费(?:国王|皇帝|公爵|伯爵|子爵|男爵|骑士|守护|贵族)|福袋|红包|抽奖|中奖|礼盒|盲盒)/;

// 入口可能出现的区域
const ENTRY_SCOPES = [
  "#js-player-main",
  "#js-player-toolbar",
  "#js-player-controlbar",
  "#js-player-asideMain",
  "#js-player-asideTopSuspension",
];

// 消息列表容器
const ROW_CONTAINERS = ["#js-player-barrage", "#js-player-chat"];
const ROW_CONTAINER_IDS = new Set(["js-player-barrage", "js-player-chat"]);

export function isGiftEntryText(text) {
  return ENTRY_TEXT_RE.test(normalizeText(text));
}

export function isGiftMessageText(text) {
  const value = normalizeText(text);
  return value.length > 0 && value.length <= 200 && MESSAGE_TEXT_RE.test(value);
}

/** 隐藏元素（React 重渲染会覆盖 style，所以同时记一个标记位） */
export function hideElement(el) {
  if (!el || typeof el.setAttribute !== "function") return false;
  if (el.getAttribute(HIDDEN_ATTR) === "1") return false;
  el.setAttribute(HIDDEN_ATTR, "1");
  el.style?.setProperty("display", "none", "important");
  return true;
}

/** 找到入口的整块容器：往上爬一层，但别把整条工具栏一起藏掉 */
function entryWrapper(el) {
  const candidate = el.closest?.('[role="button"],button,li,a,[class*="Item"],[class*="item"]');
  if (candidate) return elementText(candidate).length <= 8 ? candidate : el;
  const parent = el.parentElement;
  if (parent && parent.children.length === 1 && elementText(parent).length <= 8) return parent;
  return el;
}

/** 单条消息：只往上穿过「只有一个子元素」的包装层，避免把整个列表藏掉 */
function messageRow(el) {
  let node = el;
  while (node.parentElement && node.parentElement.children.length === 1) {
    const parent = node.parentElement;
    if (parent.id && ROW_CONTAINER_IDS.has(parent.id)) break;
    if (!isGiftMessageText(elementText(parent))) break;
    node = parent;
  }
  return node;
}

/** 按文案隐藏福袋 / 礼物入口 */
export function hideGiftEntries(root) {
  let changed = 0;
  for (const selector of ENTRY_SCOPES) {
    for (const scope of root.querySelectorAll(selector)) {
      for (const el of scope.querySelectorAll("div,span,button,li,a")) {
        if (!isGiftEntryText(elementText(el))) continue;
        // 只处理最内层，避免把外层容器一起藏掉
        if (Array.from(el.children).some((child) => isGiftEntryText(elementText(child)))) continue;
        if (hideElement(entryWrapper(el))) changed += 1;
      }
    }
  }
  return changed;
}

/** 过滤容器里的送礼 / 福袋消息 */
export function hideGiftMessages(root) {
  let changed = 0;
  for (const selector of ROW_CONTAINERS) {
    for (const container of root.querySelectorAll(selector)) {
      for (const el of container.querySelectorAll("div,li,p,span,a")) {
        if (el.id && ROW_CONTAINER_IDS.has(el.id)) continue;
        if (el.children.length > 6) continue;
        if (!isGiftMessageText(elementText(el))) continue;
        if (hideElement(messageRow(el))) changed += 1;
      }
    }
  }
  return changed;
}

/**
 * 启动斗鱼送礼内容屏蔽
 * @returns {() => void} 停止函数
 */
export function hideDouyuGift({ document: doc, timeoutMs = 60000 } = {}) {
  const win = doc?.defaultView;
  if (!win) return () => {};

  let stopped = false;
  let observer = null;
  let timer = null;
  const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : Infinity;

  function sweep(root) {
    if (stopped) return;
    hideGiftEntries(root);
    hideGiftMessages(root);
  }

  function attach() {
    if (stopped) return;
    const targets = ROW_CONTAINERS.map((selector) => doc.querySelector(selector)).filter(Boolean);
    if (targets.length) {
      win.clearInterval(timer);
      timer = null;
      observer = new win.MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node.nodeType !== 1) continue;
            const target = node.parentElement || node;
            hideGiftEntries(target);
            if (isGiftMessageText(elementText(node))) hideElement(messageRow(node));
          }
        }
        if (Date.now() > deadline) stop();
      });
      for (const target of targets) observer.observe(target, { childList: true, subtree: true });
      return true;
    }
    return false;
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    observer?.disconnect();
    observer = null;
    win.clearInterval(timer);
    timer = null;
    doc.removeEventListener?.("pagehide", stop);
  }

  sweep(doc);
  if (!attach()) timer = win.setInterval(attach, 1000);
  doc.addEventListener?.("pagehide", stop);
  return stop;
}
