import { Node } from "@tiptap/core";

import {
  decodeStoredAttachmentURL,
  encodeStoredAttachmentURL,
  needsStoredAttachmentURL,
  safeAttachmentURL,
} from "../shared/attachment-url";

export const Attachment = Node.create({
  name: "semloEditorAttachment",
  priority: 1100,
  group: "inline",
  inline: true,
  atom: true,
  draggable: true,
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
