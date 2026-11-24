# 纯净直播（pure live）修改自用版

> 自用修改版：修复了「自动切换最高画质」失效问题，保留原作者信息与 GPL 许可。
> 本仓库：https://github.com/Teristans/pure-live-plus

## 仓库包含的脚本

两个互相独立的油猴脚本，分别发布各自的 Release，可同时安装（作用页面不重叠）。

| 脚本 | 用途 | 版本 | 一键安装 |
|---|---|---|---|
| 纯净直播（修改自用版） | 斗鱼 / 虎牙 / B站 / 抖音**直播**精简、自动最高画质 | v5.3.6 | [安装](https://github.com/Teristans/pure-live-plus/releases/download/pure-live-v5.3.6/pure-live.user.js) |
| [抖音网页版精简版](./douyin-pure/README.md) | 抖音**网页版视频**精简、清晰度智能 1080、悬浮菜单在左上角 | v1.4.0 | [安装](https://github.com/Teristans/pure-live-plus/releases/download/douyin-pure-v1.4.0/douyin-pure.user.js) |

Release 页：https://github.com/Teristans/pure-live-plus/releases

## 作者与来源

本版本基于 **[ljezio](https://github.com/ljezio)** 开发的 **[pure-live](https://github.com/ljezio/pure-live)**，并合入了社区贡献的画质兼容修复。原作者已声明可自由 fork 自用修改。

- **原作者：ljezio**。界面、多平台支持及基础功能来自原项目。
  - [原项目与源代码](https://github.com/ljezio/pure-live) · [原作者的 ScriptCat 脚本](https://scriptcat.org/zh-CN/script-show-page/4481)
- **画质修复来源：yt0575**（上游 PR #4，版本 v5.2.16）。修复虎牙高画质解锁、播放器延迟初始化，以及斗鱼和 B 站默认最高可用画质的兼容问题。
- 许可证：**GPL-3.0-or-later**，保留原作者及修复贡献者的署名与版权信息。

## 本版本修改内容

- 脚本显示名称改为「纯净直播（pure live）修改自用版」。
- 修复「自动切换最高画质」失效：
  - **斗鱼 / B站**：进入直播间后默认选择原生菜单中最高可用画质，主动展开延迟加载的画质菜单，兼容晚于 10 秒完成初始化的播放器；自动选择成功后停止干预，保留用户后续手动选择；关闭开关时不操作菜单。
  - **虎牙**：按 `iSortValue` 选择最高画质，解锁扫码限制（status=4），保留原画 `iBitRate=0`，通过 `unsafeWindow` 使用页面自身 jQuery；画质处理提前启动，避免播放器容器延迟创建时中断。
- 构建配置固定 `vite` / `vitest` 版本，恢复正常生产构建。

### v5.3.6

**斗鱼改为先让斗鱼自己屏蔽：自动勾选播放器设置里的 7 个开关**（`src/site/douyu/gift.js`）

按文案删 DOM 总有漏网——送礼播报的句式在变，礼物特效又是 canvas / 异步插入，过滤赶不上。
斗鱼播放器其实自带一组屏蔽开关（控制栏「弹幕设置」面板里），勾上之后由斗鱼自己在**数据层**过滤，
比事后删节点彻底得多。现在脚本进房就把它们全勾上：

| 开关 | 挡掉的东西 |
|---|---|
| 屏蔽全部礼物 | 送礼信息、福袋口令播报 |
| 屏蔽消息通知 | 系统 / 福袋中奖通知 |
| 屏蔽视频广播 | 全站广播 |
| 屏蔽小礼物 | 免费小礼物刷屏 |
| 屏蔽进场特效 | 礼物特效的主要来源 |
| 屏蔽礼物音效 | 礼物音效 |
| 屏蔽弹幕皮肤 | 贵族 / 礼物弹幕皮肤 |

实现上的几个要点：

- **不用打开面板**：这 7 项即使面板没展开也在 DOM 里，直接点 `label` 就生效，
  用户看不到面板闪动（实测确认）。
- **只能按文案定位**：类名是哈希（`shieldSettingItem-4b3b84`、`checked-13adb7`），
  所以先用 `label` 文案精确匹配，再要求所在行有勾选框 `svg`。
- **状态判断要当心**：未勾是 `unchecked-b96102`，已勾是 `checked-13adb7`，
  而 `unchecked` 里也含 "checked" 子串，必须先排除 `unchecked` 再认 `checked`，否则会把没勾的当成勾上的。
- **幂等 + 冷却**：已勾的跳过；刚点过的 15 秒内不再点。勾不上时（斗鱼拒绝、面板重渲染）
  宁可这次没勾上，也不能反复点——反复点会把它点成未勾，比不勾更糟。
- 设置存在 `localStorage["chat-shield-config"]`（`allGift / message / videoBroadcast / smallgift /
  userEnter / audioGift / barrageSkin`），跨房间持久，所以日常进房基本是「读一遍状态、0 次点击」。
- 按文案删 DOM 的逻辑原样保留，作为兜底：斗鱼改版把开关改名或挪走时，仍能按文案过滤。

验证：headless Edge 注入构建产物到真实直播间（`www.douyu.com/9999`），注入前 7 项全未勾，
6 秒后 7 项全部 `checked-13adb7`、`localStorage` 里对应字段全部置 1、弹幕区无送礼/福袋残留，
控制台输出 `[pure-live] 斗鱼播放器屏蔽项已勾选 7`（勾齐后定时器收工，不会一直跑）。
测试新增 5 项（自动勾选、已勾不重复点、冷却期不反复点、`unchecked` 误判、面板未渲染），
斗鱼礼物模块共 11 项，全量 82 项通过，lint 0 error。

### v5.3.5

**抖音悬浮面板新增两个推荐流按钮**（`src/site/douyin/feed.js` + `IconActionButton.vue`）

脚本的 `restyle.css` 把 `#douyin-navigation` 整个隐藏了，连带把导航栏里那个指向
`live.douyin.com`（直播推荐流首页）的「直播」入口也藏掉了，进了直播间就回不去推荐流。
这一版把入口补到悬浮面板上：

- **下一个推荐直播间**（向下箭头）：在当前页面内切到推荐流的下一个直播间，不整页刷新。
  三级降级保证按下去一定有反应——
  1. 竖滑容器 `#_douyin_live_scroll_container_` 里能往下滚时，先派发一次合成 `wheel`（抖音的竖滑是自己接管滚轮，派发事件比改 `scrollTop` 更接近真实操作）；
  2. 500ms 后地址没变（抖音没响应），补一次原生 `scrollBy` 滚一屏；
  3. 再过 900ms 还是没换房，退回推荐流首页——对用户来说同样等于「换一个直播间」。
  容器里只有当前这一个房间（抖音没预加载下一个）时直接走第 3 步，不空等。
  走了哪条路径会打到控制台：`[pure-live] 切下一个推荐直播间：wheel / navigate`。
- **回推荐流首页**（四宫格）：跳转 `https://live.douyin.com/?from_nav=1`，
  就是被隐藏的那个「直播」导航入口。
- 两个按钮只在 `live.douyin.com` 显示，外观与面板上另外三个按钮同一套：20×20、透明底、
  默认半透明、悬停变实、间距 8px。图标抽成通用的 `IconActionButton.vue`。

顺带修掉一个一直存在的对齐问题：`.button > svg { display: block }` 是父组件的 scoped 样式，
**穿不进子组件内部**，导致 `FollowButton` 的图标比直接写在 `ButtonGroup` 里的按钮高 1px。
改用 `.button :deep(svg)` 后五个按钮实测全部 20×20。

验证：headless Edge 注入构建产物，在真实直播间里确认 5 个按钮全部渲染、尺寸 20×20、间距 8px；
匿名环境竖滑容器里没有下一个房间，点「下一个」正确降级为跳转 `live.douyin.com/?from_nav=1`。
测试新增 `tests/douyin-feed.test.mjs` 7 项（三条降级路径、切房成功不再降级、跳转地址），
全量 77 项通过，lint 0 error。

### v5.3.4

**真正修好「进入已关注的直播间显示空心」**（`src/site/douyin/follow.js` + `follow-api.js`）

v5.3.3 的做法是「旁听页面自己的进房请求」，实测不成立：脚本按 `@run-at document-idle` 执行，
等它跑起来时页面的进房请求早就发完了，一条也旁听不到。这一版把方向反过来——**自己问接口**：

- `requestRoomFollowStatus()` 直接 GET `/webcast/room/web/enter/?...&web_rid=<URL 末尾的号>`，
  从 `data.user.follow_info.follow_status` 读「我 → 当前主播」的关系。
  实测该接口免签名，带页面 cookie 直接请求即可返回完整数据；浏览器里跑通（进房后 1 次请求）。
- **只认 `data.user`**（当前主播，已核对昵称与页面一致），绝不递归乱找：
  `data.similar_rooms[*].room.owner` 里同样带 `follow_info`，那是推荐直播间的主播，
  把它们当成当前主播就会永远读到 0——这很可能就是 v5.3.3 仍然显示空心的原因之一。
- 进房即拉取；抖音是 SPA，切换直播间时按 URL 里的号判断并重新拉取一次；
  请求失败（风控 / 网络）重试一次，响应成功但没有该字段则不再重试。
- 拿到结果后 30 分钟内以接口为准，主播名变化（换房间）自动作废；
  点击后仍以 `/webcast/user/relation/update/` 的返回为准，优先级高于进房数据。

浏览器端到端验证（headless Edge + 真实直播间 + 拦截进房响应）：原生按钮文案是「关注」、
接口返回 `follow_status=1` 时，心形变成实心蓝（`aria-label=已关注`、`fill=#2C9EFF`）；
`follow_status=0` 时为空心。测试增至 24 项，全量 70 项通过。

**已由真实账号实测通过**（2026-11-24）：进入已关注主播的直播间显示实心蓝心，点击可正常关注 /
取消关注，进房初始状态不再回退。

### v5.3.3

**修复「进入已关注的直播间显示空心红心，点一下却提示取消关注成功」**（`src/site/douyin/follow.js` + `follow-api.js`）

- 根因：已关注状态完全靠页面文案判断。抖音会把「关注 / 已关注」两个按钮同时渲染出来、只显示其中一个，或者文案还没跟上真实关系；脚本按选择器取到的是「关注」，于是显示空心，而这一点点下去的其实是取关，抖音回「取消关注成功」。
- 新增**进房接口真值**：旁听 `/webcast/room/web/enter/` 的响应，从 `owner.follow_info.follow_status` 读出「我 → 主播」的真实关系（0 未关注 / 1 已关注 / 2 互相关注）。这是进入直播间那一刻唯一不受 DOM 影响的依据。
  - 这个旁听在等播放器之前就挂上——进房接口比播放器挂载早得多，挂晚了就永远拿不到。
  - 抖音会预加载别的直播间，这类数据的 `web_rid` 和当前地址对不上，直接丢弃，不会串房间。
- 原生按钮的挑选改成分层 + 去重：先认 `data-e2e` / class 上的 follow 标记，同级候选里优先可见的那个；同一块头部里一个说「关注」一个说「已关注」时，以「已关注」为准。
- 状态读不出来（按钮只剩图标、文案为空）时保持上一次的显示，不再凭猜测把蓝心刷成空心。

### v5.3.2

**修复抖音关注图标「点完变实心蓝、一秒后又弹回空心」**（`src/site/douyin/follow.js` + 新增 `src/site/douyin/follow-api.js`）

- 根因：原实现只按原生按钮文案判断状态。抖音这个按钮点下去会先挂成「已关注」，随后直播间信息轮询把文案刷回「关注」，脚本跟着来回跳，看起来就像点击没生效。
- 状态改为以**关注接口的真实返回**为准：新增接口观测器，只旁听不改请求，拿到 `/webcast/user/relation/update/` 的 `status_code` 与 `data.follow_status`（0 未关注 / 1 已关注 / 2 互相关注 / 3 对方关注了我）；抖音的接口层走 XHR，`fetch` 与 `XHR` 两条路都做了观测。
- 没拦到接口时，退一步用页面弹出的「关注成功 / 取消关注成功」提示作为证据。拿到证据后，图标在有效期内不再被刷旧的按钮文案带偏；换直播间（主播名变化）或再次点击，自动作废旧证据。
- 失败不再装作没事：抖音返回错误、要求人工验证、或干脆没有响应，图标会退回真实状态，失败原因写进悬停提示，并点亮图标提示这次没成功。
- 点击后的乐观状态最多保持 5 秒，等不到任何证据就退回真实状态。
- 兼容 `responseType` 为 `json` 的 XHR；响应体读不出来（如 `arraybuffer`）时不下结论，不会把「读不到」误判成「关注失败」。

### v5.3.0

1. **抖音自动最高画质重写**（`src/site/douyin/quality.js`）
   - 原实现只在脚本启动后 10 秒内、对 `.douyin-player-controls-right` 做一次 MutationObserver，播放器控件晚挂载就彻底失效；并且固定点 `[data-e2e="quality-selector"] > :nth-child(2)`，抖音调整选项顺序后就选错。
   - 现在改为轮询 + 校验：播放器/控件区没出来就继续等（最长 120 秒），按**文字**（原画 > 蓝光 > 超清 > 高清 > 标清 > 流畅 > 智能/自动）挑最高的一个，不依赖哈希类名和选项顺序；菜单用 hover 和 click 两种方式尝试打开；选完校验按钮文案是否已变成目标画质，成功即停止干预，失败最多重试 5 次后放弃。
   - 抖音入口 `src/site/douyin/index.js` 改为等待播放器挂载（最长 8 秒），避免首页/非直播页误判。

2. **斗鱼屏蔽所有送礼物信息、特效、福袋**
   - `src/site/douyu/restyle.css`：隐藏 `#js-player-effect`（覆盖全屏的礼物特效层）、礼物飘屏/横幅、礼物面板与入口（`ToolbarGiftArea`、`GiftSendSelector`、`GiftHall` 等），以及福袋/红包/抽奖入口；播放器、工具栏、聊天区内任何 `class` 含 `gift` 的部件一并隐藏。
   - `src/site/douyu/gift.js`：类名改了也能兜住的补充逻辑——按文案找「福袋 / 礼物 / 抽奖」等入口并隐藏整块按钮；在弹幕与聊天区过滤「送出 / 赠送 / 送给 / 开通贵族 / 福袋 / 抽奖」这类消息（新消息由 MutationObserver 实时过滤）。普通聊天不受影响。

3. **抖音直播间新增关注按钮**（`src/site/douyin/follow.js` + `FollowButton.vue`）
   - 外观与悬浮面板上另外两个按钮完全一致：20×20 图标、透明底、默认半透明、悬停变实，同一列纵向排列（样式只在 `ButtonGroup.vue` 定义一份）；未关注为空心红心，已关注为实心蓝心，沿用面板「蓝=开 / 红=关」的语义。
   - 不改接口、不碰风控：脚本隐藏了顶部信息栏，但原生「关注」按钮仍在 DOM 里，悬浮菜单里的关注图标直接点击它，效果与手点完全一致，关注状态（关注 / 已关注 / 互相关注）从原生按钮文案实时同步。
   - 只认完整文案，`关注 8` 这种粉丝数统计、导航栏指向「关注页」的入口、脚本自己的 UI 都会被排除，不会误点。
   - 找不到原生按钮时按钮不显示，不会留一个点不动的死按钮。

验证：源码/成品测试共 59 项通过（抖音画质 7 项、抖音关注 13 项、斗鱼礼物 6 项，其余为既有斗鱼/B站/虎牙/成品脚本用例），生产构建通过，lint 0 error。

## 功能

**🤩移除一切花里胡哨的东西，只保留直播和弹幕**

- 自动网页全屏，双击全屏
- Enter 键弹出弹幕输入框
- 自动切换最高画质
- 一键关闭脚本

### 🦈斗鱼（douyu）

- 自动勾选播放器「弹幕设置」里的 7 个屏蔽开关（屏蔽全部礼物 / 消息通知 / 视频广播 / 小礼物 / 进场特效 / 礼物音效 / 弹幕皮肤），由斗鱼自己过滤，特效和福袋口令一并覆盖
- 屏蔽所有送礼物信息（弹幕/聊天里的「送出 xxx」）
- 屏蔽礼物特效、礼物飘屏、礼物面板与礼物按钮
- 屏蔽福袋 / 红包 / 抽奖入口

### 🐯虎牙（huya）

- 自动关闭直播间贴片广告
- 去除扫码解锁清晰度限制

### 📺B站直播（bilibili）

### 🎶抖音直播（douyin）

- 进入直播间自动选最高画质（原画优先，按文字识别，不依赖哈希类名）
- 悬浮面板上有心形关注图标（空心红心=未关注，实心蓝心=已关注），点击即关注/取消关注；初始状态取自进房接口（`follow_info.follow_status`），点击结果以关注接口返回为准，失败原因显示在悬停提示里
- 悬浮面板上有「下一个推荐直播间」（向下箭头）和「回推荐流首页」（四宫格）两个按钮：前者在当前页面内切到推荐流的下一个直播间，后者跳转 `live.douyin.com`（补回被脚本隐藏掉的「直播」导航入口）

## 构建与测试

```bash
pnpm install
pnpm run build          # 构建用户脚本，产物在 dist/pure-live.user.js
pnpm run test:quality         # 斗鱼 / B站画质测试（14 项）
pnpm run test:huya            # 虎牙画质测试（13 项）
pnpm run test:bundle          # 成品脚本测试（6 项）
pnpm run test:douyin-quality  # 抖音画质测试（7 项）
pnpm run test:douyin-follow   # 抖音关注按钮测试（24 项）
pnpm run test:douyin-feed     # 抖音推荐流按钮测试（7 项）
pnpm run test:douyu-gift      # 斗鱼礼物/福袋屏蔽测试（11 项）
pnpm run test:all             # 以上全部
```

> 注意：`test:bundle` 依赖 `dist/pure-live.user.js`，需先执行 `pnpm run build`。

## 安装与使用

**纯净直播（本脚本）**

- 一键安装：[pure-live.user.js v5.3.6](https://github.com/Teristans/pure-live-plus/releases/download/pure-live-v5.3.6/pure-live.user.js)
- Release 说明：[pure-live-v5.3.6](https://github.com/Teristans/pure-live-plus/releases/tag/pure-live-v5.3.6)
- 或自行构建：`pnpm install && pnpm build` 后导入 `dist/pure-live.user.js`
- 安装后请只启用一份脚本（原版或本修改版二选一），避免重复执行

**抖音网页版精简版**

- 一键安装：[douyin-pure.user.js v1.4.0](https://github.com/Teristans/pure-live-plus/releases/download/douyin-pure-v1.4.0/douyin-pure.user.js)
- 详细说明见 [douyin-pure/README.md](./douyin-pure/README.md)

两者互相独立，可同时安装。

## 发布状态

用户脚本元数据已指向本仓库，`@author ljezio` 与 GPL 许可按原作者声明完整保留：

- `@namespace` / `@homepage` / `@source`：`https://github.com/Teristans/pure-live-plus`
- `@name`：纯净直播（pure live）修改自用版
- `@version`：`5.3.6`
- `@license`：GPL-3.0-or-later

当前发布状态：

- [x] 已发布 Release：`pure-live-v5.2.16`（本脚本）、`douyin-pure-v1.4.0`（抖音脚本），下载入口已补入 README。
- [x] `pure-live-v5.3.0` 已发布：tag `pure-live-v5.3.0` + Release 资产 `pure-live.user.js`（55.2 kB）。
- [x] `pure-live-v5.3.2` 已发布：修复抖音关注状态回弹。
- [x] `pure-live-v5.3.3` 已发布：首次尝试用进房接口纠正初始状态（未解决，见 v5.3.4）。
- [x] `pure-live-v5.3.4` 已发布：改为脚本自己请求进房接口取「我→主播」的 follow_status，修好初始状态。
- [x] `pure-live-v5.3.5` 已发布：抖音面板新增「下一个推荐直播间」「回推荐流首页」两个按钮；修复子组件图标比同级按钮高 1px 的对齐问题。
- [x] `pure-live-v5.3.6` 已发布：斗鱼改为自动勾选播放器设置里的 7 个屏蔽开关，礼物特效 / 福袋口令由斗鱼自己在数据层过滤，按文案删 DOM 降为兜底。
- [x] `LICENSE` 与原作者、修复贡献者署名完整保留。
- [x] `@version` 从 `5.2.16` 升到 `5.3.6`（`5.3.0` 为首次发布的功能版本），作为本仓库的独立版本线。
