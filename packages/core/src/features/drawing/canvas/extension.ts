import { Node } from "@tiptap/core";

import { exportCanvas } from "./export";
import { CANVAS_DEFAULT_HEIGHT, canvasHeight } from "./height";
import { kindFrom, dataFrom, parseJSON } from "./model";
import { createCanvasNodeView } from "./node-view";
import {
  presentationPayload,
  readPresentationHeight,
  readPresentationKind,
  supportedCanvasHeight,
  supportedCanvasKind,
  supportedCanvasViewport,
} from "./presentation";

/** Canvas entry points share shape and connection data but keep their own initial templates. */
export const CanvasBoard = Node.create({
  name: "semloEditorCanvas",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      height: {
        default: CANVAS_DEFAULT_HEIGHT,
        rendered: false,
        parseHTML: readPresentationHeight,
      },
      kind: { default: "board", rendered: false, parseHTML: readPresentationKind },
      data: { default: null, rendered: false, parseHTML: (element) => parseJSON(element.getAttribute("data-canvas")) },
      viewport: {
        default: null,
        rendered: false,
        parseHTML: (element) => parseJSON(element.getAttribute("data-viewport")),
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: "figure[data-semlo-editor-canvas]",
        priority: 100,
        getAttrs: (element: HTMLElement) => ({
          ...(readPresentationHeight(element) === null ? { height: null } : {}),
          ...(readPresentationKind(element) === null ? { kind: null } : {}),
        }),
      },
    ];
  },
  renderText({ node }) {
    let supported =
      supportedCanvasHeight(node.attrs.height) &&
      supportedCanvasKind(node.attrs.kind) &&
      supportedCanvasViewport(node.attrs.viewport);
    const data = dataFrom(node.attrs.data, kindFrom(node.attrs.kind), () => {
      supported = false;
    });
    if (!supported) return "画布数据格式不受支持";
    return [...data.shapes.map((shape) => shape.text), ...data.edges.map((edge) => edge.text)]
      .filter(Boolean)
      .join("\n");
  },
  renderHTML({ node }) {
    const kind = kindFrom(node.attrs.kind);
    const presentation = presentationPayload(node.attrs.height, node.attrs.kind);
    let supported =
      supportedCanvasHeight(node.attrs.height) &&
      supportedCanvasKind(node.attrs.kind) &&
      supportedCanvasViewport(node.attrs.viewport);
    const data = dataFrom(node.attrs.data, kind, () => {
      supported = false;
    });
    return [
      "figure",
      {
        "data-semlo-editor-canvas": "",
        "data-height": canvasHeight(node.attrs.height),
        "data-kind": kind,
        ...(presentation === null ? {} : { "data-semlo-editor-presentation": presentation }),
        "data-canvas": JSON.stringify(node.attrs.data),
        "data-viewport": JSON.stringify(node.attrs.viewport),
        class: "semlo-editor-canvas-export",
      },
      ["figcaption", kind === "board" ? "画板" : kind === "flowchart" ? "流程图" : "UML 图"],
      supported ? exportCanvas(data) : ["p", "画布数据格式不受支持，暂无法显示。"],
    ];
  },
  addNodeView() {
    return createCanvasNodeView();
  },
});
