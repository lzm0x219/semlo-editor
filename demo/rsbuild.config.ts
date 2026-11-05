import { defineConfig } from "@rsbuild/core";

export default defineConfig({
  source: {
    entry: { index: "./demo/main.ts" },
    define: {
      __VUE_OPTIONS_API__: true,
      __VUE_PROD_DEVTOOLS__: false,
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
    },
  },
  resolve: {
    // The demo runs from source and does not require a library build first.
    alias: {
      "@semlo-editor/core$": "./packages/core/src/index.ts",
      "@semlo-editor/react$": "./packages/react/src/index.ts",
      "@semlo-editor/vue$": "./packages/vue/src/index.ts",
      "@semlo-editor/solid$": "./packages/solid/src/index.ts",
      "@semlo-editor/core/style.css$": "./demo/editor.css",
    },
  },
  html: { template: "./demo/index.html" },
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    // Only created on demand for local browser regressions.
    publicDir: { name: ".browser-test", copyOnBuild: false },
  },
  // The demo and library builds have separate output directories.
  output: { distPath: { root: "dist-demo" } },
});
