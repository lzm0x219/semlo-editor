import { getTextBetween, getTextSerializersFromSchema, type Editor } from "@tiptap/core";
import { DOMSerializer, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import { semloEditorTableClipboardKey } from "../table/keys";

type HeadingNumber = { pos: number; marker: string };

/**
 * Let ProseMirror create both clipboard representations as usual. Only add
 * generated heading markers to HTML when the fragment still matches the
 * current selection and its serialized headings can be identified safely.
 */
export function headingNumberingClipboardPlugin(
  numbersForDocument: (doc: ProseMirrorNode) => HeadingNumber[],
  editor: Editor,
): Plugin {
  let view: EditorView | undefined;
  let clipboardEvent: Event | undefined;
  let clipboardHtmlConsumed = false;
  let clipboardTextConsumed = false;
  let plugin: Plugin;
  const recordClipboardEvent = (event: Event) => {
    clipboardEvent = event;
    clipboardHtmlConsumed = false;
    clipboardTextConsumed = false;
    // This runs within ProseMirror's event handler, which serializes the copy
    // synchronously. A capture listener can instead be followed by a native
    // microtask checkpoint before ProseMirror handles the event.
    queueMicrotask(() => {
      if (clipboardEvent === event) clipboardEvent = undefined;
    });
    return false;
  };
  const hasHostClipboardHandler = (currentView: EditorView, eventType: "copy" | "cut") =>
    currentView.someProp(
      "handleDOMEvents",
      (handlers) => handlers !== plugin.props.handleDOMEvents && Boolean(handlers[eventType]),
    );
  const serializer = new DOMSerializer({}, {});
  const resolveDelegate = () => {
    const state = view?.state ?? editor.state;
    const index = state.plugins.indexOf(plugin);
    return (
      (index < 0
        ? undefined
        : state.plugins.slice(index + 1).find((item) => item.props.clipboardSerializer)?.props.clipboardSerializer) ??
      DOMSerializer.fromSchema(state.schema)
    );
  };
  Object.defineProperties(serializer, {
    nodes: { get: () => resolveDelegate().nodes, enumerable: true },
    marks: { get: () => resolveDelegate().marks, enumerable: true },
  });
  serializer.serializeNode = (node, options) => resolveDelegate().serializeNode(node, options);

  serializer.serializeFragment = (fragment, options, target) => {
    const currentView = view;
    const delegate = resolveDelegate();

    // One copy event has one ProseMirror HTML serialization. A host bubble
    // listener can synchronously serialize again before the event is released.
    const isFirstClipboardHtml = Boolean(clipboardEvent && !clipboardHtmlConsumed);
    if (clipboardEvent) clipboardHtmlConsumed = true;
    // transformCopied is called before the clipboard serializer, and captures
    // the view even if another plugin serializes during its own initialization.
    const serialized = delegate.serializeFragment(fragment, options, target);
    if (
      !currentView ||
      !clipboardEvent ||
      !isFirstClipboardHtml ||
      target ||
      serialized.nodeType !== 11 ||
      currentView.state.selection.empty
    )
      return serialized;
    const eventType = clipboardEvent.type as "copy" | "cut";
    // A host event handler may serialize a different, structurally identical
    // slice. Without its source positions there is no safe number to attach.
    if (hasHostClipboardHandler(currentView, eventType)) return serialized;
    // Another transform can deliberately return an equal slice from elsewhere
    // in the document. Structural equality cannot establish its origin.
    if (currentView.someProp("transformCopied", (transform) => transform !== plugin.props.transformCopied))
      return serialized;

    const { selection, doc } = currentView.state;
    const slice = selection.content();
    let { content, openStart, openEnd } = slice;
    // Match ProseMirror's wrapper removal before its serializer is invoked.
    while (openStart > 1 && openEnd > 1 && content.childCount === 1 && content.firstChild!.childCount === 1) {
      openStart -= 1;
      openEnd -= 1;
      content = content.firstChild!.content;
    }
    // A host transformCopied may alter the slice; in that case it owns the
    // clipboard output and the original document positions no longer suffice.
    if (!fragment.eq(content)) return serialized;

    const source: Array<{ node: ProseMirrorNode; pos: number }> = [];
    doc.nodesBetween(selection.from, selection.to, (node, pos) => {
      if (node.type.name === "heading") source.push({ node, pos });
    });
    const copied: ProseMirrorNode[] = [];
    content.descendants((node) => {
      if (node.type.name === "heading") copied.push(node);
    });
    if (source.length !== copied.length || source.some(({ node }, i) => !node.sameMarkup(copied[i]))) return serialized;
    if (!source.some(({ node }) => node.attrs.semloEditorHeadingNumbering)) return serialized;

    const markers = new Map(numbersForDocument(doc).map(({ pos, marker }) => [pos, marker]));
    if (!source.some(({ pos }) => markers.has(pos))) return serialized;
    const headings = Array.from((serialized as DocumentFragment).querySelectorAll("h1,h2,h3,h4,h5,h6"));
    if (
      headings.length !== source.length ||
      headings.some((heading, i) => {
        const { node, pos } = source[i];
        const numbering = node.attrs.semloEditorHeadingNumbering;
        return (
          heading.tagName.toLowerCase() !== `h${node.attrs.level}` ||
          heading.textContent !== copied[i].textContent ||
          (markers.has(pos)
            ? heading.getAttribute("data-semlo-editor-heading-numbering") !== numbering
            : heading.hasAttribute("data-semlo-editor-heading-numbering"))
        );
      })
    )
      return serialized;

    const first = source[0];
    const partialSingleHeading =
      source.length === 1 &&
      selection.$from.parent === selection.$to.parent &&
      selection.$from.parent.type.name === "heading" &&
      (selection.from > first.pos + 1 || selection.to < first.pos + first.node.nodeSize - 1);
    if (partialSingleHeading) {
      const heading = headings[0];
      // Host serializers and transforms retain full control over their output.
      // The built-in serializer may safely represent a partial title as inline
      // content, retaining inline marks and the normal ProseMirror copy path.
      if (
        delegate === DOMSerializer.fromSchema(currentView.state.schema) &&
        heading.parentNode === serialized &&
        serialized.childNodes.length === 1
      ) {
        const inline = heading.ownerDocument.createElement("span");
        while (heading.firstChild) inline.append(heading.firstChild);
        serialized.replaceChild(inline, heading);
      }
      return serialized;
    }

    for (const [index, heading] of headings.entries()) {
      const marker = markers.get(source[index].pos);
      if (marker === undefined) continue;
      const span = heading.ownerDocument.createElement("span");
      span.setAttribute("data-semlo-editor-heading-marker", "");
      span.textContent = `${marker} `;
      heading.prepend(span);
    }
    return serialized;
  };

  plugin = new Plugin({
    props: {
      handleDOMEvents: {
        copy: (_currentView, event) => recordClipboardEvent(event),
        cut: (_currentView, event) => recordClipboardEvent(event),
      },
      transformCopied(slice, currentView) {
        view = currentView;
        return slice;
      },
      clipboardSerializer: serializer,
      clipboardTextSerializer(slice, currentView) {
        if (clipboardEvent && clipboardTextConsumed) return "";
        if (clipboardEvent) clipboardTextConsumed = true;
        const index = currentView.state.plugins.indexOf(plugin);
        if (index < 0) return "";
        const table = semloEditorTableClipboardKey.get(currentView.state);
        const next = currentView.state.plugins
          .slice(index + 1)
          .find((item) => item !== table && item.props.clipboardTextSerializer);
        const delegate = next?.props.clipboardTextSerializer;
        // Tiptap's built-in serializer is identified conservatively; a host
        // serializer or an unknown implementation always gets the normal call.
        // ProseMirror treats an empty return as "continue to the next hook".
        const key = (next as (Plugin & { key?: string }) | undefined)?.key;
        if (!clipboardEvent || !delegate || !/^clipboardTextSerializer\$(?:\d+)?$/.test(key ?? "")) return "";
        const eventType = clipboardEvent.type as "copy" | "cut";
        if (hasHostClipboardHandler(currentView, eventType)) return "";
        if (currentView.someProp("transformCopied", (transform) => transform !== plugin.props.transformCopied))
          return "";
        // Check owners, not function identity: a host may deliberately reuse a
        // serializer function on another plugin or on the view itself.
        if (
          currentView.props.clipboardTextSerializer ||
          currentView.props.plugins?.some((item) => item.props.clipboardTextSerializer) ||
          currentView.state.plugins.some(
            (item) => item !== plugin && item !== next && item !== table && item.props.clipboardTextSerializer,
          )
        )
          return "";

        const { selection, doc } = currentView.state;
        const { $from, $to } = selection;
        if (
          selection.empty ||
          selection.ranges.length !== 1 ||
          !slice.eq(selection.content()) ||
          $from.depth !== 1 ||
          $to.depth !== 1 ||
          $from.parent.type.name !== "heading" ||
          $to.parent.type.name !== "heading" ||
          !$from.parent.attrs.semloEditorHeadingNumbering ||
          !$to.parent.attrs.semloEditorHeadingNumbering ||
          $to.index(0) !== $from.index(0) + 1
        )
          return "";
        const numberedPositions = new Set(numbersForDocument(doc).map(({ pos }) => pos));
        if (!numberedPositions.has($from.before(1)) || !numberedPositions.has($to.before(1))) return "";
        return getTextBetween(
          doc,
          { from: selection.from, to: selection.to },
          {
            blockSeparator: "\n",
            textSerializers: getTextSerializersFromSchema(currentView.state.schema),
          },
        );
      },
    },
    view(currentView) {
      view = currentView;
      const release = (event: Event) => {
        if (clipboardEvent === event) clipboardEvent = undefined;
      };
      for (const type of ["copy", "cut"]) currentView.dom.addEventListener(type, release);
      return {
        destroy() {
          for (const type of ["copy", "cut"]) currentView.dom.removeEventListener(type, release);
          clipboardEvent = undefined;
          if (view === currentView) view = undefined;
        },
      };
    },
  });
  return plugin;
}
