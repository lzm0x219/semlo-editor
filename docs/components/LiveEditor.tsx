import { closeHistory, history } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

import type { DemoExample } from "../../demo/examples";
import type { EditorController, EditorSnapshot, MentionItem } from "../../packages/core/src/types";

const sample = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "写下第一个想法" }] },
    {
      type: "paragraph",
      content: [{ type: "text", text: "这里是一张空白的纸。你可以直接输入，试试选中文字，或者在新的一行输入 /。" }],
    },
    { type: "paragraph" },
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "从一小段文字开始" }] },
    {
      type: "bulletList",
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "记录一个灵感" }] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "整理接下来的计划" }] }] },
      ],
    },
    { type: "paragraph" },
  ],
};

const people: MentionItem[] = [
  { id: "example-person", label: "小语（示例）", kind: "person" },
  { id: "example-document", label: "入门文档（示例）", kind: "document" },
];
const exampleIds = ["lists", "database", "blocks", "formula", "media", "tools"];
const historyKey = history().spec.key;

interface ExampleDraft {
  json: EditorSnapshot["json"];
  doc: ProseMirrorNode;
  history: unknown;
}

function restoreHistory(controller: EditorController, saved: unknown) {
  const view = controller.editor.view;
  const plugins = view.state.plugins;
  const historyPlugin = historyKey?.get(view.state);
  if (!historyPlugin || !historyKey) return;

  // History state is opaque and immutable. Seed it through the public plugin
  // state initializer, then restore the original plugin without replacing the view.
  let state = view.state.reconfigure({ plugins: plugins.filter((plugin) => plugin !== historyPlugin) });
  if (saved !== undefined) {
    const seed = new Plugin<unknown>({
      key: historyKey,
      state: { init: () => saved, apply: (_transaction, previous) => previous },
    });
    state = state.reconfigure({ plugins: plugins.map((plugin) => (plugin === historyPlugin ? seed : plugin)) });
  }
  view.updateState(state.reconfigure({ plugins }));
  view.dispatch(view.state.tr.setMeta("addToHistory", false));
}

function keepExampleMenuInView(anchor: HTMLButtonElement) {
  const doc = anchor.ownerDocument;
  const view = doc.defaultView;
  const popup = anchor
    .getAttribute("aria-controls")
    ?.split(/\s+/)
    .map((id) => doc.getElementById(id))
    .find((element): element is HTMLElement => Boolean(element?.matches('.semlo-editor-dropdown[role="menu"]')));
  if (!view || !popup) return () => {};

  popup.classList.add("semlo-editor-home-example-menu");
  const scrollCue = doc.createElement("div");
  scrollCue.className = "semlo-editor-example-scroll-cue";
  scrollCue.setAttribute("aria-hidden", "true");
  scrollCue.textContent = "向下查看更多";
  popup.append(scrollCue);
  const updateScrollCue = () => {
    const lastItem = Array.from(popup.querySelectorAll<HTMLElement>('[role="menuitem"]')).at(-1);
    const viewportBottom = popup.getBoundingClientRect().top + popup.clientTop + popup.clientHeight;
    scrollCue.classList.toggle(
      "is-visible",
      Boolean(lastItem && lastItem.getBoundingClientRect().bottom > viewportBottom + 1),
    );
  };
  const position = () => {
    if (!popup.isConnected) return;
    const viewport = view.visualViewport;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportBottom = viewportTop + (viewport?.height ?? view.innerHeight) - 8;
    const nav = doc.querySelector<HTMLElement>(".semlo-editor-nav")?.getBoundingClientRect();
    const navBottom = nav && nav.top <= viewportTop + 1 && nav.bottom > viewportTop ? nav.bottom : viewportTop;
    const safeTop = Math.min(viewportBottom, Math.max(viewportTop, navBottom) + 8);
    const bounds = anchor.getBoundingClientRect();
    const belowStart = Math.max(safeTop, bounds.bottom + 4);
    const aboveEnd = Math.min(viewportBottom, bounds.top - 4);
    const above = Math.max(0, aboveEnd - safeTop);
    const below = Math.max(0, viewportBottom - belowStart);
    const naturalHeight = popup.scrollHeight + popup.offsetHeight - popup.clientHeight;
    const useAbove = naturalHeight > below && above > below;
    // CSSOM rounds fractional pixel values; stable integers avoid a positioning loop.
    const available = Math.floor(useAbove ? above : below);
    const height = Math.min(naturalHeight, available);
    const top = Math.ceil(useAbove ? aboveEnd - height : belowStart);
    const maxHeight = `${available}px`;
    const topPosition = `${top}px`;
    if (popup.style.maxHeight !== maxHeight) popup.style.maxHeight = maxHeight;
    if (popup.style.overflowY !== "auto") popup.style.overflowY = "auto";
    if (popup.style.top !== topPosition) popup.style.top = topPosition;
    updateScrollCue();
  };
  const observer = new MutationObserver(() => {
    if (!popup.isConnected) {
      observer.disconnect();
      popup.removeEventListener("scroll", updateScrollCue);
      return;
    }
    position();
  });
  observer.observe(popup, { attributes: true, attributeFilter: ["style"] });
  observer.observe(doc.body, { childList: true });
  popup.addEventListener("scroll", updateScrollCue, { passive: true });
  position();
  return () => {
    observer.disconnect();
    popup.removeEventListener("scroll", updateScrollCue);
  };
}

export type HomeExample = "lists" | "blocks" | "formula";

export interface LiveEditorHandle {
  openExample(id: HomeExample): void;
}

const LiveEditor = forwardRef<LiveEditorHandle>(function LiveEditor(_, ref) {
  const host = useRef<HTMLDivElement>(null);
  const exampleTrigger = useRef<HTMLButtonElement>(null);
  const restoreTrigger = useRef<HTMLButtonElement>(null);
  const cancelRestore = useRef<HTMLButtonElement>(null);
  const controller = useRef<EditorController | null>(null);
  const closeMenu = useRef<(() => void) | null>(null);
  const openMenu = useRef<typeof import("../../packages/core/src/platform/dom/dropdown").openDropdown | null>(null);
  const examples = useRef<readonly DemoExample[]>([]);
  const selectedId = useRef("start");
  const drafts = useRef(new Map<string, ExampleDraft>());
  const originals = useRef(new Map<string, string>());
  const pendingExample = useRef<HomeExample | null>(null);
  const [selected, setSelected] = useState("start");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [feedback, setFeedback] = useState("");
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [overflow, setOverflow] = useState({ below: false, sideways: false });

  useImperativeHandle(ref, () => ({
    openExample(id) {
      document.getElementById("semlo-editor-demo")?.scrollIntoView({ behavior: "instant", block: "start" });
      if (!controller.current) {
        pendingExample.current = id;
        return;
      }
      showExample(id, false, true);
    },
  }));

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(""), 2200);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  useEffect(() => {
    if (confirmRestore) cancelRestore.current?.focus({ preventScroll: true });
  }, [confirmRestore]);

  useEffect(() => {
    const element = host.current;
    if (state !== "ready" || !element) return;
    const editorHost: HTMLDivElement = element;

    let frame = 0;
    const observed = new Set<Element>();
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);

    function update() {
      frame = 0;
      const bounds = editorHost.getBoundingClientRect();
      const candidates = Array.from(
        editorHost.querySelectorAll<HTMLElement>(
          ".semlo-editor-prose .semlo-editor-database-body, .semlo-editor-prose .tableWrapper, .semlo-editor-prose .semlo-editor-code-body, .semlo-editor-prose pre, .semlo-editor-prose .semlo-editor-gallery-thumbnails",
        ),
      );
      const targets = new Set<Element>([editorHost, ...candidates]);
      const prose = editorHost.querySelector(".semlo-editor-prose");
      if (prose) targets.add(prose);
      candidates.forEach((candidate) => {
        if (candidate.firstElementChild) targets.add(candidate.firstElementChild);
      });
      observed.forEach((target) => {
        if (!targets.has(target)) {
          resizeObserver?.unobserve(target);
          observed.delete(target);
        }
      });
      targets.forEach((target) => {
        if (!observed.has(target)) {
          resizeObserver?.observe(target);
          observed.add(target);
        }
      });

      const below = Boolean(
        prose &&
        Array.from(prose.children).some((child) => {
          const rect = child.getBoundingClientRect();
          return rect.height > 0 && rect.bottom > bounds.bottom + 2;
        }),
      );
      const navBounds = document.querySelector(".semlo-editor-nav")?.getBoundingClientRect();
      const visibleTop = Math.max(bounds.top, navBounds && navBounds.top <= 0 ? navBounds.bottom : 0);
      const visibleBottom = Math.min(bounds.bottom, window.innerHeight);
      const sideways = candidates.some((candidate) => {
        const rect = candidate.getBoundingClientRect();
        const visibleHeight = Math.min(rect.bottom, visibleBottom) - Math.max(rect.top, visibleTop);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          visibleHeight >= Math.min(40, rect.height) &&
          candidate.scrollWidth - candidate.clientWidth - candidate.scrollLeft > 2
        );
      });
      setOverflow((previous) =>
        previous.below === below && previous.sideways === sideways ? previous : { below, sideways },
      );
    }

    function schedule() {
      if (!frame) frame = window.requestAnimationFrame(update);
    }

    const mutationObserver = new MutationObserver((mutations) => {
      schedule();
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement) || !node.matches(".semlo-editor-diagram-menu")) continue;
          if (node.closest(".semlo-editor-diagram-fullscreen-active")) continue;
          const hostBounds = editorHost.getBoundingClientRect();
          const toolbar = editorHost.querySelector<HTMLElement>(".semlo-editor-toolbar")?.getBoundingClientRect();
          const visibleTop = Math.max(hostBounds.top, toolbar?.bottom ?? 0);
          const visibleBottom = Math.min(hostBounds.bottom, window.innerHeight);
          const trigger = node.parentElement?.querySelector<HTMLElement>('button[aria-expanded="true"]');
          const available = visibleBottom - visibleTop - (trigger?.getBoundingClientRect().height ?? 0) - 18;
          node.style.maxHeight = `${Math.max(44, Math.min(360, available))}px`;
          const menuBottom = node.getBoundingClientRect().bottom;
          if (menuBottom > visibleBottom - 6) editorHost.scrollTop += menuBottom - visibleBottom + 6;
        }
      }
    });
    mutationObserver.observe(editorHost, { childList: true, characterData: true, subtree: true });
    editorHost.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, { passive: true });
    schedule();
    return () => {
      window.cancelAnimationFrame(frame);
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
      editorHost.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule);
    };
  }, [state]);

  useEffect(() => {
    if (state !== "ready") return;
    const button = host.current?.querySelector<HTMLButtonElement>(".semlo-editor-toolbar-overflow-more");
    const panel = button && document.getElementById(button.getAttribute("aria-controls") ?? "");
    if (!button || !panel) return;

    const position = () => {
      if (panel.hidden) return;
      const anchor = button.getBoundingClientRect();
      const nav = document.querySelector<HTMLElement>(".semlo-editor-nav")?.getBoundingClientRect();
      const safeTop = Math.max(window.visualViewport?.offsetTop ?? 0, nav?.bottom ?? 0) + 8;
      const above = anchor.top - panel.offsetHeight - 4;
      const originalTop = Number.parseFloat(panel.style.top);
      const shift =
        window.innerWidth <= 720 && above >= safeTop && Number.isFinite(originalTop) ? above - originalTop : 0;
      const value = `${Math.round(shift)}px`;
      if (panel.style.getPropertyValue("--semlo-panel-shift") !== value) {
        panel.style.setProperty("--semlo-panel-shift", value);
        panel.dispatchEvent(new Event("scroll"));
      }
    };
    const observer = new MutationObserver(position);
    observer.observe(panel, { attributes: true, attributeFilter: ["hidden", "style"] });
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    window.visualViewport?.addEventListener("resize", position);
    position();
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("resize", position);
      panel.style.removeProperty("--semlo-panel-shift");
    };
  }, [state]);

  useEffect(() => {
    let cancelled = false;
    let instance: EditorController | undefined;
    const urls: string[] = [];
    const leaveEditor = (event: KeyboardEvent) => {
      if (event.key === "Tab" && exampleTrigger.current?.getAttribute("aria-expanded") === "true") {
        const trigger = exampleTrigger.current;
        const popup = document.getElementById(trigger.getAttribute("aria-controls") ?? "");
        const focusInPopup = popup?.contains(document.activeElement);
        closeMenu.current?.();
        if (focusInPopup) trigger.focus();
      }
      if (
        event.key !== "Enter" ||
        !event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.shiftKey ||
        event.isComposing ||
        !(event.target instanceof HTMLElement) ||
        !host.current?.contains(event.target) ||
        !event.target.matches('[contenteditable="true"].semlo-editor-prose')
      )
        return;
      const openMenu = document.querySelector<HTMLElement>('.semlo-editor-slash-menu[role="listbox"]');
      if (openMenu && openMenu.getClientRects().length) {
        event.preventDefault();
        event.stopPropagation();
        setAnnouncement("请先按 Esc 关闭插入菜单，再按 Ctrl 加回车离开编辑器。");
        return;
      }
      const next = host.current
        ?.closest(".semlo-editor-editor-frame")
        ?.querySelector<HTMLElement>(".semlo-editor-editor-guide summary");
      if (!next) return;
      event.preventDefault();
      event.stopPropagation();
      next.focus();
    };
    document.addEventListener("keydown", leaveEditor, true);
    void Promise.all([
      import("../../packages/core/src/editor/create-editor"),
      import("../../demo/examples"),
      import("../../demo/editor.css"),
      import("../../packages/core/src/platform/dom/dropdown"),
    ])
      .then(([{ createEditor }, { demoExamples }, , dropdown]) => {
        if (cancelled || !host.current) return;
        examples.current = demoExamples.filter((item) => exampleIds.includes(item.id));
        openMenu.current = dropdown.openDropdown;
        const upload = async (file: File) => {
          const url = URL.createObjectURL(file);
          urls.push(url);
          return url;
        };
        instance = createEditor({
          element: host.current,
          content: structuredClone(sample),
          outline: false,
          uploadImage: upload,
          uploadAttachment: upload,
          searchMentions: (query) => people.filter((item) => item.label.toLowerCase().includes(query.toLowerCase())),
          onError: (reason) => setError(reason.message),
        });
        let firstBlank: number | undefined;
        instance.editor.state.doc.forEach((node, offset) => {
          if (firstBlank === undefined && node.type.name === "paragraph" && node.content.size === 0) {
            firstBlank = offset + 1;
          }
        });
        if (firstBlank !== undefined) instance.editor.commands.setTextSelection(firstBlank);
        controller.current = instance;
        originals.current.set("start", JSON.stringify(instance.getSnapshot().json));
        const editable = host.current.querySelector<HTMLElement>('[contenteditable="true"]');
        editable?.setAttribute("aria-label", "首页试用编辑器");
        editable?.setAttribute("aria-describedby", "semlo-editor-help");
        setState("ready");
        if (pendingExample.current) {
          const id = pendingExample.current;
          pendingExample.current = null;
          showExample(id, false, true);
        }
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
      document.removeEventListener("keydown", leaveEditor, true);
      closeMenu.current?.();
      closeMenu.current = null;
      openMenu.current = null;
      controller.current = null;
      instance?.destroy();
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  function showExample(id: string, restore = false, fromFeature = false) {
    const content = id === "start" ? sample : examples.current.find((item) => item.id === id)?.content;
    const editor = controller.current;
    if (!content || !editor) return;
    const currentId = selectedId.current;
    const current = editor.getSnapshot().json;
    if (restore) {
      const view = editor.editor.view;
      view.dispatch(closeHistory(view.state.tr));
      editor.setContent(structuredClone(content));
      view.dispatch(closeHistory(view.state.tr));
      drafts.current.delete(id);
      originals.current.set(id, JSON.stringify(editor.getSnapshot().json));
    } else if (id !== currentId) {
      const state = editor.editor.state;
      drafts.current.set(currentId, {
        json: structuredClone(current),
        doc: state.doc,
        history: historyKey?.getState(state),
      });
      const draft = drafts.current.get(id);
      editor.setContent(structuredClone(draft?.json ?? content));
      // A history belongs only to the exact document from which it was saved.
      restoreHistory(editor, draft?.doc.eq(editor.editor.state.doc) ? draft.history : undefined);
      if (!originals.current.has(id)) originals.current.set(id, JSON.stringify(editor.getSnapshot().json));
    }
    if (id !== currentId || restore) host.current?.scrollTo({ top: 0, left: 0 });
    selectedId.current = id;
    setConfirmRestore(false);
    setSelected(id);
    setError("");
    const title = id === "start" ? "开始写作" : examples.current.find((item) => item.id === id)?.title;
    setAnnouncement(restore ? `已恢复${title}示例。` : `已切换至${title}示例。`);
    setFeedback(restore ? "已恢复示例" : `已切换至${title}`);
    if (fromFeature) {
      window.requestAnimationFrame(() => {
        exampleTrigger.current?.focus({ preventScroll: true });
        const editorHost = host.current;
        const selector =
          id === "lists"
            ? ".semlo-editor-prose .tableWrapper"
            : id === "blocks"
              ? ".semlo-editor-prose .semlo-editor-columns"
              : null;
        const target = selector ? editorHost?.querySelector<HTMLElement>(selector) : null;
        if (editorHost && target) {
          const top =
            editorHost.scrollTop + target.getBoundingClientRect().top - editorHost.getBoundingClientRect().top;
          editorHost.scrollTo({ top: Math.max(0, top - 64), behavior: "instant" });
        }
      });
    }
  }

  function requestRestore() {
    const editor = controller.current;
    if (!editor) return;
    if (JSON.stringify(editor.getSnapshot().json) !== originals.current.get(selectedId.current)) {
      setConfirmRestore(true);
      return;
    }
    showExample(selectedId.current, true);
  }

  function closeRestore(restore: boolean) {
    if (restore) showExample(selectedId.current, true);
    else setConfirmRestore(false);
    restoreTrigger.current?.focus({ preventScroll: true });
  }

  function toggleExamples(anchor: HTMLButtonElement) {
    if (anchor.getAttribute("aria-expanded") === "true") {
      closeMenu.current?.();
      return;
    }
    const items = [{ id: "start", title: "开始写作" }, ...examples.current];
    const close = openMenu.current?.(
      anchor,
      items.map((item) => ({ label: item.title, value: item.id, selected: item.id === selected })),
      (id) => {
        showExample(id);
        anchor.focus();
      },
    );
    if (!close) return;
    const stopPositioning = keepExampleMenuInView(anchor);
    closeMenu.current = () => {
      stopPositioning();
      close();
    };
  }

  return (
    <div className="semlo-editor-editor-frame">
      <div className="semlo-editor-editor-header">
        <div className="semlo-editor-editor-title">
          <span aria-hidden="true">✳</span> 写点什么吧
        </div>
        <div className="semlo-editor-editor-actions">
          <button
            type="button"
            className="semlo-editor-example-trigger"
            ref={exampleTrigger}
            data-example-selected={selected !== "start" || undefined}
            aria-label={`选择演示内容，当前：${selected === "start" ? "开始写作" : examples.current.find((item) => item.id === selected)?.title}`}
            aria-haspopup="menu"
            aria-expanded="false"
            disabled={state !== "ready"}
            onClick={(event) => toggleExamples(event.currentTarget)}
          >
            <span>
              示例：{selected === "start" ? "开始写作" : examples.current.find((item) => item.id === selected)?.title}
            </span>
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="m3 4.5 3 3 3-3"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button type="button" ref={restoreTrigger} disabled={state !== "ready"} onClick={requestRestore}>
            恢复示例
          </button>
        </div>
      </div>
      {confirmRestore && (
        <div
          className="semlo-editor-restore-confirm"
          role="group"
          aria-label="确认恢复示例"
          onKeyDown={(event) => {
            if (event.key === "Escape") closeRestore(false);
          }}
        >
          <span id="semlo-editor-restore-warning">恢复原始示例后，仍可撤销此操作。</span>
          <div>
            <button
              type="button"
              ref={cancelRestore}
              aria-describedby="semlo-editor-restore-warning"
              onClick={() => closeRestore(false)}
            >
              取消
            </button>
            <button type="button" aria-describedby="semlo-editor-restore-warning" onClick={() => closeRestore(true)}>
              确认恢复
            </button>
          </div>
        </div>
      )}
      <div ref={host} className="semlo-editor-editor-host" />
      {state !== "ready" && (
        <div className="semlo-editor-editor-loading" role="status">
          {state === "error" ? "编辑器加载失败，请刷新页面重试。" : "正在准备编辑器…"}
        </div>
      )}
      {error && (
        <div className="semlo-editor-editor-error" role="status">
          {error}
        </div>
      )}
      <div className="semlo-editor-editor-announcement" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
      <div id="semlo-editor-help" className="semlo-editor-editor-announcement">
        输入斜杠插入内容。关闭菜单后按 Ctrl
        加回车离开编辑器。部分示例可向下或横向滚动。各示例分别保留撤销与重做历史，修改和上传仅在当前页面临时保留，刷新后将丢失。
      </div>
      <div className="semlo-editor-editor-caption">
        <span className={`semlo-editor-editor-caption-primary${feedback ? " is-feedback" : ""}`} aria-hidden="true">
          <span className="semlo-editor-live-dot" aria-hidden="true" />
          {feedback || (
            <>
              输入 <kbd>/</kbd> 插入内容
            </>
          )}
        </span>
        <span className="semlo-editor-editor-lifetime">刷新后清空</span>
        {(overflow.below || overflow.sideways) && (
          <span className="semlo-editor-editor-scroll-hint" aria-hidden="true">
            {overflow.below && "向下查看更多"}
            {overflow.below && overflow.sideways && " · "}
            {overflow.sideways && "内容可横向滚动"}
          </span>
        )}
        <details className="semlo-editor-editor-guide">
          <summary>使用说明</summary>
          <p>
            关闭菜单后按 <kbd>Ctrl + Enter</kbd>{" "}
            离开编辑器。各示例分别保留撤销与重做历史，修改和上传仅在当前页面临时保留，刷新后将丢失。
          </p>
        </details>
      </div>
    </div>
  );
});

export default LiveEditor;
