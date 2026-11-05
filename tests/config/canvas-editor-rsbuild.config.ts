import { defineConfig } from "@rsbuild/core";

export default defineConfig({
  source: { entry: { index: "./tests/fixtures/drawing/canvas-editor-fixture.ts" } },
  output: { distPath: { root: process.env.CANVAS_EDITOR_TEST_DIR! }, cleanDistPath: false },
});
