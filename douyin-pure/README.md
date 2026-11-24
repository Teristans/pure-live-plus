# 抖音网页版精简版 (douyin-pure)

一个油猴脚本：精简抖音网页版首页，去顶栏/左栏、过滤广告弹窗，搜索栏与频道菜单固定在左上角，智能把视频清晰度调到 1080，并保留播放控制条、设置、点赞、评论、作者头像等互动元素。

## 安装

把 `douyin-pure.user.js` 拖进 ScriptCat / Tampermonkey 即可，单文件免构建。

## 功能

| 需求 | 实现 |
|---|---|
| 去除顶栏、左侧栏 | 隐藏 `#douyin-header`、`#douyin-navigation`，内容区 `#douyin-right-container` 铺满整屏 |
| 过滤广告 | 隐藏登录引导弹窗、下载客户端弹窗/横幅、带广告标记的卡片、推广卡 |
| 保留互动元素 | 隐藏规则完全不碰 `.basePlayerContainer` 播放器内部，播放控制条、设置、点赞、评论、头像、收藏、分享原样保留 |
| **搜索栏 + 频道菜单移到左上角** | 两个悬浮条固定在 `left:16px`，搜索栏 `top:18px`、频道菜单 `top:62px`，半透明、鼠标移入变清晰 |
| **清晰度智能调到 1080** | 双保险写入 1080 档位 + 菜单按文本智能选档，详见下文 |
| 频道切换 | 导航「推荐/精选/关注/朋友」当前频道高亮（已移到左上角） |

## 清晰度智能 1080（v1.4.0 新增）

抖音网页版播放器通过 `sessionStorage["MANUAL_SWITCH"]` 读取手动清晰度档位。脚本采用双保险：

1. **写存储（主）**：把 1080P 档位对象 `{"gearName":"高清 1080P","qualityType":2,"gearClarity":"5",...}` 写入 `MANUAL_SWITCH`，并轮询保持约 21 秒，兼容播放器延迟读取与视频切换。此方式不依赖菜单 DOM，最稳。
2. **菜单选档（辅）**：若清晰度菜单 `[data-e2e="quality-selector"]` 可见，按**文本**智能选档——优先 1080；当前视频没有 1080 时选**不超过 1080 的最高档**（如 720P），跳过 2K/4K，兼顾画质与带宽。不依赖易变的 class。
3. **手动优先**：你用鼠标操作清晰度菜单后，脚本立即打标记并停止写入，本次会话不再干预你的选择。

> 关闭方式：把源码里的 `AUTO_QUALITY_1080` 改成 `false`。

## 频道切换说明（沿用 v1.3.0）

抖音是 SPA 且 class 高度哈希化。频道切换**不依赖猜测的 class**：按文本精确匹配「推荐/精选/关注/朋友」→ `data-e2e` 语义匹配 → 旧 class 兜底，找到后调用原生 `element.click()` 走抖音自身路由。打开首页自动进推荐流；手动点过频道后不再干预（改 `AUTO_RECOMMEND=false` 可关闭自动）。

## 排查

若清晰度或频道切换异常，打开抖音按 F12 → 控制台运行：

```js
DouyinPure.diagnose()
```

会打印 `channelCandidates`（频道入口）、`textCandidates`（页面文字候选）、`e2eSamples`（data-e2e 样本）、`quality`（清晰度状态：是否启用、手动标记、`MANUAL_SWITCH` 当前值、菜单最佳档位）。把输出截图发我即可精确修正。

## 开发

```bash
# 本脚本测试（34 项）
node --test douyin-pure/tests/pure.test.mjs

# 全量测试与构建（仓库根目录）
pnpm run test:quality
pnpm run test:huya
pnpm run test:douyin-pure
pnpm run build
pnpm run test:bundle
```

## 许可

GPL-3.0-or-later。保留原项目作者 ljezio 署名（本项目为其 pure-live 的衍生自用分支）。
