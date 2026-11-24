# 纯净直播（pure live）修改自用版

> 自用修改版：修复了「自动切换最高画质」失效问题，保留原作者信息与 GPL 许可。
> 本仓库：https://github.com/Teristans/pure-live-plus

## 仓库包含的脚本

两个互相独立的油猴脚本，分别发布各自的 Release，可同时安装（作用页面不重叠）。

| 脚本 | 用途 | 版本 | 一键安装 |
|---|---|---|---|
| 纯净直播（修改自用版） | 斗鱼 / 虎牙 / B站 / 抖音**直播**精简、自动最高画质 | v5.3.0（已合入 master，待发布） | [安装 v5.2.16](https://github.com/Teristans/pure-live-plus/releases/download/pure-live-v5.2.16/pure-live.user.js) |
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

验证：源码/成品测试共 53 项通过（新增抖音画质 7 项、抖音关注 7 项、斗鱼礼物 6 项），生产构建通过。

## 功能

**🤩移除一切花里胡哨的东西，只保留直播和弹幕**

- 自动网页全屏，双击全屏
- Enter 键弹出弹幕输入框
- 自动切换最高画质
- 一键关闭脚本

### 🦈斗鱼（douyu）

- 屏蔽所有送礼物信息（弹幕/聊天里的「送出 xxx」）
- 屏蔽礼物特效、礼物飘屏、礼物面板与礼物按钮
- 屏蔽福袋 / 红包 / 抽奖入口

### 🐯虎牙（huya）

- 自动关闭直播间贴片广告
- 去除扫码解锁清晰度限制

### 📺B站直播（bilibili）

### 🎶抖音直播（douyin）

- 进入直播间自动选最高画质（原画优先，按文字识别，不依赖哈希类名）
- 悬浮面板上有心形关注图标（空心红心=未关注，实心蓝心=已关注），点击即关注/取消关注，状态与页面实时同步

## 构建与测试

```bash
pnpm install
pnpm run build          # 构建用户脚本，产物在 dist/pure-live.user.js
pnpm run test:quality         # 斗鱼 / B站画质测试（14 项）
pnpm run test:huya            # 虎牙画质测试（13 项）
pnpm run test:bundle          # 成品脚本测试（6 项）
pnpm run test:douyin-quality  # 抖音画质测试（7 项）
pnpm run test:douyin-follow   # 抖音关注按钮测试（7 项）
pnpm run test:douyu-gift      # 斗鱼礼物/福袋屏蔽测试（6 项）
pnpm run test:all             # 以上全部
```

> 注意：`test:bundle` 依赖 `dist/pure-live.user.js`，需先执行 `pnpm run build`。

## 安装与使用

**纯净直播（本脚本）**

- 一键安装（当前已发布版本）：[pure-live.user.js v5.2.16](https://github.com/Teristans/pure-live-plus/releases/download/pure-live-v5.2.16/pure-live.user.js)
- v5.3.0（本次三项修复）已合入 `master`，尚未发布 Release：`pnpm install && pnpm build` 后导入 `dist/pure-live.user.js` 即可使用
- 发布 Release 后把上面两行换成 `pure-live-v5.3.0` 的下载地址
- 安装后请只启用一份脚本（原版或本修改版二选一），避免重复执行

**抖音网页版精简版**

- 一键安装：[douyin-pure.user.js v1.4.0](https://github.com/Teristans/pure-live-plus/releases/download/douyin-pure-v1.4.0/douyin-pure.user.js)
- 详细说明见 [douyin-pure/README.md](./douyin-pure/README.md)

两者互相独立，可同时安装。

## 发布状态

用户脚本元数据已指向本仓库，`@author ljezio` 与 GPL 许可按原作者声明完整保留：

- `@namespace` / `@homepage` / `@source`：`https://github.com/Teristans/pure-live-plus`
- `@name`：纯净直播（pure live）修改自用版
- `@version`：`5.3.0`
- `@license`：GPL-3.0-or-later

当前发布状态：

- [x] 已发布 Release：`pure-live-v5.2.16`（本脚本）、`douyin-pure-v1.4.0`（抖音脚本），下载入口已补入 README。
- [ ] `pure-live-v5.3.0` 待发布：`pnpm build` 后把 `dist/pure-live.user.js` 传到 tag `pure-live-v5.3.0` 的 Release，再把本文档里的安装链接改成新地址。
- [x] `LICENSE` 与原作者、修复贡献者署名完整保留。
- [x] `@version` 从 `5.2.16` 升到 `5.3.0`，作为本仓库的独立版本线。
