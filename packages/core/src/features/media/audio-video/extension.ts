import { Node } from "@tiptap/core";

import {
  decodeStoredAttachmentURL,
  encodeStoredAttachmentURL,
  needsStoredAttachmentURL,
  safeAttachmentURL,
} from "../shared/attachment-url";
import { createAudioNodeView } from "./audio-view";
import { createVideoNodeView } from "./video-view";

function validateDownloadPreference(value: unknown): void {
  if (value !== null && typeof value !== "boolean") throw new Error("音频下载设置无效");
}

/** 导出保留原生媒体标记；定制控件只属于节点视图。 */
function mediaNode(kind: "video" | "audio") {
  const type = kind === "video" ? "semloEditorVideo" : "semloEditorAudio";
  const label = kind === "video" ? "视频" : "音频";
  return Node.create({
    name: type,
    group: "block",
    atom: true,
    draggable: true,
    selectable: true,
    addAttributes() {
      return {
        src: {
          default: "",
          rendered: false,
          parseHTML: (el) => {
            const original = el.getAttribute("data-semlo-editor-original-src");
            return original === null ? (el.getAttribute("data-src") ?? "") : decodeStoredAttachmentURL(original);
          },
        },
        name: { default: "", rendered: false, parseHTML: (el) => el.getAttribute("data-name") ?? "" },
        size: { default: 0, rendered: false, parseHTML: (el) => Number(el.getAttribute("data-size")) || 0 },
        mimeType: { default: "", rendered: false, parseHTML: (el) => el.getAttribute("data-mime") ?? "" },
        ...(kind === "audio"
          ? {
              allowDownload: {
                default: null,
                rendered: false,
                parseHTML: (el: HTMLElement) => {
                  const value = el.getAttribute("data-semlo-editor-allow-download");
                  if (value === null) return null;
                  if (value === "true") return true;
                  if (value === "false") return false;
                  throw new Error("音频下载设置无效");
                },
                validate: validateDownloadPreference,
              },
            }
          : {}),
      };
    },
    parseHTML() {
      return [
        {
          tag: `div[data-semlo-editor-media="${kind}"]`,
          getAttrs: (element: HTMLElement) => {
            const original = element.getAttribute("data-semlo-editor-original-src");
            return original !== null && decodeStoredAttachmentURL(original) === null ? { src: null } : {};
          },
        },
      ];
    },
    renderText({ node }) {
      return node.attrs.name || `[${label}]`;
    },
    renderHTML({ node }) {
      const src = safeAttachmentURL(node.attrs.src);
      return [
        "div",
        {
          "data-semlo-editor-media": kind,
          "data-src": src ?? "",
          ...(needsStoredAttachmentURL(node.attrs.src, src)
            ? { "data-semlo-editor-original-src": encodeStoredAttachmentURL(node.attrs.src) }
            : {}),
          "data-name": node.attrs.name,
          "data-size": node.attrs.size,
          "data-mime": node.attrs.mimeType,
          ...(kind === "audio" && node.attrs.allowDownload !== null
            ? { "data-semlo-editor-allow-download": String(node.attrs.allowDownload) }
            : {}),
          class: `semlo-editor-media semlo-editor-media-${kind}`,
        },
        [
          kind,
          {
            ...(src ? { src } : {}),
            controls: "",
            ...(kind === "audio" && node.attrs.allowDownload === false ? { controlslist: "nodownload" } : {}),
            preload: "metadata",
            ...(kind === "video" ? { playsinline: "" } : {}),
            "aria-label": node.attrs.name || label,
          },
        ],
      ];
    },
    addNodeView() {
      return kind === "audio" ? createAudioNodeView : createVideoNodeView;
    },
  });
}

export const Video = mediaNode("video");
export const Audio = mediaNode("audio");
