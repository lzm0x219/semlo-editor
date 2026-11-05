import { ContentPickerController, type ContentChoice, type ContentPickerProvider } from "./yuque-content-picker";

/** Host owns insertion and any subsequent access checks; the picker does not insert or fetch content itself. */
export interface ContentPickerViewOptions {
  document: Document;
  provider: ContentPickerProvider;
  onChoose(choice: ContentChoice): void;
  onClose?(reason: "user" | "dispose"): void;
}

/** Local interaction candidate based on the observed search and link-entry affordances. */
export function createContentPickerView(options: ContentPickerViewOptions) {
  const { document: doc, provider } = options;
  const controller = new ContentPickerController(provider);
  const root = doc.createElement("section");
  root.className = "semlo-editor-yuque-content-picker";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "语雀内容");
  const heading = doc.createElement("h2");
  heading.textContent = "语雀内容";
  const close = doc.createElement("button");
  close.type = "button";
  close.setAttribute("aria-label", "关闭");
  close.textContent = "关闭";
  const searchForm = doc.createElement("form");
  searchForm.setAttribute("aria-label", "搜索内容");
  const searchInput = doc.createElement("input");
  searchInput.type = "search";
  searchInput.setAttribute("aria-label", "搜索文档或表格");
  const searchButton = doc.createElement("button");
  searchButton.type = "submit";
  searchButton.textContent = "搜索";
  searchForm.append(searchInput, searchButton);
  const linkForm = doc.createElement("form");
  linkForm.setAttribute("aria-label", "通过链接选择内容");
  const linkInput = doc.createElement("input");
  linkInput.type = "text";
  linkInput.setAttribute("aria-label", "内容链接");
  const linkButton = doc.createElement("button");
  linkButton.type = "submit";
  linkButton.textContent = "解析链接";
  linkForm.append(linkInput, linkButton);
  const status = doc.createElement("div");
  status.setAttribute("role", "status");
  const results = doc.createElement("ul");
  results.setAttribute("aria-label", "内容结果");
  root.append(heading, close, searchForm, linkForm, status, results);
  let disposed = false;
  let operation = 0;

  const render = (items: readonly ContentChoice[]) => {
    results.replaceChildren();
    for (const item of items) {
      if (!isContentChoice(item)) continue;
      const li = doc.createElement("li");
      const button = doc.createElement("button");
      button.type = "button";
      button.textContent = `${item.kind === "document" ? "文档" : "表格"}：${item.title}`;
      button.addEventListener("click", () => {
        if (!disposed && root.contains(button)) options.onChoose(item);
      });
      li.append(button);
      results.append(li);
    }
  };
  const dispose = (reason: "user" | "dispose" = "dispose") => {
    if (disposed) return;
    disposed = true;
    operation++;
    controller.dispose();
    root.remove();
    options.onClose?.(reason);
  };
  close.addEventListener("click", () => dispose("user"));
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !event.isComposing) {
      event.preventDefault();
      dispose("user");
    }
  });
  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (disposed) return;
    const current = ++operation;
    status.textContent = "正在搜索";
    render([]);
    void controller.search(searchInput.value).then((result) => {
      if (disposed || current !== operation || result.status === "superseded") return;
      if (result.status === "failed") {
        status.textContent = "搜索失败";
        return;
      }
      if (!Array.isArray(result.value)) {
        status.textContent = "搜索失败";
        return;
      }
      render(result.value);
      status.textContent = results.childElementCount ? "" : "没有找到内容";
    });
  });
  linkForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (disposed) return;
    const current = ++operation;
    status.textContent = "正在解析链接";
    render([]);
    void controller.resolveLink(linkInput.value).then((result) => {
      if (disposed || current !== operation || result.status === "superseded") return;
      if (result.status === "failed") {
        status.textContent = "链接解析失败";
        return;
      }
      if (!isContentChoice(result.value)) {
        status.textContent = "未找到可用内容";
        return;
      }
      render([result.value]);
      status.textContent = "";
    });
  });
  return { element: root, dispose };
}

/** Only the application-provided safe link is persisted; this does not verify remote access. */
export function isContentChoice(value: unknown): value is ContentChoice {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || !item.id.trim() || typeof item.title !== "string" || !item.title.trim())
    return false;
  if (item.kind !== "document" && item.kind !== "table") return false;
  if (typeof item.href !== "string") return false;
  try {
    const url = new URL(item.href);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
