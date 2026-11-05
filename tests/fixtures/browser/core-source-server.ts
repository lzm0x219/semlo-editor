import { createRsbuild } from "@rsbuild/core";

export async function startCoreSourceServer() {
  const build = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/browser/core-source-entry.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await build.startDevServer();
  return { origin: `http://127.0.0.1:${port}`, stop: () => server.close() };
}
