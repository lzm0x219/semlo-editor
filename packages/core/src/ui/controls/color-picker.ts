import { gradientValue, validGradient } from "../../features/text/color-gradient";
import { trackPopupPosition } from "../../platform/dom/dropdown";
import { linkPopup, popupEditorOwner } from "../../platform/dom/popup-owner";

type PickerKind = "text" | "background";
type RGBA = { r: number; g: number; b: number; a: number };
type HSV = { h: number; s: number; v: number };

export interface PaletteOptions {
  kind: PickerKind;
  active: string | null;
  onChoose: (value: string | null, live: boolean) => void;
}

const COLORS = [
  ["#000000", "#262626", "#585a5a", "#8a8f8d", "#d8dad9", "#e7e9e8", "#eff0f0", "#f4f5f5", "#fafafa", "#ffffff"],
  ["#df2a3f", "#ed740c", "#ecaa04", "#fbde28", "#74b602", "#1dc0c9", "#117cee", "#2f4bda", "#601bde", "#d22d8d"],
  ["#fbe4e7", "#fde6d3", "#f9efcd", "#fbf5cb", "#e8f7cf", "#cef5f7", "#d9eafc", "#d9dffc", "#e6dcf9", "#fbdfef"],
  ["#f1a2ab", "#f8b881", "#f5d480", "#fce75a", "#c1e77e", "#81dfe4", "#81bbf8", "#96a7fd", "#ba9bf2", "#f297cc"],
  ["#e4495b", "#f38f39", "#f3bb2f", "#edce02", "#8ccf17", "#01b2bc", "#2f8ef4", "#4861e0", "#7e45e8", "#e746a4"],
  ["#ad1a2b", "#c75c00", "#c99103", "#a58f04", "#5c8d07", "#07787e", "#0c68ca", "#213bc0", "#4c16b1", "#ae146e"],
  ["#70000d", "#663000", "#664900", "#665800", "#2a4200", "#004347", "#00346b", "#101e60", "#270070", "#5c0036"],
] as const;
const GRAY_NAMES = ["黑色", "深灰 3", "深灰 2", "深灰 1", "灰色", "浅灰 4", "浅灰 3", "浅灰 2", "浅灰 1", "白色"];
const COLOR_NAMES = ["红色", "橘橙", "金盏黄", "柠檬黄", "绿色", "青色", "浅蓝", "蓝色", "紫色", "玫红"];
const historyStorageKey = "semlo-editor:custom-colors:shared";
const historyCacheKey = Symbol.for("@semlo-editor/core/custom-color-history");
const historyStorageUnavailableKey = Symbol.for("@semlo-editor/core/custom-color-history-storage-unavailable");
type HistoryWindow = Window & { [historyCacheKey]?: string[]; [historyStorageUnavailableKey]?: boolean };
const memoryHistory = new WeakMap<Window, string[]>();
const unavailableStorage = new WeakSet<Window>();
const clamp = (number: number, min: number, max: number) => Math.max(min, Math.min(max, number));
const rounded = (number: number) => Math.round(clamp(number, 0, 255));
const hex = (color: RGBA) =>
  `#${[color.r, color.g, color.b].map((n) => rounded(n).toString(16).padStart(2, "0")).join("")}`;
const cssColor = (color: RGBA) =>
  color.a >= 1
    ? hex(color)
    : `rgba(${rounded(color.r)}, ${rounded(color.g)}, ${rounded(color.b)}, ${Math.round(color.a * 100) / 100})`;

function parseColor(value: unknown): RGBA | null {
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  if (text === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const short = /^#([0-9a-f]{3,4})$/i.exec(text);
  if (short) {
    const digits = short[1].split("").map((digit) => parseInt(digit + digit, 16));
    return { r: digits[0], g: digits[1], b: digits[2], a: digits[3] === undefined ? 1 : digits[3] / 255 };
  }
  const long = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(text);
  if (long) {
    const digits = long[1];
    return {
      r: parseInt(digits.slice(0, 2), 16),
      g: parseInt(digits.slice(2, 4), 16),
      b: parseInt(digits.slice(4, 6), 16),
      a: long[2] ? parseInt(long[2], 16) / 255 : 1,
    };
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(text);
  if (!rgb) return null;
  const values = rgb.slice(1).map((part) => (part === undefined ? 1 : Number(part)));
  if (values.slice(0, 3).some((part) => part < 0 || part > 255) || values[3] < 0 || values[3] > 1) return null;
  return { r: values[0], g: values[1], b: values[2], a: values[3] };
}

function toHSV(color: RGBA): HSV {
  const [r, g, b] = [color.r / 255, color.g / 255, color.b / 255];
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    delta = max - min;
  let h = 0;
  if (delta) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
  }
  return { h: (h * 60 + 360) % 360, s: max ? delta / max : 0, v: max };
}

function fromHSV(hsv: HSV, a: number): RGBA {
  const h = ((hsv.h % 360) + 360) % 360;
  const c = hsv.v * hsv.s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = hsv.v - c;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return { r: rounded((r + m) * 255), g: rounded((g + m) * 255), b: rounded((b + m) * 255), a };
}

function historyFor(win: Window | null): string[] {
  if (!win) return [];
  let cache = memoryHistory.get(win);
  try {
    cache ??= (win as HistoryWindow)[historyCacheKey];
  } catch {
    // Non-extensible hosts still have the WeakMap fallback.
  }
  if (!cache) {
    cache = [];
    try {
      Object.defineProperty(win, historyCacheKey, { value: cache, configurable: true });
    } catch {
      // A non-extensible host still keeps the per-module WeakMap cache.
    }
  }
  memoryHistory.set(win, cache);
  try {
    if (unavailableStorage.has(win) || (win as HistoryWindow)[historyStorageUnavailableKey]) return cache;
    const storage = win.localStorage;
    const read = (key: string): unknown => {
      const raw = storage.getItem(key);
      if (raw === null) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    };
    const shared = read(historyStorageKey);
    const stored = Array.isArray(shared) ? shared : null;
    if (stored) {
      const normalized: string[] = [];
      for (const value of stored) {
        const color = parseColor(value);
        if (!color) continue;
        const parsed = cssColor(color);
        if (!normalized.includes(parsed)) normalized.push(parsed);
        if (normalized.length === 10) break;
      }
      cache.splice(0, cache.length, ...normalized);
    }
  } catch {
    markStorageUnavailable(win);
  }
  return cache;
}

function markStorageUnavailable(win: Window) {
  unavailableStorage.add(win);
  try {
    Object.defineProperty(win, historyStorageUnavailableKey, { value: true, configurable: true });
  } catch {
    // The WeakSet still keeps fallback behavior in a non-extensible host.
  }
}

function remember(win: Window | null, value: string) {
  if (!win || !parseColor(value)) return;
  const colors = historyFor(win);
  const normalized = cssColor(parseColor(value)!);
  const next = [normalized, ...colors.filter((item) => cssColor(parseColor(item)!) !== normalized)].slice(0, 10);
  colors.splice(0, colors.length, ...next);
  try {
    win.localStorage.setItem(historyStorageKey, JSON.stringify(next));
  } catch {
    markStorageUnavailable(win);
    // The in-memory history continues to work when storage is unavailable.
  }
}

/** Open the color board without consuming the editor's current selection. */
export function openPalette(anchor: HTMLElement, options: PaletteOptions): () => void {
  const doc = anchor.ownerDocument,
    win = doc.defaultView;
  const openingFocus = doc.activeElement;
  const owner = popupEditorOwner(anchor) ?? openingFocus?.closest(".semlo-editor");
  const box = doc.createElement("div");
  box.className = "semlo-editor-palette";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "选择颜色");
  box.dataset.kind = options.kind;
  const unlinkPopup = linkPopup(anchor, box);
  let active = options.active;
  let morePanel: HTMLElement | undefined;
  let unlinkMore: (() => void) | undefined;
  let pendingCustom: string | undefined;
  let stopDrag = () => {};
  let closed = false;
  let stopPosition = () => {};
  let updatePosition = () => {};

  const positionMore = () => {
    if (!morePanel || !win || !box.isConnected) return;
    const bounds = box.getBoundingClientRect(),
      rect = morePanel.getBoundingClientRect();
    const margin = 8,
      gap = 4;
    const left = bounds.left >= rect.width + margin + gap ? bounds.left - rect.width - gap : bounds.right + gap;
    morePanel.style.left = `${Math.max(margin, Math.min(left, win.innerWidth - rect.width - margin))}px`;
    morePanel.style.top = `${Math.max(margin, Math.min(bounds.bottom - rect.height, win.innerHeight - rect.height - margin))}px`;
    morePanel.style.maxWidth = `${Math.max(0, win.innerWidth - margin * 2)}px`;
    morePanel.style.maxHeight = `${Math.max(0, win.innerHeight - margin * 2)}px`;
  };

  const closeMore = (focusTrigger = false) => {
    stopDrag();
    if (pendingCustom) remember(win, pendingCustom);
    pendingCustom = undefined;
    unlinkMore?.();
    unlinkMore = undefined;
    morePanel?.remove();
    morePanel = undefined;
    moreButton.setAttribute("aria-expanded", "false");
    if (!closed) {
      drawHistory();
      updatePosition();
    }
    if (focusTrigger) moreButton.focus();
  };
  const close = () => {
    if (closed) return;
    closed = true;
    closeMore();
    stopPosition();
    unlinkPopup();
    box.remove();
    anchor.setAttribute("aria-expanded", "false");
    doc.removeEventListener("pointerdown", outside, true);
    doc.removeEventListener("keydown", key, true);
  };
  const outside = (event: Event) => {
    const target = event.target as globalThis.Node;
    if (!box.contains(target) && !morePanel?.contains(target) && !anchor.contains(target)) close();
  };
  const key = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229 || event.key !== "Escape") return;
    const target = event.target as globalThis.Node | null;
    if (
      !target ||
      (target !== openingFocus &&
        !anchor.contains(target) &&
        !box.contains(target) &&
        !morePanel?.contains(target) &&
        !owner?.contains(target))
    )
      return;
    event.preventDefault();
    if (morePanel) closeMore(true);
    else {
      close();
      anchor.focus();
    }
  };
  const choose = (value: string | null) => {
    if (closed) return;
    close();
    options.onChoose(value, false);
  };
  const selectedColor = () => parseColor(active ?? (options.kind === "text" ? "#262626" : null));
  const isSelected = (value: string, gradient: boolean) =>
    gradient
      ? validGradient(active) === validGradient(value)
      : !!selectedColor() && !!parseColor(value) && cssColor(selectedColor()!) === cssColor(parseColor(value)!);
  const syncSelected = () => {
    box.querySelectorAll<HTMLButtonElement>(".semlo-editor-color-swatch").forEach((button) => {
      const selected = isSelected(button.dataset.value ?? "", button.dataset.gradient === "true");
      button.setAttribute("aria-pressed", String(selected));
      button.classList.toggle("is-selected", selected);
    });
  };
  const swatch = (value: string, name: string, gradient = false) => {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "semlo-editor-color-swatch";
    button.dataset.value = value;
    button.dataset.gradient = String(gradient);
    button.style.background = value;
    button.title = name;
    button.setAttribute("aria-label", `${name} ${value}`);
    const selected = isSelected(value, gradient);
    button.setAttribute("aria-pressed", String(selected));
    if (selected) button.classList.add("is-selected");
    const parsed = parseColor(value);
    if (parsed && parsed.r * 0.299 + parsed.g * 0.587 + parsed.b * 0.114 > 165) button.classList.add("is-light");
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => choose(value));
    return button;
  };

  const first = doc.createElement("button");
  first.type = "button";
  first.className = "semlo-editor-color-default";
  first.setAttribute("aria-label", options.kind === "text" ? "默认文字颜色" : "无填充色");
  const firstSample = doc.createElement("span");
  firstSample.className =
    options.kind === "text" ? "semlo-editor-color-default-sample" : "semlo-editor-color-none-sample";
  first.append(firstSample, doc.createTextNode(options.kind === "text" ? "默认" : "无填充色"));
  first.addEventListener("mousedown", (event) => event.preventDefault());
  first.addEventListener("click", () => choose(null));
  box.append(first);

  const grid = doc.createElement("div");
  grid.className = "semlo-editor-palette-grid";
  COLORS.forEach((row, rowIndex) =>
    row.forEach((color, column) => {
      const name =
        rowIndex === 0 ? GRAY_NAMES[column] : `${COLOR_NAMES[column]}${rowIndex === 1 ? "" : ` ${rowIndex - 1}`}`;
      grid.append(swatch(color, name));
    }),
  );
  box.append(grid);
  if (options.kind === "text") {
    const heading = doc.createElement("div");
    heading.className = "semlo-editor-color-section-title";
    heading.textContent = "渐变色";
    const gradients = doc.createElement("div");
    gradients.className = "semlo-editor-color-gradients";
    for (let index = 0; index < 4; index++) gradients.append(swatch(gradientValue(index), `渐变色 ${index + 1}`, true));
    box.append(heading, gradients);
  }
  const historyTitle = doc.createElement("div");
  historyTitle.className = "semlo-editor-color-section-title";
  historyTitle.textContent = "最近使用自定义颜色";
  const history = doc.createElement("div");
  history.className = "semlo-editor-color-history";
  const drawHistory = () => {
    history.replaceChildren();
    const colors = historyFor(win);
    if (!colors.length) {
      history.textContent = "暂无";
      history.classList.add("is-empty");
    } else {
      history.classList.remove("is-empty");
      colors.forEach((value) => history.append(swatch(value, "自定义颜色")));
    }
  };
  drawHistory();
  box.append(historyTitle, history);
  const moreButton = doc.createElement("button");
  moreButton.type = "button";
  moreButton.className = "semlo-editor-color-more";
  moreButton.setAttribute("aria-expanded", "false");
  moreButton.setAttribute("aria-haspopup", "dialog");
  const wheel = doc.createElement("span");
  wheel.className = "semlo-editor-color-wheel";
  moreButton.append(wheel, doc.createTextNode("更多颜色"));
  const arrow = doc.createElement("span");
  arrow.className = "semlo-editor-color-more-arrow";
  arrow.textContent = "›";
  moreButton.append(arrow);
  moreButton.addEventListener("mousedown", (event) => event.preventDefault());
  moreButton.addEventListener("click", () => {
    if (morePanel) {
      closeMore();
      return;
    }
    openMore();
  });
  box.append(moreButton);

  function openMore() {
    if (!win) return;
    const panel = doc.createElement("div");
    panel.className = "semlo-editor-color-custom";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "自定义颜色");
    morePanel = panel;
    unlinkMore = linkPopup(moreButton, panel);
    moreButton.setAttribute("aria-expanded", "true");
    let color = parseColor(active) ?? parseColor(options.kind === "text" ? "#262626" : "#000000")!;
    let hsv = toHSV(color);
    const field = doc.createElement("div");
    field.className = "semlo-editor-color-field";
    field.tabIndex = 0;
    field.setAttribute("role", "slider");
    field.setAttribute("aria-label", "颜色饱和度与亮度");
    const marker = doc.createElement("span");
    marker.className = "semlo-editor-color-field-marker";
    field.append(marker);
    const sliders = doc.createElement("div");
    sliders.className = "semlo-editor-color-sliders";
    const hue = doc.createElement("input");
    hue.type = "range";
    hue.min = "0";
    hue.max = "360";
    hue.step = "1";
    hue.className = "semlo-editor-color-hue";
    hue.setAttribute("aria-label", "色相");
    const alpha = doc.createElement("input");
    alpha.type = "range";
    alpha.min = "0";
    alpha.max = "100";
    alpha.step = "1";
    alpha.className = "semlo-editor-color-alpha";
    alpha.setAttribute("aria-label", "透明度");
    const sample = doc.createElement("span");
    sample.className = "semlo-editor-color-preview";
    const rails = doc.createElement("div");
    rails.className = "semlo-editor-color-rails";
    rails.append(hue, alpha);
    sliders.append(rails, sample);
    const fields = doc.createElement("div");
    fields.className = "semlo-editor-color-fields";
    const inputs: Record<"HEX" | "R" | "G" | "B" | "A", HTMLInputElement> = {} as never;
    for (const name of ["HEX", "R", "G", "B", "A"] as const) {
      const label = doc.createElement("label");
      label.textContent = name;
      const input = doc.createElement("input");
      input.type = "text";
      input.inputMode = name === "HEX" ? "text" : "numeric";
      input.setAttribute("aria-label", name);
      input.spellcheck = false;
      input.maxLength = name === "HEX" ? 9 : 3;
      inputs[name] = input;
      label.prepend(input);
      fields.append(label);
    }
    panel.append(field, sliders, fields);
    doc.body.append(panel);
    const render = (preserve?: HTMLInputElement) => {
      field.style.backgroundColor = `hsl(${hsv.h} 100% 50%)`;
      marker.style.left = `${hsv.s * 100}%`;
      marker.style.top = `${(1 - hsv.v) * 100}%`;
      field.setAttribute("aria-valuetext", `饱和度 ${Math.round(hsv.s * 100)}%，亮度 ${Math.round(hsv.v * 100)}%`);
      hue.value = String(Math.round(hsv.h));
      alpha.value = String(Math.round(color.a * 100));
      alpha.style.setProperty("--semlo-editor-alpha-color", hex(color));
      sample.style.background = cssColor(color);
      const values = {
        HEX: hex(color).toUpperCase(),
        R: String(color.r),
        G: String(color.g),
        B: String(color.b),
        A: String(Math.round(color.a * 100)),
      };
      for (const name of ["HEX", "R", "G", "B", "A"] as const)
        if (inputs[name] !== preserve) inputs[name].value = values[name];
    };
    const apply = (preserve?: HTMLInputElement) => {
      if (closed) return;
      active = cssColor(color);
      pendingCustom = active;
      options.onChoose(active, true);
      syncSelected();
      render(preserve);
    };
    const pickPoint = (event: PointerEvent) => {
      const bounds = field.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      hsv = {
        ...hsv,
        s: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
        v: 1 - clamp((event.clientY - bounds.top) / bounds.height, 0, 1),
      };
      color = fromHSV(hsv, color.a);
      apply();
    };
    field.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      pickPoint(event);
      if (closed || !field.isConnected) return;
      const move = (next: PointerEvent) => {
        if (next.pointerId === event.pointerId) pickPoint(next);
      };
      const end = (next: PointerEvent) => {
        if (next.pointerId === event.pointerId) stopDrag();
      };
      stopDrag();
      doc.addEventListener("pointermove", move, true);
      doc.addEventListener("pointerup", end, true);
      doc.addEventListener("pointercancel", end, true);
      stopDrag = () => {
        doc.removeEventListener("pointermove", move, true);
        doc.removeEventListener("pointerup", end, true);
        doc.removeEventListener("pointercancel", end, true);
        stopDrag = () => {};
      };
    });
    field.addEventListener("keydown", (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      const step = event.shiftKey ? 0.1 : 0.01;
      if (event.key === "ArrowLeft") hsv.s = clamp(hsv.s - step, 0, 1);
      else if (event.key === "ArrowRight") hsv.s = clamp(hsv.s + step, 0, 1);
      else if (event.key === "ArrowUp") hsv.v = clamp(hsv.v + step, 0, 1);
      else if (event.key === "ArrowDown") hsv.v = clamp(hsv.v - step, 0, 1);
      else return;
      event.preventDefault();
      color = fromHSV(hsv, color.a);
      apply();
    });
    hue.addEventListener("input", () => {
      hsv.h = Number(hue.value);
      color = fromHSV(hsv, color.a);
      apply();
    });
    alpha.addEventListener("input", () => {
      color.a = Number(alpha.value) / 100;
      apply();
    });
    inputs.HEX.addEventListener("input", () => {
      const value = parseColor(inputs.HEX.value);
      if (!value) return;
      color = { ...value, a: inputs.HEX.value.length === 5 || inputs.HEX.value.length === 9 ? value.a : color.a };
      hsv = toHSV(color);
      apply(inputs.HEX);
    });
    for (const name of ["R", "G", "B", "A"] as const) {
      const input = inputs[name];
      input.addEventListener("input", () => {
        if (!/^\d{1,3}$/.test(input.value)) return;
        const value = Number(input.value);
        if (value > (name === "A" ? 100 : 255)) return;
        if (name === "A") color.a = value / 100;
        else color[name.toLowerCase() as "r" | "g" | "b"] = value;
        hsv = toHSV(color);
        apply(input);
      });
    }
    for (const input of Object.values(inputs)) {
      input.addEventListener("blur", () => render());
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.isComposing && event.keyCode !== 229) {
          event.preventDefault();
          render(input);
        }
      });
    }
    render();
    positionMore();
  }

  doc.body.append(box);
  anchor.setAttribute("aria-expanded", "true");
  doc.addEventListener("pointerdown", outside, true);
  doc.addEventListener("keydown", key, true);
  const position = trackPopupPosition(anchor, box, close, positionMore);
  stopPosition = position.stop;
  updatePosition = position.update;
  position.update();
  return close;
}
