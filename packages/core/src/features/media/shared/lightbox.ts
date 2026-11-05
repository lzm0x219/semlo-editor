import type { ImageCropRect } from "./crop";
import { topMediaModal } from "./modal-order";
import { fullImageCrop, imageCrop, imageCropClip, imageRotation, imageTransform, turned } from "./transform";

export interface GalleryLightboxImage {
  src: string;
  title: string;
  rotation?: number;
  crop?: ImageCropRect | null;
}

export interface GalleryLightboxOptions {
  onClose?: () => void;
  onIndexChange?: (index: number) => void;
  ariaLabel?: string;
}

const icons: Record<string, string> = {
  close: '<path d="M4 4l16 16M20 4 4 20"/>',
  previous: '<path d="m15 5-7 7 7 7"/>',
  next: '<path d="m9 5 7 7-7 7"/>',
  zoomOut: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M7.5 10.5h6M15.5 15.5 20 20"/>',
  zoomIn: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M7.5 10.5h6M10.5 7.5v6M15.5 15.5 20 20"/>',
  fullscreen: '<path d="M8 16l-4 4M4 16v4h4M16 8l4-4M16 4h4v4"/>',
};
const icon = (name: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;

/** Display a gallery image without changing the editor document. */
export function openGalleryLightbox(
  doc: Document,
  images: readonly GalleryLightboxImage[],
  initialIndex: number,
  options: GalleryLightboxOptions = {},
): () => void {
  if (!images.length) return () => {};
  const entries = images.map((image) => ({ ...image }));
  const start = Number.isFinite(initialIndex) ? Math.trunc(initialIndex) : 0;
  let index = Math.max(0, Math.min(entries.length - 1, start));
  let scale = 1;
  let fitScale = 1;
  let fitToViewport = true;
  let scaleChanged = false;
  let fitActivated = false;
  let closed = false;
  let pan: { id: number; x: number; y: number; left: number; top: number; canPan: boolean } | undefined;
  let panMoved = false;
  let suppressClick = false;
  let panStartedOnImage = false;
  let zoomAnimation: Animation | undefined;
  let slideOld: HTMLElement | undefined;
  let slideOffset = 0;
  let slideCounter: string | undefined;
  let slideAnimations: Animation[] = [];
  const reducedMotion = doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)");
  const motionChanged = () => {
    if (reducedMotion?.matches) {
      zoomAnimation?.cancel();
      zoomAnimation = undefined;
      clearSlide();
    }
  };
  const previousFocus = doc.activeElement?.nodeType === 1 ? (doc.activeElement as HTMLElement) : null;

  const overlay = doc.createElement("div");
  overlay.className = "semlo-editor-gallery-lightbox";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", options.ariaLabel || "图册图片预览");
  overlay.tabIndex = -1;
  const closeButton = doc.createElement("button");
  closeButton.type = "button";
  closeButton.className = "semlo-editor-gallery-lightbox-close";
  closeButton.setAttribute("aria-label", "关闭图片预览");
  closeButton.title = "Close (Esc)";
  closeButton.innerHTML = icon("close");
  const stage = doc.createElement("div");
  stage.className = "semlo-editor-gallery-lightbox-stage";
  const canvas = doc.createElement("div");
  canvas.className = "semlo-editor-gallery-lightbox-canvas";
  const image = doc.createElement("img");
  image.className = "semlo-editor-gallery-lightbox-image";
  image.draggable = false;
  const imageFrame = doc.createElement("div");
  imageFrame.className = "semlo-editor-gallery-lightbox-image-frame";
  imageFrame.append(image);
  const loading = doc.createElement("div");
  loading.className = "semlo-editor-gallery-lightbox-loading";
  loading.setAttribute("role", "status");
  canvas.append(imageFrame, loading);
  stage.append(canvas);
  const controls = doc.createElement("div");
  controls.className = "semlo-editor-gallery-lightbox-controls";
  controls.setAttribute("role", "toolbar");
  controls.setAttribute("aria-label", "图片预览工具");
  const button = (label: string, glyph: string) => {
    const control = doc.createElement("button");
    control.type = "button";
    control.setAttribute("aria-label", label);
    control.dataset.tooltip = label;
    control.innerHTML = icon(glyph);
    return control;
  };
  const previous = button("上一张", "previous");
  const counter = doc.createElement("span");
  counter.className = "semlo-editor-gallery-lightbox-counter";
  counter.setAttribute("aria-live", "polite");
  const next = button("下一张", "next");
  const zoomOut = button("缩小", "zoomOut");
  const zoomIn = button("放大", "zoomIn");
  const actualSize = doc.createElement("button");
  actualSize.type = "button";
  actualSize.className = "semlo-editor-gallery-lightbox-actual-size";
  actualSize.setAttribute("aria-label", "原始大小");
  actualSize.dataset.tooltip = "实际尺寸";
  actualSize.textContent = "1:1";
  const fitSize = button("最佳大小", "fullscreen");
  fitSize.dataset.tooltip = "适应屏幕";
  const separator = doc.createElement("span");
  separator.className = "semlo-editor-gallery-lightbox-separator";
  separator.setAttribute("aria-hidden", "true");
  controls.append(previous, counter, next, separator, zoomOut, zoomIn, actualSize, fitSize);
  overlay.append(stage, closeButton, controls);

  const updateControls = () => {
    const ready = Boolean(image.naturalWidth && image.naturalHeight && !image.hidden);
    previous.disabled = entries.length < 2;
    next.disabled = entries.length < 2;
    zoomOut.disabled = !ready || scale <= Math.min(0.05, fitScale / 2);
    zoomIn.disabled = !ready || scale >= 5;
    image.style.cursor = fitScale < 1 ? "zoom-in" : "zoom-out";
    actualSize.disabled = !ready;
    actualSize.setAttribute("aria-pressed", String(ready && Math.abs(scale - 1) < 1e-8));
    fitSize.disabled = !ready || fitScale >= 1 || !scaleChanged;
    fitSize.setAttribute("aria-pressed", String(fitActivated));
    counter.textContent = slideCounter ?? `${index + 1} / ${entries.length}`;
  };
  const sizeImage = () => {
    if (!image.naturalWidth || !image.naturalHeight) return;
    const rotation = imageRotation(entries[index].rotation);
    const crop = imageCrop(entries[index].crop);
    const rect = crop ?? fullImageCrop();
    const width = (turned(rotation) ? image.naturalHeight : image.naturalWidth) * rect.width * scale;
    const height = (turned(rotation) ? image.naturalWidth : image.naturalHeight) * rect.height * scale;
    imageFrame.style.width = `${width}px`;
    imageFrame.style.height = `${height}px`;
    image.style.width = `${image.naturalWidth * scale}px`;
    image.style.height = `${image.naturalHeight * scale}px`;
    const geometry = imageTransform(rotation, rect, width, height);
    if ((rotation || crop) && geometry) {
      image.style.position = "absolute";
      image.style.left = `${geometry.left}%`;
      image.style.top = `${geometry.top}%`;
      image.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;
      if (crop) image.style.clipPath = imageCropClip(crop, rotation);
      else image.style.removeProperty("clip-path");
    } else {
      image.style.removeProperty("position");
      image.style.removeProperty("left");
      image.style.removeProperty("top");
      image.style.removeProperty("transform");
      image.style.removeProperty("clip-path");
    }
    stage.classList.toggle("can-pan", width > stage.clientWidth || height > stage.clientHeight);
    stage.scrollLeft = (stage.scrollWidth - stage.clientWidth) / 2;
    stage.scrollTop = (stage.scrollHeight - stage.clientHeight) / 2 + 12;
    updateControls();
  };
  const fitImage = () => {
    if (!image.naturalWidth || !image.naturalHeight) return;
    const rotation = imageRotation(entries[index].rotation);
    const crop = imageCrop(entries[index].crop) ?? fullImageCrop();
    const width = (turned(rotation) ? image.naturalHeight : image.naturalWidth) * crop.width;
    const height = (turned(rotation) ? image.naturalWidth : image.naturalHeight) * crop.height;
    fitScale = Math.min(1, Math.max(1, stage.clientWidth - 64) / width, Math.max(1, stage.clientHeight - 64) / height);
    if (fitToViewport) scale = fitScale;
    sizeImage();
  };
  const clearSlide = () => {
    for (const animation of slideAnimations) animation.cancel();
    slideAnimations = [];
    slideOld?.remove();
    slideOld = undefined;
    slideOffset = 0;
    const hadCounter = slideCounter !== undefined;
    slideCounter = undefined;
    if (hadCounter) updateControls();
  };
  reducedMotion?.addEventListener("change", motionChanged);
  const resizeViewport = () => {
    clearSlide();
    zoomAnimation?.cancel();
    zoomAnimation = undefined;
    fitToViewport = true;
    scaleChanged = false;
    fitActivated = false;
    fitImage();
  };
  const animateResize = (change: () => void, duration: number) => {
    clearSlide();
    const before = imageFrame.getBoundingClientRect();
    zoomAnimation?.cancel();
    zoomAnimation = undefined;
    change();
    const after = imageFrame.getBoundingClientRect();
    if (
      reducedMotion?.matches ||
      typeof imageFrame.animate !== "function" ||
      !before.width ||
      !before.height ||
      !after.width ||
      !after.height
    )
      return;
    const offsetX = before.left + before.width / 2 - (after.left + after.width / 2);
    const offsetY = before.top + before.height / 2 - (after.top + after.height / 2);
    const animation = imageFrame.animate(
      [
        {
          transform: `translate(${offsetX}px, ${offsetY}px) scale(${before.width / after.width}, ${before.height / after.height})`,
        },
        { transform: "none" },
      ],
      { duration, easing: "ease-in-out" },
    );
    zoomAnimation = animation;
    animation.addEventListener("finish", () => {
      if (zoomAnimation === animation) zoomAnimation = undefined;
    });
  };
  const showImage = () => {
    zoomAnimation?.cancel();
    zoomAnimation = undefined;
    fitToViewport = true;
    scaleChanged = false;
    fitActivated = false;
    image.hidden = true;
    imageFrame.hidden = true;
    image.removeAttribute("src");
    image.style.width = "";
    image.style.height = "";
    image.alt = entries[index].title || `图片 ${index + 1}`;
    loading.textContent = "正在加载图片…";
    loading.hidden = false;
    image.src = entries[index].src;
    updateControls();
  };
  const selectImage = (nextIndex: number) => {
    const wrapped = ((nextIndex % entries.length) + entries.length) % entries.length;
    if (wrapped === index) return;
    clearSlide();
    index = wrapped;
    showImage();
    options.onIndexChange?.(index);
  };
  image.addEventListener("load", () => {
    if (closed) return;
    loading.hidden = true;
    image.hidden = false;
    imageFrame.hidden = false;
    fitImage();
    if (slideOld && !reducedMotion?.matches && typeof imageFrame.animate === "function") {
      const from = (slideOffset < 0 ? 1 : -1) * Math.max(1, stage.clientWidth - 64) * 1.12 + slideOffset;
      const animation = imageFrame.animate([{ transform: `translateX(${from}px)` }, { transform: "none" }], {
        duration: 360,
        easing: "cubic-bezier(0.33, 1, 0.68, 1)",
      });
      slideAnimations.push(animation);
      animation.addEventListener("finish", clearSlide, { once: true });
    }
  });
  image.addEventListener("error", () => {
    if (closed) return;
    clearSlide();
    image.hidden = true;
    imageFrame.hidden = true;
    loading.hidden = false;
    loading.textContent = "图片加载失败";
    updateControls();
  });
  previous.addEventListener("click", () => selectImage(index - 1));
  next.addEventListener("click", () => selectImage(index + 1));
  zoomOut.addEventListener("click", () => {
    animateResize(() => {
      fitToViewport = false;
      scaleChanged = true;
      fitActivated = false;
      scale = Math.max(Math.min(0.05, fitScale / 2), scale / 1.2);
      sizeImage();
    }, 100);
  });
  zoomIn.addEventListener("click", () => {
    animateResize(() => {
      fitToViewport = false;
      scaleChanged = true;
      fitActivated = false;
      scale = Math.min(5, scale * 1.2);
      sizeImage();
    }, 100);
  });
  actualSize.addEventListener("click", () => {
    animateResize(() => {
      fitToViewport = false;
      scaleChanged = true;
      fitActivated = false;
      scale = 1;
      sizeImage();
    }, 100);
  });
  fitSize.addEventListener("click", () => {
    animateResize(() => {
      fitToViewport = true;
      scaleChanged = true;
      fitActivated = true;
      fitImage();
    }, 100);
  });
  stage.addEventListener("pointerdown", (event) => {
    if (pan || !event.isPrimary || event.button !== 0) return;
    clearSlide();
    zoomAnimation?.cancel();
    zoomAnimation = undefined;
    pan = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: stage.scrollLeft,
      top: stage.scrollTop,
      canPan: stage.classList.contains("can-pan"),
    };
    panMoved = false;
    suppressClick = false;
    panStartedOnImage = imageFrame.contains(event.target as globalThis.Node);
    stage.classList.add("panning");
    stage.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  stage.addEventListener("pointermove", (event) => {
    if (!pan || pan.id !== event.pointerId) return;
    if (Math.abs(event.clientX - pan.x) > 3 || Math.abs(event.clientY - pan.y) > 3) panMoved = true;
    const dx = event.clientX - pan.x;
    const dy = event.clientY - pan.y;
    if (pan.canPan) {
      stage.scrollLeft = pan.left - dx;
      stage.scrollTop = pan.top - dy;
    } else if (entries.length > 1 && Math.abs(scale - fitScale) < 0.000001 && Math.abs(dx) > Math.abs(dy)) {
      imageFrame.style.transform = `translateX(${dx}px)`;
    }
  });
  const stopPan = (event: PointerEvent) => {
    if (!pan || event.pointerId !== pan.id) return;
    const dx = event.clientX - pan.x;
    const dy = event.clientY - pan.y;
    const swipe =
      event.type === "pointerup" &&
      !pan.canPan &&
      Math.abs(scale - fitScale) < 0.000001 &&
      entries.length > 1 &&
      Math.abs(dx) >= 30 &&
      Math.abs(dx) > Math.abs(dy);
    if (swipe && !reducedMotion?.matches && typeof imageFrame.animate === "function") {
      const rect = imageFrame.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      const old = imageFrame.cloneNode(true) as HTMLElement;
      old.setAttribute("aria-hidden", "true");
      old.inert = true;
      Object.assign(old.style, {
        position: "absolute",
        left: `${rect.left - stageRect.left + stage.scrollLeft - dx}px`,
        top: `${rect.top - stageRect.top + stage.scrollTop}px`,
        pointerEvents: "none",
        transform: `translateX(${dx}px)`,
      });
      imageFrame.style.removeProperty("transform");
      const previousCounter = counter.textContent ?? "";
      selectImage(index + (dx < 0 ? 1 : -1));
      slideCounter = previousCounter;
      counter.textContent = previousCounter;
      slideOld = old;
      slideOffset = dx;
      stage.append(old);
      const animation = old.animate(
        [
          { transform: `translateX(${dx}px)` },
          { transform: `translateX(${(dx < 0 ? -1 : 1) * Math.max(1, stage.clientWidth - 64) * 1.12}px)` },
        ],
        { duration: 360, easing: "cubic-bezier(0.33, 1, 0.68, 1)" },
      );
      slideAnimations.push(animation);
      animation.addEventListener(
        "finish",
        () => {
          if (slideOld === old) clearSlide();
        },
        { once: true },
      );
    } else {
      imageFrame.style.removeProperty("transform");
      if (swipe) selectImage(index + (dx < 0 ? 1 : -1));
    }
    suppressClick = event.type === "pointerup" && panMoved;
    if (event.type !== "pointerup") panStartedOnImage = false;
    else
      doc.defaultView?.setTimeout(() => {
        suppressClick = false;
        panStartedOnImage = false;
      }, 0);
    pan = undefined;
    stage.classList.remove("panning");
  };
  stage.addEventListener("pointerup", stopPan);
  stage.addEventListener("pointercancel", stopPan);
  stage.addEventListener("lostpointercapture", stopPan);

  const close = () => {
    if (closed) return;
    const restoreFocus = topMediaModal(doc) === overlay;
    closed = true;
    doc.removeEventListener("keydown", keyboard, true);
    doc.defaultView?.removeEventListener("resize", resizeViewport);
    reducedMotion?.removeEventListener("change", motionChanged);
    clearSlide();
    zoomAnimation?.cancel();
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
      close();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      selectImage(index + (event.key === "ArrowLeft" ? -1 : 1));
    } else if (event.key === "Tab") {
      event.stopImmediatePropagation();
      const focusable = [...overlay.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      const current = focusable.indexOf(doc.activeElement as HTMLButtonElement);
      if (event.shiftKey && current <= 0) {
        event.preventDefault();
        focusable.at(-1)?.focus();
      } else if (!event.shiftKey && (current < 0 || current === focusable.length - 1)) {
        event.preventDefault();
        focusable[0]?.focus();
      }
    }
  };
  closeButton.addEventListener("click", close);
  overlay.addEventListener(
    "wheel",
    (event) => {
      if (!stage.contains(event.target as globalThis.Node)) event.preventDefault();
    },
    { passive: false },
  );
  overlay.addEventListener("click", (event) => {
    if (
      pan ||
      ("pointerType" in event && event.pointerType === "touch" && "isPrimary" in event && event.isPrimary === false)
    )
      return;
    if (suppressClick) {
      suppressClick = false;
      panStartedOnImage = false;
      return;
    }
    const target = event.target as globalThis.Node;
    if (controls.contains(target) || closeButton.contains(target)) return;
    const clickedImage = imageFrame.contains(target) || panStartedOnImage;
    panStartedOnImage = false;
    if (clickedImage && fitScale < 1 && Math.abs(scale - fitScale) <= 0.000001) {
      animateResize(() => {
        fitToViewport = false;
        scaleChanged = true;
        fitActivated = false;
        scale = 1;
        sizeImage();
      }, 333);
      return;
    }
    if (clickedImage && Math.abs(scale - fitScale) > 0.000001) {
      const fromActualSize = Math.abs(scale - 1) <= 0.000001;
      animateResize(() => {
        fitToViewport = true;
        scaleChanged = true;
        fitActivated = fitScale < 1 && fromActualSize;
        fitImage();
      }, 333);
      return;
    }
    close();
  });
  doc.addEventListener("keydown", keyboard, true);
  doc.defaultView?.addEventListener("resize", resizeViewport);
  doc.body.append(overlay);
  showImage();
  overlay.focus({ preventScroll: true });
  return close;
}
