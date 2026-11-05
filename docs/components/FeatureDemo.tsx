import { useEffect, useId, useRef, useState } from "react";

import type { DemoExample } from "../../demo/examples";
import type { EditorController, EditorSnapshot, MentionItem } from "../../packages/core/src/types";

import "./feature-demo.css";

interface FeatureDemoProps {
  examples: string[];
  title?: string;
}

const people: MentionItem[] = [
  { id: "example-person", label: "小语（示例）", kind: "person" },
  { id: "example-document", label: "入门文档（示例）", kind: "document" },
];

export default function FeatureDemo({ examples, title = "动手试一试" }: FeatureDemoProps) {
  const host = useRef<HTMLDivElement>(null);
  const exampleTrigger = useRef<HTMLButtonElement>(null);
  const closeMenu = useRef<(() => void) | null>(null);
  const openMenu = useRef<typeof import("../../packages/core/src/platform/dom/dropdown").openDropdown | null>(null);
  const controller = useRef<EditorController | null>(null);
  const choices = useRef<readonly DemoExample[]>([]);
  const currentId = useRef(examples[0]);
  const urls = useRef<string[]>([]);
  const [items, setItems] = useState<readonly DemoExample[]>([]);
  const [selected, setSelected] = useState(examples[0]);
  const [editable, setEditable] = useState(true);
  const [status, setStatus] = useState("正在准备编辑器…");
  const [snapshot, setSnapshot] = useState<EditorSnapshot | null>(null);
  const snapshotId = useId();

  useEffect(() => {
    let cancelled = false;
    let instance: EditorController | undefined;
    const objectUrls = urls.current;
    const handleTab = (event: KeyboardEvent) => {
      const trigger = exampleTrigger.current;
      if (event.key !== "Tab" || trigger?.getAttribute("aria-expanded") !== "true") return;
      const popup = document.getElementById(trigger.getAttribute("aria-controls") ?? "");
      const focusInPopup = popup?.contains(document.activeElement);
      closeMenu.current?.();
      if (focusInPopup) trigger.focus();
    };
    document.addEventListener("keydown", handleTab, true);
    void Promise.all([
      import("../../packages/core/src/editor/create-editor"),
      import("../../demo/examples"),
      import("../../demo/editor.css"),
      import("../../packages/core/src/platform/dom/dropdown"),
    ])
      .then(([{ createEditor }, { demoExamples }, , dropdown]) => {
        if (cancelled || !host.current) return;
        const available = examples
          .map((id) => demoExamples.find((item) => item.id === id))
          .filter((item) => item != null);
        const first = available[0];
        if (!first) throw new Error("未找到示例");
        choices.current = available;
        openMenu.current = dropdown.openDropdown;
        currentId.current = first.id;
        const upload = async (file: File) => {
          const url = URL.createObjectURL(file);
          objectUrls.push(url);
          return url;
        };
        instance = createEditor({
          element: host.current,
          content: structuredClone(first.content),
          uploadImage: upload,
          uploadAttachment: upload,
          searchMentions: (query) => people.filter((item) => item.label.toLowerCase().includes(query.toLowerCase())),
          onError: (error) => setStatus(error.message),
        });
        controller.current = instance;
        setItems(available);
        setSelected(first.id);
        setStatus("");
      })
      .catch(() => {
        if (!cancelled) setStatus("编辑器加载失败，请刷新页面重试。");
      });
    return () => {
      cancelled = true;
      document.removeEventListener("keydown", handleTab, true);
      closeMenu.current?.();
      closeMenu.current = null;
      openMenu.current = null;
      controller.current = null;
      instance?.destroy();
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
      objectUrls.length = 0;
    };
    // The example IDs are fixed by the documentation page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function showExample(id: string) {
    const example = choices.current.find((item) => item.id === id);
    if (!example || !controller.current) return;
    // A fresh instance is not needed for previewing samples; the button explicitly resets content.
    controller.current.setContent(structuredClone(example.content));
    currentId.current = id;
    setSelected(id);
    setSnapshot(null);
    setStatus("");
  }

  function toggleExamples(anchor: HTMLButtonElement) {
    if (anchor.getAttribute("aria-expanded") === "true") {
      closeMenu.current?.();
      return;
    }
    closeMenu.current =
      openMenu.current?.(
        anchor,
        items.map((item) => ({ label: item.title, value: item.id, selected: item.id === selected })),
        (id) => {
          showExample(id);
          anchor.focus();
        },
      ) ?? null;
  }

  return (
    <section className="docs-feature-demo" aria-label={title}>
      <div className="docs-feature-demo__header">
        <div>
          <div className="docs-feature-demo__title">
            <strong>{title}</strong>
            <span className="docs-feature-demo__mode" role="status">
              {!editable ? "当前为只读模式" : ""}
            </span>
          </div>
          <p>内容仅在当前页面保留，切换或恢复示例会替换当前内容。</p>
        </div>
        <div className="docs-feature-demo__actions">
          {items.length > 1 && (
            <div className="docs-feature-demo__example">
              <span>示例</span>
              <button
                ref={exampleTrigger}
                type="button"
                className="docs-feature-demo__example-trigger"
                aria-label={`选择示例，当前：${items.find((item) => item.id === selected)?.title}`}
                aria-haspopup="menu"
                aria-expanded="false"
                onClick={(event) => toggleExamples(event.currentTarget)}
              >
                <span>{items.find((item) => item.id === selected)?.title}</span>
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
            </div>
          )}
          <button type="button" disabled={!items.length} onClick={() => showExample(currentId.current)}>
            恢复示例
          </button>
          <button
            type="button"
            disabled={!items.length}
            aria-pressed={!editable}
            onClick={() => {
              const next = !editable;
              controller.current?.setEditable(next);
              setEditable(next);
            }}
          >
            只读模式
          </button>
          <button
            type="button"
            disabled={!items.length}
            aria-expanded={snapshot !== null}
            aria-controls={snapshotId}
            onClick={() => setSnapshot(snapshot ? null : (controller.current?.getSnapshot() ?? null))}
          >
            {snapshot ? "收起快照" : "查看快照"}
          </button>
        </div>
      </div>
      <div className="docs-feature-demo__host" ref={host} />
      {status && (
        <p className="docs-feature-demo__status" role="status">
          {status}
        </p>
      )}
      <p className="docs-feature-demo__note">上传使用本地临时地址，提及使用示例数据；刷新后不会保留修改。</p>
      <div id={snapshotId} className="docs-feature-demo__snapshot" hidden={!snapshot}>
        {snapshot && (
          <>
            <div className="docs-feature-demo__snapshot-heading">
              <strong>文档快照（JSON）</strong>
              <button type="button" onClick={() => setSnapshot(controller.current?.getSnapshot() ?? null)}>
                更新快照
              </button>
            </div>
            <p>快照记录点击时的内容，修改后可手动更新。</p>
            <pre tabIndex={0}>
              <code>{JSON.stringify(snapshot.json, null, 2)}</code>
            </pre>
          </>
        )}
      </div>
    </section>
  );
}
