import { createEditor, type EditorContent, type EditorController } from "@semlo-editor/core";

const source = "https://video.semlo.invalid/sample.mp4";
const content = (): EditorContent => ({
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "视频之前" }] },
    {
      type: "semloEditorVideo",
      attrs: { src: source, name: "semlo-media-test.mp4", size: 10140, mimeType: "video/mp4" },
    },
    { type: "paragraph", content: [{ type: "text", text: "视频之后" }] },
  ],
});

declare global {
  interface Window {
    videoPlayerFixture: {
      api: EditorController;
      second?: EditorController;
      changes: number;
      echo: "json" | "html" | null;
      retained?: HTMLVideoElement;
      settlePlay?: () => void;
      mount(options?: { content?: EditorContent; editable?: boolean; echo?: "json" | "html" | null }): void;
      mountSecond(): void;
      setAttrs(attrs: Record<string, unknown>): void;
    };
  }
}

window.videoPlayerFixture = {
  api: undefined as unknown as EditorController,
  changes: 0,
  echo: null,
  mount(options = {}) {
    this.api?.destroy();
    this.changes = 0;
    this.echo = options.echo ?? null;
    this.api = createEditor({
      element: document.querySelector<HTMLElement>("#video-editor")!,
      toolbar: false,
      outline: false,
      editable: options.editable ?? true,
      content: options.content ?? content(),
      onChange: (snapshot) => {
        this.changes += 1;
        if (this.echo) this.api.setContent(snapshot[this.echo]);
      },
    });
  },
  mountSecond() {
    this.second?.destroy();
    this.second = createEditor({
      element: document.querySelector<HTMLElement>("#video-second")!,
      toolbar: false,
      outline: false,
      content: content(),
    });
  },
  setAttrs(attrs) {
    const { editor } = this.api;
    let position: number | undefined;
    editor.state.doc.descendants((node, pos) => {
      if (position === undefined && node.type.name === "semloEditorVideo") position = pos;
    });
    if (position === undefined) throw new Error("未找到视频节点");
    const node = editor.state.doc.nodeAt(position)!;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(position, undefined, { ...node.attrs, ...attrs }));
  },
};
