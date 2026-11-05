import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import type {} from "../../fixtures/media/upload-pre-destroy-reentry-fixture";

let origin = "";
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const build = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/media/upload-pre-destroy-reentry-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await build.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  stop = () => server.close();
});
afterAll(async () => stop?.());
test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountUploadReentrantHost === "function");
});

for (const kind of ["image", "attachment"] as const) {
  for (const entry of ["editor", "controller"] as const) {
    for (const throws of [false, true]) {
      test(`${kind} started during ${entry} onDestroy (host throws: ${throws})`, async ({ page }) => {
        await page.evaluate(
          ({ kind, throws }) =>
            window.__semloRequireFixture("mountUploadReentrantHost")(throws ? `${kind}-throw` : kind),
          { kind, throws },
        );
        const result = await page.evaluate(
          async ({ kind, entry }) => {
            const fixture = window.__semloRequireFixture("uploadReentrantHost");
            let error = "";
            try {
              if (entry === "editor") fixture.controller.editor.destroy();
              else fixture.controller.destroy();
            } catch (cause) {
              error = cause instanceof Error ? cause.message : String(cause);
            }
            const uploadCount = fixture.pending.length;
            for (const task of fixture.pending) task.resolve(kind === "image" ? "/tests/late.svg" : "/tests/late.txt");
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            return {
              error,
              uploadCount,
              mountWaiters: fixture.subscriptions.filter((item) => item.name === "mount" && !item.removed).length,
              events: fixture.events,
              errors: fixture.errors,
            };
          },
          { kind, entry },
        );
        expect(result.events).toEqual(["host-destroy"]);
        expect(result.error).toBe(throws ? "host-destroy-failure" : "");
        // Once destruction begins, host callbacks cannot start a new upload.
        expect(result.uploadCount).toBe(0);
        expect(result.mountWaiters).toBe(0);
        expect(result.errors).toEqual([]);
      });
    }
  }
}
