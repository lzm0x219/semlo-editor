import { Node } from "@tiptap/core";

import {
  decodeStoredAttachmentURL,
  encodeStoredAttachmentURL,
  needsStoredAttachmentURL,
  safeAttachmentURL,
} from "../shared/attachment-url";

/** Native media controls remain usable in both editing and read-only modes. */
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
          class: `semlo-editor-media semlo-editor-media-${kind}`,
        },
        [
          kind,
          {
            ...(src ? { src } : {}),
            controls: "",
            preload: "metadata",
            ...(kind === "video" ? { playsinline: "" } : {}),
            "aria-label": node.attrs.name || label,
          },
        ],
      ];
    },
    addNodeView() {
      return ({ editor, view, node: initial, getPos }) => {
        const doc = view.dom.ownerDocument;
        const dom = doc.createElement("div");
        dom.className = `semlo-editor-media-node semlo-editor-media-${kind}`;
        dom.contentEditable = "false";
        const player = doc.createElement(kind);
        player.controls = true;
        player.preload = "metadata";
        if (kind === "video") (player as HTMLVideoElement).playsInline = true;
        const remove = doc.createElement("button");
        remove.type = "button";
        remove.className = "semlo-editor-media-remove";
        remove.setAttribute("aria-label", `删除${label}`);
        remove.textContent = "×";
        dom.append(player, remove);
        let current = initial;
        const paint = () => {
          const src = safeAttachmentURL(current.attrs.src);
          if (src !== player.getAttribute("src")) {
            if (src) player.setAttribute("src", src);
            else player.removeAttribute("src");
          }
          player.setAttribute("aria-label", current.attrs.name || label);
          remove.hidden = !editor.isEditable;
        };
        remove.addEventListener("mousedown", (event) => event.preventDefault());
        remove.addEventListener("click", () => {
          if (!editor.isEditable) return;
          const pos = getPos();
          if (typeof pos !== "number") return;
          const node = view.state.doc.nodeAt(pos);
          if (!node || node.type !== current.type) return;
          view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize));
          view.focus();
        });
        const editableChanged = () => paint();
        view.dom.addEventListener("semlo-editor:editable", editableChanged);
        paint();
        return {
          dom,
          update(node) {
            if (node.type !== current.type) return false;
            current = node;
            paint();
            return true;
          },
          stopEvent(event) {
            return player.contains(event.target as globalThis.Node) || remove.contains(event.target as globalThis.Node);
          },
          ignoreMutation: () => true,
          destroy() {
            player.pause();
            view.dom.removeEventListener("semlo-editor:editable", editableChanged);
          },
        };
      };
    },
  });
}

export const Video = mediaNode("video");
export const Audio = mediaNode("audio");
