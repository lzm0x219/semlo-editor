import { defineConfig } from "@rslib/core";

export default defineConfig({
  source: {
    tsconfigPath: "./tsconfig.lib.json",
    entry: {
      index: "./src/index.ts",
    },
  },
  lib: [{ format: "esm", bundle: true, dts: true }],
  output: {
    target: "web",
    cleanDistPath: true,
    autoExternal: true,
    minify: false,
  },
  tools: {
    rspack(config) {
      // Avoid a separate runtime; Rspack may still share modules across entries.
      // Package dependencies, including the lazy emoji dataset, remain external.
      config.optimization = { ...config.optimization, runtimeChunk: false, splitChunks: false };
    },
  },
});
