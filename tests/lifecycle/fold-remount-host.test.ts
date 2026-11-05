import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../fixtures/browser/fixture-browser-runtime";
import type {} from "../fixtures/lifecycle/fold-remount-host-fixture";

let origin = "";
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const build = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/lifecycle/fold-remount-host-fixture.ts" } },
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
  await page.waitForFunction(() => typeof window.mountFoldRemountHost === "function");
});

test("remount reconstructs host NodeView, heading widget, and leaves another instance alive", async ({ page }) => {
  const result = await page.evaluate(() => {
    window.__semloRequireFixture("mountFoldRemountHost")();
    const { first, second, events } = window.__semloRequireFixture("foldRemountHost");
    const before = first.getSnapshot().json;
    first.editor.unmount();
    const target = document.createElement("div");
    document.querySelector("#first-fold-host .semlo-editor-content")!.append(target);
    first.editor.mount(target);
    const after = first.getSnapshot().json;
    const widget = first.editor.view.dom.querySelector<HTMLButtonElement>(".semlo-editor-heading-fold-toggle")!;
    widget.click();
    const hidden = !!first.editor.view.dom.querySelector(".semlo-editor-heading-fold-hidden");
    first.destroy();
    second.setContent("<p>第二实例继续编辑</p>");
    const secondText = second.getSnapshot().text;
    second.destroy();
    return { before, after, hidden, secondText, events };
  });
  expect(result.after).toEqual(result.before);
  expect(result.hidden).toBe(true);
  expect(result.secondText).toBe("第二实例继续编辑");
  expect(result.events).toEqual(["create", "destroy", "create", "destroy"]);
});

test("host NodeView creation exception propagates during remount", async ({ page }) => {
  const result = await page.evaluate(() => {
    window.__semloRequireFixture("mountFoldRemountHost")();
    const fixture = window.__semloRequireFixture("foldRemountHost");
    fixture.first.editor.unmount();
    fixture.failCreate(true);
    const target = document.createElement("div");
    document.querySelector("#first-fold-host .semlo-editor-content")!.append(target);
    let error = "";
    try {
      fixture.first.editor.mount(target);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    fixture.failCreate(false);
    fixture.second.setContent("<p>第二实例仍可用</p>");
    const secondText = fixture.second.getSnapshot().text;
    fixture.first.editor.destroy();
    fixture.second.destroy();
    return { error, secondText, events: fixture.events };
  });
  expect(result.error).toBe("host-nodeview-create");
  expect(result.secondText).toBe("第二实例仍可用");
  expect(result.events).toEqual(["create", "destroy", "create"]);
});

test("host NodeView destruction exception propagates during unmount", async ({ page }) => {
  const result = await page.evaluate(() => {
    window.__semloRequireFixture("mountFoldRemountHost")();
    const fixture = window.__semloRequireFixture("foldRemountHost");
    fixture.failDestroy(true);
    let error = "";
    try {
      fixture.first.editor.unmount();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    fixture.failDestroy(false);
    fixture.second.setContent("<p>第二实例仍可用</p>");
    const secondText = fixture.second.getSnapshot().text;
    try {
      fixture.first.editor.destroy();
    } catch {
      // The host exception may have interrupted Tiptap teardown; the other instance remains independent.
    }
    fixture.second.destroy();
    return { error, secondText, events: fixture.events };
  });
  expect(result.error).toBe("host-nodeview-destroy");
  expect(result.secondText).toBe("第二实例仍可用");
  expect(result.events[0]).toBe("create");
  expect(result.events[1]).toBe("destroy");
});
