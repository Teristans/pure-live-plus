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
/*
 * 面板上「点一下执行一个动作」的按钮（不是开关，没有开/关两种颜色）。
 *
 * 外观规矩跟另外三个按钮一致：20×20、1024 视口、透明底、默认半透明、悬停变实，
 * 尺寸与底色由 ButtonGroup.vue 的 .button 提供（Vue 的作用域样式会落到子组件根节点），
 * 所以这里只管图标路径和颜色。
 */
defineProps({
  /** 悬停提示，同时作为无障碍标签 */
  title: { type: String, required: true },
  /**
   * 图标路径数组：一个图标由多段 path 拼成（如「下一个」= 三角 + 竖条）。
   * 统一用 evenodd 填充，这样「外框 + 内框」就能画出镂空的描边图形（如播放框）。
   */
  paths: { type: Array, required: true },
  color: { type: String, default: "#2C9EFF" },
});

const emit = defineEmits(["click"]);
</script>

<template>
  <button class="button" :title="title" :aria-label="title" @click="emit('click')">
    <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="20" height="20">
      <path v-for="(d, index) in paths" :key="index" :d="d" :fill="color" fill-rule="evenodd" />
    </svg>
  </button>
</template>
