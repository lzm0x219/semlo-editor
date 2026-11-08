import { Extension, type Editor } from "@tiptap/core";

import { captureHeadingFoldRevision, createEditor } from "../../../packages/core/src/index";
import type {
  EditorContent,
  EditorController,
  HeadingFoldPreferences,
  HeadingFoldPreferencesAdapter,
  HeadingFoldRevisionCapture,
} from "../../../packages/core/src/index";

import "../../../demo/editor.css";

type Fixture = {
  mount(
    id: string | null,
    editable?: boolean,
    changed?: boolean,
    content?: EditorContent,
    revision?: string,
    fault?: "load" | "save" | "reenter",
  ): void;
  controller: EditorController | null;
  changes: number;
  records: Map<string, HeadingFoldPreferences>;
  saves: number;
  adapter: HeadingFoldPreferencesAdapter | null;
  persistToBrowser: boolean;
  captures: HeadingFoldRevisionCapture[];
  onSave?: () => void;
  capture(): number;
};
declare global {
  interface Window {
    foldPreferences?: Fixture;
  }
}
const records = new Map<string, HeadingFoldPreferences>();
const fixture: Fixture = {
  controller: null,
  changes: 0,
  records,
  saves: 0,
  adapter: null,
  persistToBrowser: false,
  captures: [],
  capture() {
    const capture = fixture.controller && captureHeadingFoldRevision(fixture.controller);
    return capture ? fixture.captures.push(capture) - 1 : -1;
  },
  mount(id, editable = true, changed = false, contentOverride, revision = "r1", fault) {
    fixture.controller?.destroy();
    document.body.replaceChildren();
    const host = document.createElement("div");
    host.id = "fold-preferences-host";
    document.body.append(host);
    const content = contentOverride ?? `<h1>标题</h1><p>正文</p><h1>后续</h1><p>${changed ? "不同" : "内容"}</p>`;
    let initializing: Editor | undefined;
    fixture.adapter = id
      ? {
          documentId: id,
          revision,
          load: (key, version) => {
            if (fault === "load") throw new Error("storage unavailable");
            if (fault === "reenter") {
              if (!initializing) throw new Error("editor not exposed");
              initializing.commands.setContent("<h1>标题</h1><p>替换后的正文</p>");
            }
            if (fixture.persistToBrowser) {
              const value = localStorage.getItem(`fold:${JSON.stringify([key, version])}`);
              return value ? JSON.parse(value) : null;
            }
            return records.get(`${key}:${version}`);
          },
          save: (key, version, value) => {
            if (fault === "save") throw new Error("storage full");
            fixture.onSave?.();
            fixture.saves++;
            records.set(`${key}:${version}`, structuredClone(value));
            if (fixture.persistToBrowser)
              localStorage.setItem(`fold:${JSON.stringify([key, version])}`, JSON.stringify(value));
          },
        }
      : null;
    fixture.controller = createEditor({
      element: host,
      content,
      editable,
      extensions:
        fault === "reenter"
          ? [
              Extension.create({
                name: "testCaptureInitializingEditor",
                onBeforeCreate() {
                  initializing = this.editor;
                },
              }),
            ]
          : [],
      headingFoldPreferences: fixture.adapter ?? undefined,
      onChange(snapshot) {
        fixture.changes++;
        fixture.controller?.setContent(snapshot.json);
      },
    });
  },
};
window.foldPreferences = fixture;
