import type { NodeViewRendererProps } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { NodeView } from "@tiptap/pm/view";

import { safeAttachmentURL } from "../shared/attachment-url";

const playIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 11 7-11 7z" fill="currentColor"/></svg>';
const pauseIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" stroke="currentColor" stroke-width="4"/></svg>';
const closeIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
const downloadIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11m-4-4 4 4 4-4M5 19h14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function timeLabel(time: number): string {
  const seconds = Number.isFinite(time) && time > 0 ? Math.floor(time) : 0;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const tail = `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return hours ? `${hours}:${tail}` : tail;
}

function sizeLabel(size: unknown): string {
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) return "";
  const units = ["B", "kB", "MB", "GB", "TB"];
  const power = Math.max(0, Math.min(units.length - 1, Math.floor(Math.log10(size) / 3)));
  const amount = size / 1000 ** power;
  return `${Number(amount.toFixed(power && amount < 10 ? 1 : 0))} ${units[power]}`;
}

export function createAudioNodeView({ editor, view, node: initial, getPos }: NodeViewRendererProps): NodeView {
  const doc = view.dom.ownerDocument;
  const dom = doc.createElement("div");
  dom.className = "semlo-editor-media-node semlo-editor-media-audio semlo-editor-audio-player";
  dom.contentEditable = "false";
  const toggle = doc.createElement("button");
  toggle.type = "button";
  toggle.className = "semlo-editor-audio-toggle";
  const body = doc.createElement("div");
  body.className = "semlo-editor-audio-body";
  const caption = doc.createElement("div");
  caption.className = "semlo-editor-audio-caption";
  const name = doc.createElement("span");
  name.className = "semlo-editor-audio-name";
  const size = doc.createElement("span");
  size.className = "semlo-editor-audio-size";
  caption.append(name, size);
  const controls = doc.createElement("div");
  controls.className = "semlo-editor-audio-controls";
  const elapsed = doc.createElement("span");
  elapsed.className = "semlo-editor-audio-time";
  elapsed.setAttribute("aria-hidden", "true");
  const progress = doc.createElement("input");
  progress.type = "range";
  progress.className = "semlo-editor-audio-progress";
  progress.min = "0";
  progress.step = "0.01";
  progress.setAttribute("aria-label", "音频播放进度");
  const total = elapsed.cloneNode() as HTMLSpanElement;
  const rateWrapper = doc.createElement("div");
  rateWrapper.className = "semlo-editor-audio-rate-wrapper";
  const rate = doc.createElement("select");
  rate.className = "semlo-editor-audio-rate";
  rate.setAttribute("aria-label", "音频播放速度");
  for (const value of [2, 1.5, 1.25, 1, 0.75, 0.5]) {
    const option = doc.createElement("option");
    option.value = String(value);
    option.textContent = `${Number.isInteger(value) ? value.toFixed(1) : value}X`;
    rate.append(option);
  }
  const rateDisplay = doc.createElement("span");
  rateDisplay.className = "semlo-editor-audio-rate-display";
  rateDisplay.setAttribute("aria-hidden", "true");
  rateWrapper.append(rate, rateDisplay);
  const status = doc.createElement("span");
  status.className = "semlo-editor-audio-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.hidden = true;
  controls.append(elapsed, progress, total, rateWrapper);
  body.append(caption, controls, status);
  const toolbar = doc.createElement("div");
  toolbar.className = "semlo-editor-audio-toolbar";
  const download = doc.createElement("a");
  download.className = "semlo-editor-audio-download";
  download.setAttribute("aria-label", "下载音频");
  download.title = "下载音频";
  download.target = "_blank";
  download.rel = "noopener noreferrer";
  download.innerHTML = downloadIcon;
  const downloadLabel = doc.createElement("label");
  downloadLabel.className = "semlo-editor-audio-download-label";
  downloadLabel.title = "控制阅读界面的下载入口；文件权限由接入应用管理。";
  const allowDownload = doc.createElement("input");
  allowDownload.type = "checkbox";
  allowDownload.setAttribute("aria-label", "阅读页可下载");
  const downloadText = doc.createElement("span");
  downloadText.textContent = "阅读页可下载";
  downloadLabel.append(allowDownload, downloadText);
  toolbar.append(download, downloadLabel);
  const remove = doc.createElement("button");
  remove.type = "button";
  remove.className = "semlo-editor-media-remove";
  remove.setAttribute("aria-label", "删除音频");
  remove.innerHTML = closeIcon;
  dom.append(toggle, body, toolbar, remove);

  let node = initial;
  let destroyed = false;
  let revision = 0;
  let pending = false;
  let rateChosen = false;
  let player: HTMLAudioElement;
  let source: string | null = null;
  let releasePlayer: (() => void) | undefined;

  const position = () => {
    if (destroyed || editor.isDestroyed || editor.view !== view || !dom.isConnected) return undefined;
    const pos = getPos();
    return typeof pos === "number" && view.state.doc.nodeAt(pos)?.eq(node) ? pos : undefined;
  };
  const message = (text: string) => {
    status.textContent = text;
    status.hidden = !text;
  };
  const paintPlayback = () => {
    const duration = Number.isFinite(player.duration) && player.duration > 0 ? player.duration : 0;
    const current = Number.isFinite(player.currentTime) ? Math.max(0, player.currentTime) : 0;
    const playing = pending || (!player.paused && !player.ended);
    toggle.setAttribute("aria-label", playing ? "暂停音频" : "播放音频");
    toggle.innerHTML = playing ? pauseIcon : playIcon;
    toggle.disabled = source === null;
    elapsed.textContent = timeLabel(current);
    total.textContent = timeLabel(duration);
    progress.max = String(duration);
    progress.value = String(Math.min(current, duration));
    progress.style.setProperty("--semlo-audio-progress", `${duration ? Math.min(current / duration, 1) * 100 : 0}%`);
    progress.disabled = !duration || source === null;
    progress.setAttribute("aria-valuetext", `${timeLabel(current)} / ${timeLabel(duration)}`);
    rate.value = String(player.playbackRate);
    rateDisplay.textContent = rateChosen
      ? `${Number.isInteger(player.playbackRate) ? player.playbackRate.toFixed(1) : player.playbackRate}X`
      : "倍速";
  };
  const replacePlayer = (url: string | null) => {
    // 换源和整体替换使用新媒体元素，旧 Promise 与旧媒体事件无法接管新的播放状态。
    revision += 1;
    pending = false;
    rateChosen = false;
    releasePlayer?.();
    source = url;
    const media = doc.createElement("audio");
    player = media;
    media.preload = "metadata";
    media.hidden = true;
    media.setAttribute("aria-hidden", "true");
    const sync = () => {
      if (destroyed || player !== media || position() === undefined) return;
      if (!media.paused || media.ended) pending = false;
      paintPlayback();
    };
    const failed = () => {
      if (destroyed || player !== media || position() === undefined) return;
      revision += 1;
      pending = false;
      message("音频无法播放，请检查文件或网络后重试。");
      paintPlayback();
    };
    const events = ["loadedmetadata", "durationchange", "timeupdate", "seeked", "ratechange", "play", "pause", "ended"];
    for (const event of events) media.addEventListener(event, sync);
    media.addEventListener("error", failed);
    releasePlayer = () => {
      for (const event of events) media.removeEventListener(event, sync);
      media.removeEventListener("error", failed);
      media.pause();
      media.removeAttribute("src");
      media.load();
      media.remove();
    };
    dom.prepend(media);
    if (url) media.src = url;
    message(url ? "" : "音频地址无效，无法播放。");
    paintPlayback();
  };
  const paint = () => {
    const url = safeAttachmentURL(node.attrs.src);
    if (!player || source !== url) replacePlayer(url);
    name.textContent = typeof node.attrs.name === "string" && node.attrs.name ? node.attrs.name : "音频";
    name.title = name.textContent;
    size.textContent = sizeLabel(node.attrs.size);
    size.hidden = !size.textContent;
    allowDownload.checked = node.attrs.allowDownload === true;
    downloadLabel.hidden = !editor.isEditable;
    toolbar.hidden = !editor.isEditable && !allowDownload.checked;
    if (url) {
      download.setAttribute("href", url);
      download.download = name.textContent;
      download.removeAttribute("aria-disabled");
      download.removeAttribute("tabindex");
    } else {
      download.removeAttribute("href");
      download.setAttribute("aria-disabled", "true");
      download.tabIndex = -1;
    }
    player.setAttribute("aria-label", name.textContent);
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
      const playing = media.play();
      void Promise.resolve(playing).then(
        () => {
          if (!valid()) {
            // 用户已暂停时终止迟到的旧播放；后续的新播放请求不受旧 Promise 干扰。
            if (player !== media || destroyed || (!pending && media.paused)) media.pause();
            return;
          }
          pending = false;
          paintPlayback();
        },
        () => {
          if (!valid()) return;
          pending = false;
          message("音频无法播放，请检查文件或网络后重试。");
          paintPlayback();
        },
      );
    } catch {
      if (!valid()) return;
      pending = false;
      message("音频无法播放，请检查文件或网络后重试。");
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
      message("暂时无法跳转，请等待音频加载后重试。");
    }
  };
  const changeRate = () => {
    if (position() === undefined) return;
    const value = Number(rate.value);
    if (![2, 1.5, 1.25, 1, 0.75, 0.5].includes(value)) return;
    rateChosen = true;
    player.playbackRate = value;
    paintPlayback();
  };
  const changeDownload = () => {
    if (!editor.isEditable) return;
    const pos = position();
    if (pos === undefined) return;
    const transaction = closeHistory(
      view.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        allowDownload: allowDownload.checked,
      }),
    );
    view.dispatch(transaction);
    if (!destroyed && !editor.isDestroyed && editor.view === view) paint();
  };
  const preventSelection = (event: MouseEvent) => event.preventDefault();
  const removeAudio = () => {
    if (!editor.isEditable) return;
    const pos = position();
    if (pos === undefined) return;
    view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize));
    if (!editor.isDestroyed && editor.view === view) view.focus();
  };
  const documentReplacing = () => replacePlayer(safeAttachmentURL(node.attrs.src));
  toggle.addEventListener("click", togglePlayback);
  progress.addEventListener("input", seek);
  rate.addEventListener("change", changeRate);
  allowDownload.addEventListener("change", changeDownload);
  remove.addEventListener("mousedown", preventSelection);
  remove.addEventListener("click", removeAudio);
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
      releasePlayer?.();
      toggle.removeEventListener("click", togglePlayback);
      progress.removeEventListener("input", seek);
      rate.removeEventListener("change", changeRate);
      allowDownload.removeEventListener("change", changeDownload);
      remove.removeEventListener("mousedown", preventSelection);
      remove.removeEventListener("click", removeAudio);
      view.dom.removeEventListener("semlo-editor:editable", paint);
      view.dom.removeEventListener("semlo-editor:document-replace", documentReplacing);
    },
  };
}
