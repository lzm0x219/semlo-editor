import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../fixtures/browser/fixture-browser-runtime";
import type {} from "../fixtures/media/upload-lifetime-host-fixture";

let origin = "";
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const build = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/media/upload-lifetime-host-fixture.ts" } },
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
  await page.waitForFunction(() => typeof window.mountUploadLifetimeHost === "function");
});

for (const entry of ["editor", "controller"] as const) {
  for (const timing of ["before original", "after original"] as const) {
    test(`${entry} calls a failing removeAllListeners wrapper once (${timing})`, async ({ page }) => {
      await page.evaluate(() => window.__semloRequireFixture("mountUploadLifetimeHost")("normal"));
      const result = await page.evaluate(
        ({ entry, timing }) => {
          const fixture = window.__semloRequireFixture("uploadLifetimeHost");
          const editor = fixture.controller.editor;
          const error = new Error("remove-all-only");
          const original = editor.removeAllListeners.bind(editor);
          let calls = 0;
          editor.removeAllListeners = () => {
            calls++;
            if (timing === "after original") original();
            throw error;
          };
          let failure: unknown;
          try {
            if (entry === "editor") editor.destroy();
            else fixture.controller.destroy();
          } catch (cause) {
            failure = cause;
          }
          let emitError = "";
          try {
            editor.emit("destroy");
          } catch (cause) {
            emitError = cause instanceof Error ? cause.message : String(cause);
          }
          return {
            calls,
            sameError: failure === error,
            isAggregate: failure instanceof AggregateError,
            events: fixture.events,
            emitError,
            shell: !!document.querySelector("#upload-lifetime-host .semlo-editor"),
          };
        },
        { entry, timing },
      );
      expect(result.calls).toBe(1);
      expect(result.sameError).toBe(true);
      expect(result.isAggregate).toBe(false);
      expect(result.events).toEqual(["host-destroy"]);
      expect(result.emitError).toBe("");
    });
  }
}
