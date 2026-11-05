import { expect, test } from "@rstest/core";
import {
  isEditorControllerWithResults,
  type EditorController,
  type EditorControllerWithResults,
} from "@semlo-editor/core";
import type { SemloEditorProps as ReactProps } from "@semlo-editor/react";
import type { SemloEditorProps as SolidProps } from "@semlo-editor/solid";
import type { SemloEditor as VueEditor } from "@semlo-editor/vue";

test("legacy controller mocks and callbacks remain assignable", () => {
  const legacy: EditorController = {
    editor: null as unknown as EditorController["editor"],
    getSnapshot: () => ({ json: { type: "doc" }, html: "", text: "" }),
    setContent: () => {},
    setEditable: () => {},
    setIntegrations: () => {},
    focus: () => {},
    destroy: () => {},
  };
  const onReady = (controller: EditorController) => controller.setContent("<p>content</p>");
  const react: ReactProps = { onReady };
  const solid: SolidProps = { onReady };
  const vue: InstanceType<typeof VueEditor>["$props"] = { onReady };
  react.onReady?.(legacy);
  solid.onReady?.(legacy);
  vue.onReady?.(legacy);
  const originalReactShape: { onReady?: (controller: EditorController) => void } = react;
  const originalSolidShape: { onReady?: (controller: EditorController) => void } = solid;
  expect([originalReactShape.onReady, originalSolidShape.onReady]).toHaveLength(2);
  expect(isEditorControllerWithResults(legacy)).toBe(false);
  const extended: EditorControllerWithResults = { ...legacy, trySetContent: () => ({ status: "unchanged" }) };
  expect(isEditorControllerWithResults(extended)).toBe(true);
  expect([legacy, react.onReady, solid.onReady, vue.onReady]).toHaveLength(4);
});

test("framework ready callbacks can safely detect and use the result method", () => {
  const onReady = (controller: EditorController) => {
    if (isEditorControllerWithResults(controller)) controller.trySetContent("<p>content</p>");
  };
  const react: ReactProps = { onReady };
  const solid: SolidProps = { onReady };
  const vue: InstanceType<typeof VueEditor>["$props"] = { onReady };
  const getFromVue = (instance: InstanceType<typeof VueEditor>) =>
    instance.getEditor()?.trySetContent("<p>content</p>");
  expect(getFromVue).toBeTypeOf("function");
  expect([react.onReady, solid.onReady, vue.onReady]).toHaveLength(3);
});
