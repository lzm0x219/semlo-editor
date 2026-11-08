import type { NodeViewRendererProps } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { NodeView } from "@tiptap/pm/view";

import { safeAttachmentURL } from "../shared/attachment-url";

const icons = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 4 12 8-12 8z" fill="currentColor"/></svg>',
  pause:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" stroke="currentColor" stroke-width="3"/></svg>',
  volume:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Zm12-1a6 6 0 0 1 0 8m2-11a10 10 0 0 1 0 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  muted:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Zm12 1 5 5m0-5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  pip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18v14H3zM12 12h7v5h-7z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  fullscreen:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5m6 0h5v5M4 15v5h5m6 0h5v-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  close:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  download:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11m-4-4 4 4 4-4M5 19h14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function timeLabel(time: number): string {
  const seconds = Number.isFinite(time) && time > 0 ? Math.floor(time) : 0;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const tail = `${hours ? String(minutes).padStart(2, "0") : minutes}:${String(seconds % 60).padStart(2, "0")}`;
  return hours ? `${hours}:${tail}` : tail;
}

export function createVideoNodeView({ editor, view, node: initial, getPos }: NodeViewRendererProps): NodeView {
  const doc = view.dom.ownerDocument;
  const dom = doc.createElement("div");
  dom.className = "semlo-editor-media-node semlo-editor-media-video semlo-editor-video-player";
  dom.contentEditable = "false";
  const button = (className: string, label: string, icon: string) => {
    const element = doc.createElement("button");
    element.type = "button";
    element.className = className;
    element.setAttribute("aria-label", label);
    element.title = label;
    element.innerHTML = icon;
    return element;
  };
  const controls = doc.createElement("div");
  controls.className = "semlo-editor-video-controls";
  const progress = doc.createElement("input");
  progress.type = "range";
  progress.className = "semlo-editor-video-progress";
  progress.min = "0";
  progress.step = "0.01";
  progress.setAttribute("aria-label", "视频播放进度");
  const progressWrap = doc.createElement("div");
  progressWrap.className = "semlo-editor-video-progress-wrap";
  const previewTime = doc.createElement("span");
  previewTime.className = "semlo-editor-video-progress-preview";
  previewTime.setAttribute("aria-hidden", "true");
  previewTime.hidden = true;
  progressWrap.append(progress, previewTime);
  const row = doc.createElement("div");
  row.className = "semlo-editor-video-row";
  const toggle = button("semlo-editor-video-toggle", "播放视频", icons.play);
  const time = doc.createElement("span");
  time.className = "semlo-editor-video-time";
  time.setAttribute("aria-hidden", "true");
  const spacer = doc.createElement("span");
  spacer.className = "semlo-editor-video-spacer";
  const rateWrap = doc.createElement("span");
  rateWrap.className = "semlo-editor-video-rate";
  const rateText = doc.createElement("span");
  rateText.setAttribute("aria-hidden", "true");
  const rate = doc.createElement("select");
  rate.setAttribute("aria-label", "视频播放速度");
  for (const value of [2, 1.5, 1.25, 1, 0.75, 0.5]) {
    const option = doc.createElement("option");
    option.value = String(value);
    option.textContent = `${Number.isInteger(value) ? value.toFixed(1) : value}X`;
    rate.append(option);
  }
  rateWrap.append(rateText, rate);
  const volumeWrap = doc.createElement("span");
  volumeWrap.className = "semlo-editor-video-volume";
  const volume = doc.createElement("input");
  volume.type = "range";
  volume.min = "0";
  volume.max = "1";
  volume.step = "0.01";
  volume.className = "semlo-editor-video-volume-slider";
  volume.setAttribute("aria-label", "视频音量");
  volume.setAttribute("aria-orientation", "vertical");
  const mute = button("semlo-editor-video-mute", "静音", icons.volume);
  volumeWrap.append(mute, volume);
  const pip = button("semlo-editor-video-pip", "画中画", icons.pip);
  const fullscreen = button("semlo-editor-video-fullscreen", "全屏", icons.fullscreen);
  const status = doc.createElement("span");
  status.className = "semlo-editor-video-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.hidden = true;
  const remove = button("semlo-editor-media-remove", "删除视频", icons.close);
  const download = doc.createElement("a");
  download.className = "semlo-editor-video-download";
  download.setAttribute("aria-label", "下载视频");
  download.title = "下载视频";
  download.target = "_blank";
  download.rel = "noopener noreferrer";
  download.innerHTML = icons.download;
  row.append(toggle, time, spacer, rateWrap, volumeWrap, pip, fullscreen);
  controls.append(status, progressWrap, row);
  dom.append(controls, download, remove);

  let node = initial;
  let destroyed = false;
  let revision = 0;
  let pending = false;
  let source: string | null = null;
  let player: HTMLVideoElement;
  let releasePlayer: (() => void) | undefined;
  let lastVolume = 1;
  let fullscreenWanted = false;
  let pipWanted = false;

  const position = () => {
    if (destroyed || editor.isDestroyed || editor.view !== view || !dom.isConnected) return undefined;
    const pos = getPos();
    return typeof pos === "number" && view.state.doc.nodeAt(pos)?.eq(node) ? pos : undefined;
  };
  const message = (text: string) => {
    status.textContent = text;
    status.hidden = !text;
  };
  const label = (element: HTMLButtonElement, value: string) => {
    element.setAttribute("aria-label", value);
    element.title = value;
  };
  const paintPlayback = () => {
    const duration = Number.isFinite(player.duration) && player.duration > 0 ? player.duration : 0;
    const current = Number.isFinite(player.currentTime) ? Math.max(0, player.currentTime) : 0;
    const playing = pending || (!player.paused && !player.ended);
    label(toggle, playing ? "暂停视频" : "播放视频");
    toggle.innerHTML = playing ? icons.pause : icons.play;
    toggle.disabled = source === null;
    time.textContent = `${timeLabel(current)} / ${timeLabel(duration)}`;
    progress.max = String(duration);
    progress.value = String(Math.min(current, duration));
    progress.style.setProperty("--semlo-video-progress", `${duration ? Math.min(current / duration, 1) * 100 : 0}%`);
    progress.disabled = !duration || source === null;
    progress.setAttribute("aria-valuetext", `${timeLabel(current)} / ${timeLabel(duration)}`);
    rate.value = String(player.playbackRate);
    rateText.textContent = player.playbackRate === 1 ? "倍速" : `${player.playbackRate}X`;
    rate.disabled = source === null;
    const muted = player.muted || player.volume === 0;
    label(mute, muted ? "取消静音" : "静音");
    mute.innerHTML = muted ? icons.muted : icons.volume;
    mute.disabled = source === null;
    volume.value = String(player.muted ? 0 : player.volume);
    volume.disabled = source === null;
    volume.setAttribute("aria-valuetext", `${Math.round(Number(volume.value) * 100)}%`);
    pip.disabled =
      source === null || !doc.pictureInPictureEnabled || typeof player.requestPictureInPicture !== "function";
    label(pip, doc.pictureInPictureElement === player ? "退出画中画" : "画中画");
    fullscreen.disabled = source === null || typeof dom.requestFullscreen !== "function";
    label(fullscreen, doc.fullscreenElement === dom ? "退出全屏" : "全屏");
  };
  const leaveFullscreen = () => {
    fullscreenWanted = false;
    if (doc.fullscreenElement === dom) void doc.exitFullscreen().catch(() => {});
  };
  const replacePlayer = (url: string | null) => {
    // 为新文档或新地址创建媒体元素，旧事件和未完成的播放请求不能接管新视图。
    revision += 1;
    pending = false;
    previewTime.hidden = true;
    pipWanted = false;
    leaveFullscreen();
    releasePlayer?.();
    source = url;
    lastVolume = 1;
    const media = doc.createElement("video");
    player = media;
    media.preload = "metadata";
    media.playsInline = true;
    const sync = () => {
      if (destroyed || player !== media || position() === undefined) return;
      if (!media.paused || media.ended) pending = false;
      paintPlayback();
    };
    const failed = () => {
      if (destroyed || player !== media || position() === undefined) return;
      revision += 1;
      pending = false;
      message("视频无法播放，请检查文件或网络后重试。");
      paintPlayback();
    };
    const events = [
      "loadedmetadata",
      "durationchange",
      "timeupdate",
      "seeked",
      "ratechange",
      "volumechange",
      "play",
      "pause",
      "ended",
      "enterpictureinpicture",
      "leavepictureinpicture",
    ];
    for (const event of events) media.addEventListener(event, sync);
    media.addEventListener("error", failed);
    releasePlayer = () => {
      for (const event of events) media.removeEventListener(event, sync);
      media.removeEventListener("error", failed);
      if (doc.pictureInPictureElement === media) void doc.exitPictureInPicture().catch(() => {});
      media.pause();
      media.removeAttribute("src");
      media.load();
      media.remove();
    };
    dom.prepend(media);
    if (url) media.src = url;
    message(url ? "" : "视频地址无效，无法播放。");
    paintPlayback();
  };
  const paint = () => {
    const url = safeAttachmentURL(node.attrs.src);
    if (!player || source !== url) replacePlayer(url);
    player.setAttribute(
      "aria-label",
      typeof node.attrs.name === "string" && node.attrs.name ? node.attrs.name : "视频",
    );
    download.hidden = !editor.isEditable || !url;
    if (url) {
      download.setAttribute("href", url);
      download.download = typeof node.attrs.name === "string" && node.attrs.name ? node.attrs.name : "视频";
    } else download.removeAttribute("href");
    remove.hidden = !editor.isEditable;
  };
  const togglePlayback = () => {
    if (position() === undefined || source === null) return;
    const media = player;
    if (pending || (!media.paused && !media.ended)) {
      revision += 1;
      pending = false;
      media.pause();
      paintPlayback();
      return;
    }
    const attempt = ++revision;
    pending = true;
    message("");
    paintPlayback();
    const valid = () => !destroyed && player === media && revision === attempt && position() !== undefined;
    try {
      if (media.error) media.load();
      if (media.ended) media.currentTime = 0;
      void Promise.resolve(media.play()).then(
        () => {
          if (!valid()) {
            if (player !== media || destroyed || (!pending && media.paused)) media.pause();
            return;
          }
          pending = false;
          paintPlayback();
        },
        () => {
          if (!valid()) return;
          pending = false;
          message("视频无法播放，请检查文件或网络后重试。");
          paintPlayback();
        },
      );
    } catch {
      if (!valid()) return;
      pending = false;
      message("视频无法播放，请检查文件或网络后重试。");
      paintPlayback();
    }
  };
  const seek = () => {
    if (position() === undefined || progress.disabled) return;
    const value = Number(progress.value);
    if (!Number.isFinite(value) || !Number.isFinite(player.duration)) return;
    try {
      player.currentTime = Math.max(0, Math.min(value, player.duration));
      paintPlayback();
    } catch {
      message("暂时无法跳转，请等待视频加载后重试。");
    }
  };
  const previewProgress = (event: PointerEvent) => {
    const duration = player.duration;
    const rect = progress.getBoundingClientRect();
    if (progress.disabled || !Number.isFinite(duration) || duration <= 0 || rect.width <= 0) return;
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    previewTime.style.setProperty("--semlo-video-preview-position", `${fraction * 100}%`);
    previewTime.textContent = timeLabel(fraction * duration);
    previewTime.hidden = false;
  };
  const hideProgressPreview = () => {
    previewTime.hidden = true;
  };
  const endTouchPreview = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") hideProgressPreview();
  };
  const changeRate = () => {
    if (position() === undefined) return;
    const value = Number(rate.value);
    if (![2, 1.5, 1.25, 1, 0.75, 0.5].includes(value)) return;
    player.playbackRate = value;
    paintPlayback();
  };
  const changeVolume = () => {
    if (position() === undefined) return;
    const value = Number(volume.value);
    if (!Number.isFinite(value) || value < 0 || value > 1) return;
    if (value > 0) lastVolume = value;
    player.volume = value;
    player.muted = value === 0;
    paintPlayback();
  };
  const toggleMute = () => {
    if (position() === undefined || source === null) return;
    if (player.muted || player.volume === 0) {
      if (player.volume === 0) player.volume = lastVolume;
      player.muted = false;
    } else {
      lastVolume = player.volume;
      player.muted = true;
    }
    paintPlayback();
  };
  const togglePictureInPicture = () => {
    if (position() === undefined || pip.disabled) return;
    const media = player;
    pipWanted = doc.pictureInPictureElement !== media;
    message("");
    const failed = () => {
      if (!destroyed && player === media && position() !== undefined) message("无法切换画中画，请检查浏览器支持。");
    };
    try {
      const request = pipWanted ? media.requestPictureInPicture() : doc.exitPictureInPicture();
      void request.then(() => {
        if ((!pipWanted || destroyed || player !== media) && doc.pictureInPictureElement === media) {
          void doc.exitPictureInPicture().catch(() => {});
        }
        if (!destroyed && player === media && position() !== undefined) paintPlayback();
      }, failed);
    } catch {
      failed();
    }
  };
  const toggleFullscreen = () => {
    if (position() === undefined || fullscreen.disabled) return;
    fullscreenWanted = doc.fullscreenElement !== dom;
    message("");
    const failed = () => {
      if (!destroyed && position() !== undefined) message("无法切换全屏，请检查浏览器支持。");
    };
    try {
      const request = fullscreenWanted ? dom.requestFullscreen() : doc.exitFullscreen();
      void request.then(() => {
        if ((!fullscreenWanted || destroyed) && doc.fullscreenElement === dom)
          void doc.exitFullscreen().catch(() => {});
        if (!destroyed && position() !== undefined) paintPlayback();
      }, failed);
    } catch {
      failed();
    }
  };
  const fullscreenChanged = () => {
    if (doc.fullscreenElement !== dom) fullscreenWanted = false;
    if (!destroyed && position() !== undefined) paintPlayback();
  };
  const preventSelection = (event: MouseEvent) => event.preventDefault();
  const removeVideo = () => {
    if (!editor.isEditable) return;
    const pos = position();
    if (pos === undefined) return;
    view.dispatch(closeHistory(view.state.tr).delete(pos, pos + node.nodeSize));
    if (!editor.isDestroyed && editor.view === view) {
      view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
      if (!editor.isDestroyed && editor.view === view) view.focus();
    }
  };
  const documentReplacing = () => replacePlayer(safeAttachmentURL(node.attrs.src));
  toggle.addEventListener("click", togglePlayback);
  progress.addEventListener("input", seek);
  progress.addEventListener("pointermove", previewProgress);
  progress.addEventListener("pointerleave", hideProgressPreview);
  progress.addEventListener("pointerup", endTouchPreview);
  progress.addEventListener("pointercancel", hideProgressPreview);
  rate.addEventListener("change", changeRate);
  volume.addEventListener("input", changeVolume);
  mute.addEventListener("click", toggleMute);
  pip.addEventListener("click", togglePictureInPicture);
  fullscreen.addEventListener("click", toggleFullscreen);
  remove.addEventListener("mousedown", preventSelection);
  remove.addEventListener("click", removeVideo);
  doc.addEventListener("fullscreenchange", fullscreenChanged);
  view.dom.addEventListener("semlo-editor:editable", paint);
  view.dom.addEventListener("semlo-editor:document-replace", documentReplacing);
  paint();
  return {
    dom,
    update(next) {
      if (next.type !== node.type) return false;
      node = next;
      paint();
      return true;
    },
    stopEvent: (event) => dom.contains(event.target as globalThis.Node),
    ignoreMutation: () => true,
    destroy() {
      destroyed = true;
      revision += 1;
      pending = false;
      pipWanted = false;
      leaveFullscreen();
      releasePlayer?.();
      toggle.removeEventListener("click", togglePlayback);
      progress.removeEventListener("input", seek);
      progress.removeEventListener("pointermove", previewProgress);
      progress.removeEventListener("pointerleave", hideProgressPreview);
      progress.removeEventListener("pointerup", endTouchPreview);
      progress.removeEventListener("pointercancel", hideProgressPreview);
      rate.removeEventListener("change", changeRate);
      volume.removeEventListener("input", changeVolume);
      mute.removeEventListener("click", toggleMute);
      pip.removeEventListener("click", togglePictureInPicture);
      fullscreen.removeEventListener("click", toggleFullscreen);
      remove.removeEventListener("mousedown", preventSelection);
      remove.removeEventListener("click", removeVideo);
      doc.removeEventListener("fullscreenchange", fullscreenChanged);
      view.dom.removeEventListener("semlo-editor:editable", paint);
      view.dom.removeEventListener("semlo-editor:document-replace", documentReplacing);
    },
  };
}
