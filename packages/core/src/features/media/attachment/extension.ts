import { Node } from "@tiptap/core";

import {
  decodeStoredAttachmentURL,
  encodeStoredAttachmentURL,
  needsStoredAttachmentURL,
  safeAttachmentURL,
} from "../shared/attachment-url";
import { presentationHTML, readPresentationHTML, validatePresentationValue } from "./presentation";
import type { AttachmentOptions } from "./preview";
import { createAttachmentView } from "./view";

function validateDownloadPreference(value: unknown): void {
  if (value !== null && typeof value !== "boolean") throw new Error("附件下载设置无效");
}

export const Attachment = Node.create<AttachmentOptions>({
  name: "semloEditorAttachment",
  priority: 1100,
  group: "inline",
  inline: true,
  atom: true,
  draggable: true,
  addOptions() {
    return { getPreviewResolver: () => undefined, getPreviewOwner: () => undefined, onError: () => {} };
  },
  addNodeView() {
    return (props) => createAttachmentView(props, this.options);
  },
  addAttributes() {
    return {
      href: {
        default: "",
        rendered: false,
        parseHTML: (el) => {
          const original = el.getAttribute("data-semlo-editor-original-href");
          return original === null ? (el.getAttribute("href") ?? "") : decodeStoredAttachmentURL(original);
        },
      },
      name: { default: "", rendered: false, parseHTML: (el) => el.getAttribute("data-name") ?? el.textContent ?? "" },
      size: { default: 0, rendered: false, parseHTML: (el) => Number(el.getAttribute("data-size")) || 0 },
      mimeType: { default: "", rendered: false, parseHTML: (el) => el.getAttribute("data-mime") ?? "" },
      displayMode: {
        default: null,
        rendered: false,
        parseHTML: (el) => readPresentationHTML(el, "mode"),
        validate: validatePresentationValue,
      },
      previewHeight: {
        default: null,
        rendered: false,
        parseHTML: (el) => readPresentationHTML(el, "height"),
        validate: validatePresentationValue,
      },
      allowDownload: {
        default: null,
        rendered: false,
        parseHTML: (el) => {
          const value = el.getAttribute("data-semlo-editor-attachment-allow-download");
          if (value === null) return null;
          if (value === "true") return true;
          if (value === "false") return false;
          throw new Error("附件下载设置无效");
        },
        validate: validateDownloadPreference,
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: "a[data-semlo-editor-attachment]",
        priority: 100,
        getAttrs: (element: HTMLElement) => {
          const original = element.getAttribute("data-semlo-editor-original-href");
          return original !== null && decodeStoredAttachmentURL(original) === null ? { href: null } : {};
        },
      },
    ];
  },
  renderText({ node }) {
    return node.attrs.name || "附件";
  },
  renderHTML({ node }) {
    const href = safeAttachmentURL(node.attrs.href);
    return [
      "a",
      {
        "data-semlo-editor-attachment": "",
        "data-name": node.attrs.name,
        "data-size": node.attrs.size,
        "data-mime": node.attrs.mimeType,
        ...presentationHTML(node.attrs),
        ...(node.attrs.allowDownload !== null
          ? { "data-semlo-editor-attachment-allow-download": String(node.attrs.allowDownload) }
          : {}),
        ...(needsStoredAttachmentURL(node.attrs.href, href)
          ? { "data-semlo-editor-original-href": encodeStoredAttachmentURL(node.attrs.href) }
          : {}),
        class: "semlo-editor-attachment",
        ...(href ? { href, target: "_blank", rel: "noopener noreferrer" } : {}),
      },
      node.attrs.name || "附件",
    ];
  },
});
