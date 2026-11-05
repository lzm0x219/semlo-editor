import { defineConfig } from "@rslib/core";

export default defineConfig({
  source: { tsconfigPath: "./tsconfig.json", entry: { index: "./src/index.ts" } },
  lib: [{ format: "esm", bundle: true, dts: true }],
  output: { target: "web", autoExternal: true },
});
