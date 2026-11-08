import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../../fixtures/browser/fixture-rsbuild";
import type {} from "../../fixtures/media/upload-lifetime-host-fixture";

let origin = "";
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  ({ origin, stop } = await startFixtureServer("./tests/fixtures/media/upload-lifetime-host-fixture.ts"));
});
afterAll(async () => stop?.());
test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountUploadLifetimeHost === "function");
});

for (const kind of ["image", "attachment"] as const) {
  for (const host of ["normal", "throw", "recursive"] as const) {
    for (const phase of ["waiting for remount", "upload in flight"] as const) {
      for (const entry of ["editor", "controller"] as const) {
        test(`${kind}: ${entry} destroy runs early ${host} host callback while ${phase}`, async ({ page }) => {
          await page.evaluate((host) => window.__semloRequireFixture("mountUploadLifetimeHost")(host), host);
          if (kind === "image") {
            await page.evaluate(() => {
              const editor = window.__semloRequireFixture("uploadLifetimeHost").controller.editor;
              const transfer = new DataTransfer();
              transfer.items.add(new File(["image"], "sample.png", { type: "image/png" }));
              editor.view.dom.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true }));
            });
          } else {
            await page
              .locator('#upload-lifetime-host input[type="file"]')
              .nth(1)
              .setInputFiles({
                name: "sample.txt",
                mimeType: "text/plain",
                buffer: Buffer.from("attachment"),
              });
          }
          await page.waitForFunction(() => window.__semloRequireFixture("uploadLifetimeHost").pending.length === 1);
          const result = await page.evaluate(
            async ({ kind, phase, entry }) => {
              const fixture = window.__semloRequireFixture("uploadLifetimeHost");
              const editor = fixture.controller.editor;
              if (phase === "waiting for remount") {
                editor.unmount();
                fixture.pending[0].resolve(kind === "image" ? "/tests/sample-image.svg" : "/tests/sample.txt");
                await new Promise<void>((resolve) => setTimeout(resolve, 0));
              }
              const waiters = fixture.subscriptions.slice();
              let error = "";
              let sameError = false;
              try {
                if (entry === "editor") editor.destroy();
                else fixture.controller.destroy();
              } catch (cause) {
                sameError = cause === fixture.hostFailure;
                error = cause instanceof Error ? cause.message : String(cause);
              }
              if (phase === "upload in flight")
                fixture.pending[0].resolve(kind === "image" ? "/tests/sample-image.svg" : "/tests/sample.txt");
              await new Promise<void>((resolve) => setTimeout(resolve, 0));
              return {
                error,
                sameError,
                shellCount: document.querySelectorAll("#upload-lifetime-host .semlo-editor").length,
                events: fixture.events,
                pendingCount: waiters.length,
                leaked: waiters.filter((entry) => !entry.removed).map((entry) => entry.name),
                errors: fixture.errors,
              };
            },
            { kind, phase, entry },
          );
          expect(result.pendingCount).toBeGreaterThanOrEqual(phase === "waiting for remount" ? 2 : 1);
          expect(result.error).toBe(host === "throw" ? "host-destroy-failure" : "");
          expect(result.sameError).toBe(host === "throw");
          expect(result.shellCount).toBe(0);
          expect(result.events).toEqual(["host-destroy"]);
          expect(result.leaked).toEqual([]);
          expect(result.errors).toEqual([]);
        });
      }
    }
  }
}

for (const entry of ["editor", "controller"] as const) {
  for (const scenario of ["host throw", "recursive", "two errors", "two errors general"] as const) {
    test(`both uploads: ${entry} destroy handles ${scenario}`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.evaluate(
        ({ recursive }) => window.__semloRequireFixture("mountUploadLifetimeHost")(recursive ? "recursive" : "throw"),
        { recursive: scenario === "recursive" },
      );
      await page.evaluate(() => {
        const editor = window.__semloRequireFixture("uploadLifetimeHost").controller.editor;
        const transfer = new DataTransfer();
        transfer.items.add(new File(["image"], "sample.png", { type: "image/png" }));
        editor.view.dom.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true }));
      });
      await page
        .locator('#upload-lifetime-host input[type="file"]')
        .nth(1)
        .setInputFiles({
          name: "sample.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("attachment"),
        });
      await page.waitForFunction(() => window.__semloRequireFixture("uploadLifetimeHost").pending.length === 2);
      const result = await page.evaluate(
        async ({ entry, scenario }) => {
          const fixture = window.__semloRequireFixture("uploadLifetimeHost");
          const editor = fixture.controller.editor;
          editor.unmount();
          fixture.pending[0].resolve("/tests/sample-image.svg");
          fixture.pending[1].resolve("/tests/sample.txt");
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          const waiters = fixture.subscriptions.slice();
          const cleanupFailure = new Error("upload-off-failure");
          let failureTarget = "";
          if (scenario === "two errors" || scenario === "two errors general") {
            const methods = editor as unknown as {
              off: (name: string, callback: (...args: never[]) => unknown) => unknown;
            };
            const originalOff = methods.off.bind(editor);
            let failOnce = true;
            methods.off = (name, callback) => {
              const result = originalOff(name, callback);
              const uploadListener = waiters.some((item) => item.name === name && item.callback === callback);
              if (failOnce && name === "destroy" && (scenario === "two errors general" || uploadListener)) {
                failOnce = false;
                failureTarget = uploadListener ? "upload" : "other";
                throw cleanupFailure;
              }
              return result;
            };
          }
          let sameHostError = false;
          let sameCleanupError = false;
          let aggregateLength = 0;
          let error = "";
          try {
            if (entry === "editor") editor.destroy();
            else fixture.controller.destroy();
          } catch (cause) {
            error = cause instanceof Error ? cause.message : String(cause);
            if (cause instanceof AggregateError) {
              aggregateLength = cause.errors.length;
              sameHostError = cause.errors.includes(fixture.hostFailure);
              sameCleanupError = cause.errors.includes(cleanupFailure);
            } else {
              sameHostError = cause === fixture.hostFailure;
            }
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          return {
            error,
            sameHostError,
            sameCleanupError,
            aggregateLength,
            failureTarget,
            pendingCount: waiters.length,
            leaked: waiters.filter((item) => !item.removed).map((item) => item.name),
            errors: fixture.errors,
            events: fixture.events,
            shellCount: document.querySelectorAll("#upload-lifetime-host .semlo-editor").length,
          };
        },
        { entry, scenario },
      );
      expect(result.pendingCount).toBeGreaterThanOrEqual(4);
      expect(result.events).toEqual(["host-destroy"]);
      expect(result.error).toBe(
        scenario === "recursive"
          ? ""
          : scenario === "host throw"
            ? "host-destroy-failure"
            : scenario === "two errors general" && entry === "controller"
              ? "Editor cleanup failed"
              : "Editor destruction failed",
      );
      expect(result.sameHostError).toBe(scenario !== "recursive");
      expect(result.sameCleanupError).toBe(scenario === "two errors" || scenario === "two errors general");
      expect(result.aggregateLength).toBe(scenario === "two errors" || scenario === "two errors general" ? 2 : 0);
      expect(result.failureTarget).toBe(
        scenario === "two errors"
          ? "upload"
          : scenario === "two errors general"
            ? entry === "controller"
              ? "other"
              : "upload"
            : "",
      );
      expect(result.leaked).toEqual([]);
      expect(result.errors).toEqual([]);
      expect(result.shellCount).toBe(0);
      expect(pageErrors).toEqual([]);
    });
  }
}

for (const kind of ["image", "attachment"] as const) {
  for (const entry of ["editor", "controller"] as const) {
    for (const throws of [false, true]) {
      test(`${kind}: ${entry} destroy blocks a new upload reentered from off (host throws: ${throws})`, async ({
        page,
      }) => {
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));
        await page.evaluate(
          ({ throws }) => window.__semloRequireFixture("mountUploadLifetimeHost")(throws ? "throw" : "normal"),
          { throws },
        );
        if (kind === "image") {
          await page.evaluate(() => {
            const editor = window.__semloRequireFixture("uploadLifetimeHost").controller.editor;
            const data = new DataTransfer();
            data.items.add(new File(["first"], "first.png", { type: "image/png" }));
            editor.view.dom.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
          });
        } else {
          await page
            .locator('#upload-lifetime-host input[type="file"]')
            .nth(1)
            .setInputFiles({
              name: "first.txt",
              mimeType: "text/plain",
              buffer: Buffer.from("first"),
            });
        }
        await page.waitForFunction(() => window.__semloRequireFixture("uploadLifetimeHost").pending.length === 1);
        const result = await page.evaluate(
          async ({ kind, entry }) => {
            const fixture = window.__semloRequireFixture("uploadLifetimeHost");
            const editor = fixture.controller.editor;
            const uploadListener = fixture.subscriptions.find((item) => item.name === "destroy");
            const methods = editor as unknown as {
              off: (name: string, callback: (...args: never[]) => unknown) => unknown;
            };
            const originalOff = methods.off.bind(editor);
            let fired = false;
            methods.off = (name, callback) => {
              const value = originalOff(name, callback);
              if (!fired && name === "destroy" && callback === uploadListener?.callback) {
                fired = true;
                const data = new DataTransfer();
                const file =
                  kind === "image"
                    ? new File(["late"], "late.png", { type: "image/png" })
                    : new File(["late"], "late.txt", { type: "text/plain" });
                data.items.add(file);
                if (kind === "image") {
                  editor.view.dom.dispatchEvent(
                    new ClipboardEvent("paste", {
                      clipboardData: data,
                      bubbles: true,
                      cancelable: true,
                    }),
                  );
                } else {
                  const input = document.querySelectorAll<HTMLInputElement>(
                    '#upload-lifetime-host input[type="file"]',
                  )[1];
                  input.files = data.files;
                  input.dispatchEvent(new Event("change", { bubbles: true }));
                }
              }
              return value;
            };
            let error = "";
            try {
              if (entry === "editor") editor.destroy();
              else fixture.controller.destroy();
            } catch (cause) {
              error = cause instanceof Error ? cause.message : String(cause);
            }
            const uploadCount = fixture.pending.length;
            for (const pending of fixture.pending)
              pending.resolve(kind === "image" ? "/tests/first.svg" : "/tests/first.txt");
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            return {
              fired,
              error,
              uploadCount,
              mountWaiters: fixture.subscriptions.filter((item) => item.name === "mount" && !item.removed).length,
              errors: fixture.errors,
            };
          },
          { kind, entry },
        );
        expect(result.fired).toBe(true);
        expect(result.error).toBe(throws ? "host-destroy-failure" : "");
        expect(result.uploadCount).toBe(1);
        expect(result.mountWaiters).toBe(0);
        expect(result.errors).toEqual([]);
        expect(pageErrors).toEqual([]);
      });
    }
  }
}
