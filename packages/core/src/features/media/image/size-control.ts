export interface ImageSizeSnapshot {
  /** Stored dimensions in CSS pixels, falling back to the actual size if unset. */
  width: number;
  height: number;
  /** Intrinsic image dimensions, or zero before the image loads. */
  naturalWidth: number;
  naturalHeight: number;
}

export interface ImageSizeControlOptions {
  doc: Document;
  image: HTMLImageElement;
  canEdit: () => boolean;
  getSize: () => ImageSizeSnapshot;
  commitSize: (width: number, height: number) => void;
  getStyle?: () => ImageVisualStyle;
  commitStyle?: (style: ImageVisualStyle) => void;
}

export type ImageVisualStyle = "none" | "border" | "shadow";
const presets = [25, 50, 75, 100] as const;
const styles: Array<[ImageVisualStyle, string]> = [
  ["none", "无样式"],
  ["border", "图片描边"],
  ["shadow", "图片阴影"],
];
const positive = (value: number) => Number.isFinite(value) && value > 0;

/** Pick one nearest preset within one pixel; ties retain the earlier preset. */
export function selectedImageScale(width: number, naturalWidth: number): number | null {
  if (!positive(width) || !positive(naturalWidth)) return null;
  let selected: number | null = null;
  let distance = Infinity;
  for (const percent of presets) {
    const next = Math.abs(width - (naturalWidth * percent) / 100);
    if (next <= 1 && next < distance) {
      selected = percent;
      distance = next;
    }
  }
  return selected;
}

/** A floating, independently managed size control for a selected image. */
export function createImageSizeControl({
  doc,
  image,
  canEdit,
  getSize,
  commitSize,
  getStyle,
  commitStyle,
}: ImageSizeControlOptions) {
  const win = doc.defaultView;
  const element = doc.createElement("div");
  element.className = "semlo-editor-image-size-control";
  element.setAttribute("role", "toolbar");
  element.setAttribute("aria-label", "图片格式");
  element.contentEditable = "false";

  const toggle = doc.createElement("button");
  toggle.type = "button";
  toggle.className = "semlo-editor-image-size-toggle";
  toggle.setAttribute("aria-label", "图片尺寸");
  toggle.setAttribute("aria-haspopup", "dialog");
  toggle.setAttribute("aria-expanded", "false");
  toggle.innerHTML =
    '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 3h10v10H3zM6 6h4M6 9h2M13 7h4v10H7v-4m3 4v-3m3 3v-3"/></svg><span>宽高</span>';
  const panel = doc.createElement("div");
  panel.className = "semlo-editor-image-size-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "图片尺寸");
  panel.hidden = true;

  const dimensions = doc.createElement("div");
  dimensions.className = "semlo-editor-image-size-fields";
  const makeInput = (label: string, accessible: string) => {
    const wrapper = doc.createElement("label");
    wrapper.className = "semlo-editor-image-size-field";
    const name = doc.createElement("span");
    name.textContent = label;
    const input = doc.createElement("input");
    input.type = "number";
    input.inputMode = "numeric";
    input.min = "1";
    input.step = "1";
    input.setAttribute("aria-label", accessible);
    wrapper.append(name, input);
    dimensions.append(wrapper);
    return input;
  };
  const width = makeInput("宽", "图片宽度");
  const height = makeInput("高", "图片高度");
  const options = doc.createElement("div");
  options.className = "semlo-editor-image-size-presets";
  options.setAttribute("role", "radiogroup");
  options.setAttribute("aria-label", "图片缩放比例");
  const buttons = presets.map((percent) => {
    const button = doc.createElement("button");
    button.type = "button";
    button.textContent = `${percent}%`;
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", "false");
    options.append(button);
    return button;
  });
  const styleToggle = doc.createElement("button");
  styleToggle.type = "button";
  styleToggle.className = "semlo-editor-image-style-toggle";
  styleToggle.setAttribute("aria-label", "图片样式");
  styleToggle.setAttribute("aria-haspopup", "menu");
  styleToggle.setAttribute("aria-expanded", "false");
  styleToggle.innerHTML =
    '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 4h14v12H3zM5 13l3-3 2 2 2-2 3 3M7 7h.01"/></svg><span>样式</span><span aria-hidden="true">⌄</span>';
  styleToggle.hidden = !getStyle || !commitStyle;
  const stylePanel = doc.createElement("div");
  stylePanel.className = "semlo-editor-image-style-panel";
  stylePanel.setAttribute("role", "menu");
  stylePanel.setAttribute("aria-label", "图片样式");
  stylePanel.hidden = true;
  const styleButtons = styles.map(([, label]) => {
    const button = doc.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitemradio");
    button.setAttribute("aria-checked", "false");
    const check = doc.createElement("span");
    check.className = "semlo-editor-image-style-check";
    check.setAttribute("aria-hidden", "true");
    check.textContent = "✓";
    const text = doc.createElement("span");
    text.textContent = label;
    button.append(check, text);
    stylePanel.append(button);
    return button;
  });
  panel.append(dimensions, options);
  element.append(toggle, styleToggle, panel, stylePanel);

  let opened = false;
  let styleOpened = false;
  let destroyed = false;
  const getSnapshot = () => {
    const size = getSize();
    const intrinsic = positive(size.naturalWidth) && positive(size.naturalHeight);
    const ratio = intrinsic
      ? size.naturalHeight / size.naturalWidth
      : positive(size.width) && positive(size.height)
        ? size.height / size.width
        : 0;
    return { ...size, intrinsic, ratio };
  };

  const setCheckedPreset = (draftWidth: number, naturalWidth: number, intrinsic: boolean) => {
    const selected = intrinsic ? selectedImageScale(draftWidth, naturalWidth) : null;
    buttons.forEach((button, index) => {
      button.setAttribute("aria-checked", String(selected === presets[index]));
    });
  };
  const refresh = () => {
    if (destroyed) return;
    if (!canEdit()) close();
    const size = getSnapshot();
    const available = canEdit() && positive(size.ratio);
    width.disabled = !available;
    height.disabled = !available;
    const active = opened ? doc.activeElement : null;
    const draft = active === width ? Number(width.value) : active === height ? Number(height.value) : 0;
    const hasDraft = (active === width || active === height) && positive(draft) && positive(size.ratio);
    const draftWidth = hasDraft ? (active === width ? draft : draft / size.ratio) : size.width;
    const draftHeight = hasDraft ? (active === height ? draft : draft * size.ratio) : size.height;
    if (active !== width) width.value = positive(draftWidth) ? String(Math.max(1, Math.round(draftWidth))) : "";
    if (active !== height) height.value = positive(draftHeight) ? String(Math.max(1, Math.round(draftHeight))) : "";
    buttons.forEach((button) => {
      button.disabled = !canEdit() || !size.intrinsic;
    });
    setCheckedPreset(size.width, size.naturalWidth, size.intrinsic);
    const currentStyle = getStyle?.() ?? "none";
    styleButtons.forEach((button, index) => {
      button.disabled = !canEdit();
      button.setAttribute("aria-checked", String(styles[index][0] === currentStyle));
    });
  };

  const commit = (nextWidth: number, nextHeight: number) => {
    if (!canEdit() || !positive(nextWidth) || !positive(nextHeight)) return false;
    const w = Math.max(1, Math.round(nextWidth));
    const h = Math.max(1, Math.round(nextHeight));
    if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w < 1 || h < 1) return false;
    const current = getSnapshot();
    if (Math.round(current.width) !== w || Math.round(current.height) !== h) commitSize(w, h);
    width.value = String(w);
    height.value = String(h);
    refresh();
    return true;
  };
  const applyInput = (input: HTMLInputElement) => {
    if (!input.value.trim() || input.validity.stepMismatch) return;
    const parsed = Number(input.value);
    const value = parsed <= 0 ? 1 : parsed;
    const ratio = getSnapshot().ratio;
    if (!positive(value) || !positive(ratio)) {
      const size = getSnapshot();
      input.value = String(Math.round(input === width ? size.width : size.height) || "");
      refresh();
      return;
    }
    const nextWidth = input === width ? value : value / ratio;
    const nextHeight = input === height ? value : value * ratio;
    if (!commit(nextWidth, nextHeight)) refresh();
  };
  const outside = (event: PointerEvent) => {
    if (!element.contains(event.target as globalThis.Node)) {
      const active = doc.activeElement;
      if (active === width) applyInput(width);
      else if (active === height) applyInput(height);
      close();
    }
  };
  function close() {
    if (!opened && !styleOpened) return;
    opened = false;
    styleOpened = false;
    // A lifecycle change discards unsubmitted edits.
    // An outside pointer commits the focused input before it reaches here.
    const size = getSnapshot();
    width.value = positive(size.width) ? String(Math.round(size.width)) : "";
    height.value = positive(size.height) ? String(Math.round(size.height)) : "";
    setCheckedPreset(size.width, size.naturalWidth, size.intrinsic);
    panel.hidden = true;
    stylePanel.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    styleToggle.setAttribute("aria-expanded", "false");
    doc.removeEventListener("pointerdown", outside, true);
  }
  const open = () => {
    if (destroyed || !canEdit()) return;
    if (styleOpened) close();
    opened = true;
    panel.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    refresh();
    const outer = element.getBoundingClientRect();
    const rect = toggle.getBoundingClientRect();
    const viewportWidth = win?.innerWidth ?? doc.documentElement.clientWidth;
    const left = Math.max(8, Math.min(rect.left, viewportWidth - 8 - panel.offsetWidth));
    panel.style.left = `${left - outer.left}px`;
    doc.addEventListener("pointerdown", outside, true);
  };
  const openStyle = () => {
    if (destroyed || !canEdit() || !getStyle || !commitStyle) return;
    if (opened) close();
    styleOpened = true;
    stylePanel.hidden = false;
    styleToggle.setAttribute("aria-expanded", "true");
    refresh();
    const outer = element.getBoundingClientRect();
    const rect = styleToggle.getBoundingClientRect();
    const viewportWidth = win?.innerWidth ?? doc.documentElement.clientWidth;
    const left = Math.max(8, Math.min(rect.left, viewportWidth - 8 - 150));
    stylePanel.style.left = `${left - outer.left}px`;
    doc.addEventListener("pointerdown", outside, true);
  };
  // Buttons should not steal focus from ProseMirror's selected image; doing
  // so can deselect the node and remove the toolbar before click is delivered.
  for (const button of [toggle, ...buttons, styleToggle, ...styleButtons])
    button.addEventListener("mousedown", (event) => event.preventDefault());
  toggle.addEventListener("click", () => (opened ? close() : open()));
  styleToggle.addEventListener("click", () => (styleOpened ? close() : openStyle()));
  for (const input of [width, height]) {
    input.addEventListener("input", () => {
      const value = Number(input.value);
      const size = getSnapshot();
      if (!input.value.trim()) {
        if (input === width) height.value = "";
        else width.value = "";
        setCheckedPreset(size.width, size.naturalWidth, size.intrinsic);
        return;
      }
      if (input.validity.stepMismatch) {
        if (input === width) height.value = "";
        else width.value = "";
        setCheckedPreset(size.width, size.naturalWidth, size.intrinsic);
        return;
      }
      // Draft feedback uses the source ratio; commit applies the transformed image ratio.
      const draftRatio =
        image.complete && image.currentSrc === image.src && image.naturalWidth && image.naturalHeight
          ? image.naturalHeight / image.naturalWidth
          : size.ratio;
      if (!Number.isFinite(value) || !positive(draftRatio)) {
        setCheckedPreset(size.width, size.naturalWidth, size.intrinsic);
        return;
      }
      const draftWidth = input === width ? value : value / draftRatio;
      const draftHeight = input === height ? value : value * draftRatio;
      const roundedWidth = Math.round(draftWidth);
      const roundedHeight = Math.round(draftHeight);
      if (!Number.isSafeInteger(roundedWidth) || !Number.isSafeInteger(roundedHeight)) return;
      if (input === width) height.value = String(Math.max(20, roundedHeight));
      else width.value = String(Math.max(30, roundedWidth));
      setCheckedPreset(size.width, size.naturalWidth, size.intrinsic);
    });
    input.addEventListener("change", () => applyInput(input));
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      event.stopPropagation();
      applyInput(input);
    });
  }
  buttons.forEach((button, index) => {
    button.addEventListener("click", () => {
      const size = getSnapshot();
      if (!size.intrinsic) return;
      commit((size.naturalWidth * presets[index]) / 100, (size.naturalHeight * presets[index]) / 100);
    });
  });
  styleButtons.forEach((button, index) => {
    button.addEventListener("click", () => {
      if (!canEdit() || !getStyle || !commitStyle) return;
      const style = styles[index][0];
      if (getStyle() !== style) commitStyle(style);
      close();
      refresh();
    });
  });
  image.addEventListener("load", refresh);
  image.addEventListener("error", refresh);
  refresh();
  return {
    element,
    refresh,
    close,
    destroy() {
      if (destroyed) return;
      close();
      destroyed = true;
      image.removeEventListener("load", refresh);
      image.removeEventListener("error", refresh);
      element.remove();
    },
  };
}
