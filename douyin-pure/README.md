# 抖音网页版精简版 (douyin-pure)

一个油猴脚本：精简抖音网页版首页，去顶栏/左栏、过滤广告弹窗，搜索栏移到左下角，并保留播放控制条、设置、点赞、评论、作者头像等互动元素。

## 安装

把 `douyin-pure.user.js` 拖进 ScriptCat / Tampermonkey 即可，单文件免构建。

## 功能

| 需求 | 实现 |
|---|---|
| 去除顶栏、左侧栏 | 隐藏 `#douyin-header`、`#douyin-navigation`，内容区 `#douyin-right-container` 铺满整屏 |
| 过滤广告 | 隐藏登录引导弹窗、下载客户端弹窗/横幅、带广告标记的卡片、推广卡 |
| 保留互动元素 | 隐藏规则完全不碰 `.basePlayerContainer` 播放器内部，播放控制条、设置、点赞、评论、头像、收藏、分享原样保留 |
| 搜索栏换位置 | 左下角悬浮半透明搜索框，回车跳转抖音官方搜索页，鼠标移入变清晰 |
| 频道切换 | 因左栏被隐藏，左下角提供「推荐/精选/关注/朋友」悬浮导航，当前频道高亮 |

## 频道切换为什么反复失效（v1.3.0 说明）

抖音网页版是 SPA 且 class 高度哈希化、频繁改版。早期版本用硬编码 class（`.tab-recommend`）或 URL 参数（`?recommend=1`）切换，一旦抖音改版就会失配，且抖音会把 `?recommend=1` 重写回精选页，导致「点推荐没效果」。

v1.3.0 改为**运行时自适应定位**，不再依赖猜测的 class：

1. **文本精确匹配**：按「推荐」「精选」等文字找原生入口（最稳，文字一般不会变）；
2. **`data-e2e` 语义匹配**：抖音相对稳定的测试属性；
3. **旧 class 兜底**：以上都不中时才尝试历史 class。

找到后调用**原生 `element.click()`** 触发抖音自身路由（比合成事件序列可靠得多），只有完全找不到入口时才回退 URL（并补齐 `is_from_mobile_home=1&recommend=1` 参数）。

打开首页时会自动进入推荐流；手动点过任一频道后脚本不再干预。若想保留「打开即精选」，把源码里的 `AUTO_RECOMMEND` 改成 `false`。

## 排查：切换仍失效怎么办

若更新后仍无法切换，请打开抖音页面按 F12 → 控制台，粘贴运行：

```js
DouyinPure.diagnose()
```

把输出的 `channelCandidates` / `textCandidates` / `e2eSamples` 截图发我。这份报告会列出页面上真实的候选元素（标签、class、data-e2e、文字），据此可以精确修正定位规则——改动都集中在 `CHANNELS` 数组和 `findChannelEntry()`，很好替换。

## 开发

```bash
# 运行本脚本测试（24 项）
node --test douyin-pure/tests/pure.test.mjs

# 全量测试与构建（在仓库根目录）
pnpm run test:quality
pnpm run test:huya
pnpm run test:douyin-pure
pnpm run build
pnpm run test:bundle
```

## 许可

GPL-3.0-or-later。保留原项目作者 ljezio 署名（本项目为其 pure-live 的衍生自用分支）。
