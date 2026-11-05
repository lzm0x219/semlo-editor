import { Node, type Editor, type Range } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { DOMOutputSpec } from "@tiptap/pm/model";
import { NodeSelection, type Transaction } from "@tiptap/pm/state";

import type { ImageUpload } from "../../../types";
import { safeImageLinkURL } from "../shared/image-link";
import { openGalleryLightbox } from "../shared/lightbox";
import { openGalleryDialog } from "./dialog";
import { mapGalleryPosition, markGalleryMarkupUpdate, uploadGalleryImages } from "./uploads";

export type GalleryLayout = "carousel" | "thumbnail" | "grid";

export interface GalleryImage {
  id: string;
  src: string;
  title: string;
  href: string;
}

export interface GalleryData {
  id: string;
  layout: GalleryLayout;
  images: GalleryImage[];
}

let galleryCounter = 0;
export function createGalleryId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? "gallery-" + Date.now().toString(36) + "-" + (++galleryCounter).toString(36)
  );
}

function idValue(value: unknown): string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value) ? value : "";
}

function safeURL(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4096) return null;
  if (Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))
    return null;
  const url = value.trim();
  if (url.startsWith("/") && !url.startsWith("//") && !url.startsWith("/\\")) return url;
  try {
    const parsed = new URL(url);
    if (["http:", "https:", "blob:"].includes(parsed.protocol)) return url;
  } catch {
    /* Invalid or relative URLs are not used. */
  }
  return null;
}

export function safeGalleryImageURL(value: unknown): string | null {
  return safeURL(value);
}

export function safeGalleryLinkURL(value: unknown): string | null {
  return safeImageLinkURL(value);
}

function galleryLinkInput(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 4096 ||
    value.includes("\\") ||
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || (code >= 127 && code <= 159);
    })
  )
    return "";
  const input = value.trim();
  if (safeGalleryLinkURL(input)) return input;
  // Keep unfinished text for editing, but never preserve unsafe URL schemes.
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(input) ? "" : input;
}

type GalleryProjection = {
  data: GalleryData;
  slots: Array<{ image: GalleryImage; source: Record<string, unknown> } | null>;
};

// 展示层只使用安全投影；原始字段和不能展示的图片仍属于文档。
function projectGalleryData(value: unknown): GalleryProjection {
  const data = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const layout = data.layout === "thumbnail" || data.layout === "grid" ? data.layout : "carousel";
  const used = new Set<string>();
  const slots = (Array.isArray(data.images) ? data.images : []).map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const image = item as Record<string, unknown>;
    const src = safeGalleryImageURL(image.src);
    if (!src) return null;
    let id = idValue(image.id) || "image-" + index;
    if (used.has(id)) id = "image-" + index;
    while (used.has(id)) id += "-copy";
    used.add(id);
    return {
      source: image,
      image: {
        id,
        src,
        title: typeof image.title === "string" ? image.title : "",
        href: galleryLinkInput(image.href),
      },
    };
  });
  return {
    data: { id: idValue(data.id), layout, images: slots.flatMap((slot) => (slot ? [slot.image] : [])) },
    slots,
  };
}

/** Normalize document data before it reaches the DOM or a link. */
export function normalizeGalleryData(value: unknown): GalleryData {
  return projectGalleryData(value).data;
}

// 只覆盖用户实际修改的展示字段，其他字段和不能展示的图片原样保留。
function mergeGalleryData(value: unknown, next: GalleryData): unknown {
  if (value === null || value === undefined) return next;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("图册数据无法编辑，请检查原始内容");
  const source = value as Record<string, unknown>;
  const before = projectGalleryData(value);
  const merged: Record<string, unknown> = { ...source };
  if (next.id !== before.data.id) {
    if (source.id != null && source.id !== "" && !idValue(source.id)) throw new Error("图册标识无效，请检查原始内容");
    merged.id = next.id;
  }
  if (next.layout !== before.data.layout) merged.layout = next.layout;
  if (!Array.isArray(source.images)) {
    if (JSON.stringify(next.images) !== JSON.stringify(before.data.images))
      throw new Error("图册图片数据无效，请检查原始内容");
    return merged;
  }
  const byId = new Map(before.slots.flatMap((slot) => (slot ? [[slot.image.id, slot] as const] : [])));
  const materialize = (image: GalleryImage): unknown => {
    const previous = byId.get(image.id);
    if (!previous) return image;
    const result = { ...previous.source };
    for (const key of ["id", "src", "title", "href"] as const) {
      if (image[key] !== previous.image[key]) result[key] = image[key];
    }
    return result;
  };
  let index = 0;
  const images: unknown[] = [];
  before.slots.forEach((slot, sourceIndex) => {
    if (!slot) images.push((source.images as unknown[])[sourceIndex]);
    else if (index < next.images.length) images.push(materialize(next.images[index++]));
  });
  while (index < next.images.length) images.push(materialize(next.images[index++]));
  merged.images = images;
  return merged;
}

// 导出的可读属性仍可由宿主编辑；只把与安全投影不同的字段合并回原始数据。
function readGalleryExport(element: HTMLElement, raw: unknown): unknown {
  const before = projectGalleryData(raw);
  const id = element.getAttribute("data-gallery-id") ?? before.data.id;
  const layout = element.getAttribute("data-layout") ?? before.data.layout;
  const images = Array.from(element.querySelectorAll<HTMLImageElement>("img[data-gallery-image]")).map((image) => ({
    id: image.getAttribute("data-image-id") ?? "",
    src: image.getAttribute("src"),
    title: image.getAttribute("data-title") ?? image.getAttribute("alt") ?? "",
    href: image.getAttribute("data-href") ?? "",
  }));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    if (id !== before.data.id || layout !== before.data.layout || images.length)
      throw new Error("图册数据无法安全合并，请检查原始内容");
    return raw;
  }
  const source = raw as Record<string, unknown>;
  const result: Record<string, unknown> = { ...source };
  if (id !== before.data.id) result.id = id;
  if (layout !== before.data.layout) result.layout = layout;
  if (!Array.isArray(source.images)) {
    if (images.length) throw new Error("图册图片数据无法安全合并，请检查原始内容");
    return result;
  }
  const visible = before.slots.flatMap((slot) => (slot ? [slot] : []));
  const byId = new Map(visible.map((slot) => [slot.image.id, slot]));
  const ids = new Set<string>();
  for (const image of images) {
    if (!idValue(image.id) || ids.has(image.id)) throw new Error("图册图片标识无效或重复，请检查原始内容");
    ids.add(image.id);
  }
  const reserved = new Set(images.flatMap((image) => (byId.has(image.id) ? [image.id] : [])));
  const claimed = new Set<string>();
  const normalizeLineEndings = (value: string) => value.replace(/\r\n?/g, "\n");
  const materialized = images.map((image, index) => {
    let previous = byId.get(image.id);
    if (!previous && images.length === visible.length) {
      const candidate = visible[index];
      if (candidate && !reserved.has(candidate.image.id) && !claimed.has(candidate.image.id)) previous = candidate;
    }
    if (!previous) return image;
    claimed.add(previous.image.id);
    const result = { ...previous.source };
    for (const key of ["id", "src", "title", "href"] as const) {
      const next = image[key];
      const old = previous.image[key];
      if (typeof next !== "string" || normalizeLineEndings(next) !== normalizeLineEndings(old)) result[key] = next;
    }
    return result;
  });
  let index = 0;
  const merged: unknown[] = [];
  before.slots.forEach((slot, sourceIndex) => {
    if (!slot) merged.push((source.images as unknown[])[sourceIndex]);
    else if (index < materialized.length) merged.push(materialized[index++]);
  });
  while (index < materialized.length) merged.push(materialized[index++]);
  result.images = merged;
  return result;
}

export function createGalleryData(): GalleryData {
  return { id: createGalleryId(), layout: "grid", images: [] };
}

/** Insert a fresh gallery from either the slash menu or an insertion panel. */
export function insertGallery(editor: Editor, range?: Range): boolean {
  if (editor.isDestroyed || !editor.isEditable) return false;
  const content = { type: "semloEditorGallery", attrs: { data: createGalleryData() } };
  const probe = editor.can().chain().focus();
  if (range) probe.deleteRange(range);
  if (!probe.insertContent(content).run()) return false;
  const chain = editor.chain().focus();
  if (range) chain.deleteRange(range);
  return chain.insertContent(content).run();
}

export interface GalleryOptions {
  getUploadImage: () => ImageUpload | undefined;
  onError: (error: unknown) => void;
}

/** A gallery stores only image data; each view builds its own interactive controls. */
export const Gallery = Node.create<GalleryOptions>({
  name: "semloEditorGallery",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addOptions() {
    return { getUploadImage: () => undefined, onError: () => {} };
  },
  addAttributes() {
    return {
      data: {
        default: null,
        rendered: false,
        parseHTML: (element) => {
          const payload = element.getAttribute("data-semlo-gallery-json");
          if (payload !== null) {
            let value: unknown;
            try {
              value = JSON.parse(decodeURIComponent(payload));
            } catch {
              throw new Error("图册数据无法解析，请检查原始内容");
            }
            return readGalleryExport(element, value);
          }
          const source = {
            id: element.getAttribute("data-gallery-id"),
            layout: element.getAttribute("data-layout"),
            images: Array.from(element.querySelectorAll<HTMLImageElement>("img[data-gallery-image]")).map((image) => ({
              id: image.getAttribute("data-image-id"),
              src: image.getAttribute("src"),
              title: image.getAttribute("data-title") ?? image.getAttribute("alt"),
              href: image.getAttribute("data-href"),
            })),
          };
          const projection = projectGalleryData(source);
          return {
            ...projection.data,
            id: projection.data.id || createGalleryId(),
            images: projection.slots.map((slot, index) =>
              slot
                ? { ...slot.image, href: typeof slot.source.href === "string" ? slot.source.href : slot.image.href }
                : source.images[index],
            ),
          };
        },
      },
    };
  },
  parseHTML() {
    return [{ tag: "figure[data-semlo-editor-gallery]", priority: 100 }];
  },
  renderText() {
    return "";
  },
  renderHTML({ node }) {
    const data = normalizeGalleryData(node.attrs.data);
    const children: DOMOutputSpec[] = data.images.map((image) => {
      const img: DOMOutputSpec = [
        "img",
        {
          "data-gallery-image": "",
          "data-image-id": image.id,
          "data-title": image.title,
          "data-href": image.href,
          src: image.src,
          alt: image.title,
        },
      ];
      const href = safeGalleryLinkURL(image.href);
      const content: DOMOutputSpec = href ? ["a", { href, target: "_blank", rel: "noopener noreferrer" }, img] : img;
      return [
        "div",
        { "data-gallery-item": "" },
        content,
        ...(image.title ? [["figcaption", image.title] as DOMOutputSpec] : []),
      ];
    });
    return [
      "figure",
      {
        "data-semlo-editor-gallery": "",
        "data-gallery-id": data.id,
        "data-layout": data.layout,
        "data-semlo-gallery-json": encodeURIComponent(JSON.stringify(node.attrs.data ?? null)),
        class: "semlo-editor-gallery-export",
      },
      ...children,
    ];
  },
  addNodeView() {
    return ({ editor, view, node: initial, getPos }) => {
      const doc = view.dom.ownerDocument;
      const dom = doc.createElement("div");
      dom.className = "semlo-editor-gallery";
      dom.dataset.type = "semloEditorGallery";
      dom.contentEditable = "false";
      const surface = doc.createElement("div");
      surface.className = "semlo-editor-gallery-surface";
      const empty = doc.createElement("div");
      empty.className = "semlo-editor-gallery-empty";
      const illustration = doc.createElement("div");
      illustration.className = "semlo-editor-gallery-empty-icon";
      illustration.setAttribute("aria-hidden", "true");
      illustration.innerHTML =
        '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m29 10 3 1a3 3 0 0 1 2 3.7l-4.4 16.4a3 3 0 0 1-3.7 2.1L15 30"/><rect x="4" y="5" width="25" height="25" rx="4"/><circle cx="13" cy="13" r="1.7"/><path d="m5 25 5-6 4 5 6-8 8 10"/></svg>';
      const emptyLabel = doc.createElement("div");
      emptyLabel.className = "semlo-editor-gallery-empty-label";
      emptyLabel.textContent = "在此上传或拖入多张图片";
      const upload = doc.createElement("button");
      upload.type = "button";
      upload.className = "semlo-editor-gallery-upload-button";
      upload.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m-4 4 4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg><span>上传图片</span>';
      const input = doc.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.multiple = true;
      input.hidden = true;
      input.setAttribute("aria-label", "选择图册图片");
      const status = doc.createElement("div");
      status.className = "semlo-editor-gallery-status";
      status.setAttribute("role", "status");
      status.hidden = true;
      empty.append(illustration, emptyLabel, upload);
      const content = doc.createElement("div");
      content.className = "semlo-editor-gallery-content";
      surface.append(empty, content);
      const toolbar = doc.createElement("div");
      toolbar.className = "semlo-editor-gallery-toolbar";
      toolbar.setAttribute("role", "toolbar");
      toolbar.setAttribute("aria-label", "图册操作");
      const switchLayout = doc.createElement("button");
      switchLayout.type = "button";
      switchLayout.className = "semlo-editor-gallery-tool";
      switchLayout.setAttribute("aria-label", "切换版式");
      switchLayout.title = "切换版式";
      switchLayout.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M12 10v10"/></svg><span>切换版式</span>';
      const separator = doc.createElement("span");
      separator.className = "semlo-editor-gallery-toolbar-separator";
      separator.setAttribute("aria-hidden", "true");
      const edit = doc.createElement("button");
      edit.type = "button";
      edit.className = "semlo-editor-gallery-tool";
      edit.setAttribute("aria-label", "编辑图册");
      edit.title = "编辑图册";
      edit.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 17-.5 3.5L7 20 19 8l-3-3L4 17zM14 7l3 3M12 20h8"/></svg><span>编辑图册</span>';
      toolbar.append(switchLayout, separator, edit);
      dom.append(surface, toolbar, input, status);

      let current = initial;
      let selected = false;
      let destroyed = false;
      let activeIndex = 0;
      let navigationPending = false;
      let slideDirection: -1 | 0 | 1 = 0;
      let slideAnimations: Animation[] = [];
      const reducedMotion = doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)");
      const onReducedMotionChange = () => {
        if (!reducedMotion?.matches) return;
        for (const animation of slideAnimations) animation.cancel();
        slideAnimations = [];
      };
      reducedMotion?.addEventListener("change", onReducedMotionChange);
      let renderKey = "";
      let dialog: (() => void) | undefined;
      let dialogTarget: { pos: number; id: string } | undefined;
      let lightbox: (() => void) | undefined;
      let lightboxImages = "";
      let cancelUploads: (() => void) | undefined;
      let uploadError = "";
      const fallbackId = createGalleryId();
      const getData = () => normalizeGalleryData(current.attrs.data);
      const report = (error: unknown) => {
        if (destroyed) return;
        uploadError = error instanceof Error ? error.message : "图片上传失败";
        status.textContent = uploadError;
        status.hidden = false;
        this.options.onError(error);
      };
      const updateData = (value: GalleryData, separateHistory = true) => {
        if (destroyed || !editor.isEditable) return false;
        const pos = getPos();
        if (typeof pos !== "number") return false;
        const found = view.state.doc.nodeAt(pos);
        if (!found || found.type !== current.type) return false;
        const projection = normalizeGalleryData(value);
        if (!projection.id) projection.id = fallbackId;
        let next: unknown;
        try {
          next = mergeGalleryData(found.attrs.data, projection);
        } catch (error) {
          report(error);
          return false;
        }
        if (JSON.stringify(found.attrs.data) === JSON.stringify(next)) return true;
        const transaction = markGalleryMarkupUpdate(
          view.state.tr.setNodeMarkup(pos, undefined, { ...found.attrs, data: next }),
          pos,
          projection.id,
        );
        view.dispatch(separateHistory ? closeHistory(transaction) : transaction);
        if (separateHistory) view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
        return true;
      };
      const ensureData = () => {
        const data = getData();
        if (!data.id) {
          data.id = fallbackId;
          if (!updateData(data)) return null;
        }
        return data;
      };
      const select = () => {
        if (!editor.isEditable) return;
        const pos = getPos();
        if (typeof pos !== "number" || view.state.doc.nodeAt(pos)?.type !== current.type) return;
        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
        view.focus();
      };
      const addFiles = (files: File[]) => {
        if (!editor.isEditable || destroyed || dialog || !files.length) return;
        if (!ensureData()) return;
        const position = getPos();
        if (typeof position !== "number") return;
        const stored = view.state.doc.nodeAt(position)?.attrs.data;
        if (!stored || typeof stored !== "object" || !Array.isArray(stored.images)) {
          report(new Error("图册图片数据无效，请检查原始内容"));
          return;
        }
        uploadError = "";
        status.hidden = true;
        cancelUploads = uploadGalleryImages(editor, position, files, this.options.getUploadImage, report, (count) => {
          if (destroyed) return;
          if (count) {
            status.textContent = "正在上传 " + count + " 张图片…";
            status.hidden = false;
          } else if (uploadError) {
            status.textContent = uploadError;
            status.hidden = false;
          } else status.hidden = true;
        });
      };
      const chooseFiles = () => {
        if (!editor.isEditable || destroyed || dialog) return;
        if (!this.options.getUploadImage()) {
          report(new Error("请先配置图片上传"));
          return;
        }
        select();
        input.click();
      };
      const imageElement = (image: GalleryImage, index: number, grid = false) => {
        const wrapper = doc.createElement("div");
        wrapper.className = "semlo-editor-gallery-image-wrap";
        const picture = doc.createElement("img");
        picture.src = image.src;
        picture.alt = image.title || "图册图片 " + (index + 1);
        picture.draggable = false;
        picture.loading = "lazy";
        const href = safeGalleryLinkURL(image.href);
        const container = doc.createElement(href ? "a" : "span");
        container.className = "semlo-editor-gallery-image";
        if (container instanceof (doc.defaultView?.HTMLAnchorElement ?? HTMLAnchorElement)) {
          container.href = href!;
          container.target = "_blank";
          container.rel = "noopener noreferrer";
          container.addEventListener("click", (event) => {
            if (editor.isEditable) event.preventDefault();
          });
        }
        container.append(picture);
        wrapper.append(container);
        if (grid && image.title) {
          const title = doc.createElement("div");
          title.className = "semlo-editor-gallery-grid-title";
          const text = doc.createElement("span");
          text.textContent = image.title;
          title.append(text);
          wrapper.append(title);
        }
        const actions = doc.createElement("div");
        actions.className = "semlo-editor-gallery-image-actions";
        const zoom = doc.createElement("button");
        zoom.type = "button";
        zoom.setAttribute("aria-label", "放大图片");
        zoom.title = "放大";
        zoom.innerHTML =
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5M14 10l6-6M10 14l-6 6"/></svg>';
        zoom.addEventListener("click", () => {
          const data = getData();
          if (!data.images[index]) return;
          lightbox?.();
          lightboxImages = JSON.stringify(data.images);
          lightbox = openGalleryLightbox(doc, data.images, index, {
            onClose: () => {
              lightbox = undefined;
              lightboxImages = "";
            },
          });
        });
        actions.append(zoom);
        if (href) {
          const open = doc.createElement("a");
          open.href = href;
          open.target = "_blank";
          open.rel = "noopener noreferrer";
          open.setAttribute("aria-label", "打开图片链接");
          open.title = "打开链接";
          open.innerHTML =
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 4h7v7M20 4l-9 9M19 13v6H5V5h6"/></svg>';
          actions.append(open);
        }
        if (editor.isEditable) {
          const remove = doc.createElement("button");
          remove.type = "button";
          remove.setAttribute("aria-label", "删除当前图片");
          remove.title = "删除";
          remove.innerHTML =
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9 7V5h6v2m-9 0 1 12h10l1-12M10 10v6m4-6v6"/></svg>';
          remove.addEventListener("click", () => {
            if (!editor.isEditable) return;
            const data = ensureData();
            if (!data) return;
            const target = data.images.findIndex((item) => item.id === image.id);
            if (target < 0) return;
            data.images.splice(target, 1);
            if (target < activeIndex) activeIndex--;
            activeIndex = Math.max(0, Math.min(activeIndex, data.images.length - 1));
            updateData(data);
          });
          actions.append(remove);
        }
        wrapper.append(actions);
        return wrapper;
      };
      const paintContent = (data: GalleryData) => {
        activeIndex = Math.max(0, Math.min(activeIndex, data.images.length - 1));
        const key = JSON.stringify([data.layout, data.images, activeIndex, editor.isEditable]);
        if (key === renderKey) return;
        const previousStage = navigationPending
          ? content.querySelector<HTMLElement>(".semlo-editor-gallery-stage")
          : null;
        const previousHeight = previousStage?.getBoundingClientRect().height ?? 0;
        const previousImage = slideDirection
          ? previousStage?.querySelector<HTMLElement>(".semlo-editor-gallery-image-wrap")?.cloneNode(true)
          : null;
        for (const animation of slideAnimations) animation.cancel();
        slideAnimations = [];
        renderKey = key;
        navigationPending = false;
        content.replaceChildren();
        content.dataset.layout = data.layout;
        if (!data.images.length) {
          slideDirection = 0;
          return;
        }
        if (data.layout === "grid" || data.images.length === 1) {
          slideDirection = 0;
          const grid = doc.createElement("div");
          grid.className = "semlo-editor-gallery-grid";
          grid.dataset.columns = String(Math.min(3, data.images.length));
          data.images.forEach((image, index) => grid.append(imageElement(image, index, true)));
          content.append(grid);
          return;
        }
        const stage = doc.createElement("div");
        stage.className = "semlo-editor-gallery-stage";
        const image = data.images[activeIndex];
        stage.append(imageElement(image, activeIndex));
        const nextPicture = stage.querySelector<HTMLImageElement>(".semlo-editor-gallery-image img");
        if (nextPicture) {
          if (previousHeight > 0 && !nextPicture.complete) stage.style.minHeight = `${previousHeight}px`;
          nextPicture.addEventListener(
            "load",
            () => {
              delete stage.dataset.imageFailed;
              stage.style.removeProperty("min-height");
            },
            { once: true },
          );
          nextPicture.addEventListener(
            "error",
            () => {
              stage.dataset.imageFailed = "true";
              stage.style.removeProperty("min-height");
            },
            { once: true },
          );
        }
        if (
          previousImage instanceof (doc.defaultView?.HTMLElement ?? HTMLElement) &&
          slideDirection &&
          !reducedMotion?.matches &&
          typeof previousImage.animate === "function"
        ) {
          const direction = slideDirection;
          const currentImage = stage.querySelector<HTMLElement>(".semlo-editor-gallery-image-wrap")!;
          previousImage.classList.add("semlo-editor-gallery-slide-out");
          previousImage.setAttribute("aria-hidden", "true");
          previousImage.inert = true;
          content.append(previousImage);
          const timing: KeyframeAnimationOptions = { duration: 700, easing: "ease-in-out" };
          const oldAnimation = previousImage.animate(
            [{ transform: "translateX(0)" }, { transform: `translateX(${-direction * 100}%)` }],
            timing,
          );
          const newAnimation = currentImage.animate(
            [{ transform: `translateX(${direction * 100}%)` }, { transform: "translateX(0)" }],
            timing,
          );
          slideAnimations = [oldAnimation, newAnimation];
          void oldAnimation.finished.then(() => previousImage.remove()).catch(() => previousImage.remove());
        }
        slideDirection = 0;
        const overlay = doc.createElement("div");
        overlay.className = "semlo-editor-gallery-caption";
        overlay.dataset.hasTitle = String(Boolean(image.title));
        const caption = doc.createElement("span");
        caption.textContent = image.title;
        overlay.append(caption);
        const dots = doc.createElement("div");
        dots.className = "semlo-editor-gallery-dots";
        dots.setAttribute("aria-label", "选择图册图片");
        data.images.forEach((_, index) => {
          const dot = doc.createElement("button");
          dot.type = "button";
          dot.setAttribute("aria-label", "第 " + (index + 1) + " 张图片");
          dot.setAttribute("aria-pressed", String(index === activeIndex));
          dot.addEventListener("click", (event) => {
            if (index === activeIndex) return;
            navigationPending = true;
            slideDirection = event.detail ? (index > activeIndex ? 1 : -1) : 0;
            activeIndex = index;
            paintContent(getData());
            if (!event.detail)
              content
                .querySelector<HTMLButtonElement>('.semlo-editor-gallery-dots button[aria-pressed="true"]')
                ?.focus({
                  preventScroll: true,
                });
          });
          dots.append(dot);
        });
        overlay.append(dots);
        stage.append(overlay);
        content.append(stage);
        if (nextPicture?.complete && nextPicture.currentSrc === nextPicture.src && !nextPicture.naturalWidth)
          stage.dataset.imageFailed = "true";
        if (data.layout === "thumbnail") {
          const thumbnails = doc.createElement("div");
          thumbnails.className = "semlo-editor-gallery-thumbnails";
          thumbnails.setAttribute("aria-label", "图册缩略图");
          data.images.forEach((item, index) => {
            const thumb = doc.createElement("button");
            thumb.type = "button";
            thumb.setAttribute("aria-label", "查看第 " + (index + 1) + " 张图片");
            thumb.setAttribute("aria-pressed", String(index === activeIndex));
            const img = doc.createElement("img");
            img.src = item.src;
            img.alt = "";
            img.draggable = false;
            thumb.append(img);
            thumb.addEventListener("click", (event) => {
              if (index === activeIndex) return;
              navigationPending = true;
              slideDirection = event.detail ? (index > activeIndex ? 1 : -1) : 0;
              activeIndex = index;
              paintContent(getData());
              if (!event.detail)
                content
                  .querySelector<HTMLButtonElement>('.semlo-editor-gallery-thumbnails button[aria-pressed="true"]')
                  ?.focus({ preventScroll: true });
            });
            thumbnails.append(thumb);
          });
          content.append(thumbnails);
        }
      };
      const paint = () => {
        if (destroyed) return;
        const data = getData();
        empty.hidden = data.images.length > 0;
        content.hidden = data.images.length === 0;
        upload.disabled = !editor.isEditable;
        toolbar.hidden = !selected || !editor.isEditable;
        surface.classList.toggle("is-empty", data.images.length === 0);
        surface.classList.toggle("is-selected", selected && editor.isEditable);
        paintContent(data);
      };
      switchLayout.addEventListener("mousedown", (event) => event.preventDefault());
      switchLayout.addEventListener("click", () => {
        if (!editor.isEditable) return;
        const data = ensureData();
        if (!data) return;
        const layouts: GalleryLayout[] = ["carousel", "thumbnail", "grid"];
        data.layout = layouts[(layouts.indexOf(data.layout) + 1) % layouts.length];
        updateData(data);
      });
      const openSettings = (initialFiles?: readonly File[]) => {
        if (!editor.isEditable || destroyed || dialog) return;
        cancelUploads?.();
        cancelUploads = undefined;
        status.hidden = true;
        const data = ensureData();
        if (!data) return;
        const id = data.id;
        const pos = getPos();
        if (typeof pos !== "number") return;
        dialogTarget = { pos, id };
        dialog = openGalleryDialog(doc, data, {
          getUploadImage: this.options.getUploadImage,
          initialFiles,
          onCommit: (next) => {
            if (destroyed || !editor.isEditable || getData().id !== id) return;
            updateData({ ...next, id });
          },
          onClose: () => {
            dialog = undefined;
            dialogTarget = undefined;
          },
          onError: (error) => this.options.onError(error),
        });
      };
      edit.addEventListener("mousedown", (event) => event.preventDefault());
      edit.addEventListener("click", () => openSettings());
      upload.addEventListener("click", chooseFiles);
      input.addEventListener("change", () => {
        const files = Array.from(input.files ?? []);
        input.value = "";
        if (!files.some((file) => file.type.startsWith("image/"))) return;
        if (!getData().images.length) openSettings(files);
        else addFiles(files);
      });
      surface.addEventListener("mousedown", (event) => {
        if (!editor.isEditable || event.button !== 0) return;
        const target = event.target;
        if (
          target instanceof (doc.defaultView?.Element ?? Element) &&
          target.closest(
            ".semlo-editor-gallery-upload-button,.semlo-editor-gallery-image-actions,.semlo-editor-gallery-dots,.semlo-editor-gallery-thumbnails",
          )
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        select();
      });
      surface.addEventListener("dragover", (event) => {
        if (!event.dataTransfer?.types.includes("Files")) return;
        event.preventDefault();
        event.stopPropagation();
        if (editor.isEditable && !dialog) surface.classList.add("is-dragging");
      });
      surface.addEventListener("dragleave", () => surface.classList.remove("is-dragging"));
      surface.addEventListener("drop", (event) => {
        if (!event.dataTransfer?.types.includes("Files")) return;
        event.preventDefault();
        event.stopPropagation();
        surface.classList.remove("is-dragging");
        addFiles(Array.from(event.dataTransfer.files));
      });
      const editableChanged = () => {
        if (!editor.isEditable) {
          dialog?.();
          cancelUploads?.();
          cancelUploads = undefined;
          status.hidden = true;
          surface.classList.remove("is-dragging");
        }
        paint();
      };
      const editorUpdated = () => {
        if (!editor.isEditable) editableChanged();
      };
      const documentReplacing = () => {
        dialog?.();
      };
      const trackDialog = ({
        transaction,
        appendedTransactions = [],
      }: {
        transaction: Transaction;
        appendedTransactions?: Transaction[];
      }) => {
        if (!dialog || !dialogTarget) return;
        const finalDoc = appendedTransactions.at(-1)?.doc ?? transaction.doc;
        if (
          transaction.before.eq(finalDoc) &&
          transaction.before.nodeAt(dialogTarget.pos) === finalDoc.nodeAt(dialogTarget.pos)
        )
          return;
        let changed = false;
        for (const part of [transaction, ...appendedTransactions]) {
          if (!part.docChanged) continue;
          changed = true;
          if (part.before.eq(part.doc) && part.before.nodeAt(dialogTarget.pos) === part.doc.nodeAt(dialogTarget.pos))
            continue;
          const pos = mapGalleryPosition(part, dialogTarget.pos, dialogTarget.id);
          if (pos === null) return dialog();
          dialogTarget.pos = pos;
        }
        if (!changed) return;
        const node = view.state.doc.nodeAt(dialogTarget.pos);
        if (node?.type.name !== "semloEditorGallery" || node.attrs.data?.id !== dialogTarget.id) dialog();
      };
      view.dom.addEventListener("semlo-editor:editable", editableChanged);
      view.dom.addEventListener("semlo-editor:document-replace", documentReplacing);
      editor.on("transaction", trackDialog);
      editor.on("update", editorUpdated);
      paint();
      return {
        dom,
        update(node) {
          if (node.type !== current.type) return false;
          const before = getData();
          const after = normalizeGalleryData(node.attrs.data);
          if (dialog && JSON.stringify(before) !== JSON.stringify(after)) dialog();
          if (before.id !== after.id) {
            cancelUploads?.();
            cancelUploads = undefined;
            status.hidden = true;
            activeIndex = 0;
          }
          current = node;
          if (lightbox && lightboxImages !== JSON.stringify(getData().images)) lightbox();
          paint();
          return true;
        },
        selectNode() {
          selected = true;
          paint();
        },
        deselectNode() {
          selected = false;
          paint();
        },
        stopEvent(event) {
          const target = event.target as globalThis.Node;
          return (
            toolbar.contains(target) ||
            upload.contains(target) ||
            input.contains(target) ||
            !!(
              target instanceof (doc.defaultView?.Element ?? Element) &&
              target.closest(
                ".semlo-editor-gallery-dots,.semlo-editor-gallery-thumbnails,.semlo-editor-gallery-image-actions",
              )
            )
          );
        },
        ignoreMutation: () => true,
        destroy() {
          destroyed = true;
          for (const animation of slideAnimations) animation.cancel();
          reducedMotion?.removeEventListener("change", onReducedMotionChange);
          dialog?.();
          lightbox?.();
          cancelUploads?.();
          view.dom.removeEventListener("semlo-editor:editable", editableChanged);
          view.dom.removeEventListener("semlo-editor:document-replace", documentReplacing);
          editor.off("transaction", trackDialog);
          editor.off("update", editorUpdated);
        },
      };
    };
  },
});
