/*
 * pure-live, a script that makes live webpages pure.
 * Copyright (C) 2025-present ljezio
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
import { INPUT_MAX } from "@/common/constants";
import { waitForElement } from "@/common/dom";
import { swt } from "@/common/utils";
import mountVue from "@/components";
import { autoHighestImage, dbClick, sendBulletChatFn } from "@/site/douyin/core";
import { douyinFollow } from "@/site/douyin/follow";

const PLAYER_SELECTOR = '#_douyin_live_scroll_container_, [data-e2e="live-player"]';

export default async function pureDouyin() {
  // 进房接口比播放器挂载早得多，先挂上旁听，才拿得到「进房时是否已关注」这个真值
  if (swt.script.isOn()) douyinFollow.watch(document);
  // 播放器可能晚于脚本挂载，等一会儿；超时说明不是直播页面
  const player = await waitForElement(document, PLAYER_SELECTOR, { timeoutMs: 8000 });
  if (!player) return;
  mountVue(document.body, INPUT_MAX.DOUYIN, sendBulletChatFn);
  if (swt.script.isOn()) {
    import("@/site/douyin/restyle.css").catch((e) => console.error(e));
    autoHighestImage();
    douyinFollow.start(document);
    dbClick(player);
  }
}
