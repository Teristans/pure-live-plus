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
import { elementText, normalizeText, simulateClick, simulateHover } from "@/common/dom";

/**
 * 抖音直播清晰度，从高到低。
 * 抖音的类名大多是哈希的（hY8lWHgA 这类），所以一律按「文字」识别，
 * 只要抖音不改文案就不会失效。
 */
export const QUALITY_LABELS = ["原画", "蓝光", "超清", "高清", "标清", "流畅", "智能", "自动"];

const PLAYER_SELECTOR = [
  "#_douyin_live_scroll_container_",
  '[data-e2e="live-player"]',
  '[class*="douyin-player" i]',
].join(",");

// 画质按钮（点它/悬停它才出菜单）
const TRIGGER_SELECTORS = [
  ".QualitySwitchNewPlugin",
  '[class*="QualitySwitch" i]',
  ".xgplayer-clarity-btn",
];

// 画质选项容器，子节点就是各档画质（DOM 顺序：原画 > 蓝光 > 超清 > 高清 > 标清）
const OPTION_CONTAINER_SELECTOR = '[data-e2e="quality-selector"]';

const CONTROL_SELECTORS = [
  ".douyin-player-controls-right",
  '[class*="controls-right" i]',
  '[class*="ControlsRight" i]',
  ".douyin-player-controls-inner",
];

/** 文字 → 画质名；支持「原画 1080P」这类带后缀的写法 */
export function qualityLabel(text) {
  const value = normalizeText(text);
  if (!value || value.length > 16) return null;
  // 需要登录才能看的档位（「登录可看原画」）不算可选画质
  if (value.includes("登录")) return null;
  for (const label of QUALITY_LABELS) {
    if (value === label) return label;
    const rest = value.slice(label.length);
    // 后缀只允许出现数字 / 字母 / 点，避免把「原画蓝光高清」这种整块菜单文本当成选项
    if (value.startsWith(label) && /^[0-9a-z.\s]*$/i.test(rest)) return label;
  }
  return null;
}

/** 画质名 → 优先级，数字越小越清晰 */
export function qualityRank(label) {
  return QUALITY_LABELS.indexOf(label);
}

function hasQualityChild(node) {
  return Array.from(node.children).some((child) => qualityLabel(elementText(child)));
}

/**
 * 找画质选项容器
 * 1) 优先用已知结构 [data-e2e="quality-selector"]（子节点就是画质档位）
 * 2) 兜底：任意一个「直接子节点里至少有 2 个不同画质名」的容器
 */
export function findQualityMenu(doc) {
  if (!doc) return null;
  for (const container of doc.querySelectorAll(OPTION_CONTAINER_SELECTOR)) {
    if (hasQualityChild(container)) return container;
  }
  let best = null;
  let bestSize = 0;
  for (const node of doc.querySelectorAll("div,ul,ol,menu")) {
    if (node.children.length < 2) continue;
    const labels = new Set();
    for (const child of node.children) {
      const label = qualityLabel(elementText(child));
      if (label) labels.add(label);
    }
    if (labels.size > bestSize) {
      best = node;
      bestSize = labels.size;
    }
  }
  return bestSize >= 2 ? best : null;
}

/** 列出菜单里的画质选项 */
export function listQualityOptions(menu) {
  if (!menu) return [];
  return Array.from(menu.children)
    .map((el) => ({ el, label: qualityLabel(elementText(el)) }))
    .filter((item) => item.label);
}

/** 选出最高画质选项 */
export function bestQualityOption(options) {
  let best = null;
  for (const item of options) {
    if (!best || qualityRank(item.label) < qualityRank(best.label)) best = item;
  }
  return best;
}

/** 选项是否已处于选中态 */
export function isQualitySelected(el) {
  if (!el || typeof el.getAttribute !== "function") return false;
  for (const name of ["aria-selected", "aria-checked", "data-selected", "data-checked", "data-active"]) {
    if (el.getAttribute(name) === "true") return true;
  }
  return Array.from(el.classList || []).some((name) =>
    /(^|[-_])(selected|active|current|checked|chosen?)([-_]|$)/i.test(name),
  );
}

/** 找画质按钮 */
export function findQualityTrigger(doc) {
  if (!doc) return null;
  for (const selector of TRIGGER_SELECTORS) {
    const el = doc.querySelector(selector);
    if (el) return el;
  }
  const player = doc.querySelector(PLAYER_SELECTOR);
  if (!player) return null;
  let scope = player;
  for (const selector of CONTROL_SELECTORS) {
    const el = player.querySelector(selector);
    if (el) {
      scope = el;
      break;
    }
  }
  // 兜底：控件区里文字就是画质名 / 「清晰度」的小按钮（选项本身不算）
  for (const el of scope.querySelectorAll('button,[role="button"],div,span,li,a')) {
    if (el.closest(OPTION_CONTAINER_SELECTOR)) continue;
    const text = elementText(el);
    if (!text || text.length > 6) continue;
    if (text !== "清晰度" && !qualityLabel(text)) continue;
    return el;
  }
  return null;
}

/** 画质按钮上当前显示的画质 */
function currentQuality(doc) {
  const trigger = findQualityTrigger(doc);
  return trigger ? qualityLabel(elementText(trigger)) : null;
}

/**
 * 抖音自动最高画质
 *
 * 旧实现只在脚本启动后 10 秒内、对 `.douyin-player-controls-right` 监听一次，
 * 播放器控件晚挂载就彻底失效；而且固定点「第 2 个选项」，抖音调整顺序后就选错。
 *
 * 现在：轮询到成功为止（最长 120 秒），按文字挑最高档；已知结构
 * `.QualitySwitchNewPlugin [data-e2e="quality-selector"]` 直接点，结构变了
 * 就退回「打开菜单 → 按文字找最高档」；选完校验按钮文案，成功即停止干预。
 *
 * @returns {() => void} 停止函数
 */
export function watchDouyinQuality({ document: doc, shouldSwitch = () => true, timeoutMs = 120000 }) {
  const win = doc?.defaultView;
  if (!win) return () => {};

  let stopped = false;
  let timer = null;
  let lastReveal = 0;
  let lastTriggerAction = 0;
  let triggerAttempts = 0;
  let openAttempts = 0;
  let lastOptionClick = 0;
  let clickedLabel = null;
  let retries = 0;
  let noTriggerSince = Date.now();
  const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : Infinity;

  function stop() {
    if (stopped) return;
    stopped = true;
    win.clearInterval(timer);
    doc.removeEventListener?.("pagehide", stop);
  }

  function revealControls(player) {
    lastReveal = Date.now();
    const init = { bubbles: true, cancelable: true, view: win };
    // 控件区是鼠标移到画面上才出现的，容器和 video 上都派发一次
    for (const target of [player, player.querySelector("video")]) {
      if (!target) continue;
      target.dispatchEvent(new win.MouseEvent("pointermove", init));
      target.dispatchEvent(new win.MouseEvent("mousemove", init));
    }
  }

  function finish(menu) {
    if (menu) {
      const init = { bubbles: true, view: win };
      menu.dispatchEvent(new win.MouseEvent("mouseout", init));
      menu.dispatchEvent(new win.MouseEvent("mouseleave", init));
    }
    stop();
  }

  function clickHighest(menu) {
    const options = listQualityOptions(menu);
    if (options.length < 2) return finish(menu); // 只有一路清晰度，没什么可选的
    const best = bestQualityOption(options);
    if (!best) return finish(menu);

    if (isQualitySelected(best.el) || currentQuality(doc) === best.label) {
      clickedLabel = best.label;
      return finish(menu);
    }
    if (clickedLabel === best.label && Date.now() - lastOptionClick < 1500) return;
    if (++retries > 5) return finish(menu); // 点了几次都没生效，不再纠缠
    clickedLabel = best.label;
    lastOptionClick = Date.now();
    simulateClick(best.el, win);
  }

  function scan() {
    if (stopped) return;
    if (!shouldSwitch()) return stop();
    if (Date.now() > deadline) return stop();

    const player = doc.querySelector(PLAYER_SELECTOR);
    if (!player) return;
    if (Date.now() - lastReveal > 400) revealControls(player);

    const menu = findQualityMenu(doc);
    if (menu) return clickHighest(menu);

    // 上一次点过最高画质，按钮文案已经变成目标画质 → 已生效
    if (clickedLabel && currentQuality(doc) === clickedLabel) return finish(null);

    const trigger = findQualityTrigger(doc);
    if (!trigger) {
      if (Date.now() - noTriggerSince > 25000) return stop(); // 这个直播间没有画质开关
      return;
    }
    noTriggerSince = Date.now();
    if (Date.now() - lastTriggerAction < 700) return;
    lastTriggerAction = Date.now();
    // 菜单一直打不开（比如直播间只有一路清晰度）就收手，别一直闪
    if (++openAttempts > 12) return stop();
    // 菜单可能是 hover 打开、也可能要点一下，两种都试
    if (triggerAttempts++ % 2 === 0) simulateHover(trigger, win);
    else simulateClick(trigger, win);
  }

  timer = win.setInterval(scan, 500);
  doc.addEventListener?.("pagehide", stop);
  scan();
  return stop;
}
