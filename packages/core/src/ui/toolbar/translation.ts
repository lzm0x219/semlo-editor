import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

import { linkPopup } from "../../platform/dom/popup-owner";

export type TranslationSourceLanguage = "auto" | "zh" | "en";
export type TranslationTargetLanguage = "zh" | "en";
export type TranslationService = (request: {
  text: string;
  sourceLanguage: TranslationSourceLanguage;
  targetLanguage: TranslationTargetLanguage;
  signal: AbortSignal;
}) => Promise<string>;

export interface TranslationPanelController {
  open(anchor: HTMLButtonElement): void;
  close(): void;
  destroy(): void;
}

/** Mount a selection-driven translation panel using a host-provided service. */
export function mountTranslationPanel(
  editor: Editor,
  body: HTMLElement,
  getService: () => TranslationService | undefined,
  report?: (error: unknown) => void,
): TranslationPanelController {
  const doc = body.ownerDocument;
  const panel = doc.createElement("aside");
  panel.className = "semlo-editor-translation-panel";
  panel.hidden = true;
  panel.setAttribute("aria-label", "翻译");
  const heading = doc.createElement("div");
  heading.className = "semlo-editor-translation-heading";
  const title = doc.createElement("strong");
  title.textContent = "翻译";
  const closeButton = doc.createElement("button");
  closeButton.type = "button";
  closeButton.className = "semlo-editor-translation-close";
  closeButton.setAttribute("aria-label", "关闭翻译");
  closeButton.textContent = "×";
  heading.append(title, closeButton);
  const languageTitle = doc.createElement("div");
  languageTitle.textContent = "源 & 目标";
  const source = doc.createElement("select");
  source.setAttribute("aria-label", "源语言");
  const target = doc.createElement("select");
  target.setAttribute("aria-label", "目标语言");
  for (const [value, label] of [
    ["auto", "自动检测"],
    ["zh", "中文"],
    ["en", "英文"],
  ]) {
    const option = doc.createElement("option");
    option.value = value;
    option.textContent = label;
    source.append(option);
    if (value !== "auto") target.append(option.cloneNode(true));
  }
  target.value = "en";
  const resultTitle = doc.createElement("div");
  resultTitle.textContent = "译文";
  const result = doc.createElement("pre");
  result.className = "semlo-editor-translation-result";
  result.setAttribute("aria-label", "译文");
  const status = doc.createElement("div");
  status.className = "semlo-editor-translation-status";
  status.setAttribute("role", "status");
  const retry = doc.createElement("button");
  retry.type = "button";
  retry.className = "semlo-editor-translation-retry";
  retry.textContent = "重试";
  retry.hidden = true;
  const insert = doc.createElement("button");
  insert.type = "button";
  insert.className = "semlo-editor-translation-insert";
  insert.textContent = "插入文档";
  insert.disabled = true;
  panel.append(heading, languageTitle, source, target, resultTitle, result, status, retry, insert);
  body.append(panel);

  let anchor: HTMLButtonElement | undefined;
  let unlink: (() => void) | undefined;
  let request: AbortController | undefined;
  let generation = 0;
  let lastKey = "";
  let snapshot: { from: number; to: number; doc: typeof editor.state.doc; text: string } | undefined;
  let destroyed = false;

  const cancel = () => {
    generation++;
    request?.abort();
    request = undefined;
    snapshot = undefined;
    result.textContent = "";
    status.textContent = "";
    retry.hidden = true;
    insert.disabled = true;
  };
  const update = (force = false) => {
    if (destroyed || panel.hidden || editor.isDestroyed) return;
    const selection = editor.state.selection;
    const text =
      selection instanceof TextSelection && !selection.empty
        ? editor.state.doc.textBetween(selection.from, selection.to, "\n")
        : "";
    const key = `${selection.from}:${selection.to}:${source.value}:${target.value}:${text}`;
    if (!force && key === lastKey && snapshot?.doc === editor.state.doc) return;
    lastKey = key;
    cancel();
    if (!text) return;
    const service = getService();
    if (!service) {
      status.textContent = "请先配置翻译服务";
      return;
    }
    snapshot = { from: selection.from, to: selection.to, doc: editor.state.doc, text };
    const current = generation;
    request = new AbortController();
    const signal = request.signal;
    const sourceLanguage = source.value as TranslationSourceLanguage;
    const targetLanguage = target.value as TranslationTargetLanguage;
    status.textContent = "翻译中…";
    Promise.resolve()
      .then(() => (signal.aborted ? "" : service({ text, sourceLanguage, targetLanguage, signal })))
      .then((translated) => {
        if (destroyed || panel.hidden || signal.aborted || current !== generation || !snapshot) return;
        if (typeof translated !== "string") throw new Error("翻译服务返回了无效结果");
        result.textContent = translated;
        status.textContent = "";
        insert.disabled = !translated || !editor.isEditable;
      })
      .catch((error: unknown) => {
        if (destroyed || panel.hidden || signal.aborted || current !== generation) return;
        status.textContent = "翻译失败";
        retry.hidden = false;
        if (error instanceof Error && error.name === "AbortError") return;
        try {
          report?.(error);
        } catch (reportError) {
          // 宿主错误回调的异常仍需可观察，但不能变成未处理的 Promise 拒绝。
          queueMicrotask(() => {
            throw reportError;
          });
        }
      });
  };
  const close = () => {
    if (panel.hidden) return;
    panel.hidden = true;
    body.classList.remove("semlo-editor-translation-open");
    cancel();
    lastKey = "";
    unlink?.();
    unlink = undefined;
    anchor?.setAttribute("aria-expanded", "false");
    anchor = undefined;
  };
  const changeLanguage = () => update(true);
  const onTransaction = () => update();
  source.addEventListener("change", changeLanguage);
  target.addEventListener("change", changeLanguage);
  retry.addEventListener("click", changeLanguage);
  closeButton.addEventListener("click", close);
  insert.addEventListener("click", () => {
    const current = snapshot;
    const translation = result.textContent;
    const selection = editor.state.selection;
    if (
      !current ||
      !translation ||
      !editor.isEditable ||
      current.doc !== editor.state.doc ||
      selection.from !== current.from ||
      selection.to !== current.to
    )
      return;
    cancel();
    lastKey = "";
    const view = editor.view;
    const focused = view.dom.ownerDocument.activeElement;
    editor
      .chain()
      .command(({ tr }) => {
        tr.insertText(translation, current.from, current.to);
        return true;
      })
      .run();
    if (
      !editor.isDestroyed &&
      editor.view === view &&
      view.dom.isConnected &&
      view.dom.ownerDocument.activeElement === focused
    )
      view.focus();
  });
  editor.on("transaction", onTransaction);

  return {
    open(trigger) {
      if (destroyed || editor.isDestroyed || !getService()) return;
      if (!panel.hidden) {
        close();
        return;
      }
      panel.hidden = false;
      body.classList.add("semlo-editor-translation-open");
      anchor = trigger;
      unlink = linkPopup(trigger, panel);
      trigger.setAttribute("aria-expanded", "true");
      update(true);
    },
    close,
    destroy() {
      if (destroyed) return;
      close();
      destroyed = true;
      cancel();
      editor.off("transaction", onTransaction);
      source.removeEventListener("change", changeLanguage);
      target.removeEventListener("change", changeLanguage);
      retry.removeEventListener("click", changeLanguage);
      panel.remove();
    },
  };
}
