import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import type {} from "../../fixtures/heading/heading-fold-preferences-fixture";
let origin = "";
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/heading/heading-fold-preferences-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true },
      dev: { hmr: false, liveReload: false },
    },
  });
  const server = await rsbuild.startDevServer();
  origin = `http://127.0.0.1:${server.port}`;
  stop = () => server.server.close();
});
afterAll(async () => stop?.());
test.beforeEach(async ({ page }) => installFixtureGuards(page));

test("host-owned fold state restores only the same document and does not alter content", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.foldPreferences));
  await page.evaluate(() => window.__semloRequireFixture("foldPreferences").mount("A"));
  const host = page.locator("#fold-preferences-host");
  const toggle = host.getByRole("button", { name: "折叠标题：标题" });
  const before = await page.evaluate(() => window.__semloRequireFixture("foldPreferences").controller!.getSnapshot());
  await toggle.click();
  await expect(host.locator(".semlo-editor-prose > p").first()).toBeHidden();
  await page.waitForFunction(() => window.foldPreferences!.records.has("A:r1"), undefined, { timeout: 3000 });
  expect(await page.evaluate(() => window.__semloRequireFixture("foldPreferences").controller!.getSnapshot())).toEqual(
    before,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("foldPreferences").changes)).toBe(0);
  await page.evaluate(() => window.__semloRequireFixture("foldPreferences").mount("A"));
  await expect(host.locator(".semlo-editor-prose > p").first()).toBeHidden();
  await page.evaluate(() => window.__semloRequireFixture("foldPreferences").mount("B"));
  await expect(host.locator(".semlo-editor-prose > p").first()).toBeVisible();
  await page.evaluate(() => window.__semloRequireFixture("foldPreferences").mount("A", true, true, undefined, "r2"));
  await expect(host.locator(".semlo-editor-prose > p").first()).toBeVisible();
  await page.evaluate(() => window.__semloRequireFixture("foldPreferences").mount("A", false));
  await expect(host.locator(".semlo-editor-prose > p").first()).toBeHidden();
  await host.getByRole("button", { name: "展开标题：标题" }).click();
  await expect(host.locator(".semlo-editor-prose > p").first()).toBeVisible();
});

test("unconfigured callers retain independent in-memory view state", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.foldPreferences));
  await page.evaluate(() => window.__semloRequireFixture("foldPreferences").mount(null));
  const host = page.locator("#fold-preferences-host");
  const before = await page.evaluate(() => window.__semloRequireFixture("foldPreferences").controller!.getSnapshot());
  await host.getByRole("button", { name: "折叠标题：标题" }).click();
  await expect(host.locator(".semlo-editor-prose > p").first()).toBeHidden();
  expect(await page.evaluate(() => window.__semloRequireFixture("foldPreferences").controller!.getSnapshot())).toEqual(
    before,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("foldPreferences").saves)).toBe(0);
  await page.evaluate(() => window.__semloRequireFixture("foldPreferences").mount(null));
  await expect(host.locator(".semlo-editor-prose > p").first()).toBeVisible();
});

test("controlled echo, remapped positions, search expansion and undo remain coherent", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.foldPreferences));
  await page.evaluate(() => window.__semloRequireFixture("foldPreferences").mount("A"));
  const host = page.locator("#fold-preferences-host");
  const before = await page.evaluate(
    () => window.__semloRequireFixture("foldPreferences").controller!.getSnapshot().json,
  );
  await host.getByRole("button", { name: "折叠标题：标题" }).click();
  await page.waitForFunction(() => window.foldPreferences!.records.has("A:r1"), undefined, { timeout: 3000 });
  const saves = await page.evaluate(() => window.__semloRequireFixture("foldPreferences").saves);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("foldPreferences").controller!.editor;
    editor.view.dispatch(
      editor.state.tr.insert(0, editor.schema.nodes.paragraph.create(null, editor.schema.text("前文"))),
    );
  });
  await expect(host.locator(".semlo-editor-prose p").getByText("正文", { exact: true })).toBeHidden();
  expect(await page.evaluate(() => window.__semloRequireFixture("foldPreferences").saves)).toBe(saves);
  const edited = await page.evaluate(
    () => window.__semloRequireFixture("foldPreferences").controller!.getSnapshot().json,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("foldPreferences").changes)).toBe(1);
  await page.evaluate(
    (json) => window.__semloRequireFixture("foldPreferences").mount("A", true, false, json, "r2"),
    edited,
  );
  await expect(host.locator(".semlo-editor-prose p").getByText("正文", { exact: true })).toBeVisible();
  await host.getByRole("button", { name: "折叠标题：标题" }).click();
  await host.getByRole("button", { name: "查找替换" }).click();
  await page.getByRole("dialog", { name: "查找替换" }).getByRole("textbox", { name: "查找内容" }).fill("正文");
  await expect(host.locator(".semlo-editor-prose p").getByText("正文", { exact: true })).toBeVisible();
  await page.waitForFunction(() => window.foldPreferences!.records.get("A:r2")?.positions.length === 0);
  await page.evaluate(
    (json) => window.__semloRequireFixture("foldPreferences").mount("A", true, false, json, "r2"),
    edited,
  );
  await expect(host.locator(".semlo-editor-prose p").getByText("正文", { exact: true })).toBeVisible();
  // A fold preference is view state and does not add an undo event.
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("foldPreferences").controller!.editor;
    editor.view.dispatch(editor.state.tr.insertText("X", 2));
  });
  await page.evaluate(() => window.__semloRequireFixture("foldPreferences").controller!.editor.commands.undo());
  expect(
    await page.evaluate(() => window.__semloRequireFixture("foldPreferences").controller!.getSnapshot().json),
  ).toEqual(edited);
  expect(edited).not.toEqual(before);
});

test("mutating the original adapter identity cannot move a fold into another document or revision", async ({
  page,
}) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.foldPreferences));
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("foldPreferences");
    fixture.mount("A");
    fixture.adapter!.documentId = "B";
    fixture.adapter!.revision = "r2";
  });
  await page.locator("#fold-preferences-host").getByRole("button", { name: "折叠标题：标题" }).click();
  await page.waitForFunction(() => window.foldPreferences!.records.has("A:r1"));
  expect(await page.evaluate(() => window.__semloRequireFixture("foldPreferences").records.has("B:r2"))).toBe(false);
});
