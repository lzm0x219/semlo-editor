import { createRsbuild, mergeRsbuildConfig } from "@rsbuild/core";

import config from "../../demo/rsbuild.config";

export default async function setup() {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: mergeRsbuildConfig(config, {
      source: { define: { "process.env.NODE_ENV": JSON.stringify("development") } },
      // 使用系统分配的端口，避免与开发服务器或其他测试进程冲突。
      server: { host: "127.0.0.1", port: 0, strictPort: true },
      dev: { hmr: false, liveReload: false },
    }),
  });
  const { port, server } = await rsbuild.startDevServer();
  const origin = `http://127.0.0.1:${port}`;
  process.env.SEMLO_TEST_ORIGIN = origin;
  process.env.SEMLO_FIXTURE_URL = process.env.SEMLO_BENCH_PAGE === "demo" ? origin : `${origin}/tests/editor-fixture.html`;
  return async () => {
    delete process.env.SEMLO_TEST_ORIGIN;
    delete process.env.SEMLO_FIXTURE_URL;
    await server.close();
  };
}
