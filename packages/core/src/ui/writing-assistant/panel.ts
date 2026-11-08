import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { writingPresetGroups } from "../../features/writing-assistant/presets";
import type { installWritingAssistant } from "../../features/writing-assistant/session";
import { toolbarWritingIcon } from "../toolbar/icons";
import { renderWritingPreview } from "./preview";

/** 草稿、提问和操作均为装饰，不进入正文或撤销记录。 */
export function mountWritingAssistantPanel(editor: Editor, session: ReturnType<typeof installWritingAssistant>) {
  const controller = session.controller;
  const doc = editor.view.dom.ownerDocument;
  const panel = doc.createElement("aside");
  panel.className = "semlo-editor-writing-assistant";
  panel.contentEditable = "false";
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "智能写作助手");
  const button = (label: string, action: () => void, className = "") => {
    const element = doc.createElement("button");
    element.type = "button";
    element.textContent = label;
    element.className = className;
    element.addEventListener("click", action);
    return element;
  };
  const preview = doc.createElement("div");
  preview.className = "semlo-editor-writing-preview";
  const output = doc.createElement("div");
  output.className = "semlo-editor-writing-result";
  output.tabIndex = 0;
  output.setAttribute("role", "document");
  output.setAttribute("aria-label", "写作草稿");
  const footer = doc.createElement("div");
  footer.className = "semlo-editor-writing-disclosure";
  const declaration = doc.createElement("span");
  declaration.textContent = "本内容由 AI 生成";
  let renderVersion = 0;
  const copy = button("复制草稿", () => {
    const version = renderVersion,
      text = controller.getSnapshot().text;
    output.focus();
    const range = doc.createRange();
    range.selectNodeContents(output);
    const selection = doc.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const clipboard = doc.defaultView?.navigator.clipboard;
    if (!clipboard) {
      status.textContent = "草稿已选中，可按复制快捷键。";
      status.hidden = false;
      return;
    }
    void clipboard.writeText(text).then(
      () => {
        if (panel.isConnected && version === renderVersion) {
          status.textContent = "草稿已复制。";
          status.hidden = false;
        }
      },
      () => {
        if (panel.isConnected && version === renderVersion) {
          status.textContent = "草稿已选中，可按复制快捷键。";
          status.hidden = false;
        }
      },
    );
  });
  const footerActions = doc.createElement("div");
  footerActions.className = "semlo-editor-writing-feedback-actions";
  const positive = button(
    "有帮助",
    () => void session.feedback("positive").catch(() => {}),
    "semlo-editor-writing-feedback",
  );
  const negative = button(
    "没有帮助",
    () => void session.feedback("negative").catch(() => {}),
    "semlo-editor-writing-feedback semlo-editor-writing-feedback-negative",
  );
  for (const [element, label] of [
    [positive, "有帮助"],
    [negative, "没有帮助"],
  ] as const) {
    element.setAttribute("aria-label", label);
    element.innerHTML =
      '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 7.1 8 2.5c.5-.9 1.7-.3 1.6.6l-.3 2.7h2.8c1.1 0 1.6.7 1.3 1.8l-.9 4.1c-.2.9-.9 1.5-1.8 1.5H5.5zM2.5 7.1h3v6h-3z"/></svg>';
  }
  footerActions.append(copy, positive, negative);
  footer.append(declaration, footerActions);
  preview.append(output, footer);
  const form = doc.createElement("form");
  form.className = "semlo-editor-writing-form";
  const icon = doc.createElement("span");
  icon.className = "semlo-editor-writing-icon";
  icon.innerHTML = toolbarWritingIcon;
  const input = doc.createElement("textarea");
  input.placeholder = "向智能助手提问...";
  input.setAttribute("aria-label", "向智能助手提问");
  input.rows = 1;
  const resizeInput = () => {
    input.style.height = "auto";
    if (!input.hidden && input.isConnected) input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  };
  const progress = doc.createElement("span");
  progress.className = "semlo-editor-writing-progress";
  progress.setAttribute("role", "status");
  const submit = () => {
    const state = controller.getSnapshot();
    if (input.disabled || state.status === "pending") return;
    const promise = state.status === "ready" ? controller.followUp(input.value) : controller.send(input.value);
    void promise.catch(() => {});
  };
  const send = button("发送", submit, "semlo-editor-writing-send");
  const close = button("关闭", () => controller.cancel(), "semlo-editor-writing-close");
  close.setAttribute("aria-label", "关闭写作助手");
  close.title = "关闭";
  close.innerHTML =
    '<svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16"><path d="m4 4 8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
  const stop = button("停止", () => controller.stop());
  const escape = doc.createElement("kbd");
  escape.textContent = "Esc";
  stop.append(escape);
  form.append(icon, input, progress, send, stop, close);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit();
  });
  const status = doc.createElement("div");
  status.className = "semlo-editor-writing-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const presets = doc.createElement("div");
  presets.className = "semlo-editor-writing-presets";
  for (const group of writingPresetGroups) {
    const section = doc.createElement("section");
    section.setAttribute("aria-label", group.title);
    const title = doc.createElement("div");
    title.className = "semlo-editor-writing-preset-heading";
    title.textContent = group.title;
    section.append(title);
    for (const [label, prompt] of group.items)
      section.append(
        button(label, () => {
          void controller.send(prompt).catch(() => {});
        }),
      );
    presets.append(section);
  }
  input.addEventListener("input", () => {
    send.hidden = !input.value.trim();
    send.disabled = !input.value.trim() || !controller.getSnapshot().available;
    const state = controller.getSnapshot();
    presets.hidden = state.status !== "prompt" || !state.replacing || Boolean(input.value.trim());
    resizeInput();
  });
  const actions = doc.createElement("div");
  actions.className = "semlo-editor-writing-actions";
  actions.setAttribute("role", "group");
  actions.setAttribute("aria-label", "草稿操作");
  const addActionIcon = (element: HTMLButtonElement, path: string) => {
    const icon = doc.createElement("span");
    icon.className = "semlo-editor-writing-action-icon";
    icon.innerHTML = `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
    const label = doc.createElement("span");
    label.textContent = element.textContent;
    element.replaceChildren(icon, label);
    return label;
  };
  const accept = button(
    "完成",
    () => {
      controller.accept();
    },
    "semlo-editor-writing-accept",
  );
  const after = button("插入选区下方", () => {
    controller.accept("after");
  });
  const regenerate = button(
    "重新生成",
    () => {
      void controller.retry().catch(() => {});
    },
    "semlo-editor-writing-regenerate",
  );
  const retry = button("重试", () => {
    const prompt = controller.getSnapshot().prompt;
    void (input.value.trim() && input.value !== prompt ? controller.send(input.value) : controller.retry()).catch(
      () => {},
    );
  });
  const discard = button("关闭", () => controller.cancel());
  const checkIcon = '<path d="m3 8 3 3 7-7"/>';
  const retryIcon = '<path d="M13 6a5 5 0 0 0-8.6-2L3 5.5M3 2.5v3h3M3 10a5 5 0 0 0 8.6 2l1.4-1.5M13 13.5v-3h-3"/>';
  const acceptLabel = addActionIcon(accept, checkIcon);
  addActionIcon(after, checkIcon);
  addActionIcon(regenerate, retryIcon);
  addActionIcon(retry, retryIcon);
  addActionIcon(discard, '<path d="M3 4h10M6 4V2.5h4V4M4 4l.5 9h7L12 4M6.5 6.5v4M9.5 6.5v4"/>');
  actions.append(accept, after, regenerate, retry, discard);
  panel.append(preview, form, status, presets, actions);
  panel.addEventListener("focusin", () => {
    if (editor.isDestroyed || !session.isOpen()) return;
    // 装饰仍在编辑器 DOM 内，BubbleMenu 的 blur 判定会把它当作正文；显式隐藏可避免遮挡提问按钮。
    editor.view.dispatch(editor.state.tr.setMeta("bubbleMenu", "hide").setMeta("addToHistory", false));
  });
  panel.addEventListener("keydown", (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (controller.getSnapshot().status === "pending") controller.stop();
      else controller.cancel();
    } else if (event.target === input && event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  });
  const key = new PluginKey("semloEditorWritingPanel");
  let destroyed = false,
    previousStatus = "closed";
  const plugin = new Plugin({
    key,
    props: {
      decorations(state) {
        if (destroyed || !session.isOpen()) return null;
        return DecorationSet.create(state.doc, [
          Decoration.widget(session.anchor(state.doc), () => panel, {
            key: "writing-assistant",
            side: 1,
            ignoreSelection: true,
            stopEvent: () => true,
          }),
        ]);
      },
    },
  });
  editor.registerPlugin(plugin);
  const onMount = () => {
    if (destroyed || editor.isDestroyed) return;
    if (!editor.state.plugins.includes(plugin)) editor.registerPlugin(plugin);
    refresh();
  };
  editor.on("mount", onMount);
  const refresh = () => {
    if (destroyed || editor.isDestroyed) return;
    const state = controller.getSnapshot();
    const feedback = session.feedbackState();
    const version = ++renderVersion;
    const heldFocus = panel.contains(doc.activeElement),
      started = state.status === "pending" && previousStatus !== "pending";
    const completed = state.status !== "pending" && previousStatus === "pending";
    const opened = state.status === "prompt" || (state.status !== "closed" && previousStatus === "closed");
    if (opened || ((state.status === "error" || state.status === "stopped") && state.status !== previousStatus))
      input.value = state.prompt;
    if (state.status === "ready" && previousStatus !== "ready") input.value = "";
    previousStatus = state.status;
    panel.dataset.status = state.status;
    panel.setAttribute("aria-busy", String(state.status === "pending"));
    input.disabled = state.status === "stale" || !state.available;
    input.readOnly = state.status === "pending";
    input.hidden = state.status === "pending";
    send.disabled = input.disabled || state.status === "pending" || !input.value.trim();
    send.hidden = state.status === "pending" || !input.value.trim();
    progress.textContent = state.status === "pending" ? "正在编写…" : "";
    progress.hidden = state.status !== "pending";
    stop.hidden = state.status !== "pending";
    resizeInput();
    status.textContent = feedback.message || state.message;
    status.hidden = !feedback.message && (!state.message || state.status === "pending" || state.status === "ready");
    for (const [element, rating] of [
      [positive, "positive"],
      [negative, "negative"],
    ] as const) {
      element.disabled = !feedback.available || feedback.pending;
      element.setAttribute("aria-pressed", String(feedback.rating === rating));
      element.title = feedback.available ? element.getAttribute("aria-label")! : "反馈暂不可用";
    }
    renderWritingPreview(output, state.result, state.text);
    preview.hidden = !state.text && !state.result;
    presets.hidden = state.status !== "prompt" || !state.replacing || Boolean(input.value.trim());
    actions.hidden = state.status !== "ready" && state.status !== "error" && state.status !== "stopped";
    retry.hidden = state.status !== "error" && state.status !== "stopped";
    retry.disabled = input.disabled;
    accept.hidden = after.hidden = regenerate.hidden = state.status !== "ready";
    after.hidden ||= !state.replacing;
    accept.disabled = after.disabled = !state.canAccept;
    acceptLabel.textContent = state.replacing ? "替换选中内容" : "完成";
    // 只刷新装饰，不在事务通知中重入派发。
    try {
      editor.view.updateState(editor.state);
    } catch {
      return;
    }
    if (started && heldFocus && panel.isConnected) stop.focus({ preventScroll: true });
    if (completed && heldFocus && state.status !== "closed" && panel.isConnected) {
      if (!preview.hidden) output.focus({ preventScroll: true });
      else if (!input.disabled) input.focus({ preventScroll: true });
      else close.focus({ preventScroll: true });
    }
    if (opened)
      queueMicrotask(() => {
        if (!destroyed && version === renderVersion && panel.isConnected && !input.disabled) input.focus();
      });
  };
  const unsubscribe = controller.subscribe(refresh);
  return () => {
    if (destroyed) return;
    destroyed = true;
    unsubscribe();
    editor.off("mount", onMount);
    panel.remove();
  };
}
