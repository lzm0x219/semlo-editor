import type { NodeViewRenderer } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { DOMSerializer } from "@tiptap/pm/model";
import { NodeSelection, TextSelection, type Transaction } from "@tiptap/pm/state";

import { rotateImageCropRect, type ImageCropRect } from "../shared/crop";
import { safeImageLinkURL } from "../shared/image-link";
import { openGalleryLightbox } from "../shared/lightbox";
import {
  fullImageCrop,
  imageCrop,
  imageCropClip,
  imageRotation,
  imageTransform,
  turned,
  type ImageRotation,
} from "../shared/transform";
import {
  type Corner,
  type ImageAlign,
  imageStyle,
  imageAlign,
  imageCaption,
  imageHref,
  corners,
  dimension,
} from "./attributes";
import { createImageCaptionControl } from "./caption-control";
import { createImageCropControl } from "./crop-control";
import { createImageLinkControl } from "./link-control";
import { createImageSizeControl } from "./size-control";

export function createImageNodeView(): NodeViewRenderer {
  return ({ editor, view, node: initial, getPos }) => {
    const doc = view.dom.ownerDocument;
    const win = doc.defaultView;
    const dom = doc.createElement("span");
    dom.className = "semlo-editor-image-node";
    dom.contentEditable = "false";
    const media = doc.createElement("span");
    media.className = "semlo-editor-image-media";
    const frame = doc.createElement("div");
    frame.className = "semlo-editor-image-frame";
    const image = doc.createElement("img");
    image.draggable = true;
    const imageError = doc.createElement("span");
    imageError.className = "semlo-editor-image-error";
    imageError.setAttribute("role", "img");
    imageError.setAttribute("aria-label", "图片加载失败");
    imageError.hidden = true;
    imageError.innerHTML =
      '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 4h14v12H3zM5 13l3-3 2 2 2-2 3 3M7 7h.01M3 3l14 14"/></svg><span>图片加载失败</span>';
    const link = doc.createElement("a");
    link.className = "semlo-editor-image-link";
    link.addEventListener("click", (event) => {
      if (editor.isEditable || !safeImageLinkURL(current.attrs.semloEditorImageHref)) event.preventDefault();
    });
    // Establish the editor's DOM selection before ProseMirror selects an
    // image at the start of an unfocused document. Otherwise a delayed
    // browser selectionchange can move the selection into the next text.
    const selectImage = (event: PointerEvent) => {
      if (!editor.isEditable || event.button !== 0) return;
      if (!view.hasFocus()) view.focus();
      if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
      const pos = getPos();
      if (typeof pos !== "number" || view.state.doc.nodeAt(pos) !== current) return;
      const selection = view.state.selection;
      if (selection instanceof NodeSelection && selection.from === pos) return;
      // ProseMirror can interpret a click as a double-click even after the
      // keyboard moved the selection elsewhere; select the image anew.
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)).setMeta("pointer", true));
    };
    image.addEventListener("pointerdown", selectImage);
    imageError.addEventListener("pointerdown", (event) => {
      if (editor.isEditable && event.button === 0) event.preventDefault();
      selectImage(event);
    });
    frame.append(image, imageError, link);
    const controls = doc.createElement("div");
    controls.className = "semlo-editor-image-controls";
    controls.contentEditable = "false";
    const toolbar = doc.createElement("div");
    toolbar.className = "semlo-editor-image-toolbar";
    const preview = doc.createElement("button");
    preview.type = "button";
    preview.className = "semlo-editor-image-action";
    preview.setAttribute("aria-label", "预览图片");
    preview.title = "预览图片";
    preview.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H4v5m11-5h5v5M20 15v5h-5M9 20H4v-5M8 16 16 8m-4 0h4v4"/></svg>';
    const remove = doc.createElement("button");
    remove.type = "button";
    remove.className = "semlo-editor-image-action";
    remove.setAttribute("aria-label", "删除图片");
    remove.title = "删除图片";
    remove.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9 7V5h6v2m-9 0 1 12h10l1-12M10 10v6m4-6v6"/></svg>';
    const more = doc.createElement("button");
    more.type = "button";
    more.className = "semlo-editor-image-action";
    more.setAttribute("aria-label", "图片更多操作");
    more.setAttribute("aria-haspopup", "menu");
    more.setAttribute("aria-expanded", "false");
    more.title = "更多";
    more.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h.01M12 12h.01M19 12h.01"/></svg>';
    const copyMenu = doc.createElement("div");
    copyMenu.className = "semlo-editor-image-copy-menu";
    copyMenu.setAttribute("role", "menu");
    copyMenu.setAttribute("aria-label", "图片更多操作");
    copyMenu.hidden = true;
    const copy = doc.createElement("button");
    copy.type = "button";
    copy.className = "semlo-editor-image-copy-option";
    copy.setAttribute("role", "menuitem");
    copy.setAttribute("aria-label", "复制图片");
    copy.title = "复制图片";
    copy.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="7" width="11" height="13" rx="2"/><path d="M15 7V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2"/></svg><span>复制</span>';
    copyMenu.append(copy);
    const feedback = doc.createElement("span");
    feedback.className = "semlo-editor-image-feedback";
    feedback.setAttribute("role", "status");
    feedback.hidden = true;
    toolbar.append(preview, remove, more, feedback);
    for (const [corner, label] of corners) {
      const handle = doc.createElement("button");
      handle.type = "button";
      handle.className = `semlo-editor-image-handle semlo-editor-image-handle-${corner}`;
      handle.setAttribute("aria-label", `调整图片大小（${label}）`);
      handle.addEventListener("pointerdown", (event) => beginResize(corner, event));
      handle.addEventListener("keydown", (event) => {
        if (
          editor.isEditable &&
          (event.metaKey || event.ctrlKey) &&
          (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y")
        ) {
          event.preventDefault();
          event.stopPropagation();
          if (event.key.toLowerCase() === "y" || event.shiftKey) editor.commands.redo();
          else editor.commands.undo();
          handle.focus();
          return;
        }
        if (!editor.isEditable || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = frame.getBoundingClientRect();
        const max = availableWidth();
        const next = Math.max(
          Math.min(48, max),
          Math.min(max, rect.width + (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 20 : 5)),
        );
        commit(next, rect.height / Math.max(rect.width, 1));
        handle.focus();
      });
      controls.append(handle);
    }
    frame.append(toolbar, copyMenu, controls);
    media.append(frame);
    dom.append(media);
    let current = initial;
    let selected = false;
    let resizing: (() => void) | undefined;
    let cropControl: ReturnType<typeof createImageCropControl> | undefined;
    let feedbackTimer: number | undefined;
    let destroyed = false;
    let committingToolbar = false;
    let closePreview: (() => void) | undefined;
    let previewSnapshot = "";
    let observedTextBlock: HTMLElement | null = null;
    const textBlock = () => {
      const pos = getPos();
      if (typeof pos !== "number" || view.state.doc.nodeAt(pos) !== current) return null;
      const resolved = view.state.doc.resolve(pos);
      return resolved.depth && resolved.parent.isTextblock
        ? { node: resolved.parent, pos: resolved.before(resolved.depth) }
        : null;
    };
    const paragraphAlign = () => imageAlign(textBlock()?.node.attrs.textAlign);
    const availableWidth = () => {
      const container = dom.parentElement;
      if (!container) return Math.max(1, view.dom.getBoundingClientRect().width);
      const style = win?.getComputedStyle(container);
      const padding =
        (Number.parseFloat(style?.paddingLeft ?? "") || 0) + (Number.parseFloat(style?.paddingRight ?? "") || 0);
      return Math.max(1, container.clientWidth - padding || container.getBoundingClientRect().width || 1);
    };
    function closeMore() {
      copyMenu.hidden = true;
      more.setAttribute("aria-expanded", "false");
      doc.removeEventListener("pointerdown", outsideMore, true);
    }
    function outsideMore(event: PointerEvent) {
      const target = event.target as globalThis.Node;
      if (!more.contains(target) && !copyMenu.contains(target)) closeMore();
    }
    more.addEventListener("click", () => {
      if (!editor.isEditable) return;
      if (!copyMenu.hidden) {
        closeMore();
        return;
      }
      copyMenu.hidden = false;
      more.setAttribute("aria-expanded", "true");
      doc.addEventListener("pointerdown", outsideMore, true);
    });
    const documentImages = () => {
      const images: Array<{
        id: string;
        src: string;
        title: string;
        href: string;
        rotation: ImageRotation;
        crop: ImageCropRect | null;
      }> = [];
      view.state.doc.descendants((node, pos) => {
        if (node.type !== current.type || typeof node.attrs.src !== "string" || !node.attrs.src.trim()) return;
        images.push({
          id: String(pos),
          src: node.attrs.src,
          title: node.attrs.alt || node.attrs.title || "",
          href: "",
          rotation: imageRotation(node.attrs.semloEditorImageRotation),
          crop: imageCrop(node.attrs.semloEditorImageCrop),
        });
      });
      return images;
    };
    const imageSnapshot = () =>
      JSON.stringify(documentImages().map(({ src, title, rotation, crop }) => ({ src, title, rotation, crop })));
    const getImageSize = () => {
      const rotation = imageRotation(current.attrs.semloEditorImageRotation);
      const savedWidth = dimension(current.attrs.width);
      const savedHeight = dimension(current.attrs.height);
      const crop = imageCrop(current.attrs.semloEditorImageCrop) ?? fullImageCrop();
      const rect = frame.getBoundingClientRect();
      const loaded = image.complete && image.naturalWidth > 0 && image.currentSrc === image.src;
      const naturalWidth = loaded ? (turned(rotation) ? image.naturalHeight : image.naturalWidth) * crop.width : 0;
      const naturalHeight = loaded ? (turned(rotation) ? image.naturalWidth : image.naturalHeight) * crop.height : 0;
      const ratio =
        naturalWidth && naturalHeight
          ? naturalHeight / naturalWidth
          : savedWidth && savedHeight
            ? savedHeight / savedWidth
            : rect.width
              ? rect.height / rect.width
              : 0;
      return {
        width: savedWidth ?? (savedHeight && ratio ? savedHeight / ratio : naturalWidth || rect.width),
        height: savedHeight ?? (savedWidth && ratio ? savedWidth * ratio : naturalHeight || rect.height),
        naturalWidth,
        naturalHeight,
      };
    };
    const paintVisualSize = (width: number, height: number, cropOverride?: ImageCropRect) => {
      const rotation = imageRotation(current.attrs.semloEditorImageRotation);
      const crop = cropOverride ?? imageCrop(current.attrs.semloEditorImageCrop) ?? fullImageCrop();
      const hasCrop = imageCrop(crop) !== null;
      const geometry = imageTransform(rotation, crop, width, height);
      frame.classList.toggle("has-crop", hasCrop && !!geometry);
      frame.dataset.semloEditorImageStyle = imageStyle(current.attrs.semloEditorImageStyle);
      if ((rotation || hasCrop || cropOverride) && geometry) {
        frame.style.width = `${width}px`;
        frame.style.aspectRatio = `${width} / ${height}`;
        image.style.position = "absolute";
        image.style.left = `${geometry.left}%`;
        image.style.top = `${geometry.top}%`;
        image.style.width = `${geometry.width}%`;
        image.style.height = `${geometry.height}%`;
        image.style.maxWidth = "none";
        image.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;
        if (hasCrop) image.style.clipPath = imageCropClip(crop, rotation);
        else image.style.removeProperty("clip-path");
        return;
      }
      frame.style.removeProperty("width");
      frame.style.removeProperty("aspect-ratio");
      image.style.removeProperty("position");
      image.style.removeProperty("left");
      image.style.removeProperty("top");
      image.style.removeProperty("height");
      image.style.removeProperty("max-width");
      image.style.removeProperty("clip-path");
      if (rotation) image.style.transform = `rotate(${rotation}deg)`;
      else image.style.removeProperty("transform");
      const savedWidth = dimension(current.attrs.width);
      if (savedWidth) image.style.width = `${savedWidth}px`;
      else image.style.removeProperty("width");
    };
    const paint = () => {
      const attrs = current.attrs;
      if (attrs.src && image.getAttribute("src") !== attrs.src) image.setAttribute("src", attrs.src);
      if (!attrs.src) image.removeAttribute("src");
      const failed =
        Boolean(attrs.src) &&
        image.complete &&
        !image.naturalWidth &&
        (!image.currentSrc || image.currentSrc === image.src);
      image.hidden = failed;
      imageError.hidden = !failed;
      imageError.style.width = `${dimension(attrs.width) ?? 100}px`;
      toolbar.hidden = failed;
      if (failed) {
        resizing?.();
        if (cropControl) clearCrop();
        frame.style.removeProperty("width");
        frame.style.removeProperty("aspect-ratio");
        frame.classList.remove("has-crop");
      }
      image.alt = attrs.alt ?? "";
      if (attrs.title) image.title = attrs.title;
      else image.removeAttribute("title");
      image.dataset.semloEditorImageStyle = imageStyle(attrs.semloEditorImageStyle);
      dom.dataset.semloEditorImageAlign = paragraphAlign();
      const href = safeImageLinkURL(attrs.semloEditorImageHref);
      if (href) {
        link.setAttribute("href", href);
        link.setAttribute("target", attrs.semloEditorImageOpenInCurrent === true ? "_self" : "_blank");
        link.setAttribute("rel", "noopener noreferrer");
        link.setAttribute("aria-label", "打开图片链接");
      } else {
        link.removeAttribute("href");
        link.removeAttribute("target");
        link.removeAttribute("rel");
        link.removeAttribute("aria-label");
      }
      link.hidden = failed || editor.isEditable || !href;
      link.tabIndex = href && !failed && !editor.isEditable ? 0 : -1;
      const width = dimension(attrs.width);
      const height = dimension(attrs.height);
      if (width) {
        image.setAttribute("width", String(width));
      } else {
        image.removeAttribute("width");
      }
      if (height) image.setAttribute("height", String(height));
      else image.removeAttribute("height");
      const size = getImageSize();
      if (!failed && !cropControl) paintVisualSize(size.width, size.height);
      rotate.disabled =
        !editor.isEditable ||
        !((size.naturalWidth > 0 && size.naturalHeight > 0) || (dimension(attrs.width) && dimension(attrs.height)));
      const crop = imageCrop(attrs.semloEditorImageCrop) ?? fullImageCrop();
      cropButton.disabled =
        rotate.disabled ||
        !imageTransform(imageRotation(attrs.semloEditorImageRotation), crop, size.width, size.height);
      restore.hidden = !imageRotation(attrs.semloEditorImageRotation) && !imageCrop(attrs.semloEditorImageCrop);
      controls.hidden = failed || !selected || !editor.isEditable;
      remove.hidden = failed || !editor.isEditable;
      more.hidden = failed || !editor.isEditable;
      if (!editor.isEditable) closeMore();
      preview.disabled = failed || typeof attrs.src !== "string" || !attrs.src.trim();
      frame.classList.toggle("is-selected", !failed && selected && editor.isEditable);
      sizeControl.element.hidden = failed || !selected || !editor.isEditable;
      if (sizeControl.element.hidden) sizeControl.close();
      if (!sizeControl.element.hidden) sizeControl.refresh();
      positionToolbar();
      captionControl.refresh();
      linkControl.refresh();
      refreshAlign();
    };
    function positionToolbar() {
      const parent = dom.parentElement;
      if (parent !== observedTextBlock && toolbarObserver) {
        if (observedTextBlock) toolbarObserver.unobserve(observedTextBlock);
        observedTextBlock = parent;
        if (observedTextBlock) toolbarObserver.observe(observedTextBlock);
      }
      if (sizeControl.element.hidden) return;
      const frameLeft = frame.getBoundingClientRect().left;
      const viewport = win?.innerWidth ?? doc.documentElement.clientWidth;
      const rightLimit = viewport - sizeControl.element.offsetWidth - 8;
      const left = Math.max(8, Math.min(frameLeft, rightLimit));
      sizeControl.element.style.left = `${left - frameLeft}px`;
    }
    const preserveImageSelection = (tr: Transaction, pos: number) => {
      const selection = view.state.selection;
      if (selection instanceof NodeSelection && selection.from === pos && tr.doc.nodeAt(pos)?.type === current.type)
        tr.setSelection(NodeSelection.create(tr.doc, pos));
      return tr;
    };
    const commit = (width: number, heightRatio: number, expected = current, focusEditor = true) => {
      if (!editor.isEditable) {
        paint();
        return;
      }
      const pos = getPos();
      if (typeof pos !== "number") {
        paint();
        return;
      }
      const found = view.state.doc.nodeAt(pos);
      if (!found || found !== expected) {
        paint();
        return;
      }
      const nextWidth = Math.max(1, Math.round(width));
      const nextHeight = Math.max(1, Math.round(width * heightRatio));
      if (dimension(found.attrs.width) === nextWidth && dimension(found.attrs.height) === nextHeight) {
        paint();
        return;
      }
      view.dispatch(
        preserveImageSelection(
          closeHistory(view.state.tr).setNodeMarkup(pos, undefined, {
            ...found.attrs,
            width: nextWidth,
            height: nextHeight,
          }),
          pos,
        ),
      );
      if (editor.isDestroyed) return;
      view.dispatch(closeHistory(view.state.tr));
      if (focusEditor && !editor.isDestroyed) view.focus();
    };
    const sizeControl = createImageSizeControl({
      doc,
      image,
      canEdit: () => editor.isEditable,
      getSize: getImageSize,
      commitSize: (width, height) => {
        committingToolbar = true;
        try {
          commit(width, height / width, current, false);
        } finally {
          committingToolbar = false;
        }
      },
      getStyle: () => imageStyle(current.attrs.semloEditorImageStyle),
      commitStyle: (style) => {
        if (!editor.isEditable) return;
        commitAttributes({ semloEditorImageStyle: style });
      },
    });
    const commitAttributes = (attributes: Record<string, unknown>, atomic = true) => {
      if (!editor.isEditable) return false;
      const pos = getPos();
      if (typeof pos !== "number") return false;
      const found = view.state.doc.nodeAt(pos);
      if (!found || found !== current) return false;
      if (Object.entries(attributes).every(([key, value]) => found.attrs[key] === value)) return true;
      committingToolbar = true;
      try {
        const tr = atomic ? closeHistory(view.state.tr) : view.state.tr;
        view.dispatch(preserveImageSelection(tr.setNodeMarkup(pos, undefined, { ...found.attrs, ...attributes }), pos));
        if (atomic) view.dispatch(closeHistory(view.state.tr));
      } finally {
        committingToolbar = false;
      }
      return true;
    };
    const captionControl = createImageCaptionControl({
      doc,
      canEdit: () => editor.isEditable,
      getState: () => ({
        text: imageCaption(current.attrs.semloEditorCaption),
        visible: current.attrs.semloEditorCaptionVisible === true,
      }),
      commit: (text, visible, kind) => {
        commitAttributes({ semloEditorCaption: text, semloEditorCaptionVisible: visible }, kind === "toggle");
        if (kind === "finish" && !editor.isDestroyed) view.dispatch(closeHistory(view.state.tr));
      },
      beginEdit: () => {
        if (editor.isEditable && !editor.isDestroyed) view.dispatch(closeHistory(view.state.tr));
      },
      enterAfter: () => {
        if (!editor.isEditable) return;
        const pos = getPos();
        if (typeof pos !== "number" || view.state.doc.nodeAt(pos) !== current) return;
        const after = pos + current.nodeSize;
        const tr = view.state.tr;
        view.dispatch(tr.setSelection(TextSelection.create(tr.doc, after)).scrollIntoView());
        view.focus();
      },
      undo: () => {
        committingToolbar = true;
        try {
          editor.commands.undo();
        } finally {
          committingToolbar = false;
        }
      },
      redo: () => {
        committingToolbar = true;
        try {
          editor.commands.redo();
        } finally {
          committingToolbar = false;
        }
      },
    });
    const linkControl = createImageLinkControl({
      doc,
      canEdit: () => editor.isEditable,
      getState: () => ({
        href: imageHref(current.attrs.semloEditorImageHref),
        openInCurrent: current.attrs.semloEditorImageOpenInCurrent === true,
      }),
      commit: ({ href, openInCurrent }) => {
        commitAttributes({ semloEditorImageHref: imageHref(href), semloEditorImageOpenInCurrent: openInCurrent });
      },
    });
    const alignButton = doc.createElement("button");
    alignButton.type = "button";
    alignButton.className = "semlo-editor-image-align-toggle";
    alignButton.setAttribute("aria-label", "图片对齐");
    alignButton.setAttribute("aria-haspopup", "menu");
    alignButton.setAttribute("aria-expanded", "false");
    alignButton.title = "对齐方式";
    alignButton.innerHTML =
      '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 4h14M3 8h10M3 12h14M3 16h10"/></svg><span aria-hidden="true">⌄</span>';
    const alignPanel = doc.createElement("div");
    alignPanel.className = "semlo-editor-image-align-panel";
    alignPanel.setAttribute("role", "menu");
    alignPanel.setAttribute("aria-label", "图片对齐");
    alignPanel.hidden = true;
    const alignments: Array<[ImageAlign, string]> = [
      ["left", "左对齐"],
      ["center", "居中对齐"],
      ["right", "右对齐"],
    ];
    const alignOptions = alignments.map(([value, label]) => {
      const option = doc.createElement("button");
      option.type = "button";
      option.setAttribute("role", "menuitemradio");
      option.setAttribute("aria-checked", "false");
      option.innerHTML = `<span aria-hidden="true">✓</span><span>${label}</span>`;
      option.addEventListener("mousedown", (event) => event.preventDefault());
      option.addEventListener("click", () => {
        const block = textBlock();
        if (editor.isEditable && block && paragraphAlign() !== value) {
          committingToolbar = true;
          try {
            const pos = getPos();
            const tr = closeHistory(view.state.tr).setNodeMarkup(block.pos, undefined, {
              ...block.node.attrs,
              textAlign: value,
            });
            view.dispatch(typeof pos === "number" ? preserveImageSelection(tr, pos) : tr);
            view.dispatch(closeHistory(view.state.tr));
          } finally {
            committingToolbar = false;
          }
        }
        closeAlign();
      });
      alignPanel.append(option);
      return option;
    });
    function refreshAlign() {
      alignOptions.forEach((option, index) => {
        option.setAttribute("aria-checked", String(alignments[index][0] === paragraphAlign()));
        option.disabled = !editor.isEditable;
      });
    }
    function outsideAlign(event: PointerEvent) {
      const target = event.target as globalThis.Node;
      if (!alignButton.contains(target) && !alignPanel.contains(target)) closeAlign();
    }
    function closeAlign() {
      alignPanel.hidden = true;
      alignButton.setAttribute("aria-expanded", "false");
      doc.removeEventListener("pointerdown", outsideAlign, true);
    }
    alignButton.addEventListener("mousedown", (event) => event.preventDefault());
    alignButton.addEventListener("click", () => {
      if (!editor.isEditable) return;
      if (!alignPanel.hidden) {
        closeAlign();
        return;
      }
      sizeControl.close();
      linkControl.close();
      alignPanel.hidden = false;
      alignButton.setAttribute("aria-expanded", "true");
      refreshAlign();
      doc.addEventListener("pointerdown", outsideAlign, true);
    });
    const styleToggle = sizeControl.element.querySelector(".semlo-editor-image-style-toggle");
    const rotate = doc.createElement("button");
    rotate.type = "button";
    rotate.className = "semlo-editor-image-rotate-toggle";
    rotate.setAttribute("aria-label", "逆时针旋转 90 度");
    rotate.title = "逆时针旋转90度";
    rotate.innerHTML =
      '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 8a6 6 0 1 1 1.7 6.2M4 4v4h4M7 7h8v8H7z"/></svg>';
    rotate.addEventListener("mousedown", (event) => event.preventDefault());
    rotate.addEventListener("click", () => {
      if (!editor.isEditable || rotate.disabled) return;
      const size = getImageSize();
      const rotation = imageRotation(current.attrs.semloEditorImageRotation);
      const attrs: Record<string, unknown> = { semloEditorImageRotation: (rotation + 270) % 360 };
      const crop = imageCrop(current.attrs.semloEditorImageCrop);
      if (crop) attrs.semloEditorImageCrop = imageCrop(rotateImageCropRect(crop, -1));
      const hasKnownDimensions =
        (size.naturalWidth > 0 && size.naturalHeight > 0) ||
        (dimension(current.attrs.width) && dimension(current.attrs.height));
      if (hasKnownDimensions && size.width > 0 && size.height > 0) {
        attrs.width = Math.max(1, Math.round(size.height));
        attrs.height = Math.max(1, Math.round(size.width));
      } else {
        attrs.width = dimension(current.attrs.height);
        attrs.height = dimension(current.attrs.width);
      }
      sizeControl.close();
      linkControl.close();
      closeAlign();
      commitAttributes(attrs);
    });
    sizeControl.element.prepend(rotate);
    const cropButton = doc.createElement("button");
    cropButton.type = "button";
    cropButton.className = "semlo-editor-image-rotate-toggle semlo-editor-image-crop-toggle";
    cropButton.setAttribute("aria-label", "裁剪图片");
    cropButton.setAttribute("aria-pressed", "false");
    cropButton.title = "图片剪裁";
    cropButton.innerHTML =
      '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2v11a2 2 0 0 0 2 2h11M2 5h11a2 2 0 0 1 2 2v11"/></svg>';
    const restore = doc.createElement("button");
    restore.type = "button";
    restore.className = "semlo-editor-image-rotate-toggle semlo-editor-image-restore-toggle";
    restore.setAttribute("aria-label", "还原图片");
    restore.title = "还原图片";
    restore.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 7a6 6 0 1 1 0 6M4 3v4h4"/></svg>';
    for (const button of [cropButton, restore]) button.addEventListener("mousedown", (event) => event.preventDefault());
    function clearCrop() {
      cropControl?.destroy();
      cropControl = undefined;
      cropButton.setAttribute("aria-pressed", "false");
      frame.classList.remove("is-cropping");
      doc.removeEventListener("pointerdown", outsideCrop, true);
    }
    function outsideCrop(event: PointerEvent) {
      if (!cropControl) return;
      const target = event.target as globalThis.Node;
      if (cropControl.element.contains(target) || cropButton.contains(target)) return;
      cropControl.finish();
    }
    cropButton.addEventListener("click", () => {
      if (!editor.isEditable || cropButton.disabled) return;
      if (cropControl) {
        cropControl.finish();
        return;
      }
      const expected = current;
      const size = getImageSize();
      const oldCrop = imageCrop(expected.attrs.semloEditorImageCrop);
      const rect = oldCrop ?? fullImageCrop();
      const fullWidth = size.width / rect.width;
      const fullHeight = size.height / rect.height;
      if (
        !imageTransform(imageRotation(expected.attrs.semloEditorImageRotation), fullImageCrop(), fullWidth, fullHeight)
      )
        return;
      sizeControl.close();
      linkControl.close();
      closeAlign();
      closeMore();
      controls.hidden = true;
      paintVisualSize(fullWidth, fullHeight, fullImageCrop());
      positionToolbar();
      frame.classList.add("is-cropping");
      cropButton.setAttribute("aria-pressed", "true");
      cropControl = createImageCropControl({
        doc,
        stage: frame,
        keyboardScope: view.dom,
        initialRect: rect,
        onCommit: (nextRect) => {
          clearCrop();
          if (!editor.isEditable || current !== expected) {
            paint();
            return;
          }
          const nextCrop = imageCrop(nextRect);
          const width = Math.max(1, Math.round(fullWidth * nextRect.width));
          const height = Math.max(1, Math.round(fullHeight * nextRect.height));
          if (JSON.stringify(nextCrop) !== JSON.stringify(oldCrop))
            commitAttributes({ semloEditorImageCrop: nextCrop, width, height });
          if (editor.isDestroyed) return;
          paint();
          view.focus();
        },
      });
      doc.addEventListener("pointerdown", outsideCrop, true);
      cropControl.element
        .querySelector<HTMLElement>(".semlo-editor-image-crop-selection")
        ?.focus({ preventScroll: true });
    });
    restore.addEventListener("click", () => {
      if (!editor.isEditable) return;
      const size = getImageSize();
      const crop = imageCrop(current.attrs.semloEditorImageCrop) ?? fullImageCrop();
      const rotation = imageRotation(current.attrs.semloEditorImageRotation);
      const fullWidth = size.width / crop.width;
      const fullHeight = size.height / crop.height;
      const width = turned(rotation) ? fullHeight : fullWidth;
      const height = turned(rotation) ? fullWidth : fullHeight;
      if (!dimension(width) || !dimension(height)) return;
      commitAttributes({
        semloEditorImageRotation: 0,
        semloEditorImageCrop: null,
        width: Math.round(width),
        height: Math.round(height),
      });
    });
    const batch = doc.createElement("button");
    batch.type = "button";
    batch.className = "semlo-editor-image-batch-toggle";
    batch.setAttribute("aria-label", "批量应用格式");
    batch.setAttribute("aria-haspopup", "menu");
    batch.setAttribute("aria-expanded", "false");
    batch.title = "批量应用格式：对本文档的图片一键应用样式和宽度";
    batch.innerHTML =
      '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4" width="12" height="12" rx="1"/><path d="m6 9 2 2 4-4M16 7h1v10H6v-1"/></svg><span aria-hidden="true">⌄</span>';
    const batchMenu = doc.createElement("div");
    batchMenu.className = "semlo-editor-image-batch-menu";
    batchMenu.setAttribute("role", "menu");
    batchMenu.setAttribute("aria-label", "批量应用图片格式");
    batchMenu.hidden = true;
    let batchNotice: HTMLElement | undefined;
    let batchNoticeTimer: number | undefined;
    const closeBatch = () => {
      batchMenu.hidden = true;
      batch.setAttribute("aria-expanded", "false");
      doc.removeEventListener("pointerdown", outsideBatch, true);
    };
    const outsideBatch = (event: PointerEvent) => {
      if (!batch.contains(event.target as globalThis.Node) && !batchMenu.contains(event.target as globalThis.Node))
        closeBatch();
    };
    const applyBatch = (kind: "style" | "width") => {
      if (!editor.isEditable || destroyed) return;
      const position = getPos();
      if (typeof position !== "number") return;
      const source = view.state.doc.nodeAt(position);
      if (!source || source !== current) return;
      const sourceWidth = getImageSize().width;
      if (kind === "width" && !dimension(sourceWidth)) return;
      let tr = closeHistory(view.state.tr);
      view.state.doc.descendants((node, pos) => {
        if (node.type !== current.type) return;
        if (kind === "style") {
          const style = imageStyle(source.attrs.semloEditorImageStyle);
          if (imageStyle(node.attrs.semloEditorImageStyle) !== style)
            tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, semloEditorImageStyle: style });
        } else {
          const targetDOM = view.nodeDOM(pos) as HTMLElement | null;
          const targetImage = targetDOM?.querySelector("img");
          const rotation = imageRotation(node.attrs.semloEditorImageRotation);
          const crop = imageCrop(node.attrs.semloEditorImageCrop) ?? fullImageCrop();
          const naturalWidth = targetImage?.naturalWidth ?? 0;
          const naturalHeight = targetImage?.naturalHeight ?? 0;
          const savedWidth = dimension(node.attrs.width);
          const savedHeight = dimension(node.attrs.height);
          const intrinsicWidth = (turned(rotation) ? naturalHeight : naturalWidth) * crop.width;
          const intrinsicHeight = (turned(rotation) ? naturalWidth : naturalHeight) * crop.height;
          const ratio =
            savedWidth && savedHeight
              ? savedHeight / savedWidth
              : intrinsicWidth && intrinsicHeight
                ? intrinsicHeight / intrinsicWidth
                : 0;
          const width = Math.max(1, Math.round(sourceWidth));
          const height = ratio ? Math.max(1, Math.round(ratio * width)) : null;
          if (dimension(node.attrs.width) !== width || dimension(node.attrs.height) !== height)
            tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, width, height });
        }
      });
      if (tr.docChanged) {
        committingToolbar = true;
        try {
          view.dispatch(tr);
          view.dispatch(closeHistory(view.state.tr));
        } finally {
          committingToolbar = false;
        }
      }
      batchNotice?.remove();
      if (batchNoticeTimer !== undefined) win?.clearTimeout(batchNoticeTimer);
      batchNotice = doc.createElement("div");
      batchNotice.className = "semlo-editor-image-batch-notice";
      batchNotice.setAttribute("role", "status");
      batchNotice.innerHTML = '<span aria-hidden="true">✓</span>图片格式已对所有图片生效';
      doc.body.append(batchNotice);
      batchNoticeTimer = win?.setTimeout(() => {
        batchNotice?.remove();
        batchNotice = undefined;
      }, 1800);
    };
    for (const [label, kind] of [
      ["同步图片样式到全文", "style"],
      ["同步图片宽度到全文", "width"],
    ] as const) {
      const action = doc.createElement("button");
      action.type = "button";
      action.setAttribute("role", "menuitem");
      action.textContent = label;
      action.addEventListener("click", () => applyBatch(kind));
      batchMenu.append(action);
    }
    batch.addEventListener("click", () => {
      if (!editor.isEditable) return;
      const open = batchMenu.hidden;
      sizeControl.close();
      closeAlign();
      linkControl.close();
      batchMenu.hidden = !open;
      batch.setAttribute("aria-expanded", String(open));
      if (open) doc.addEventListener("pointerdown", outsideBatch, true);
      else doc.removeEventListener("pointerdown", outsideBatch, true);
    });
    sizeControl.element.insertBefore(cropButton, rotate.nextSibling);
    sizeControl.element.insertBefore(linkControl.button, styleToggle);
    sizeControl.element.insertBefore(captionControl.button, styleToggle);
    sizeControl.element.insertBefore(alignButton, styleToggle);
    sizeControl.element.append(batch, restore, linkControl.panel, alignPanel, batchMenu);
    sizeControl.element.addEventListener("pointerdown", (event) => {
      const target = event.target as globalThis.Node;
      if (linkControl.button.contains(target) || captionControl.button.contains(target)) {
        sizeControl.close();
        closeAlign();
        closeBatch();
      } else if (
        styleToggle?.contains(target) ||
        sizeControl.element.querySelector(".semlo-editor-image-size-toggle")?.contains(target)
      ) {
        closeAlign();
        closeBatch();
      }
    });
    frame.append(sizeControl.element);
    media.append(captionControl.caption);
    const beginResize = (corner: Corner, event: PointerEvent) => {
      if (!editor.isEditable || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      resizing?.();
      const expected = current;
      const rect = frame.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const startX = event.clientX,
        startY = event.clientY,
        ratio = rect.height / rect.width;
      const max = availableWidth(),
        min = Math.min(48, max);
      let width = rect.width;
      let moved = false;
      dom.classList.add("is-resizing");
      const move = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== event.pointerId) return;
        const dx = (moveEvent.clientX - startX) * (corner.endsWith("right") ? 1 : -1);
        const dy = ((moveEvent.clientY - startY) * (corner.startsWith("bottom") ? 1 : -1)) / ratio;
        const delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
        if (Math.abs(delta) > 1) moved = true;
        width = Math.max(min, Math.min(max, rect.width + delta));
        if (imageRotation(current.attrs.semloEditorImageRotation) || imageCrop(current.attrs.semloEditorImageCrop))
          paintVisualSize(width, width * ratio);
        else image.style.width = `${width}px`;
      };
      const finish = (endEvent: PointerEvent) => {
        if (endEvent.pointerId !== event.pointerId) return;
        cleanup();
        if (moved) commit(width, ratio, expected);
        else paint();
      };
      const abort = (endEvent: PointerEvent) => {
        if (endEvent.pointerId !== event.pointerId) return;
        cleanup();
        paint();
      };
      const key = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key === "Escape") {
          keyEvent.preventDefault();
          cleanup();
          paint();
          view.focus();
        }
      };
      const cleanup = () => {
        doc.removeEventListener("pointermove", move, true);
        doc.removeEventListener("pointerup", finish, true);
        doc.removeEventListener("pointercancel", abort, true);
        doc.removeEventListener("keydown", key, true);
        dom.classList.remove("is-resizing");
        resizing = undefined;
      };
      resizing = cleanup;
      doc.addEventListener("pointermove", move, true);
      doc.addEventListener("pointerup", finish, true);
      doc.addEventListener("pointercancel", abort, true);
      doc.addEventListener("keydown", key, true);
    };
    preview.addEventListener("click", () => {
      const pos = getPos();
      if (typeof pos !== "number" || view.state.doc.nodeAt(pos) !== current) return;
      const images = documentImages();
      const index = images.findIndex((entry) => entry.id === String(pos));
      if (index < 0) return;
      closePreview?.();
      previewSnapshot = imageSnapshot();
      closePreview = openGalleryLightbox(doc, images, index, {
        ariaLabel: "图片预览",
        onClose: () => {
          closePreview = undefined;
          previewSnapshot = "";
        },
      });
    });
    remove.addEventListener("click", () => {
      if (!editor.isEditable) return;
      const pos = getPos();
      if (typeof pos !== "number") return;
      const found = view.state.doc.nodeAt(pos);
      if (!found || found.type !== current.type) return;
      view.dispatch(closeHistory(view.state.tr).delete(pos, pos + found.nodeSize));
      view.dispatch(closeHistory(view.state.tr));
      view.focus();
    });
    copy.addEventListener("click", async () => {
      closeMore();
      try {
        const clipboard = win?.navigator.clipboard;
        if (!clipboard) throw new Error("Clipboard unavailable");
        const copied = doc.createElement("div");
        copied.append(DOMSerializer.fromSchema(view.state.schema).serializeNode(current, { document: doc }));
        let copiedImage = false;
        if (clipboard.write && win?.ClipboardItem) {
          await clipboard.write([
            new win.ClipboardItem({
              "text/html": new Blob([copied.innerHTML], { type: "text/html" }),
              "text/plain": new Blob([String(current.attrs.src ?? "")], { type: "text/plain" }),
            }),
          ]);
          copiedImage = true;
        } else if (clipboard.writeText) await clipboard.writeText(String(current.attrs.src ?? ""));
        else throw new Error("Clipboard unavailable");
        if (!destroyed) feedback.textContent = copiedImage ? "已复制" : "已复制图片地址";
      } catch {
        if (!destroyed) feedback.textContent = "复制失败";
      }
      if (!destroyed) {
        feedback.hidden = false;
        if (feedbackTimer !== undefined) win?.clearTimeout(feedbackTimer);
        feedbackTimer = win?.setTimeout(() => {
          feedback.hidden = true;
        }, 2000);
      }
    });
    const editableChanged = () => {
      resizing?.();
      if (!editor.isEditable) {
        clearCrop();
        captionControl.close();
        linkControl.close();
        closeAlign();
        closeBatch();
      }
      paint();
    };
    const transaction = () => {
      if (destroyed) return;
      const pos = getPos();
      const found = typeof pos === "number" ? view.state.doc.nodeAt(pos) : null;
      if (found !== current) {
        resizing?.();
        clearCrop();
        closePreview?.();
        closeMore();
        if (!committingToolbar) {
          sizeControl.close();
          captionControl.close();
          linkControl.close();
          closeAlign();
        }
        // A full document replacement can keep the existing node view for an
        // equal image without invoking update(). Keep future actions bound to
        // the node that actually belongs to the replacement document.
        if (found && found.type === current.type) {
          current = found;
          paint();
        }
      } else {
        if (closePreview && previewSnapshot !== imageSnapshot()) closePreview();
        dom.dataset.semloEditorImageAlign = paragraphAlign();
        refreshAlign();
        positionToolbar();
      }
    };
    view.dom.addEventListener("semlo-editor:editable", editableChanged);
    editor.on("transaction", transaction);
    win?.addEventListener("resize", positionToolbar);
    doc.addEventListener("scroll", positionToolbar, true);
    const toolbarObserver = win?.ResizeObserver ? new win.ResizeObserver(positionToolbar) : undefined;
    toolbarObserver?.observe(dom);
    toolbarObserver?.observe(frame);
    toolbarObserver?.observe(sizeControl.element);
    image.addEventListener("load", paint);
    image.addEventListener("error", paint);
    paint();
    return {
      dom,
      update(node) {
        if (node.type !== current.type) return false;
        if (node !== current) {
          resizing?.();
          clearCrop();
          closePreview?.();
          closeMore();
          if (!committingToolbar) {
            sizeControl.close();
            captionControl.close();
            linkControl.close();
            closeAlign();
          }
        }
        current = node;
        paint();
        return true;
      },
      selectNode() {
        selected = true;
        paint();
      },
      deselectNode() {
        selected = false;
        clearCrop();
        closeMore();
        sizeControl.close();
        linkControl.close();
        closeAlign();
        closeBatch();
        if (!resizing) paint();
      },
      stopEvent(event) {
        return (
          controls.contains(event.target as globalThis.Node) ||
          toolbar.contains(event.target as globalThis.Node) ||
          copyMenu.contains(event.target as globalThis.Node) ||
          !!cropControl?.element.contains(event.target as globalThis.Node) ||
          sizeControl.element.contains(event.target as globalThis.Node) ||
          captionControl.caption.contains(event.target as globalThis.Node)
        );
      },
      ignoreMutation() {
        return true;
      },
      destroy() {
        destroyed = true;
        resizing?.();
        clearCrop();
        closePreview?.();
        closeMore();
        closeAlign();
        closeBatch();
        doc.removeEventListener("pointerdown", outsideBatch, true);
        batchNotice?.remove();
        if (batchNoticeTimer !== undefined) win?.clearTimeout(batchNoticeTimer);
        captionControl.destroy();
        linkControl.destroy();
        sizeControl.destroy();
        image.removeEventListener("load", paint);
        image.removeEventListener("error", paint);
        if (feedbackTimer !== undefined) win?.clearTimeout(feedbackTimer);
        view.dom.removeEventListener("semlo-editor:editable", editableChanged);
        win?.removeEventListener("resize", positionToolbar);
        doc.removeEventListener("scroll", positionToolbar, true);
        toolbarObserver?.disconnect();
        editor.off("transaction", transaction);
      },
    };
  };
}
