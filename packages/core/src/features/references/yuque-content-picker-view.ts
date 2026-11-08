import { ContentPickerController, type ContentChoice, type ContentPickerProvider } from "./yuque-content-picker";

export interface ContentPickerViewOptions {
  document: Document;
  provider: ContentPickerProvider;
  onChoose(choice: ContentChoice): void;
  onClose?(reason: "user" | "dispose"): void;
}

export function createContentPickerView(options: ContentPickerViewOptions) {
  const { document: doc, provider } = options;
  const controller = new ContentPickerController(provider);
  const root = doc.createElement("section");
  root.className = "semlo-editor-yuque-content-picker";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "语雀内容");
  const form = doc.createElement("form");
  const input = doc.createElement("input");
  input.type = "search";
  input.setAttribute("aria-label", "搜索文档或表格");
  input.placeholder = "搜索语雀文档、表格或贴入链接";
  const submit = doc.createElement("button");
  submit.type = "submit";
  submit.textContent = "确定";
  form.append(input, submit);
  const panel = doc.createElement("div");
  panel.className = "semlo-editor-yuque-content-results";
  const heading = doc.createElement("span");
  heading.className = "semlo-editor-yuque-content-results-heading";
  const status = doc.createElement("div");
  status.setAttribute("role", "status");
  const results = doc.createElement("ul");
  results.setAttribute("aria-label", "内容结果");
  panel.append(heading, status, results);
  root.append(form, panel);
  let disposed = false;
  let operation = 0;
  let timer: number | undefined;

  const render = (items: readonly ContentChoice[]) => {
    results.replaceChildren();
    for (const item of items) {
      if (!isContentChoice(item)) continue;
      const li = doc.createElement("li");
      const button = doc.createElement("button");
      button.type = "button";
      button.setAttribute("aria-label", `${item.kind === "document" ? "文档" : "表格"}：${item.title}`);
      const icon = doc.createElement("span");
      icon.className = "semlo-editor-yuque-content-result-icon";
      icon.textContent = item.kind === "document" ? "▤" : "▦";
      icon.setAttribute("aria-hidden", "true");
      const text = doc.createElement("span");
      text.className = "semlo-editor-yuque-content-result-text";
      const title = doc.createElement("span");
      title.textContent = item.title;
      text.append(title);
      if (item.description) {
        const description = doc.createElement("span");
        description.className = "semlo-editor-yuque-content-result-description";
        description.textContent = item.description;
        text.append(description);
      }
      button.append(icon, text);
      button.addEventListener("click", () => {
        if (!disposed && root.contains(button)) options.onChoose(item);
      });
      li.append(button);
      results.append(li);
    }
  };
  const clearTimer = () => {
    if (timer !== undefined) doc.defaultView?.clearTimeout(timer);
    timer = undefined;
  };
  const dispose = (reason: "user" | "dispose" = "dispose") => {
    if (disposed) return;
    disposed = true;
    operation++;
    clearTimer();
    controller.dispose();
    root.remove();
    options.onClose?.(reason);
  };
  const search = (query: string) => {
    if (disposed) return;
    clearTimer();
    const current = ++operation;
    heading.textContent = query ? "" : "最近使用";
    status.textContent = "正在搜索";
    render([]);
    void controller.search(query).then((result) => {
      if (disposed || current !== operation || result.status === "superseded") return;
      if (result.status === "failed" || !Array.isArray(result.value)) {
        status.textContent = "搜索失败";
        return;
      }
      render(result.value);
      status.textContent = results.childElementCount ? "" : "没有找到内容";
    });
  };
  const resolve = (value: string) => {
    clearTimer();
    const current = ++operation;
    heading.textContent = "";
    status.textContent = "正在解析链接";
    render([]);
    void controller.resolveLink(value).then((result) => {
      if (disposed || current !== operation || result.status === "superseded") return;
      if (result.status === "failed") {
        status.textContent = "链接解析失败";
        return;
      }
      if (!isContentChoice(result.value)) {
        status.textContent = "未找到可用内容";
        return;
      }
      options.onChoose(result.value);
    });
  };
  input.addEventListener("input", () => {
    operation++;
    clearTimer();
    controller.cancel();
    const value = input.value.trim();
    if (/^https?:\/\//i.test(value)) {
      heading.textContent = "";
      status.textContent = "";
      render([]);
      return;
    }
    timer = doc.defaultView?.setTimeout(() => search(value), 150);
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (/^https?:\/\//i.test(value)) resolve(value);
    else search(value);
  });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !event.isComposing) {
      event.preventDefault();
      dispose("user");
      return;
    }
    if (event.isComposing || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
    const items = Array.from(results.querySelectorAll<HTMLButtonElement>("button"));
    if (!items.length) return;
    const index = items.findIndex((item) => item === doc.activeElement);
    if (index < 0 && doc.activeElement !== input) return;
    event.preventDefault();
    const next =
      index < 0
        ? event.key === "ArrowDown"
          ? 0
          : items.length - 1
        : Math.max(0, Math.min(items.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
    items[next].focus();
  });
  search("");
  return { element: root, dispose };
}

export function isContentChoice(value: unknown): value is ContentChoice {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== "string" ||
    !item.id.trim() ||
    item.id.length > 4096 ||
    typeof item.title !== "string" ||
    !item.title.trim() ||
    item.title.length > 4096
  )
    return false;
  if (item.kind !== "document" && item.kind !== "table") return false;
  if (item.description !== undefined && (typeof item.description !== "string" || item.description.length > 4096))
    return false;
  if (
    typeof item.href !== "string" ||
    item.href.length > 4096 ||
    Array.from(item.href).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    return false;
  try {
    const url = new URL(item.href);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
  } catch {
    return false;
  }
}
