import {
  getBoldState,
  getHeadingStyleState,
  getLinkState,
  getListState,
  startLinkEdit,
  toggleBold,
  toggleHeadingStyle,
  toggleList,
  type LinkEditSession,
  type ToolbarFactory,
} from "@semlo-editor/core";

let nextLinkFormId = 0;

/** 只使用组件库公开入口，为体验页提供可替换的主工具栏。 */
export const createDemoToolbar: ToolbarFactory = ({ element, controller, syncSelection, subscribe }) => {
  const doc = element.ownerDocument;
  const editor = controller.editor;
  const events = new AbortController();
  const { signal } = events;
  element.classList.add("demo-custom-toolbar");
  element.setAttribute("aria-label", "自定义工具栏");

  const createButton = (label: string, action: () => void) => {
    const button = doc.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.setAttribute("aria-pressed", "false");
    // 鼠标点击工具栏时保留文档选区；键盘焦点仍可进入按钮。
    button.addEventListener(
      "mousedown",
      (event) => {
        event.preventDefault();
        syncSelection();
      },
      { signal },
    );
    button.addEventListener("click", action, { signal });
    element.append(button);
    return button;
  };

  const heading = createButton("二级标题", () => toggleHeadingStyle(editor, 2));
  const bold = createButton("加粗", () => toggleBold(editor));
  const bullet = createButton("无序列表", () => toggleList(editor, "bulletList"));
  const ordered = createButton("有序列表", () => toggleList(editor, "orderedList"));

  const linkForm = doc.createElement("form");
  linkForm.id = `demo-toolbar-link-${++nextLinkFormId}`;
  linkForm.className = "demo-toolbar-link";
  linkForm.setAttribute("aria-label", "链接设置");
  linkForm.hidden = true;
  const textLabel = doc.createElement("label");
  textLabel.textContent = "链接文本";
  const textInput = doc.createElement("input");
  textInput.type = "text";
  textInput.setAttribute("aria-label", "链接文本");
  textLabel.append(textInput);
  const label = doc.createElement("label");
  label.textContent = "链接地址";
  const input = doc.createElement("input");
  input.type = "text";
  input.inputMode = "url";
  input.placeholder = "https://example.com";
  input.autocomplete = "off";
  input.setAttribute("aria-label", "链接地址");
  label.append(input);
  const save = doc.createElement("button");
  save.type = "submit";
  save.textContent = "应用链接";
  const cancel = doc.createElement("button");
  cancel.type = "button";
  cancel.textContent = "取消";
  const remove = doc.createElement("button");
  remove.type = "button";
  remove.textContent = "移除链接";
  remove.hidden = true;
  const error = doc.createElement("span");
  error.className = "demo-toolbar-link-error";
  error.setAttribute("role", "status");
  error.setAttribute("aria-live", "polite");
  linkForm.append(textLabel, label, save, cancel, remove, error);
  let linkEdit: LinkEditSession | null = null;
  const closeLink = () => {
    linkEdit?.close();
    linkEdit = null;
    linkForm.hidden = true;
    link.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-invalid");
    textInput.removeAttribute("aria-invalid");
    error.textContent = "";
  };
  const link = createButton("链接", () => {
    if (!linkForm.hidden) {
      closeLink();
      return;
    }
    linkEdit = startLinkEdit(editor, { onInvalidate: closeLink });
    if (!linkEdit) return;
    textInput.value = linkEdit.text || "链接";
    input.value = linkEdit.href ?? "";
    remove.hidden = !linkEdit.existing;
    save.disabled = !textInput.value.trim() || !input.value.trim();
    linkForm.hidden = false;
    link.setAttribute("aria-expanded", "true");
    input.focus();
    input.select();
  });
  link.setAttribute("aria-expanded", "false");
  link.setAttribute("aria-controls", linkForm.id);
  element.append(linkForm);

  const update = () => {
    if (editor.isDestroyed) return;
    const selection = editor.state.selection;
    if (
      linkEdit &&
      (!linkEdit.isValid() || linkEdit.range.from !== selection.from || linkEdit.range.to !== selection.to)
    ) {
      closeLink();
    }
    const headingStyle = getHeadingStyleState(editor);
    heading.disabled = !headingStyle.enabled;
    const boldState = getBoldState(editor);
    const bulletState = getListState(editor, "bulletList");
    const orderedState = getListState(editor, "orderedList");
    const linkState = getLinkState(editor);
    bold.disabled = !boldState.enabled;
    bullet.disabled = !bulletState.enabled;
    ordered.disabled = !orderedState.enabled;
    link.disabled = !linkState.enabled;
    heading.setAttribute("aria-pressed", String(headingStyle.level === 2));
    bold.setAttribute("aria-pressed", String(boldState.active));
    bullet.setAttribute("aria-pressed", String(bulletState.active));
    ordered.setAttribute("aria-pressed", String(orderedState.active));
    link.setAttribute("aria-pressed", String(linkState.active));
  };

  linkForm.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
      if (!linkEdit) return;
      const result = linkEdit.apply({ href: input.value, text: textInput.value });
      if (result === "invalid-url") {
        input.setAttribute("aria-invalid", "true");
        error.textContent = "请输入有效的链接地址，如 https://、mailto: 或站内路径。";
        input.focus();
        return;
      }
      if (result === "invalid-text") {
        textInput.setAttribute("aria-invalid", "true");
        error.textContent = "请输入链接文本。";
        textInput.focus();
        return;
      }
      closeLink();
    },
    { signal },
  );
  input.addEventListener(
    "input",
    () => {
      input.removeAttribute("aria-invalid");
      error.textContent = "";
      save.disabled = !textInput.value.trim() || !input.value.trim();
    },
    { signal },
  );
  textInput.addEventListener(
    "input",
    () => {
      textInput.removeAttribute("aria-invalid");
      error.textContent = "";
      save.disabled = !textInput.value.trim() || !input.value.trim();
    },
    { signal },
  );
  cancel.addEventListener(
    "click",
    () => {
      closeLink();
      editor.commands.focus();
    },
    { signal },
  );
  remove.addEventListener(
    "click",
    () => {
      linkEdit?.remove();
      closeLink();
    },
    { signal },
  );
  linkForm.addEventListener(
    "keydown",
    (event) => {
      if (event.isComposing || event.keyCode === 229 || event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeLink();
      editor.commands.focus();
    },
    { signal },
  );

  const unsubscribe = subscribe(update);
  update();
  return () => {
    unsubscribe();
    closeLink();
    events.abort();
  };
};
