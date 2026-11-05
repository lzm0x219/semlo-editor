import { common, createLowlight } from "lowlight";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

const examples = {
  Vue: {
    filename: "DocumentEditor.vue",
    code: `<script setup lang="ts">
import { ref } from 'vue'
import { SemloEditor } from '@semlo-editor/vue'
import type { EditorContent, EditorSnapshot } from '@semlo-editor/core'
import '@semlo-editor/core/style.css'

const content = ref<EditorContent>({
  type: 'doc', content: [{ type: 'paragraph' }],
})
function onChange(snapshot: EditorSnapshot) {
  content.value = snapshot.json
}
</script>

<template>
  <SemloEditor :content="content" @change="onChange" />
</template>`,
  },
  React: {
    filename: "DocumentEditor.tsx",
    code: `import { useState } from 'react'
import { SemloEditor } from '@semlo-editor/react'
import type { EditorContent } from '@semlo-editor/core'
import '@semlo-editor/core/style.css'

export function DocumentEditor() {
  const [content, setContent] = useState<EditorContent>({
    type: 'doc', content: [{ type: 'paragraph' }],
  })
  return (
    <SemloEditor
      content={content}
      onChange={value => setContent(value.json)}
    />
  )
}`,
  },
  SolidJS: {
    filename: "DocumentEditor.tsx",
    code: `import { createSignal } from 'solid-js'
import { SemloEditor } from '@semlo-editor/solid'
import type { EditorContent } from '@semlo-editor/core'
import '@semlo-editor/core/style.css'

export function DocumentEditor() {
  const [content, setContent] = createSignal<EditorContent>({
    type: 'doc', content: [{ type: 'paragraph' }],
  })
  return (
    <SemloEditor
      content={content()}
      onChange={value => setContent(value.json)}
    />
  )
}`,
  },
  JavaScript: {
    filename: "editor.js",
    code: `import { createEditor } from '@semlo-editor/core'
import '@semlo-editor/core/style.css'

const host = document.querySelector('#editor')
if (!host) throw new Error('找不到编辑器挂载元素')

const editor = createEditor({
  element: host,
  content: { type: 'doc', content: [{ type: 'paragraph' }] },
  onChange: ({ json }) => console.log(json),
})

// 页面卸载或不再使用时调用 editor.destroy()`,
  },
} as const;

const lowlight = createLowlight(common);
type HighlightNode = ReturnType<typeof lowlight.highlight>["children"][number];

function renderHighlight(node: HighlightNode, key: string): ReactNode {
  if (node.type === "text") return node.value;
  if (node.type !== "element") return null;
  const classes = node.properties.className;
  return (
    <span key={key} className={Array.isArray(classes) ? classes.join(" ") : undefined}>
      {node.children.map((child, index) => renderHighlight(child, `${key}-${index}`))}
    </span>
  );
}

type Framework = keyof typeof examples;
const frameworks = Object.keys(examples) as Framework[];

export default function FrameworkPreview() {
  const [framework, setFramework] = useState<Framework>("Vue");
  const [copyStatus, setCopyStatus] = useState("");
  const [scrollable, setScrollable] = useState(false);
  const [wrap, setWrap] = useState(false);
  const codeRef = useRef<HTMLPreElement>(null);
  const example = examples[framework];
  const tokens = useMemo(
    () =>
      lowlight.highlight(
        framework === "Vue" ? "xml" : framework === "JavaScript" ? "javascript" : "typescript",
        example.code,
      ).children,
    [framework, example.code],
  );

  useEffect(() => {
    const code = codeRef.current;
    if (!code) return;
    code.scrollLeft = 0;
    const update = () => setScrollable(code.scrollWidth > code.clientWidth + 1);
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(code);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [framework, wrap]);

  useEffect(() => {
    if (!copyStatus) return;
    const timer = window.setTimeout(() => setCopyStatus(""), 2500);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);

  async function copyExample() {
    try {
      await navigator.clipboard.writeText(example.code);
      setCopyStatus("已复制");
    } catch {
      setCopyStatus("无法复制，请手动选择代码");
    }
  }

  return (
    <div className="semlo-editor-framework-preview">
      <div className="semlo-editor-framework-toolbar">
        <div className="semlo-editor-framework-options" role="group" aria-label="选择接入示例">
          {frameworks.map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={framework === name}
              onClick={() => {
                setFramework(name);
                setCopyStatus("");
              }}
            >
              {name}
            </button>
          ))}
        </div>
        <button className="semlo-editor-framework-copy" type="button" onClick={() => void copyExample()}>
          {copyStatus === "已复制" ? "已复制" : "复制代码"}
        </button>
      </div>
      <div className="semlo-editor-framework-meta">
        <span className="semlo-editor-framework-filename">{example.filename}</span>
        <div className="semlo-editor-framework-code-actions">
          {scrollable && (
            <span className="semlo-editor-framework-scroll-hint" id="semlo-editor-framework-scroll-hint">
              可横向滚动 <span aria-hidden="true">↔</span>
            </span>
          )}
          <button
            className="semlo-editor-framework-wrap"
            type="button"
            aria-pressed={wrap}
            onClick={() => setWrap(!wrap)}
          >
            自动换行
          </button>
        </div>
      </div>
      <pre
        key={framework}
        ref={codeRef}
        className={`semlo-editor-framework-code${wrap ? " is-wrapped" : ""}`}
        role="region"
        aria-label={`${framework} 代码示例`}
        aria-describedby={scrollable ? "semlo-editor-framework-scroll-hint" : undefined}
        tabIndex={scrollable ? 0 : undefined}
      >
        <code>{tokens.map((node, index) => renderHighlight(node, String(index)))}</code>
      </pre>
      <div className="semlo-editor-framework-status" role="status" aria-live="polite">
        {copyStatus}
      </div>
    </div>
  );
}
