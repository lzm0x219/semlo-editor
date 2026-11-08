import type { Editor, Range } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Selection, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import { cloneContentValue } from "../../editor/content/clone-value";
import type { BlockInsertTarget } from "../blocks/actions/target";
import { siblingItemAttrs } from "../insertion/sibling-item-attrs";
import { acceptWritingSelection } from "./accept";
import { parseWritingResult } from "./content";
import { setWritingGuardHooks, writingAcceptMeta, writingEditableTransition } from "./guard";
import { createWritingRequestRunner } from "./request";
import type {
  WritingAssistantController,
  WritingOpenOptions,
  WritingService,
  WritingSnapshot,
  WritingRequest,
  WritingResult,
  WritingFeedbackRating,
  WritingFeedbackService,
} from "./types";

type BelowTarget = Pick<BlockInsertTarget, "pos" | "after" | "node" | "kind">;
type Target = {
  doc: ProseMirrorNode;
  view: EditorView;
  selection: Selection;
  range: Range;
  provider: WritingService;
  below?: BelowTarget;
};
const assistants = new WeakMap<Editor, WritingAssistantController>();

/** 默认入口和自定义工具栏共享当前实例的同一个会话；非 Semlo 实例返回 null。 */
export function getWritingAssistant(editor: Editor): WritingAssistantController | null {
  return assistants.get(editor) ?? null;
}

export function installWritingAssistant(
  editor: Editor,
  getService: () => WritingService | null | undefined,
  report: (error: unknown) => void,
  unavailable: () => boolean,
  getFeedback: () => WritingFeedbackService | null | undefined = () => undefined,
) {
  const runner = createWritingRequestRunner();
  const feedbackRunner = createWritingRequestRunner();
  const listeners = new Set<() => void>();
  let viewDom = editor.view.dom;
  let mounted = true;
  let disposed = false;
  let applying = false;
  let revision = 0;
  let target: Target | null = null;
  let parsed: ProseMirrorNode | null = null;
  let lastRequest: Omit<WritingRequest, "signal"> | null = null;
  let feedbackState: { rating: WritingFeedbackRating | null; pending: boolean; message: string } = {
    rating: null,
    pending: false,
    message: "",
  };
  let state: WritingSnapshot = {
    status: "closed",
    available: false,
    prompt: "",
    text: "",
    result: null,
    message: "",
    replacing: false,
    canAccept: false,
  };
  const available = () =>
    !disposed &&
    mounted &&
    !writingEditableTransition(editor) &&
    !unavailable() &&
    !editor.isDestroyed &&
    editor.isEditable &&
    typeof getService() === "function";
  const live = (value: Target) =>
    available() && target === value && editor.view === value.view && getService() === value.provider;
  const valid = (value: Target) =>
    live(value) && editor.state.doc === value.doc && state.status !== "stale" && state.status !== "closed";
  const notify = () => {
    for (const listener of Array.from(listeners)) {
      if (disposed) break;
      listener();
    }
  };
  const resetFeedback = () => {
    feedbackState = { rating: null, pending: false, message: "" };
    feedbackRunner.cancel();
  };
  const invalidate = (message = "正文或写作目标已变化。请复制草稿，关闭后重新选择位置。") => {
    if (disposed) return;
    if (state.status === "closed") {
      notify();
      return;
    }
    const current = ++revision;
    state = { ...state, status: "stale", message, canAccept: false };
    runner.cancel();
    if (current !== revision || disposed) return;
    resetFeedback();
    if (current !== revision || disposed) return;
    notify();
  };
  const ensure = (value: Target) => {
    if (valid(value)) return true;
    if (target === value) invalidate();
    return false;
  };
  const open = (options: WritingOpenOptions = {}, below?: BelowTarget) => {
    if (!available()) return false;
    const doc = editor.state.doc;
    const source = options.range ?? editor.state.selection;
    const range = below ? { from: below.after, to: below.after } : { from: source.from, to: source.to };
    if (
      !Number.isInteger(range.from) ||
      !Number.isInteger(range.to) ||
      range.from < 0 ||
      range.to < range.from ||
      range.to > doc.content.size
    )
      return false;
    if (below && (doc.nodeAt(below.pos) !== below.node || below.after !== below.pos + below.node.nodeSize))
      return false;
    const value: Target = {
      doc,
      view: editor.view,
      selection: editor.state.selection,
      range: { from: range.from, to: range.to },
      provider: getService()!,
      below: below && { ...below },
    };
    revision++;
    target = value;
    parsed = null;
    lastRequest = null;
    state = {
      status: "prompt",
      available: true,
      prompt: options.prompt ?? "",
      text: "",
      result: null,
      message: "",
      replacing: !below && range.from !== range.to,
      canAccept: false,
    };
    runner.cancel();
    if (target !== value || state.status !== "prompt") return false;
    resetFeedback();
    if (target !== value || state.status !== "prompt") return false;
    notify();
    return target === value && state.status === "prompt";
  };
  const onTransaction = ({ transaction }: { transaction: Transaction }) => {
    if (target && state.status !== "closed" && !applying && (transaction.docChanged || !valid(target))) invalidate();
  };
  const checkEditable = () => {
    if (target && state.status !== "closed" && (!live(target) || (!applying && editor.state.doc !== target.doc)))
      invalidate("编辑器已只读或写作服务已变化。草稿保留，请重新打开助手。");
  };
  const onUnmount = () => {
    mounted = false;
    invalidate("编辑器已卸载，旧写作目标已失效。草稿仍可复制。");
  };
  const onMount = () => {
    viewDom.removeEventListener("semlo-editor:document-replace", onReplace);
    viewDom.removeEventListener("semlo-editor:editable", checkEditable);
    viewDom = editor.view.dom;
    viewDom.addEventListener("semlo-editor:document-replace", onReplace);
    viewDom.addEventListener("semlo-editor:editable", checkEditable);
    mounted = true;
    notify();
  };
  const onReplace = () => invalidate();
  const generate = async (prompt: string, previousDraft?: WritingResult, replay?: Omit<WritingRequest, "signal">) => {
    const value = target;
    if (applying || !value || !ensure(value) || typeof prompt !== "string" || !prompt.trim()) return;
    const current = ++revision;
    const { from, to } = value.range;
    const doc = value.doc;
    const request = replay
      ? cloneContentValue(replay)
      : {
          prompt,
          context: {
            selection: {
              from,
              to,
              text: doc.textBetween(from, to, "\n"),
              content: cloneContentValue(doc.slice(from, to).content.toJSON() ?? []),
            },
            before: doc.textBetween(Math.max(0, from - 1000), from, "\n"),
            after: doc.textBetween(to, Math.min(doc.content.size, to + 1000), "\n"),
          },
          ...(previousDraft ? { previousDraft: cloneContentValue(previousDraft) } : {}),
        };
    if (current !== revision || !ensure(value)) return;
    lastRequest = cloneContentValue(request);
    // 重生或追问时保留上一份草稿，失败、停止和失效均仍可复制。
    state = { ...state, status: "pending", prompt: request.prompt, message: "正在编写…", canAccept: false };
    resetFeedback();
    if (current !== revision || !valid(value)) return;
    notify();
    if (current !== revision || !valid(value)) return;
    await runner.run(
      async (signal) => {
        if (current !== revision || !ensure(value)) throw new Error("写作请求已失效");
        return value.provider({ ...cloneContentValue(request), signal });
      },
      (result) => {
        if (current !== revision || !ensure(value)) return;
        // 非法结构只留可复制的文本，绝不交给 HTML 解析或自定义节点渲染。
        let text = "";
        try {
          text =
            result?.format === "text" && typeof result.text === "string"
              ? result.text
              : (JSON.stringify(result, null, 2) ?? "");
        } catch {
          /* 不可序列化结果由严格解析报告。 */
        }
        if (current !== revision || !ensure(value)) return;
        if (!state.result) state = { ...state, text };
        const output = parseWritingResult(editor, result);
        if (current !== revision || !ensure(value)) return;
        parsed = output.parsed;
        state = {
          ...state,
          status: "ready",
          result: output.result,
          text: output.text,
          message: "请检查生成内容，接纳后才会写入正文。",
          canAccept: true,
        };
        notify();
      },
      (error) => {
        if (current !== revision || !ensure(value)) return;
        state = {
          ...state,
          status: "error",
          message: error instanceof Error ? error.message : "写作失败，请重试",
          canAccept: false,
        };
        notify();
        report(error);
      },
    );
  };
  const sendFeedback = async (rating: WritingFeedbackRating) => {
    const value = target;
    const provider = getFeedback();
    const result = state.result;
    if (
      (rating !== "positive" && rating !== "negative") ||
      feedbackState.pending ||
      feedbackState.rating === rating ||
      state.status !== "ready" ||
      !result ||
      !value ||
      typeof provider !== "function" ||
      !ensure(value)
    )
      return;
    const current = revision;
    const prompt = state.prompt;
    const owns = () =>
      current === revision &&
      state.status === "ready" &&
      state.result === result &&
      valid(value) &&
      getFeedback() === provider;
    feedbackState = { ...feedbackState, pending: true, message: "" };
    notify();
    if (!owns() || !feedbackState.pending) return;
    await feedbackRunner.run(
      async (signal) => {
        if (!owns()) return;
        await provider({ rating, prompt, result: cloneContentValue(result), signal });
      },
      () => {
        if (!owns()) return;
        feedbackState = { rating, pending: false, message: "" };
        notify();
      },
      (error) => {
        if (!owns()) return;
        feedbackState = { ...feedbackState, pending: false, message: "反馈提交失败，请重试。" };
        notify();
        if (owns()) report(error);
      },
    );
  };
  const controller: WritingAssistantController = {
    getSnapshot() {
      return {
        ...state,
        available: available(),
        canAccept: state.status === "ready" && Boolean(target && valid(target)),
        result: state.result ? JSON.parse(JSON.stringify(state.result)) : null,
      };
    },
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    open,
    send(prompt) {
      return generate(prompt);
    },
    followUp(prompt) {
      if (state.status !== "ready" || !state.result) return Promise.resolve();
      return generate(prompt, state.result);
    },
    retry() {
      return lastRequest ? generate(lastRequest.prompt, undefined, lastRequest) : Promise.resolve();
    },
    stop() {
      if (disposed || state.status !== "pending") return;
      revision++;
      state = { ...state, status: "stopped", message: "已停止编写，可修改提问后重试。", canAccept: false };
      runner.cancel();
      notify();
    },
    accept(mode = "default") {
      if (mode !== "default" && mode !== "after") return "unavailable";
      if (applying) return "busy";
      const value = target;
      if (state.status !== "ready" || !parsed || !value || !ensure(value)) return "unavailable";
      if (mode === "after" && (value.below || value.range.from === value.range.to)) return "unavailable";
      const current = revision;
      let expected: ProseMirrorNode | null = null;
      let failure: unknown;
      applying = true;
      try {
        let tr = editor.state.tr;
        if (value.below) {
          const below = value.below;
          const resolved = value.doc.resolve(below.pos);
          let content = parsed.content;
          if (below.kind === "item") {
            const type = below.node.type;
            if (!type.validContent(content)) throw new Error("当前列表项不支持此生成内容");
            content = Fragment.from(type.create(siblingItemAttrs(below.node), content));
          }
          const index = resolved.index() + 1;
          if (!resolved.parent.canReplace(index, index, content)) throw new Error("当前块下方不支持此生成内容");
          tr.insert(below.after, content);
        } else tr = acceptWritingSelection(editor.state, parsed, value.range, mode);
        tr.doc.check();
        expected = tr.doc;
        if (value.below)
          tr.setSelection(
            Selection.near(tr.doc.resolve(Math.min(tr.doc.content.size, tr.mapping.map(value.range.to))), -1),
          );
        tr.setMeta(writingAcceptMeta, () => current === revision && valid(value));
        editor.view.dispatch(closeHistory(tr).scrollIntoView());
      } catch (error) {
        failure = error;
      } finally {
        applying = false;
      }
      if (!disposed && current === revision && live(value) && expected && editor.state.doc.eq(expected)) {
        target = null;
        parsed = null;
        lastRequest = null;
        revision++;
        state = { ...state, status: "closed", prompt: "", text: "", result: null, canAccept: false, message: "" };
        runner.cancel();
        if (!disposed && revision === current + 1) resetFeedback();
        // 将后续输入与这一次接纳分开，避免一次撤销同时吞掉后续文字。
        try {
          if (!editor.isDestroyed && mounted)
            editor.view.dispatch(closeHistory(editor.state.tr).setMeta("addToHistory", false));
        } catch (error) {
          failure ??= error;
        }
        notify();
        if (!disposed && state.status === "closed" && mounted && !editor.isDestroyed) editor.view.focus();
        if (failure) report(failure);
        return "applied";
      }
      if (!disposed && current === revision && target === value && valid(value)) {
        state = {
          ...state,
          message: failure instanceof Error ? failure.message : "宿主未接纳此事务，草稿已保留，可再次接纳。",
        };
        notify();
      } else if (!disposed && target === value)
        invalidate("宿主更改了文档或会话，草稿已保留。请核对正文后重新选择位置。");
      if (failure) report(failure);
      return state.status === "ready" ? "rejected" : "unavailable";
    },
    cancel() {
      if (disposed || state.status === "closed") return;
      const value = target;
      const restore = value && valid(value);
      target = null;
      parsed = null;
      lastRequest = null;
      const current = ++revision;
      state = { ...state, status: "closed", prompt: "", text: "", result: null, canAccept: false, message: "" };
      runner.cancel();
      if (current !== revision || disposed) return;
      resetFeedback();
      if (current !== revision || disposed) return;
      notify();
      if (current === revision && restore && value && available() && editor.state.doc === value.doc) {
        editor.view.dispatch(editor.state.tr.setSelection(value.selection).setMeta("addToHistory", false));
        if (current === revision && available()) editor.view.focus();
      }
    },
  };
  const destroy = () => {
    if (disposed) return;
    disposed = true;
    revision++;
    target = null;
    lastRequest = null;
    state = { ...state, status: "closed", prompt: "", text: "", result: null, available: false, canAccept: false };
    assistants.delete(editor);
    setWritingGuardHooks(editor);
    listeners.clear();
    editor.off("transaction", onTransaction);
    editor.off("update", checkEditable);
    editor.off("unmount", onUnmount);
    editor.off("mount", onMount);
    editor.off("destroy", destroy);
    viewDom.removeEventListener("semlo-editor:document-replace", onReplace);
    viewDom.removeEventListener("semlo-editor:editable", checkEditable);
    runner.cancel();
    feedbackRunner.cancel();
  };
  assistants.set(editor, controller);
  setWritingGuardHooks(editor, {
    invalidate: () => invalidate("编辑器已只读，旧写作目标已失效。草稿仍可复制。"),
    refresh: notify,
  });
  editor.on("transaction", onTransaction);
  editor.on("update", checkEditable);
  editor.on("unmount", onUnmount);
  editor.on("mount", onMount);
  editor.on("destroy", destroy);
  viewDom.addEventListener("semlo-editor:document-replace", onReplace);
  viewDom.addEventListener("semlo-editor:editable", checkEditable);
  return {
    controller,
    invalidate,
    destroy,
    feedback: sendFeedback,
    feedbackState: () => ({
      ...feedbackState,
      available: state.status === "ready" && Boolean(target && valid(target)) && typeof getFeedback() === "function",
    }),
    feedbackProviderChanged: () => {
      if (disposed) return;
      resetFeedback();
      notify();
    },
    openBelow: (below: BelowTarget) => open({}, below),
    isOpen: () => state.status !== "closed",
    anchor(document: ProseMirrorNode) {
      if (!target || target.doc !== document) return document.content.size;
      if (target.below) {
        const position = document.resolve(target.below.pos);
        return position.depth ? position.after(1) : target.below.after;
      }
      const position = document.resolve(target.range.to);
      return position.depth ? position.after(1) : target.range.to;
    },
  };
}
