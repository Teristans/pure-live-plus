<!--
  - pure-live, a script that makes live webpages pure.
  - Copyright (C) 2025-present ljezio and contributors
  -
  - This program is free software: you can redistribute it and/or modify it under the
  - terms of the GNU General Public License as published by the Free Software Foundation,
  - either version 3 of the License, or (at your option) any later version.
  -
  - This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY;
  - without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
  - See the GNU General Public License for more details.
  -
  - You should have received a copy of the GNU General Public License along with this program.
  - If not, see <https://www.gnu.org/licenses/>.
  -->
<script setup>
import { douyinFollow } from "@/site/douyin/follow";

/*
 * 外观与面板上另外两个图标按钮完全一致：
 * 20×20 的 1024 视口 SVG、透明底、默认半透明、悬停变实。
 * 样式统一由 ButtonGroup.vue 的 .button 提供（Vue 的作用域样式会作用到子组件根节点），
 * 本文件只负责图标形状与两种状态的颜色，所以不要再往这里加尺寸/底色相关的 CSS。
 * 颜色沿用面板的语义：蓝 = 已开启（已关注），红 = 未开启（未关注）。
 */
const ON_COLOR = "#2C9EFF";
const OFF_COLOR = "#D94A3C";

// 心形：Material Icons 的 favorite 路径按 1024/24 换算，与相邻图标同一坐标系
const HEART_PATH =
  "M 512 910.93 l -61.87 -56.32 C 230.4 655.36 85.33 523.95 85.33 362.67 " +
  "85.33 231.25 188.59 128 320 128 c 74.24 0 145.49 34.56 192 89.17 " +
  "C 558.51 162.56 629.76 128 704 128 835.41 128 938.67 231.25 938.67 362.67 " +
  "c 0 161.28 -145.07 292.69 -364.8 492.37 L 512 910.93 z";

// 只有抖音直播间拿到了原生关注按钮，这个按钮才会出现
const supported = douyinFollow.supported;
const following = douyinFollow.following;

function toggle() {
  douyinFollow.toggle();
}
</script>

<template>
  <button
    v-if="supported"
    class="button"
    :title="following ? '取消关注' : '关注主播'"
    :aria-label="following ? '已关注' : '关注'"
    :aria-pressed="following ? 'true' : 'false'"
    @click="toggle"
  >
    <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="20" height="20">
      <!--
        未关注：空心红；已关注：实心蓝。
        心形原路径只占 1024 框的 83%，比相邻的电源/显示器图标显小，
        放大 1.12 倍并绕中心对齐，三个图标的视觉体量才一致。
      -->
      <path
        :d="HEART_PATH"
        transform="translate(512 519.5) scale(1.12) translate(-512 -519.5)"
        :fill="following ? ON_COLOR : 'none'"
        :stroke="following ? 'none' : OFF_COLOR"
        stroke-width="58"
        stroke-linejoin="round"
      />
    </svg>
  </button>
</template>
