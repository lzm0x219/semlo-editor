import { Extension } from "@tiptap/core";
import { DOMParser, DOMSerializer, type ResolvedPos, type Slice } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import type { EditorProps, EditorView } from "@tiptap/pm/view";

/** 默认纯文本解析会合并连续换行；仅在需要保留空段落时补充解析。 */
export const PlainTextPaste = Extension.create({
  name: "semloEditorPlainTextPaste",
  priority: 10,
  addProseMirrorPlugins() {
    let plugin: Plugin;
    const parse = (text: string, context: ResolvedPos, _plain: boolean, view: EditorView): Slice | undefined => {
      if (!/(?:\r\n?|\n){2}/.test(text)) return undefined;
      // 前面的解析器已自行决定是否处理；先按原顺序调用后面的解析器，避免抢占或重复调用。
      const index = view.state.plugins.indexOf(plugin);
      if (index < 0) return undefined;
      for (const other of view.state.plugins.slice(index + 1)) {
        const parser = other.props.clipboardTextParser;
        const parsed = parser?.call(other, text, context, _plain, view);
        if (parsed) return parsed;
      }
      const { schema } = view.state;
      const marks = context.marks();
      const document = view.dom.ownerDocument;
      const wrapper = document.createElement("div");
      const serializer = DOMSerializer.fromSchema(schema);
      for (const line of text.split(/\r\n?|\n/)) {
        const paragraph = wrapper.appendChild(document.createElement("p"));
        if (line) paragraph.appendChild(serializer.serializeNode(schema.text(line, marks), { document }));
      }
      const parser = view.someProp("clipboardParser") ?? view.someProp("domParser") ?? DOMParser.fromSchema(schema);
      return parser.parseSlice(wrapper, { preserveWhitespace: true, context });
    };
    // ProseMirror 的运行时允许 parser 返回 undefined 交回默认流程，其类型声明只写了 Slice。
    plugin = new Plugin({ props: { clipboardTextParser: parse as NonNullable<EditorProps["clipboardTextParser"]> } });
    return [plugin];
  },
});
