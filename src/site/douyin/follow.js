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
import { isFollowingStatus, watchFollowApi } from "@/site/douyin/follow-api";

/**
 * 抖音直播的关注按钮
 *
 * 思路：不自己调关注接口（需要签名 + 风控），而是「借用」页面上原生的关注按钮。
 * 脚本把顶部信息栏隐藏了，但节点还在 DOM 里，点它和用户手点效果完全一致。
 *
 * 状态识别是本模块最容易出错的地方，抖音的 DOM 有两个坑：
 *   1. 「关注」和「已关注」两个按钮会被同时渲染，只靠 CSS 隐藏其中一个。
 *      如果按选择器取第一个命中的元素，就会拿到被隐藏的「关注」，
 *      于是明明已经关注了却显示空心；点下去反而触发取关（提示「取消关注成功」）。
 *   2. 直播间信息轮询会把按钮文案刷回旧值，只看文案会「点完变蓝、一秒又空心」。
 *
 * 所以状态来源按可靠程度排队：
 *   1. 关注接口的返回值（点击后）     —— 唯一能证明「点了有生效」的证据
 *   2. 进房接口里的 follow_status    —— 进入直播间瞬间就有的服务端真值
 *   3. 可见的那个原生按钮的文案      —— 兜底，隐藏的重复按钮不参与判断
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

/**
 * 分层查找关注按钮，越靠前越可信
 * keepUnknown：文案读不出来但标记很确定时也保留（有按钮总比没有强）
 */
const TIERS = [
  {
    base: 100,
    loose: true,
    keepUnknown: true,
    selectors: [
      '[data-e2e="live-followbutton"]',
      '[data-e2e*="follow-btn" i]',
      '[data-e2e*="followbutton" i]',
      '[data-e2e*="follow" i]',
      '[class*="follow-btn" i]',
      '[class*="FollowBtn" i]',
    ],
  },
  { base: 20, loose: true, keepUnknown: false, selectors: ['button,a,[role="button"]'] },
  // 最后一层是普通 div/span，必须完全等于「关注 / 已关注」，否则会误点粉丝数统计
  { base: 10, loose: false, keepUnknown: false, selectors: ["div,span"] },
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

/** class 里带 followed / following 也算已关注（文案是图标、读不出字时兜底） */
function hasFollowedClass(el) {
  const raw = el?.className;
  if (typeof raw !== "string" || !raw) return false;
  return raw.split(/\s+/).some((token) => /^(?:is-)?follow(?:ed|ing)(?:[-_].*)?$/i.test(token));
}

/** 文案读不出来时，看 aria / title / class 上的状态提示 */
function readStateHint(el) {
  if (!el || typeof el.getAttribute !== "function") return null;
  const pressed = el.getAttribute("aria-pressed");
  if (pressed === "true") return "followed";
  if (pressed === "false") return "unfollowed";
  for (const name of ["aria-label", "title"]) {
    const raw = String(el.getAttribute(name) ?? "");
    if (!raw) continue;
    // 已关注时按钮的语义是「取消关注」，比「关注」更可信
    if (normalizeText(raw).includes("取消关注")) return "followed";
    const state = readFollowState(raw, { loose: true });
    if (state) return state;
  }
  if (hasFollowedClass(el)) return "followed";
  return null;
}

/** 元素自身的状态：先看文案，再看属性提示 */
function readElementState(el, loose) {
  return readFollowState(elementText(el), { loose }) ?? readStateHint(el);
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

/**
 * 元素是否真的显示在页面上
 *
 * 只要抖音把「关注」和「已关注」两个按钮都渲染出来、用 display:none 藏一个，
 * 隐藏的那个就是假状态。hasLayout 为 false（jsdom 之类的无布局环境）时跳过尺寸判断，
 * 只按样式判断，不然测试环境里所有元素都是「零尺寸」。
 */
function isVisible(el, { hasLayout = false } = {}) {
  if (!el || el.nodeType !== 1) return true;
  if (typeof el.hasAttribute === "function" && el.hasAttribute("hidden")) return false;
  if (el.getAttribute?.("aria-hidden") === "true") return false;
  const win = el.ownerDocument?.defaultView;
  if (!win?.getComputedStyle) return true;
  let node = el;
  for (let depth = 0; node && node.nodeType === 1 && depth < 12; depth += 1) {
    let style = null;
    try {
      style = win.getComputedStyle(node);
    } catch {
      style = null;
    }
    if (style) {
      if (style.display === "none") return false;
      if (style.visibility === "hidden" || style.visibility === "collapse") return false;
      if (node === el && style.opacity && Number(style.opacity) === 0) return false;
    }
    node = node.parentElement;
  }
  if (hasLayout && typeof el.getClientRects === "function" && el.getClientRects().length === 0) {
    return false;
  }
  return true;
}

/** 关注按钮所在的区域（先按已知的头部容器，头部没渲染时才退回整页按钮） */
function scopeRoots(doc) {
  const roots = [];
  for (const selector of SCOPE_SELECTORS) {
    for (const root of doc.querySelectorAll(selector)) roots.push(root);
  }
  return roots.length ? roots.map((root, index) => ({ root, index })) : [{ root: doc, index: 0 }];
}

function collectTier(doc, tierIndex, ctx) {
  const tier = TIERS[tierIndex];
  const out = [];
  const seen = new Set();
  for (const { root, index } of scopeRoots(doc)) {
    tier.selectors.forEach((selector, weight) => {
      for (const el of root.querySelectorAll(selector)) {
        if (isExcluded(el)) continue;
        const clickable = resolveClickable(el);
        if (!clickable || seen.has(clickable)) continue;
        // 容器上可能套了一层，状态从命中的元素和真正要点的按钮上都读一遍
        const state = readElementState(el, tier.loose) ?? readElementState(clickable, tier.loose);
        if (!state && !tier.keepUnknown) continue;
        seen.add(clickable);
        out.push({
          element: clickable,
          state,
          tier: tierIndex,
          visible: isVisible(clickable, ctx),
          weight: tier.base - weight,
          scopeIndex: index,
        });
      }
    });
  }
  return out;
}

let lastCandidateKey = "";

/** 候选之间状态打架时打一行日志，方便对着控制台定位（同一组合只打一次） */
function reportAmbiguity(candidates, chosen) {
  if (candidates.length < 2) return;
  const labels = candidates.map((c) => `${c.state ?? "未知"}${c.visible ? "" : "(隐藏)"}`);
  if (new Set(labels).size < 2) return;
  const key = `${labels.join("|")}=>${chosen.state ?? "未知"}`;
  if (key === lastCandidateKey) return;
  lastCandidateKey = key;
  console.debug("[pure-live] 关注按钮候选状态不一致，已取可信的那个：", key);
}

/**
 * 从候选里挑一个
 *
 * 注意：本脚本自己把 `#HeaderLayout` 设成了 display:none，原生按钮在 DOM 里必然是「不可见」，
 * 所以可见性只能当同级别（同标记、同区域）候选之间的次级排序，不能拿来压过标记可靠程度，
 * 否则直播间里别处一个可见的「关注」按钮就能把真正的主播按钮顶掉。
 */
function pickControl(candidates) {
  if (!candidates.length) return null;
  const minTier = Math.min(...candidates.map((c) => c.tier));
  const pool = candidates
    .filter((c) => c.tier === minTier)
    .sort(
      (a, b) =>
        b.weight - a.weight ||
        a.scopeIndex - b.scopeIndex ||
        Number(b.visible) - Number(a.visible),
    );
  let best = pool[0];
  // 抖音会把「关注」和「已关注」同时渲染出来（只显示其中一个）。
  // 如果认出来的那个说「未关注」，但同一块区域里还有个按钮说「已关注」，以「已关注」为准：
  // 显示成已关注、点下去取关，总好过显示空心、点下去还是取关。
  if (best.state !== "followed") {
    const followedInScope = candidates.find(
      (c) => c.tier <= 1 && c.scopeIndex === best.scopeIndex && c.state === "followed",
    );
    if (followedInScope) best = followedInScope;
  }
  reportAmbiguity(candidates, best);
  // 文案读不出来的按钮不给结论（state 为 null），上层会保持原样
  return { element: best.element, state: best.state ?? null };
}

/**
 * 在页面里找原生关注按钮
 * @returns {{element: Element, state: "followed"|"unfollowed"|null}|null}
 */
export function findFollowControl(doc, { hasLayout = false } = {}) {
  if (!doc) return null;
  const ctx = { hasLayout };
  // 带 follow 标记的两层都收（很便宜）；都没有结果时才去扫全部 div/span（贵）
  const candidates = [...collectTier(doc, 0, ctx), ...collectTier(doc, 1, ctx)];
  if (!candidates.length) candidates.push(...collectTier(doc, 2, ctx));
  return pickControl(candidates);
}

const DEFAULT_GRACE_MS = 5000;
const CLICK_EVIDENCE_TTL = 10 * 60 * 1000;
const SNAPSHOT_EVIDENCE_TTL = 30 * 60 * 1000;

// 抖音关注成功后的提示文案（页面上真正发生过的证据，比按钮文案可靠）
const FOLLOW_OK_TEXT = "关注成功";
const UNFOLLOW_OK_TEXT = "取消关注成功";

export const douyinFollow = (() => {
  const supported = ref(false);
  const following = ref(false);
  // 关注失败 / 页面没响应时的说明，给按钮 title 用
  const lastError = ref("");
  let doc = null;
  let started = false;
  let observer = null;
  let lastSync = 0;
  let stopApi = null;
  let graceMs = DEFAULT_GRACE_MS;
  // 点过之后、还没拿到接口结果的时间窗
  let pendingUntil = 0;
  let awaitingClick = false;
  let gotApiResult = false;
  // 拿到过的确凿状态：{ following, anchor, until }，期间不信 DOM 文案（会被轮询刷旧）
  let evidence = null;
  // 点击前的状态，用来识别「点了但没变化」
  let beforeFollowing = false;
  // 有没有真实布局（jsdom 无布局，靠它决定要不要用尺寸判断可见性）
  let hasLayout = false;
  let layoutCheckedAt = 0;

  function layoutAvailable() {
    const now = Date.now();
    if (!hasLayout && now - layoutCheckedAt > 1000) {
      layoutCheckedAt = now;
      try {
        const rect = doc?.body?.getBoundingClientRect?.();
        hasLayout = Boolean(rect && (rect.width > 0 || rect.height > 0));
      } catch {
        hasLayout = false;
      }
    }
    return hasLayout;
  }

  function find() {
    return findFollowControl(doc, { hasLayout: layoutAvailable() });
  }

  function anchorKey() {
    const el = doc?.querySelector('[data-e2e="live-room-nickname"]');
    return normalizeText(el?.textContent);
  }

  /**
   * 证据是否还对得上当前直播间
   * 进房接口可能在主播名渲染出来之前就到了，这时先把主播名留空，等第一次读到再绑定
   */
  function evidenceValid() {
    if (!evidence) return false;
    if (Date.now() > evidence.until) {
      evidence = null;
      return false;
    }
    const key = anchorKey();
    if (!key) return true;
    if (!evidence.anchor) {
      // 进房接口通常比主播名渲染得早：允许第一次读到主播名时把它补上。
      // 点击证据不补——点的时候都读不到主播名，就别认房间了，宁可作废。
      if (!evidence.adopt) {
        evidence = null;
        return false;
      }
      evidence.anchor = key;
      return true;
    }
    if (evidence.anchor !== key) {
      evidence = null;
      return false;
    }
    return true;
  }

  /** 记录下来自接口 / 进房数据的结论 */
  function setEvidence(value) {
    evidence = {
      following: Boolean(value),
      anchor: anchorKey(),
      until: Date.now() + SNAPSHOT_EVIDENCE_TTL,
      // 进房数据可能早于主播名，等读到主播名再绑定
      adopt: true,
    };
    following.value = evidence.following;
  }

  /** 拿到点击成功的证据：以它为准，并压住被刷旧的按钮文案 */
  function confirmState(value) {
    awaitingClick = false;
    gotApiResult = true;
    pendingUntil = 0;
    lastError.value = "";
    evidence = {
      following: Boolean(value),
      anchor: anchorKey(),
      until: Date.now() + CLICK_EVIDENCE_TTL,
    };
    following.value = evidence.following;
  }

  /** 确认失败：退回页面真实状态，并把原因挂出来 */
  function failWith(message) {
    awaitingClick = false;
    gotApiResult = true;
    pendingUntil = 0;
    evidence = null;
    const found = find();
    if (found?.state) following.value = found.state === "followed";
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
    const found = find();
    supported.value = Boolean(found);
    const now = Date.now();
    // 刚点过关注：文案可能是「乐观更新 → 被轮询刷回」，等接口结果为准
    if (now < pendingUntil) return found;
    if (evidenceValid()) {
      following.value = evidence.following;
      return found;
    }
    const domState = found?.state;
    if (domState === "followed") following.value = true;
    else if (domState === "unfollowed") following.value = false;
    // 读不出状态（比如按钮上只有图标）就保持上一次的显示，别凭猜测把蓝心刷成空心
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

  /** 当前直播间 URL 里的那串数字（web_rid） */
  function currentRid() {
    try {
      const path = doc?.defaultView?.location?.pathname || "";
      return path.split("/").filter(Boolean).pop() || "";
    } catch {
      return "";
    }
  }

  /**
   * 收到进房接口里的关注关系
   * 这是「进入一个已关注的直播间」时唯一可靠的初始状态：
   * 页面上那两个按钮谁是隐藏的、文案有没有被刷旧，都不影响它。
   */
  function handleSnapshot(relation) {
    if (!doc || !relation) return;
    const value = isFollowingStatus(relation.followStatus);
    if (value === undefined) return;
    // 抖音会预加载别的直播间，那种数据的 web_rid 和当前地址对不上，直接丢掉。
    // 只在两边都是纯数字（同一个 id 体系）时才敢判「对不上」，避免 id 形式不同误杀。
    const rid = currentRid();
    if (
      rid &&
      relation.webRid &&
      /^\d+$/.test(rid) &&
      /^\d+$/.test(relation.webRid) &&
      rid !== relation.webRid
    )
      return;
    // 正在点 / 刚点完：以点击结果为准，别让进房时的旧数据把状态顶回去
    if (awaitingClick || Date.now() < pendingUntil) return;
    lastError.value = "";
    evidence = null;
    setEvidence(value);
    sync();
  }

  /**
   * 只挂接口旁听，不做任何 DOM 操作
   *
   * 进房接口在播放器挂载之前就发出去了，晚挂就永远拿不到「进房时是否已关注」这个真值，
   * 所以入口处要第一时间调用它，别等 waitForElement。
   */
  function watch(document) {
    const target = document || doc;
    if (!target || stopApi) return false;
    doc = doc || target;
    const win = target.defaultView;
    try {
      stopApi = watchFollowApi(win, { onResult: handleResult, onSnapshot: handleSnapshot });
    } catch (e) {
      console.error("[pure-live] 关注接口观测失败", e);
      return false;
    }
    return true;
  }

  function start(document, { grace = DEFAULT_GRACE_MS } = {}) {
    if (!document) return;
    watch(document);
    if (started) return;
    started = true;
    doc = document;
    graceMs = grace;
    hasLayout = false;
    layoutCheckedAt = 0;
    sync();
    const win = doc.defaultView;
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
    const found = find();
    if (!found) {
      sync();
      return false;
    }
    const win = doc.defaultView;
    awaitingClick = true;
    gotApiResult = false;
    // 以当前「显示的状态」为基准，接口返回和它一样就说明抖音没动
    const current = evidenceValid() ? evidence.following : found.state === "followed";
    beforeFollowing = current;
    // 新的一次点击优先，之前进房 / 接口的结论作废
    evidence = null;
    lastError.value = "";
    simulateClick(found.element, win);
    // 乐观更新，等接口结果覆盖
    following.value = !current;
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
    started = false;
    supported.value = false;
    following.value = false;
    lastError.value = "";
    pendingUntil = 0;
    awaitingClick = false;
    evidence = null;
    hasLayout = false;
    layoutCheckedAt = 0;
    lastCandidateKey = "";
  }

  return { supported, following, lastError, start, watch, toggle, stop, sync };
})();
