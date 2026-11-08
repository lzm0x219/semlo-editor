const themeColors = [
  "#ffffff",
  "#252525",
  "#f0f1f1",
  "#a48ed5",
  "#7989d5",
  "#8cc5bd",
  "#d5ba74",
  "#91c98b",
  "#db9292",
  "#d887c8",
  "#80b7dc",
  "#777d7b",
];
const defaultColors = [
  "#000000",
  "#585a5a",
  "#8a8f8d",
  "#d8dad9",
  "#ffffff",
  "#df2a3f",
  "#ed740c",
  "#ecaa04",
  "#74b602",
  "#1dc0c9",
  "#117cee",
  "#2f4bda",
  "#601bde",
  "#d22d8d",
  "#fbe4e7",
  "#fde6d3",
  "#f9efcd",
  "#e8f7cf",
  "#cef5f7",
  "#d9eafc",
  "#f1a2ab",
  "#f8b881",
  "#f5d480",
  "#c1e77e",
  "#81dfe4",
  "#81bbf8",
  "#96a7fd",
  "#ba9bf2",
  "#f297cc",
  "#ad1a2b",
];
function tint(color: string, amount: number) {
  const channels = [1, 3, 5].map((index) => parseInt(color.slice(index, index + 2), 16));
  return `#${channels
    .map((channel) =>
      Math.round(amount >= 0 ? channel + (255 - channel) * amount : channel * (1 + amount))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** 导图配色面板随节点视图重绘销毁，不持有全局事件。 */
export function createMindmapColorControl(
  doc: Document,
  label: string,
  value: string,
  onChoose: (color: string) => void,
) {
  const element = doc.createElement("div");
  element.className = "semlo-editor-mindmap-color-control";
  const trigger = doc.createElement("button");
  trigger.type = "button";
  trigger.className = "semlo-editor-mindmap-color-trigger";
  trigger.setAttribute("aria-label", label);
  trigger.setAttribute("aria-expanded", "false");
  trigger.title = label;
  const sample = doc.createElement("span");
  sample.style.background = value;
  trigger.append(sample);
  const panel = doc.createElement("div");
  panel.className = "semlo-editor-mindmap-color-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", `${label}选择器`);
  panel.hidden = true;
  const tabs = doc.createElement("div");
  tabs.className = "semlo-editor-mindmap-color-tabs";
  const themeTab = doc.createElement("button");
  const defaultTab = doc.createElement("button");
  themeTab.type = defaultTab.type = "button";
  themeTab.textContent = "主题配色";
  defaultTab.textContent = "默认配色";
  tabs.append(themeTab, defaultTab);
  const colors = doc.createElement("div");
  colors.className = "semlo-editor-mindmap-color-grid";
  const gradientTitle = doc.createElement("div");
  gradientTitle.className = "semlo-editor-mindmap-color-title";
  gradientTitle.textContent = "色彩梯度";
  const shades = doc.createElement("div");
  shades.className = "semlo-editor-mindmap-color-grid is-gradient";
  const customLabel = doc.createElement("label");
  customLabel.className = "semlo-editor-mindmap-color-custom";
  customLabel.textContent = "自定义颜色";
  const custom = doc.createElement("input");
  custom.type = "color";
  custom.value = /^#[\da-f]{6}$/i.test(value) ? value : "#ffffff";
  custom.setAttribute("aria-label", `自定义${label}`);
  custom.addEventListener("change", () => onChoose(custom.value));
  customLabel.append(custom);
  const swatch = (color: string) => {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "semlo-editor-mindmap-color-swatch";
    button.style.background = color;
    button.setAttribute("aria-label", `${label} ${color}`);
    button.setAttribute("aria-pressed", String(color.toLowerCase() === value.toLowerCase()));
    button.title = color;
    button.addEventListener("click", () => onChoose(color));
    return button;
  };
  const position = () => {
    panel.style.left = "calc(100% + 4px)";
    panel.style.right = "auto";
    panel.style.top = "0";
    panel.style.transform = "";
    const canvas = trigger.closest(".semlo-editor-mindmap");
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const scale = (trigger.offsetWidth ? trigger.getBoundingClientRect().width / trigger.offsetWidth : 1) || 1;
    panel.style.maxHeight = `${Math.max(32, (bounds.height - 8) / scale)}px`;
    panel.style.maxWidth = `${Math.max(32, (bounds.width - 8) / scale)}px`;
    panel.style.overflow = "auto";
    let popup = panel.getBoundingClientRect();
    if (popup.right > bounds.right) {
      panel.style.left = "auto";
      panel.style.right = "calc(100% + 4px)";
      popup = panel.getBoundingClientRect();
    }
    const shiftX =
      popup.left < bounds.left ? bounds.left - popup.left : popup.right > bounds.right ? bounds.right - popup.right : 0;
    const shiftY =
      popup.bottom > bounds.bottom ? bounds.bottom - popup.bottom : popup.top < bounds.top ? bounds.top - popup.top : 0;
    panel.style.transform = `translate(${shiftX / scale}px, ${shiftY / scale}px)`;
  };
  const show = (theme: boolean) => {
    themeTab.setAttribute("aria-pressed", String(theme));
    defaultTab.setAttribute("aria-pressed", String(!theme));
    colors.replaceChildren(...(theme ? themeColors : defaultColors).map(swatch));
    gradientTitle.hidden = shades.hidden = !theme;
    if (theme) {
      const base = /^#[\da-f]{6}$/i.test(value) ? value : "#7989d5";
      shades.replaceChildren(...[0.8, 0.6, 0.4, 0.2, 0, -0.3].map((amount) => swatch(tint(base, amount))));
    }
    if (!panel.hidden) position();
  };
  themeTab.addEventListener("click", () => show(true));
  defaultTab.addEventListener("click", () => show(false));
  panel.append(tabs, colors, gradientTitle, shades, customLabel);
  trigger.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    trigger.setAttribute("aria-expanded", String(!panel.hidden));
    if (panel.hidden) return;
    position();
  });
  panel.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    trigger.focus();
  });
  show(true);
  element.append(trigger, panel);
  return { element, trigger };
}
