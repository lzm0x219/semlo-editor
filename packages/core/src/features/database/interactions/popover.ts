import type { Editor } from "@tiptap/core";

import { createDatabaseId, DatabaseContentError, databaseFiles, databaseLimits, type DatabaseFile } from "../model";
import type { DatabaseOptions } from "../options";

interface DatabasePopoverContext {
  doc: Document;
  dom: HTMLElement;
  editor: Editor;
  getOptions(): DatabaseOptions;
  reportContentError(error: DatabaseContentError): void;
  isDestroyed(): boolean;
  scheduleBodyRefresh(): void;
  button(
    label: string,
    text: string,
    action: () => void,
    className?: string,
    allowReadonly?: boolean,
  ): HTMLButtonElement;
}

/** 管理数据库弹层及其异步请求，关闭时统一使旧工作失效。 */
export function createDatabasePopover({
  doc,
  dom,
  editor,
  getOptions,
  reportContentError,
  isDestroyed,
  scheduleBodyRefresh,
  button,
}: DatabasePopoverContext) {
  let popup: HTMLElement | null = null;
  let disposePopupPosition: (() => void) | null = null;
  let personSearchAbort: AbortController | null = null;
  const fileUploads = new Set<AbortController>();
  let popupGeneration = 0;
  const closePopup = () => {
    popupGeneration++;
    const uploads = [...fileUploads];
    fileUploads.clear();
    personSearchAbort?.abort();
    personSearchAbort = null;
    disposePopupPosition?.();
    disposePopupPosition = null;
    popup?.remove();
    popup = null;
    doc.removeEventListener("pointerdown", outsidePointer, true);
    editor.off("update", onEditableChanged);
    scheduleBodyRefresh();
    for (const upload of uploads) upload.abort();
  };
  const outsidePointer = (event: Event) => {
    if (popup?.contains(event.target as globalThis.Node)) return;
    closePopup();
  };
  const onEditableChanged = () => {
    if (!editor.isEditable) closePopup();
  };
  const panel = (anchor: HTMLElement, title: string) => {
    closePopup();
    const element = doc.createElement("div");
    element.className = "semlo-editor-database-popover";
    element.setAttribute("role", "dialog");
    element.setAttribute("aria-label", title);
    const initialRoot = dom.getBoundingClientRect();
    const initialAnchor = anchor.getBoundingClientRect();
    let relativeAnchor = {
      left: initialAnchor.left - initialRoot.left,
      top: initialAnchor.top - initialRoot.top,
      bottom: initialAnchor.bottom - initialRoot.top,
    };
    element.style.left = `${Math.max(0, relativeAnchor.left)}px`;
    element.style.top = `${relativeAnchor.bottom + 5}px`;
    dom.append(element);
    popup = element;
    const win = doc.defaultView;
    let positionFrame: number | undefined;
    const position = () => {
      if (isDestroyed() || popup !== element || !win) return;
      const root = dom.getBoundingClientRect();
      if (anchor.isConnected && dom.contains(anchor)) {
        const rect = anchor.getBoundingClientRect();
        relativeAnchor = { left: rect.left - root.left, top: rect.top - root.top, bottom: rect.bottom - root.top };
      }
      const viewport = win.visualViewport;
      const leftEdge = (viewport?.offsetLeft ?? 0) + 8;
      const topEdge = (viewport?.offsetTop ?? 0) + 8;
      const rightEdge = (viewport?.offsetLeft ?? 0) + (viewport?.width ?? win.innerWidth) - 8;
      const bottomEdge = (viewport?.offsetTop ?? 0) + (viewport?.height ?? win.innerHeight) - 8;
      element.style.maxWidth = `${Math.max(0, Math.min(560, rightEdge - leftEdge))}px`;
      const rect = element.getBoundingClientRect();
      const desiredLeft = root.left + relativeAnchor.left;
      const left = Math.max(leftEdge, Math.min(desiredLeft, rightEdge - rect.width));
      const below = root.top + relativeAnchor.bottom + 5;
      const above = root.top + relativeAnchor.top - rect.height - 5;
      const desiredTop = below + rect.height <= bottomEdge || above < topEdge ? below : above;
      const top = Math.max(topEdge, Math.min(desiredTop, bottomEdge - rect.height));
      element.style.left = `${left - root.left}px`;
      element.style.top = `${top - root.top}px`;
    };
    const schedulePosition = () => {
      if (!win || positionFrame !== undefined) return;
      positionFrame = win.requestAnimationFrame(() => {
        positionFrame = undefined;
        position();
      });
    };
    const observer = win?.ResizeObserver ? new win.ResizeObserver(schedulePosition) : null;
    observer?.observe(element);
    win?.addEventListener("resize", schedulePosition);
    win?.visualViewport?.addEventListener("resize", schedulePosition);
    win?.visualViewport?.addEventListener("scroll", schedulePosition);
    doc.addEventListener("scroll", schedulePosition, true);
    disposePopupPosition = () => {
      observer?.disconnect();
      win?.removeEventListener("resize", schedulePosition);
      win?.visualViewport?.removeEventListener("resize", schedulePosition);
      win?.visualViewport?.removeEventListener("scroll", schedulePosition);
      doc.removeEventListener("scroll", schedulePosition, true);
      if (positionFrame !== undefined) win?.cancelAnimationFrame(positionFrame);
    };
    // Callers populate the panel synchronously; measure it after those children exist.
    queueMicrotask(position);
    doc.addEventListener("pointerdown", outsidePointer, true);
    editor.on("update", onEditableChanged);
    return element;
  };
  const closeButton = (element: HTMLElement) =>
    button("关闭", "×", () => element === popup && closePopup(), "semlo-editor-database-close", true);
  const panelHeading = (element: HTMLElement, text: string) => {
    const header = doc.createElement("div");
    header.className = "semlo-editor-database-popover-heading";
    const title = doc.createElement("strong");
    title.textContent = text;
    header.append(title, closeButton(element));
    element.append(header);
  };
  const personSearch = (container: HTMLElement, onPick: (item: { id: string; label: string }) => void) => {
    const search = doc.createElement("input");
    search.placeholder = "搜索人员";
    search.setAttribute("aria-label", "搜索人员");
    const results = doc.createElement("div");
    results.className = "semlo-editor-database-person-results";
    const run = async () => {
      personSearchAbort?.abort();
      const controller = new AbortController();
      personSearchAbort = controller;
      results.replaceChildren();
      const provider = getOptions().getSearchMentions();
      if (!provider) {
        results.textContent = "请先配置人员搜索";
        return;
      }
      results.textContent = "正在搜索…";
      try {
        const found = await provider(search.value, controller.signal);
        if (controller.signal.aborted || isDestroyed() || !dom.contains(container)) return;
        results.replaceChildren();
        const people = Array.isArray(found)
          ? found
              .filter(
                (item) =>
                  item?.kind === "person" &&
                  typeof item.id === "string" &&
                  item.id &&
                  typeof item.label === "string" &&
                  item.label,
              )
              .slice(0, 50)
          : [];
        if (!people.length) results.textContent = "没有找到人员";
        for (const person of people)
          results.append(
            button(person.label, person.label, () => {
              if (person.id.length > 500 || person.label.length > 200) {
                reportContentError(new DatabaseContentError("人员标识或名称超出长度限制"));
                return;
              }
              onPick({ id: person.id, label: person.label });
            }),
          );
      } catch (error) {
        if (controller.signal.aborted || isDestroyed() || !dom.contains(container)) return;
        results.textContent = "人员搜索失败";
        getOptions().onError(error);
      }
    };
    search.addEventListener("input", () => void run());
    container.append(search, results);
    void run();
  };
  const filePicker = (
    container: HTMLElement,
    type: "image" | "attachment",
    onUploaded: (files: DatabaseFile[]) => void,
    remaining: () => number,
  ) => {
    const input = doc.createElement("input");
    input.type = "file";
    input.multiple = true;
    if (type === "image") input.accept = "image/*";
    input.setAttribute("aria-label", type === "image" ? "选择图片" : "选择附件");
    const status = doc.createElement("span");
    status.setAttribute("role", "status");
    const upload = async (selected: File[]) => {
      if (input.disabled) return;
      const provider = type === "image" ? getOptions().getUploadImage() : getOptions().getUploadAttachment();
      if (!provider) {
        status.textContent = type === "image" ? "请先配置图片上传" : "请先配置附件上传";
        return;
      }
      const files = selected.filter((file) => type !== "image" || file.type.startsWith("image/"));
      if (!files.length) {
        status.textContent = type === "image" ? "请选择图片" : "请选择附件";
        return;
      }
      if (files.length > remaining()) {
        input.value = "";
        status.textContent = `文件不能超过 ${databaseLimits.files} 项`;
        reportContentError(new DatabaseContentError(status.textContent));
        return;
      }
      const generation = popupGeneration;
      const uploaded: DatabaseFile[] = [];
      const controller = new AbortController();
      fileUploads.add(controller);
      input.disabled = true;
      status.textContent = "上传中…";
      try {
        for (const file of files) {
          if (isDestroyed() || !editor.isEditable || generation !== popupGeneration || !dom.contains(container)) return;
          const url = await provider(file, { signal: controller.signal });
          if (
            controller.signal.aborted ||
            isDestroyed() ||
            !editor.isEditable ||
            generation !== popupGeneration ||
            !dom.contains(container)
          )
            return;
          const [result] = databaseFiles([
            { id: createDatabaseId("file"), name: file.name, url, size: file.size, mimeType: file.type },
          ]);
          if (!result) throw new Error("上传返回的文件地址无效");
          uploaded.push(result);
        }
        if (uploaded.length) onUploaded(uploaded);
        status.textContent = "";
      } catch (error) {
        if (
          controller.signal.aborted ||
          (error instanceof Error && error.name === "AbortError") ||
          isDestroyed() ||
          generation !== popupGeneration ||
          !dom.contains(container)
        )
          return;
        status.textContent = "上传失败";
        if (error instanceof DatabaseContentError) reportContentError(error);
        else getOptions().onError(error);
      } finally {
        fileUploads.delete(controller);
        if (generation === popupGeneration && dom.contains(input)) {
          input.disabled = false;
          input.value = "";
        }
      }
    };
    input.addEventListener("change", () => void upload(Array.from(input.files ?? [])));
    const dropZone = doc.createElement("div");
    dropZone.className = "semlo-editor-database-file-drop";
    dropZone.tabIndex = 0;
    dropZone.setAttribute("role", "group");
    dropZone.setAttribute("aria-label", type === "image" ? "粘贴或拖拽图片" : "粘贴或拖拽附件");
    dropZone.textContent = "直接粘贴或拖拽到这里";
    dropZone.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    dropZone.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void upload(Array.from(event.dataTransfer?.files ?? []));
    });
    dropZone.addEventListener("paste", (event) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (!files.length) return;
      event.preventDefault();
      event.stopPropagation();
      void upload(files);
    });
    container.append(dropZone, input, status);
  };

  return {
    get current() {
      return popup;
    },
    closePopup,
    panel,
    panelHeading,
    personSearch,
    filePicker,
    cancelPersonSearch() {
      personSearchAbort?.abort();
    },
  };
}
