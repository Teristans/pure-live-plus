# 纯净直播（pure live）修改自用版

> 自用修改版：修复了「自动切换最高画质」失效问题，保留原作者信息与 GPL 许可。
> 本仓库：https://github.com/Teristans/pure-live-plus

## 仓库包含的脚本

两个互相独立的油猴脚本，分别发布各自的 Release，可同时安装（作用页面不重叠）。

| 脚本 | 用途 | 版本 | 一键安装 |
|---|---|---|---|
| 纯净直播（修改自用版） | 斗鱼 / 虎牙 / B站 / 抖音**直播**精简、自动最高画质 | v5.2.16 | [安装](https://github.com/Teristans/pure-live-plus/releases/download/pure-live-v5.2.16/pure-live.user.js) |
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

验证：源码测试 27 项 + 成品脚本测试 6 项，共 33 项通过；生产构建通过。上游实播验证中，斗鱼 213116、B站 544618 由 1280×720 升为 1920×1080，虎牙多房间解锁至 2560×1440。

## 功能

**🤩移除一切花里胡哨的东西，只保留直播和弹幕**

- 自动网页全屏，双击全屏
- Enter 键弹出弹幕输入框
- 自动切换最高画质
- 一键关闭脚本

### 🦈斗鱼（douyu）

### 🐯虎牙（huya）

- 自动关闭直播间贴片广告
- 去除扫码解锁清晰度限制

### 📺B站直播（bilibili）

### 🎶抖音直播（douyin）

## 构建与测试

```bash
pnpm install
pnpm run build          # 构建用户脚本，产物在 dist/pure-live.user.js
pnpm run test:quality   # 斗鱼 / B站画质测试（14 项）
pnpm run test:huya      # 虎牙画质测试（13 项）
pnpm run test:bundle    # 成品脚本测试（6 项）
```

> 注意：`test:bundle` 依赖 `dist/pure-live.user.js`，需先执行 `pnpm run build`。

## 安装与使用

**纯净直播（本脚本）**

- 一键安装：[pure-live.user.js v5.2.16](https://github.com/Teristans/pure-live-plus/releases/download/pure-live-v5.2.16/pure-live.user.js)
- 或自行构建后导入 `dist/pure-live.user.js`
- 安装后请只启用一份脚本（原版或本修改版二选一），避免重复执行

**抖音网页版精简版**

- 一键安装：[douyin-pure.user.js v1.4.0](https://github.com/Teristans/pure-live-plus/releases/download/douyin-pure-v1.4.0/douyin-pure.user.js)
- 详细说明见 [douyin-pure/README.md](./douyin-pure/README.md)

两者互相独立，可同时安装。

## 发布状态

用户脚本元数据已指向本仓库，`@author ljezio` 与 GPL 许可按原作者声明完整保留：

- `@namespace` / `@homepage` / `@source`：`https://github.com/Teristans/pure-live-plus`
- `@name`：纯净直播（pure live）修改自用版
- `@version`：`5.2.16`
- `@license`：GPL-3.0-or-later

当前发布状态：

- [x] 已发布两个独立 Release：`pure-live-v5.2.16`（本脚本）、`douyin-pure-v1.4.0`（抖音脚本），下载入口已补入 README。
- [x] `LICENSE` 与原作者、修复贡献者署名完整保留。
- [ ] `@version` 当前 `5.2.16`，与上游修复版一致；后续如作为独立版本线，可自行改为 v6.x。
