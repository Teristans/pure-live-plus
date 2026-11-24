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
    class="button follow"
    :class="{ followed: following }"
    :title="following ? '已关注，点击取消关注' : '关注主播'"
    @click="toggle"
  >
    {{ following ? "已关注" : "关注" }}
  </button>
</template>

<style scoped>
.follow {
  display: block;
  width: 44px;
  height: 24px;
  padding: 0;
  border: none;
  margin-bottom: 8px;
  border-radius: 4px;
  background-color: #fe2c55;
  color: #fff;
  font-size: 12px;
  line-height: 24px;
  cursor: pointer;
  opacity: 0.9;
  transition: opacity 0.3s ease;
}

.follow:hover {
  opacity: 1;
}

.follow.followed {
  background-color: #4a4a4a;
}
</style>
