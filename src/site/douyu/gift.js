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

/*
 * 播放器设置里的屏蔽项
 *
 * 斗鱼在控制栏「弹幕设置」面板里自带一组屏蔽开关，勾上之后由斗鱼自己过滤，
 * 比我们按文案删 DOM 彻底得多：礼物特效、礼物飘屏、福袋口令、进场特效都在它管辖范围内。
 * 面板的类名是哈希（shieldSettingItem-4b3b84、checked-13adb7），只能按文案定位；
 * 好消息是这些开关即使面板没展开也在 DOM 里，点 label 直接生效，用户看不到面板闪动。
 */
const SHIELD_SETTING_TEXTS = [
  "屏蔽全部礼物", // 送礼信息（含福袋口令这类播报）
  "屏蔽消息通知", // 系统 / 福袋中奖通知
  "屏蔽视频广播", // 全站广播
  "屏蔽小礼物",
  "屏蔽进场特效", // 礼物特效的主要来源
  "屏蔽礼物音效",
  "屏蔽弹幕皮肤", // 贵族 / 礼物弹幕皮肤
];

// 面板可能晚于播放器渲染，最多重试这么多轮
const SHIELD_ROUND_LIMIT = 40;
const SHIELD_INTERVAL_MS = 1000;
// 点过一次后，隔这么久才允许再点，避免勾不上时来回切换
const SHIELD_CLICK_COOLDOWN_MS = 15000;

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
 * 开关是否已勾上
 *
 * 斗鱼用 svg 的类名表示状态：未选中 `unchecked-b96102`、已选中 `checked-13adb7`。
 * 哈希后缀会变，所以只认前缀；注意 `unchecked` 里也含 "checked"，必须先排除。
 */
export function isShieldChecked(row) {
  const svg = row?.querySelector?.("svg");
  const cls = String(svg?.getAttribute?.("class") ?? "");
  return cls.includes("checked") && !cls.includes("unchecked");
}

/** 按文案定位一个屏蔽项：文案所在的 label + 它所在的整行（行里必须有勾选框 svg） */
export function findShieldRow(doc, text) {
  if (!doc?.querySelectorAll) return null;
  for (const label of doc.querySelectorAll("label")) {
    if (normalizeText(elementText(label)) !== text) continue;
    const row = label.parentElement;
    if (row?.querySelector("svg")) return { row, label };
  }
  return null;
}

/**
 * 勾选播放器设置里的屏蔽项
 *
 * 幂等：已勾的跳过；刚点过的在冷却期内不再点，避免勾不上时来回切换（那会比不勾更糟）。
 *
 * @param {Document} doc 页面文档
 * @param {Window} win 页面窗口（要拿它的 MouseEvent）
 * @param {Map<string, number>} clickedAt 记录每项上次点击时间，调用方持有
 * @returns {{found: number, checked: number, clicked: number}} 找到几项 / 已勾几项 / 本次点了几项
 */
export function applyShieldSettings(doc, win, clickedAt = new Map()) {
  const stats = { found: 0, checked: 0, clicked: 0 };
  const now = Date.now();
  for (const text of SHIELD_SETTING_TEXTS) {
    const hit = findShieldRow(doc, text);
    if (!hit) continue;
    stats.found += 1;
    if (isShieldChecked(hit.row)) {
      stats.checked += 1;
      // 已勾上就清掉点击记录，万一之后被重置还能再点
      clickedAt.delete(text);
      continue;
    }
    if (now - (clickedAt.get(text) ?? 0) < SHIELD_CLICK_COOLDOWN_MS) continue;
    try {
      const Mouse = win?.MouseEvent;
      if (typeof Mouse === "function") {
        hit.label.dispatchEvent(new Mouse("click", { bubbles: true, cancelable: true, view: win }));
      } else {
        hit.label.click?.();
      }
      clickedAt.set(text, now);
      stats.clicked += 1;
    } catch {
      /* 点不动就算了，下一轮再说 */
    }
  }
  return stats;
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
  let shieldTimer = null;
  let shieldRounds = 0;
  const shieldClickedAt = new Map();
  const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : Infinity;

  function sweep(root) {
    if (stopped) return;
    hideGiftEntries(root);
    hideGiftMessages(root);
  }

  /**
   * 确保播放器设置里的屏蔽项都勾上
   *
   * 这是主力手段：勾选后由斗鱼自己过滤，按文案删 DOM 只是兜底。
   * 面板可能晚于播放器渲染，所以每秒试一次，勾齐或重试到头就收工。
   */
  function ensureShieldSettings() {
    if (stopped) return;
    const stats = applyShieldSettings(doc, win, shieldClickedAt);
    shieldRounds += 1;
    const done = stats.found > 0 && stats.checked === stats.found;
    if (done) {
      win.clearInterval(shieldTimer);
      shieldTimer = null;
      console.debug("[pure-live] 斗鱼播放器屏蔽项已勾选", stats.found);
      return;
    }
    if (shieldRounds < SHIELD_ROUND_LIMIT) return;
    win.clearInterval(shieldTimer);
    shieldTimer = null;
    if (stats.found === 0) {
      console.debug("[pure-live] 没找到斗鱼播放器的屏蔽项，改为按文案过滤送礼消息");
    } else {
      console.warn(
        `[pure-live] 斗鱼播放器屏蔽项只勾上 ${stats.checked}/${stats.found}，其余先按文案过滤兜住`,
      );
    }
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
    win.clearInterval(shieldTimer);
    shieldTimer = null;
    doc.removeEventListener?.("pagehide", stop);
  }

  sweep(doc);
  if (!attach()) timer = win.setInterval(attach, 1000);
  // 先建定时器再试一次：ensureShieldSettings 里勾齐时会自己清掉它
  shieldTimer = win.setInterval(ensureShieldSettings, SHIELD_INTERVAL_MS);
  ensureShieldSettings();
  doc.addEventListener?.("pagehide", stop);
  return stop;
}
