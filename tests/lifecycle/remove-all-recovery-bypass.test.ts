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
    test(`${entry} host failure clears base listeners without invoking wrapper (${timing})`, async ({ page }) => {
      await page.evaluate(() => window.__semloRequireFixture("mountUploadLifetimeHost")("throw"));
      const result = await page.evaluate(
        ({ entry, timing }) => {
          const fixture = window.__semloRequireFixture("uploadLifetimeHost");
          const editor = fixture.controller.editor;
          const cleanupError = new Error("host-wrapper-error");
          const original = editor.removeAllListeners.bind(editor);
          let calls = 0;
          let lateListenerCalls = 0;
          editor.on("destroy", () => {
            lateListenerCalls++;
          });
          editor.removeAllListeners = () => {
            calls++;
            if (timing === "after original") original();
            throw cleanupError;
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
            sameError: failure === fixture.hostFailure,
            lateListenerCalls,
            events: fixture.events,
            emitError,
            shell: !!document.querySelector("#upload-lifetime-host .semlo-editor"),
          };
        },
        { entry, timing },
      );
      expect(result.calls).toBe(0);
      expect(result.sameError).toBe(true);
      expect(result.lateListenerCalls).toBe(0);
      expect(result.events).toEqual(["host-destroy"]);
      expect(result.emitError).toBe("");
      expect(result.shell).toBe(false);
    });
  }
}
