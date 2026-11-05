import { defineConfig } from "@rsbuild/core";
export default defineConfig({
  source: { entry: { index: "./tests/fixtures/drawing/mindmap-fixture.ts" } },
  output: { distPath: { root: process.env.MINDMAP_TEST_DIR! }, cleanDistPath: false },
});
