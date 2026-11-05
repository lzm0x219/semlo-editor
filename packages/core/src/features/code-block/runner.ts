import type { Editor } from "@tiptap/core";

import { normalizeCodeLanguage } from "./language-aliases";

export interface CodeRunRequest {
  language:
    | "javascript"
    | "typescript"
    | "python"
    | "c"
    | "csharp"
    | "cpp"
    | "java"
    | "go"
    | "rust"
    | "php"
    | "html"
    | "sql"
    | "bash"
    | "shell"
    | "vbnet"
    | "verilog"
    | "systemverilog";
  code: string;
  signal: AbortSignal;
}
export type CodeRunner = (request: CodeRunRequest) => void | Promise<void>;

type RunnerState = {
  runner: CodeRunner | null;
  report: (error: unknown) => void;
  pending: Set<AbortController>;
};
const states = new WeakMap<Editor, RunnerState>();

/** Called by the host integration on creation and when integrations change. */
export function configureCodeRunner(editor: Editor, runner: CodeRunner | null, report: (error: unknown) => void): void {
  if (editor.isDestroyed) return;
  let state = states.get(editor);
  if (!state) {
    state = { runner: null, report, pending: new Set() };
    states.set(editor, state);
    const owned = state;
    editor.on("destroy", () => {
      for (const controller of owned.pending) controller.abort();
      owned.pending.clear();
      owned.runner = null;
      states.delete(editor);
    });
  }
  // 先切换并摘出旧任务；中止回调可能同步更新集成或启动新任务。
  const previous = state.runner === runner ? [] : [...state.pending];
  if (previous.length) state.pending.clear();
  state.runner = runner;
  state.report = report;
  for (const controller of previous) controller.abort();
  if (editor.isDestroyed) return;
  const view = editor.view;
  const EventType = view.dom.ownerDocument.defaultView?.Event;
  if (EventType) view.dom.dispatchEvent(new EventType("semlo-editor:code-runner"));
}

function runnableLanguage(language: unknown): CodeRunRequest["language"] | null {
  const normalized = normalizeCodeLanguage(language);
  return normalized === "javascript" ||
    normalized === "typescript" ||
    normalized === "python" ||
    normalized === "c" ||
    normalized === "csharp" ||
    normalized === "cpp" ||
    normalized === "java" ||
    normalized === "go" ||
    normalized === "rust" ||
    normalized === "php" ||
    normalized === "html" ||
    normalized === "sql" ||
    normalized === "bash" ||
    normalized === "shell" ||
    normalized === "vbnet" ||
    normalized === "verilog" ||
    normalized === "systemverilog"
    ? normalized
    : null;
}

export function canRunCode(editor: Editor, language: unknown): boolean {
  return !!states.get(editor)?.runner && runnableLanguage(language) !== null;
}

/** Execution and output belong entirely to the host; the editor never runs source itself. */
export async function runCode(editor: Editor, language: unknown, code: string): Promise<void> {
  const state = states.get(editor);
  const resolved = runnableLanguage(language);
  if (!state?.runner || !resolved || editor.isDestroyed) return;
  const runner = state.runner;
  const controller = new AbortController();
  state.pending.add(controller);
  try {
    await runner({ language: resolved, code, signal: controller.signal });
  } catch (error) {
    if (!controller.signal.aborted && !editor.isDestroyed && states.get(editor) === state) state.report(error);
  } finally {
    state.pending.delete(controller);
  }
}
