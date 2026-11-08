import { createRsbuild } from "@rsbuild/core";

type FixtureBuildOptions = { framework?: boolean; publicDir?: false };

export function createFixtureRsbuild(entry: string, options: FixtureBuildOptions = {}) {
  return createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: {
        entry: { index: entry },
        ...(options.framework
          ? {
              define: {
                "process.env.NODE_ENV": JSON.stringify("development"),
                __VUE_OPTIONS_API__: true,
                __VUE_PROD_DEVTOOLS__: false,
                __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
              },
            }
          : {}),
      },
      ...(options.framework ? { resolve: { alias: { "@semlo-editor/core$": "./packages/core/src/index.ts" } } } : {}),
      server: {
        host: "127.0.0.1",
        port: 0,
        strictPort: true,
        ...(options.publicDir === false ? { publicDir: false } : {}),
      },
      dev: { hmr: false, liveReload: false },
    },
  });
}

export async function startFixtureServer(entry: string, options: FixtureBuildOptions = {}) {
  const build = await createFixtureRsbuild(entry, options);
  const { port, server } = await build.startDevServer();
  return { origin: `http://127.0.0.1:${port}`, stop: () => server.close() };
}
