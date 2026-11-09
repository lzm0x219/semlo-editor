import type { NodeViewRenderer } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";

import { createCodeBlockControl, type CodeBlockOption } from "./controls";
import { showCodeFeedback, showCodeProgress } from "./feedback";
import { createCodeFoldGutter } from "./fold-gutter";
import { readCodeFolds } from "./folding";
import { hasCodeIndentLanguage } from "./indent-language";
import { autoIndentCodeBlock, isAutoIndentPending, isCurrentAutoIndent } from "./keyboard";
import { normalizeCodeLanguage } from "./language-aliases";
import { lowlight } from "./languages";
import { createCodeLineNumbers } from "./line-numbers";
import { canRunCode, runCode } from "./runner";
import { readCodeSettings, rememberCodePreferences } from "./settings";
import { createCodeSettingsMenu } from "./settings-menu";

// Preserve the reference list, including languages that currently fall back
// to plain text. Mark approximations and missing grammars in the picker.
const languageOptions: CodeBlockOption[] = (
  [
    ["plaintext", "Plain Text"],
    ["abap", "ABAP", "近似高亮"],
    ["agda", "Agda", "近似高亮"],
    ["arkts", "ArkTS", "近似高亮"],
    ["x86asm", "Asm", "近似高亮"],
    ["bash", "Bash"],
    ["basic", "Basic", "近似高亮"],
    ["c", "C"],
    ["csharp", "C#"],
    ["cpp", "C++"],
    ["clojure", "Clojure"],
    ["cmake", "CMake"],
    ["css", "CSS"],
    ["cypher", "Cypher", "近似高亮"],
    ["dart", "Dart"],
    ["diff", "Diff"],
    ["dockerfile", "Dockerfile"],
    ["erlang", "Erlang"],
    ["fsharp", "F#"],
    ["fortran", "Fortran"],
    ["git", "Git", "近似高亮"],
    ["glsl", "Glsl"],
    ["go", "Go"],
    ["graphql", "GraphQL", "近似高亮"],
    ["groovy", "Groovy"],
    ["haskell", "Haskell"],
    ["html", "HTML"],
    ["http", "HTTP"],
    ["java", "Java"],
    ["javascript", "JavaScript"],
    ["json", "JSON"],
    ["jsx", "JSX", "近似高亮"],
    ["julia", "Julia"],
    ["katex", "KaTeX", "近似高亮"],
    ["kotlin", "Kotlin"],
    ["latex", "LaTeX"],
    ["less", "Less"],
    ["lisp", "Lisp"],
    ["lua", "Lua"],
    ["makefile", "Makefile", "近似高亮"],
    ["markdown", "Markdown", "近似高亮"],
    ["matlab", "MATLAB"],
    ["nginx", "Nginx"],
    ["objectivec", "Objective-C"],
    ["ocaml", "OCaml"],
    ["pascal", "Pascal"],
    ["perl", "Perl"],
    ["php", "PHP"],
    ["plsql", "PL/SQL", "近似高亮"],
    ["powershell", "PowerShell"],
    ["properties", "Properties"],
    ["protobuf", "Protobuf"],
    ["python", "Python"],
    ["r", "R"],
    ["ruby", "Ruby"],
    ["rust", "Rust"],
    ["sass", "Sass", "近似高亮"],
    ["scala", "Scala"],
    ["scheme", "Scheme"],
    ["shell", "Shell", "近似高亮"],
    ["solidity", "Solidity", "近似高亮"],
    ["sql", "SQL"],
    ["stex", "sTeX", "近似高亮"],
    ["swift", "Swift"],
    ["systemverilog", "SystemVerilog", "近似高亮"],
    ["tcl", "Tcl"],
    ["toml", "TOML"],
    ["tsx", "TSX", "近似高亮"],
    ["typescript", "TypeScript"],
    ["vbnet", "VB.net"],
    ["velocity", "Velocity", "近似高亮"],
    ["verilog", "Verilog"],
    ["vue", "Vue", "近似高亮"],
    ["xml", "XML"],
    ["yaml", "YAML"],
  ] as [string, string, string?][]
).map(([value, label, note]) => ({ value, label, note: note ?? (lowlight.registered(value) ? undefined : "纯文本") }));

const themeOptions: CodeBlockOption[] = [
  { value: "light-pro", label: "Yuque Light Pro" },
  { value: "light", label: "Yuque Light" },
  { value: "bracket-lights-pro", label: "Bracket Lights Pro" },
  { value: "dark", label: "One Dark Pro" },
  { value: "night-owl", label: "Night Owl" },
  { value: "darcula", label: "Darcula" },
];

export function createCodeBlockNodeView(): NodeViewRenderer {
  return ({ editor, view, getPos, node: initial }) => {
    const doc = view.dom.ownerDocument;
    const dom = doc.createElement("div");
    dom.className = "semlo-editor-code-card";
    dom.dataset.type = "codeBlock";
    const header = doc.createElement("div");
    header.className = "semlo-editor-code-header";
    header.contentEditable = "false";
    const revealHeader = doc.createElement("button");
    revealHeader.type = "button";
    revealHeader.className = "semlo-editor-code-header-reveal";
    revealHeader.contentEditable = "false";
    revealHeader.setAttribute("aria-label", "显示代码块标题栏");
    revealHeader.title = "显示代码块标题栏";
    const collapse = doc.createElement("button");
    collapse.type = "button";
    collapse.className = "semlo-editor-code-collapse";
    const title = doc.createElement("input");
    title.className = "semlo-editor-code-title";
    title.placeholder = "请输入代码块名称";
    title.setAttribute("aria-label", "代码块名称");
    const copy = doc.createElement("button");
    copy.type = "button";
    copy.className = "semlo-editor-code-copy";
    copy.title = "复制代码";
    copy.setAttribute("aria-live", "polite");
    const copyIcon = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    copyIcon.setAttribute("viewBox", "0 0 24 24");
    copyIcon.setAttribute("fill", "none");
    copyIcon.setAttribute("stroke", "currentColor");
    copyIcon.setAttribute("stroke-width", "1.7");
    copyIcon.setAttribute("stroke-linecap", "round");
    copyIcon.setAttribute("stroke-linejoin", "round");
    copyIcon.setAttribute("aria-hidden", "true");
    const front = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
    front.setAttribute("x", "8");
    front.setAttribute("y", "8");
    front.setAttribute("width", "11");
    front.setAttribute("height", "11");
    front.setAttribute("rx", "1.5");
    const back = doc.createElementNS("http://www.w3.org/2000/svg", "path");
    back.setAttribute("d", "M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2");
    copyIcon.append(front, back);
    const paintCopy = (status?: string) => {
      copy.setAttribute("aria-label", status ?? "复制代码");
      copy.title = status ?? "复制代码";
      if (status) {
        const icon = copyIcon.cloneNode(false) as SVGSVGElement;
        const mark = doc.createElementNS("http://www.w3.org/2000/svg", "path");
        mark.setAttribute("d", status === "已复制" ? "M5 12l4 4L19 6" : "M6 6l12 12M18 6 6 18");
        icon.append(mark);
        const announcement = doc.createElement("span");
        announcement.className = "semlo-editor-code-copy-announcement";
        announcement.textContent = status;
        copy.replaceChildren(icon, announcement);
      } else copy.replaceChildren(copyIcon.cloneNode(true));
    };
    paintCopy();
    const run = doc.createElement("button");
    run.type = "button";
    run.className = "semlo-editor-code-run";
    run.title = "运行代码";
    run.setAttribute("aria-label", "运行代码");
    const runIcon = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    runIcon.setAttribute("viewBox", "0 0 24 24");
    runIcon.setAttribute("fill", "none");
    runIcon.setAttribute("stroke", "currentColor");
    runIcon.setAttribute("stroke-width", "1.7");
    runIcon.setAttribute("aria-hidden", "true");
    const circle = doc.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", "12");
    circle.setAttribute("cy", "12");
    circle.setAttribute("r", "9");
    const triangle = doc.createElementNS("http://www.w3.org/2000/svg", "path");
    triangle.setAttribute("d", "M10 8.5 16 12l-6 3.5z");
    runIcon.append(circle, triangle);
    run.append(runIcon);
    const body = doc.createElement("div");
    body.className = "semlo-editor-code-body";
    const numbers = doc.createElement("div");
    numbers.className = "semlo-editor-code-numbers";
    numbers.contentEditable = "false";
    numbers.setAttribute("aria-hidden", "true");
    const pre = doc.createElement("pre");
    const code = doc.createElement("code");
    pre.append(code);
    body.append(numbers, pre);
    dom.append(header, revealHeader, body);
    let current = initial;
    let transientCollapsed: boolean | null = null;
    let transientHeaderHidden: boolean | null = null;
    let copyTimer: number | undefined;
    let dismissFeedback = () => {};
    let destroyed = false;
    const lineNumbers = createCodeLineNumbers({
      code,
      numbers,
      content: () => current.textContent,
      wrapping: () => readCodeSettings(current.attrs).wordWrap,
      visible: () =>
        readCodeSettings(current.attrs).showLineNumbers &&
        !(typeof getPos() === "number" && readCodeFolds(view, getPos() as number, current).length),
    });
    const foldGutter = createCodeFoldGutter({
      code,
      numbers,
      body,
      view,
      getPos: () => getPos(),
      node: () => current,
    });
    const updateAttrs = (attrs: Record<string, unknown>, separateHistory = false, addToHistory = true) => {
      if (!editor.isEditable || typeof getPos !== "function") return;
      const position = getPos();
      if (typeof position !== "number") return;
      const found = view.state.doc.nodeAt(position);
      if (!found || found.type !== current.type) return;
      if (Object.entries(attrs).every(([key, value]) => found.attrs[key] === value)) return;
      const tr = view.state.tr.setNodeMarkup(position, undefined, { ...found.attrs, ...attrs });
      if (!addToHistory) tr.setMeta("addToHistory", false);
      view.dispatch(separateHistory ? closeHistory(tr) : tr);
      if (separateHistory && !view.isDestroyed)
        view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
    };
    const rememberCurrent = () => {
      const position = getPos();
      const found = typeof position === "number" ? view.state.doc.nodeAt(position) : null;
      if (found?.type === current.type) rememberCodePreferences(editor, found.attrs);
    };
    const syncStyles = (includeLanguage: boolean) => {
      const position = getPos();
      if (!editor.isEditable || typeof position !== "number") return;
      const source = view.state.doc.nodeAt(position);
      if (!source || source.type !== current.type) return;
      const style = {
        ...readCodeSettings(source.attrs),
        theme: typeof source.attrs.theme === "string" ? source.attrs.theme : "light",
        ...(includeLanguage ? { language: source.attrs.language ?? null } : {}),
      };
      let tr = closeHistory(view.state.tr);
      view.state.doc.descendants((node, pos) => {
        if (pos === position || node.type !== current.type) return;
        if (Object.entries(style).some(([key, value]) => node.attrs[key] !== value))
          tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...style });
      });
      rememberCodePreferences(editor, source.attrs);
      if (!tr.docChanged) return;
      view.dispatch(tr);
      if (!view.isDestroyed) view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
    };
    const hideHeaders = () => {
      const position = getPos();
      if (!editor.isEditable || typeof position !== "number") return false;
      const source = view.state.doc.nodeAt(position);
      if (!source || source.type !== current.type) return false;
      let tr = closeHistory(view.state.tr);
      view.state.doc.descendants((node, pos) => {
        if (node.type !== current.type || node.attrs.collapsed || node.attrs.headerHidden === true) return;
        tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, headerHidden: true });
      });
      if (tr.docChanged) {
        // This is a presentation action, and should not displace the user's
        // previous text edit in the undo stack.
        view.dispatch(tr.setMeta("addToHistory", false));
        if (!view.isDestroyed) view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
      }
      returnToCode(settings.element);
      dismissFeedback();
      dismissFeedback = showCodeFeedback(doc, "成功");
      return !source.attrs.collapsed;
    };
    const returnToCode = (control: HTMLButtonElement) => {
      const position = getPos();
      if (typeof position !== "number" || !editor.isEditable) return;
      if (dom.classList.contains("is-collapsed")) {
        control.focus();
        return;
      }
      // Keep an existing cursor or range inside this block; if the menu was
      // opened before the code was focused, place it at the block's end.
      const { from, to } = view.state.selection;
      if (from <= position || to >= position + current.nodeSize) {
        editor.commands.setTextSelection(position + 1 + current.content.size);
      }
      view.focus();
    };
    const language = createCodeBlockControl({
      doc,
      label: "代码语言",
      className: "semlo-editor-code-language",
      options: languageOptions,
      searchable: true,
      unknownNote: "纯文本",
      onChoose: (value) => {
        const next = value === "plaintext" ? null : value;
        updateAttrs({ language: next });
        rememberCurrent();
        returnToCode(language.element);
        const position = getPos();
        if (next && (hasCodeIndentLanguage(next) || next === "graphql") && typeof position === "number") {
          const name = normalizeCodeLanguage(next);
          const width = ["python", "csharp", "c", "cpp", "java", "go", "rust"].includes(name)
            ? 4
            : ["javascript", "typescript", "jsx", "tsx", "json", "css", "html", "xml", "ruby", "php", "sql"].includes(
                  name,
                )
              ? 2
              : undefined;
          void autoIndentCodeBlock(view, position, {
            indentWidth: width,
          });
        }
      },
    });
    const theme = createCodeBlockControl({
      doc,
      label: "代码主题",
      className: "semlo-editor-code-theme",
      options: themeOptions,
      onChoose: (value) => {
        updateAttrs({ theme: value });
        rememberCurrent();
        returnToCode(theme.element);
      },
    });
    const settings = createCodeSettingsMenu({
      doc,
      getSettings: () => readCodeSettings(current.attrs),
      getTheme: () => (typeof current.attrs.theme === "string" ? current.attrs.theme : "light"),
      canRun: () => canRunCode(editor, current.attrs.language),
      onOpen: () => returnToCode(settings.element),
      onChange: (changes) => {
        updateAttrs(changes, true);
        rememberCurrent();
        if ("indentMode" in changes || "indentWidth" in changes) {
          const position = getPos();
          if (typeof position === "number") void autoIndentCodeBlock(view, position);
        }
      },
      onSync: syncStyles,
      onRun: () => {
        void runCode(editor, current.attrs.language, current.textContent);
      },
      onAutoIndent: () => {
        const position = getPos();
        if (typeof position !== "number") return;
        returnToCode(settings.element);
        dismissFeedback();
        const task = autoIndentCodeBlock(view, position);
        const dismissProgress = isAutoIndentPending(view) ? showCodeProgress(doc, "正在自动缩进…") : () => {};
        dismissFeedback = dismissProgress;
        void task.then((result) => {
          dismissProgress();
          if (dismissFeedback === dismissProgress) dismissFeedback = () => {};
          if (result === "cancelled" || destroyed || !isCurrentAutoIndent(view, task)) return;
          dismissFeedback();
          dismissFeedback = showCodeFeedback(
            doc,
            result === "success" ? "自动缩进成功" : "自动缩进未完成",
            result === "success" ? "success" : "error",
          );
        });
      },
      onHideHeaders: hideHeaders,
    });
    header.append(collapse, title, language.element, theme.element, copy, run, settings.element);
    const paint = () => {
      const codeSettings = readCodeSettings(current.attrs);
      const collapsed = transientCollapsed ?? !!current.attrs.collapsed;
      const headerHidden = !collapsed && (transientHeaderHidden ?? current.attrs.headerHidden === true);
      dom.dataset.theme = current.attrs.theme;
      dom.dataset.codeWrap = String(codeSettings.wordWrap);
      dom.dataset.codeHeaderHidden = String(headerHidden);
      header.hidden = headerHidden;
      revealHeader.hidden = !headerHidden;
      dom.style.fontSize = codeSettings.codeFontSize === null ? "inherit" : `${codeSettings.codeFontSize}px`;
      pre.style.tabSize = String(codeSettings.indentWidth);
      numbers.hidden = !codeSettings.showLineNumbers;
      dom.classList.toggle("is-collapsed", collapsed);
      collapse.textContent = collapsed ? "▸" : "▾";
      collapse.setAttribute("aria-label", collapsed ? "展开代码块" : "收起代码块");
      if (doc.activeElement !== title) title.value = current.attrs.title ?? "";
      const rawLanguage = typeof current.attrs.language === "string" ? current.attrs.language : "plaintext";
      const normalizedLanguage = normalizeCodeLanguage(rawLanguage);
      language.setValue(
        languageOptions.some((option) => option.value === normalizedLanguage) ? normalizedLanguage : rawLanguage,
      );
      theme.setValue(current.attrs.theme ?? "light");
      run.hidden = !canRunCode(editor, current.attrs.language);
      title.disabled = !editor.isEditable;
      language.setDisabled(!editor.isEditable);
      theme.setDisabled(!editor.isEditable);
      settings.setDisabled(!editor.isEditable);
      settings.refresh();
      lineNumbers.schedule();
      foldGutter.schedule();
    };
    const paintSelection = () => {
      const position = getPos();
      const selection = view.state.selection;
      dom.classList.toggle(
        "is-active",
        typeof position === "number" &&
          view.hasFocus() &&
          selection.from > position &&
          selection.to < position + current.nodeSize,
      );
    };
    collapse.addEventListener("click", () => {
      if (editor.isEditable) {
        transientCollapsed = null;
        updateAttrs({ collapsed: !current.attrs.collapsed });
      } else {
        transientCollapsed = !(transientCollapsed ?? !!current.attrs.collapsed);
        paint();
      }
    });
    // Keep the code focused until click: otherwise the focus-only handle can
    // disappear between pointerdown and click as the editor blurs.
    revealHeader.addEventListener("mousedown", (event) => event.preventDefault());
    revealHeader.addEventListener("click", () => {
      if (editor.isEditable) {
        transientHeaderHidden = null;
        updateAttrs({ headerHidden: false }, true, false);
        returnToCode(revealHeader);
      } else {
        transientHeaderHidden = false;
        paint();
        view.focus();
      }
    });
    title.addEventListener("input", () => updateAttrs({ title: title.value }));
    title.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        title.blur();
      }
    });
    run.addEventListener("click", () => {
      void runCode(editor, current.attrs.language, current.textContent);
    });
    copy.addEventListener("click", async () => {
      try {
        const clipboard = doc.defaultView?.navigator.clipboard;
        if (!clipboard) throw new Error("Clipboard unavailable");
        await clipboard.writeText(current.textContent);
        if (!destroyed) paintCopy("已复制");
      } catch {
        if (!destroyed) paintCopy("复制失败");
      }
      if (!destroyed && doc.defaultView) {
        if (copyTimer !== undefined) doc.defaultView.clearTimeout(copyTimer);
        copyTimer = doc.defaultView.setTimeout(() => {
          paintCopy();
        }, 2000);
      }
    });
    const editableChanged = () => {
      transientCollapsed = null;
      transientHeaderHidden = null;
      paint();
    };
    const runnerChanged = () => {
      settings.close();
      paint();
    };
    const foldsChanged = () => {
      lineNumbers.schedule();
      foldGutter.schedule();
    };
    view.dom.addEventListener("semlo-editor:code-folds", foldsChanged);
    view.dom.addEventListener("semlo-editor:editable", editableChanged);
    view.dom.addEventListener("semlo-editor:code-runner", runnerChanged);
    editor.on("selectionUpdate", paintSelection);
    editor.on("focus", paintSelection);
    editor.on("blur", paintSelection);
    paint();
    paintSelection();
    return {
      dom,
      contentDOM: code,
      update(updated) {
        if (updated.type !== current.type) return false;
        if (updated.attrs.headerHidden !== current.attrs.headerHidden) transientHeaderHidden = null;
        current = updated;
        paint();
        return true;
      },
      stopEvent(event) {
        return (
          header.contains(event.target as Node) ||
          revealHeader.contains(event.target as Node) ||
          foldGutter.element.contains(event.target as Node)
        );
      },
      ignoreMutation(mutation) {
        return (
          (mutation.type === "attributes" && mutation.target === dom) ||
          header.contains(mutation.target) ||
          revealHeader.contains(mutation.target) ||
          numbers.contains(mutation.target) ||
          foldGutter.element.contains(mutation.target)
        );
      },
      destroy() {
        destroyed = true;
        language.destroy();
        theme.destroy();
        settings.destroy();
        lineNumbers.destroy();
        foldGutter.destroy();
        dismissFeedback();
        if (copyTimer !== undefined) doc.defaultView?.clearTimeout(copyTimer);
        view.dom.removeEventListener("semlo-editor:code-folds", foldsChanged);
        view.dom.removeEventListener("semlo-editor:editable", editableChanged);
        view.dom.removeEventListener("semlo-editor:code-runner", runnerChanged);
        editor.off("selectionUpdate", paintSelection);
        editor.off("focus", paintSelection);
        editor.off("blur", paintSelection);
      },
    };
  };
}
