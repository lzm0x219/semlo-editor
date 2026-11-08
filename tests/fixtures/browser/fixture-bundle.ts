import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { createRsbuild } from "@rsbuild/core";

type BundleOptions = { framework?: boolean };

export function createInlineFixtureRsbuild(
  name: string,
  entry: string,
  directory: string,
  options: BundleOptions = {},
) {
  return createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: {
        entry: { [name]: entry },
        ...(options.framework
          ? {
              define: {
                "process.env.NODE_ENV": JSON.stringify("production"),
                __VUE_OPTIONS_API__: true,
                __VUE_PROD_DEVTOOLS__: false,
                __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
              },
            }
          : {}),
      },
      ...(options.framework
        ? { resolve: { alias: { "@semlo-editor/core$": resolve("packages/core/src/index.ts") } } }
        : {}),
      output: { distPath: { root: directory }, filename: { js: "[name].js" }, cleanDistPath: false },
      tools: { rspack: { optimization: { splitChunks: false, runtimeChunk: false } } },
    },
  });
}

export async function readInlineFixtureBundle(directory: string) {
  const output = join(directory, "static/js");
  const bundle = (await readdir(output)).find((name) => name.endsWith(".js"));
  if (!bundle) throw new Error(`浏览器夹具未生成 JavaScript：${output}`);
  return readFile(join(output, bundle), "utf8");
}
