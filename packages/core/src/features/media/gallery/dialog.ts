import type { ImageUpload } from "../../../types";
import { topMediaModal } from "../shared/modal-order";
import type { GalleryData, GalleryImage, GalleryLayout } from "./extension";
import { createGalleryUploads } from "./uploads";

export interface GalleryDialogOptions {
  getUploadImage: () => ImageUpload | undefined;
  initialFiles?: readonly File[];
  onCommit: (data: GalleryData) => void;
  onClose?: () => void;
  onError?: (error: unknown) => void;
}

const layouts: Array<{ value: GalleryLayout; label: string }> = [
  { value: "carousel", label: "轮播" },
  { value: "thumbnail", label: "带缩略图的轮播" },
  { value: "grid", label: "平铺" },
];

function pictureNumber(index: number): string {
  const digits = "零一二三四五六七八九";
  const value = index + 1;
  if (value < 10) return digits[value];
  if (value < 100)
    return `${value < 20 ? "" : digits[Math.floor(value / 10)]}十${value % 10 ? digits[value % 10] : ""}`;
  return String(value);
}

/** Edit a private draft and publish it only when the user confirms. */
export function openGalleryDialog(doc: Document, initialData: GalleryData, options: GalleryDialogOptions): () => void {
  const draft: GalleryData = { ...initialData, images: initialData.images.map((image) => ({ ...image })) };
  let selected = draft.images.length ? 0 : -1;
  let pending = 0;
  let closed = false;
  let draggedId: string | undefined;
  let stopTouchDrag: (() => void) | undefined;
  let removingId: string | undefined;
  let nextImageId = 0;
  const previousFocus = doc.activeElement?.nodeType === 1 ? (doc.activeElement as HTMLElement) : null;

  const overlay = doc.createElement("div");
  overlay.className = "semlo-editor-gallery-dialog-overlay";
  const dialog = doc.createElement("div");
  dialog.className = "semlo-editor-gallery-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "图册设置");
  const header = doc.createElement("div");
  header.className = "semlo-editor-gallery-dialog-header";
  const heading = doc.createElement("h2");
  heading.textContent = "图册设置";
  const closeButton = doc.createElement("button");
  closeButton.type = "button";
  closeButton.className = "semlo-editor-gallery-dialog-close";
  closeButton.setAttribute("aria-label", "关闭图册设置");
  closeButton.innerHTML =
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.6 2.6l10.8 10.8M13.4 2.6L2.6 13.4"/></svg>';
  header.append(heading, closeButton);

  const body = doc.createElement("div");
  body.className = "semlo-editor-gallery-dialog-body";
  const layoutTitle = doc.createElement("div");
  layoutTitle.className = "semlo-editor-gallery-dialog-label";
  layoutTitle.textContent = "版式选择";
  const layoutGroup = doc.createElement("div");
  layoutGroup.className = "semlo-editor-gallery-layouts";
  layoutGroup.setAttribute("role", "group");
  layoutGroup.setAttribute("aria-label", "图册版式");
  const layoutButtons = layouts.map(({ value, label }, index) => {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = `semlo-editor-gallery-layout semlo-editor-gallery-layout-${index + 1}`;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", String(draft.layout === value));
    button.innerHTML =
      '<span class="semlo-editor-gallery-layout-art" aria-hidden="true"><span class="semlo-editor-gallery-layout-image"></span><span class="semlo-editor-gallery-layout-detail"></span></span>';
    button.addEventListener("click", () => {
      draft.layout = value;
      layoutButtons.forEach((item, buttonIndex) => item.setAttribute("aria-pressed", String(buttonIndex === index)));
    });
    layoutGroup.append(button);
    return button;
  });

  const imagesTitle = doc.createElement("div");
  imagesTitle.className = "semlo-editor-gallery-dialog-label semlo-editor-gallery-images-label";
  imagesTitle.textContent = "上传图片";
  const imageRow = doc.createElement("div");
  imageRow.className = "semlo-editor-gallery-image-row";
  const images = doc.createElement("div");
  images.className = "semlo-editor-gallery-image-list";
  const upload = doc.createElement("button");
  upload.type = "button";
  upload.className = "semlo-editor-gallery-upload";
  upload.setAttribute("aria-label", "上传图片");
  upload.innerHTML = '<span aria-hidden="true">＋</span>';
  const inputFile = doc.createElement("input");
  inputFile.type = "file";
  inputFile.accept = ".svg,.png,.bmp,.jpg,.jpeg,.gif,.tif,.tiff,.emf,.webp,.heic";
  inputFile.multiple = true;
  inputFile.hidden = true;
  inputFile.setAttribute("aria-label", "选择图片文件");
  upload.addEventListener("click", () => inputFile.click());
  const uploadStatus = doc.createElement("div");
  uploadStatus.className = "semlo-editor-gallery-upload-status";
  uploadStatus.setAttribute("role", "status");

  const titleLabel = doc.createElement("label");
  titleLabel.className = "semlo-editor-gallery-field";
  const titleText = doc.createElement("span");
  const titleInput = doc.createElement("input");
  titleInput.type = "text";
  titleInput.placeholder = "输入标题（选填）";
  titleLabel.append(titleText, titleInput);
  const hrefLabel = doc.createElement("label");
  hrefLabel.className = "semlo-editor-gallery-field";
  const hrefText = doc.createElement("span");
  const hrefInput = doc.createElement("input");
  hrefInput.type = "text";
  hrefInput.placeholder = "插入链接（选填）";
  hrefLabel.append(hrefText, hrefInput);
  titleInput.addEventListener("input", () => {
    if (draft.images[selected]) draft.images[selected].title = titleInput.value;
  });
  hrefInput.addEventListener("input", () => {
    if (draft.images[selected]) draft.images[selected].href = hrefInput.value;
  });
  imageRow.append(upload, images);
  body.append(layoutTitle, layoutGroup, imagesTitle, imageRow, inputFile, uploadStatus, titleLabel, hrefLabel);

  const footer = doc.createElement("div");
  footer.className = "semlo-editor-gallery-dialog-footer";
  const cancel = doc.createElement("button");
  cancel.type = "button";
  cancel.className = "semlo-editor-gallery-dialog-cancel";
  cancel.textContent = "取消";
  const confirm = doc.createElement("button");
  confirm.type = "button";
  confirm.className = "semlo-editor-gallery-dialog-confirm";
  confirm.textContent = "确定";
  footer.append(cancel, confirm);
  dialog.append(header, body, footer);
  overlay.append(dialog);

  const drawFields = () => {
    const image = draft.images[selected];
    const suffix = image ? `（图片${pictureNumber(selected)}）` : "";
    titleText.textContent = `标题${suffix}`;
    hrefText.textContent = `链接${suffix}`;
    titleInput.disabled = !image;
    hrefInput.disabled = !image;
    titleInput.value = image?.title ?? "";
    hrefInput.value = image?.href ?? "";
  };
  const fitDeleteConfirmation = () => {
    const confirmation = dialog.querySelector<HTMLElement>(".semlo-editor-gallery-delete-confirm");
    const thumbnail = [...images.querySelectorAll<HTMLElement>(".semlo-editor-gallery-thumbnail")].find(
      (element) => element.dataset.galleryImageId === removingId,
    );
    if (!confirmation || !thumbnail) return;
    const target = thumbnail.getBoundingClientRect();
    const container = body.getBoundingClientRect();
    const bounds = confirmation.getBoundingClientRect();
    confirmation.style.left = `${Math.max(container.left + 8, Math.min(target.left + target.width / 2 - bounds.width / 2, container.right - bounds.width - 8))}px`;
    confirmation.style.top = `${target.top - bounds.height - 8}px`;
  };
  const syncImageScroll = () => {
    if (images.clientWidth) images.classList.toggle("has-scrollbar", images.scrollWidth > images.clientWidth + 1);
    fitDeleteConfirmation();
  };
  const reorder = (from: number, to: number) => {
    if (from < 0 || to < 0 || from >= draft.images.length || to >= draft.images.length || from === to) return;
    const selectedImage = draft.images[selected];
    const [image] = draft.images.splice(from, 1);
    draft.images.splice(to, 0, image);
    selected = selectedImage ? draft.images.indexOf(selectedImage) : -1;
    drawImages();
  };
  const drawImages = () => {
    stopTouchDrag?.();
    dialog.querySelector(".semlo-editor-gallery-delete-confirm")?.remove();
    images.replaceChildren();
    draft.images.forEach((image, index) => {
      const thumbnail = doc.createElement("div");
      thumbnail.className = "semlo-editor-gallery-thumbnail";
      thumbnail.draggable = true;
      thumbnail.dataset.galleryImageId = image.id;
      thumbnail.classList.toggle("selected", selected === index);
      thumbnail.addEventListener("dragstart", (event) => {
        draggedId = image.id;
        thumbnail.classList.add("is-dragging");
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", image.id);
        }
      });
      thumbnail.addEventListener("dragend", () => {
        draggedId = undefined;
        thumbnail.classList.remove("is-dragging");
      });
      thumbnail.addEventListener("dragover", (event) => {
        if (!draggedId) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      });
      thumbnail.addEventListener("drop", (event) => {
        if (!draggedId) return;
        event.preventDefault();
        const from = draft.images.findIndex((item) => item.id === draggedId);
        draggedId = undefined;
        reorder(from, index);
      });
      const select = doc.createElement("button");
      select.type = "button";
      select.className = "semlo-editor-gallery-thumbnail-select";
      select.setAttribute("aria-label", `图片${pictureNumber(index)}`);
      select.setAttribute("aria-pressed", String(selected === index));
      const preview = doc.createElement("img");
      preview.src = image.src;
      preview.alt = "";
      preview.draggable = false;
      select.append(preview);
      select.addEventListener("click", () => {
        removingId = undefined;
        selected = index;
        drawImages();
        [...images.querySelectorAll<HTMLElement>(".semlo-editor-gallery-thumbnail")]
          .find((element) => element.dataset.galleryImageId === image.id)
          ?.querySelector<HTMLButtonElement>(".semlo-editor-gallery-thumbnail-select")
          ?.focus({ preventScroll: true });
      });
      thumbnail.append(select);
      {
        const handle = doc.createElement("button");
        handle.type = "button";
        handle.draggable = true;
        handle.className = "semlo-editor-gallery-thumbnail-handle";
        handle.setAttribute("aria-label", `拖动图片${pictureNumber(index)}`);
        handle.innerHTML =
          '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="5.5" cy="3.3" r="1.125"/><circle cx="10.5" cy="3.3" r="1.125"/><circle cx="5.5" cy="8" r="1.125"/><circle cx="10.5" cy="8" r="1.125"/><circle cx="5.5" cy="12.7" r="1.125"/><circle cx="10.5" cy="12.7" r="1.125"/></svg>';
        handle.addEventListener("pointerdown", (event) => {
          if (event.pointerType !== "touch" || !event.isPrimary || event.button !== 0 || stopTouchDrag) return;
          const pointerId = event.pointerId;
          const startX = event.clientX;
          const startY = event.clientY;
          let moving = false;
          let highlighted: HTMLElement | null = null;
          const targetAt = (x: number, y: number) => {
            const target = doc.elementFromPoint(x, y)?.closest<HTMLElement>(".semlo-editor-gallery-thumbnail");
            return target && images.contains(target) ? target : null;
          };
          const clear = () => {
            highlighted?.classList.remove("is-touch-drop-target");
            doc.removeEventListener("pointermove", move, true);
            doc.removeEventListener("pointerup", finish, true);
            doc.removeEventListener("pointercancel", cancel, true);
            doc.defaultView?.removeEventListener("blur", cancel);
            stopTouchDrag = undefined;
          };
          const move = (next: PointerEvent) => {
            if (next.pointerId !== pointerId) return;
            if (!moving && Math.hypot(next.clientX - startX, next.clientY - startY) < 8) return;
            moving = true;
            next.preventDefault();
            const candidate = targetAt(next.clientX, next.clientY);
            if (candidate !== highlighted) {
              highlighted?.classList.remove("is-touch-drop-target");
              highlighted = candidate;
              highlighted?.classList.add("is-touch-drop-target");
            }
          };
          const finish = (next: PointerEvent) => {
            if (next.pointerId !== pointerId) return;
            const from = draft.images.findIndex((item) => item.id === image.id);
            const targetId = targetAt(next.clientX, next.clientY)?.dataset.galleryImageId;
            const to = draft.images.findIndex((item) => item.id === targetId);
            clear();
            if (moving) {
              next.preventDefault();
              reorder(from, to);
            }
          };
          const cancel = (next: Event) => {
            if (next.type === "pointercancel" && (next as PointerEvent).pointerId !== pointerId) return;
            clear();
          };
          stopTouchDrag = clear;
          doc.addEventListener("pointermove", move, true);
          doc.addEventListener("pointerup", finish, true);
          doc.addEventListener("pointercancel", cancel, true);
          doc.defaultView?.addEventListener("blur", cancel);
        });
        handle.addEventListener("keydown", (event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const target = index + (event.key === "ArrowLeft" ? -1 : 1);
          reorder(index, target);
          [...images.querySelectorAll<HTMLElement>(".semlo-editor-gallery-thumbnail")]
            .find((element) => element.dataset.galleryImageId === image.id)
            ?.querySelector<HTMLButtonElement>(".semlo-editor-gallery-thumbnail-handle")
            ?.focus();
        });
        const remove = doc.createElement("button");
        remove.type = "button";
        remove.className = "semlo-editor-gallery-thumbnail-remove";
        remove.setAttribute("aria-label", `删除图片${pictureNumber(index)}`);
        remove.innerHTML =
          '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4.9h11M5.3 2.4h5.4M4.1 5l.4 7a1.4 1.4 0 0 0 1.4 1.3h4.2a1.4 1.4 0 0 0 1.4-1.3l.4-7M6.7 7.4v3M9.3 7.4v3"/></svg>';
        remove.addEventListener("click", () => {
          removingId = removingId === image.id ? undefined : image.id;
          drawImages();
        });
        thumbnail.append(handle, remove);
        if (removingId === image.id) {
          const confirmation = doc.createElement("div");
          confirmation.className = "semlo-editor-gallery-delete-confirm";
          confirmation.setAttribute("role", "alertdialog");
          confirmation.setAttribute("aria-label", "删除图片确认");
          const message = doc.createElement("div");
          message.textContent = "确认删除该图片？";
          const actions = doc.createElement("div");
          actions.className = "semlo-editor-gallery-delete-actions";
          const cancelDelete = doc.createElement("button");
          cancelDelete.type = "button";
          cancelDelete.textContent = "取消";
          cancelDelete.addEventListener("click", () => {
            removingId = undefined;
            drawImages();
          });
          const confirmDelete = doc.createElement("button");
          confirmDelete.type = "button";
          confirmDelete.textContent = "确定";
          confirmDelete.addEventListener("click", () => {
            draft.images.splice(index, 1);
            selected = draft.images.length ? 0 : -1;
            removingId = undefined;
            drawImages();
          });
          actions.append(cancelDelete, confirmDelete);
          confirmation.append(message, actions);
          dialog.append(confirmation);
        }
      }
      images.append(thumbnail);
    });
    drawFields();
    syncImageScroll();
  };
  const uploads = createGalleryUploads({
    getUpload: options.getUploadImage,
    onSuccess: ({ url }) => {
      let id: string;
      do id = `image-${Date.now().toString(36)}-${++nextImageId}`;
      while (draft.images.some((image) => image.id === id));
      const image: GalleryImage = { id, src: url, title: "", href: "" };
      draft.images.push(image);
      if (selected < 0) selected = 0;
      drawImages();
    },
    onError: (error) => {
      uploadStatus.textContent = error instanceof Error ? error.message : "图片上传失败";
      options.onError?.(error);
    },
    onPendingChange: (value) => {
      pending = value;
      confirm.disabled = pending > 0;
      if (pending > 0) uploadStatus.textContent = `正在上传 ${pending} 张图片…`;
      else if (uploadStatus.textContent?.startsWith("正在上传")) uploadStatus.textContent = "";
    },
  });
  inputFile.addEventListener("change", () => {
    const files = Array.from(inputFile.files ?? []);
    inputFile.value = "";
    if (files.length) {
      uploadStatus.textContent = "";
      uploads.add(files);
    }
  });

  const close = () => {
    if (closed) return;
    const restoreFocus = topMediaModal(doc) === overlay;
    closed = true;
    stopTouchDrag?.();
    uploads.destroy();
    doc.removeEventListener("keydown", keyboard, true);
    doc.defaultView?.removeEventListener("resize", syncImageScroll);
    images.removeEventListener("scroll", fitDeleteConfirmation);
    body.removeEventListener("scroll", fitDeleteConfirmation);
    overlay.remove();
    if (!restoreFocus && previousFocus?.isConnected) {
      const top = topMediaModal(doc);
      if (top) Reflect.set(top, "__semloGalleryReturnFocus", previousFocus);
    }
    if (restoreFocus) {
      const next = topMediaModal(doc);
      const returnFocus = previousFocus?.isConnected
        ? previousFocus
        : (Reflect.get(overlay, "__semloGalleryReturnFocus") as HTMLElement | undefined);
      if (next && returnFocus && !next.contains(returnFocus))
        Reflect.set(next, "__semloGalleryReturnFocus", returnFocus);
      const focus =
        next && (!returnFocus || !next.contains(returnFocus))
          ? next.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled), [tabindex]")
          : returnFocus;
      if (focus?.isConnected) focus.focus({ preventScroll: true });
    }
    options.onClose?.();
  };
  const keyboard = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (topMediaModal(doc) !== overlay) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (removingId) {
        removingId = undefined;
        drawImages();
      } else close();
    } else if (event.key === "Tab") {
      event.stopImmediatePropagation();
      const focusable = [...dialog.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)")];
      if (!focusable.length) return;
      const current = focusable.indexOf(doc.activeElement as HTMLElement);
      if (event.shiftKey && current <= 0) {
        event.preventDefault();
        focusable.at(-1)?.focus();
      } else if (!event.shiftKey && (current < 0 || current === focusable.length - 1)) {
        event.preventDefault();
        focusable[0].focus();
      }
    }
  };
  closeButton.addEventListener("click", close);
  cancel.addEventListener("click", close);
  confirm.addEventListener("click", () => {
    if (pending || closed) return;
    options.onCommit({ ...draft, images: draft.images.map((image) => ({ ...image })) });
    close();
  });
  dialog.addEventListener("pointerdown", (event) => {
    const target = event.target as Element | null;
    if (!removingId || target?.closest(".semlo-editor-gallery-delete-confirm, .semlo-editor-gallery-thumbnail-remove"))
      return;
    removingId = undefined;
    dialog.querySelector(".semlo-editor-gallery-delete-confirm")?.remove();
  });
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  doc.addEventListener("keydown", keyboard, true);
  doc.defaultView?.addEventListener("resize", syncImageScroll);
  images.addEventListener("scroll", fitDeleteConfirmation);
  body.addEventListener("scroll", fitDeleteConfirmation);
  drawImages();
  doc.body.append(overlay);
  syncImageScroll();
  if (topMediaModal(doc) === overlay) closeButton.focus({ preventScroll: true });
  if (options.initialFiles?.length) uploads.add(options.initialFiles);
  return close;
}
