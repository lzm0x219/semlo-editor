import { renderDiagram } from "../../../packages/core/src/features/drawing/diagram/render";
import { diagramTemplates } from "../../../packages/core/src/features/drawing/diagram/templates";
import { createEditor } from "../../../packages/core/src/index";

Object.assign(window, {
  guardRenderDiagram: renderDiagram,
  guardDiagramTemplates: diagramTemplates,
  guardCreateEditor: createEditor,
});
