import { defineConfig } from "@rslib/core";

// Test-only browser bundles consume the real dist entries and their external
// dependencies. They are never included in the published library or demo.
export default defineConfig({
  source: {
    entry: {
      "dist/index": "./tests/fixtures/browser/fixture-browser-entry.ts",
      "tests/controlled": "./tests/fixtures/contracts/controlled.ts",
      "tests/code-block-preferences-fixture": "./tests/fixtures/code-block/code-block-preferences-fixture.ts",
      "tests/interactive-public-fixture": "./tests/fixtures/interactive/interactive-public-fixture.ts",
      "tests/embed-bookmark-framework": "./tests/fixtures/references/embed-bookmark-framework-fixture.ts",
    },
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
      __VUE_OPTIONS_API__: true,
      __VUE_PROD_DEVTOOLS__: false,
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
    },
  },
  lib: [{ format: "esm", bundle: true }],
  output: {
    target: "web",
    autoExternal: false,
    cleanDistPath: true,
    distPath: { root: ".browser-test" },
    minify: false,
  },
  tools: {
    rspack(config) {
      // Both browser-test entries must register shared lazy chunks with the same runtime.
      config.optimization = { ...config.optimization, runtimeChunk: "single", splitChunks: false };
    },
  },
});
