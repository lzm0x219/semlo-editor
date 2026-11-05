import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../packages/core/src/types";
import { installFixtureGuards } from "../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    bookmarkFramework?: {
      mount: (kind: "core" | "react" | "vue" | "solid") => void;
      pending: Array<{
        label: string;
        url: string;
        canonicalUrl?: string;
        signal: AbortSignal;
        resolve: (value: { title: string } | null) => void;
      }>;
      pendingUploads: Array<{ label: string; name: string; resolve: (url: string) => void }>;
      readonly contentWrites: number;
      readonly integrationWrites: number;
      writeContent: (value: ReturnType<EditorController["getSnapshot"]>["json"]) => void;
      replaceUpload: () => void;
      appendReplacement: (equal?: boolean, clone?: boolean) => void;
      appendNetEqual: (clone?: boolean) => void;
      rebuildBookmarkAndEdit: () => void;
      moveBookmark: () => void;
      registerReentrantEdit: () => void;
      registerReentrantRebuild: () => void;
      triggerReentrantEdit: () => void;
      duplicateBookmarkReference: () => void;
      rebuildFirstDuplicate: () => void;
      readonly controller?: EditorController;
      replace: () => void;
      remove: () => void;
    };
  }
}

for (const kind of ["core", "react", "vue", "solid"] as const) {
  test(`${kind} does not submit bookmark title during simulated composition`, async ({ page }) => {
    await page.route("https://codepen.io/**", (route) => route.fulfill({ status: 200, body: "Fixture" }));
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({ type: "module", url: "/tests/embed-bookmark-framework.js" });
    await page.waitForFunction(() => Boolean(window.bookmarkFramework));
    await page.evaluate((entry) => window.__semloRequireFixture("bookmarkFramework").mount(entry), kind);
    await page.waitForFunction(() => Boolean(window.bookmarkFramework?.controller));
    const host = page.locator("#framework-bookmark");
    await page.evaluate(() =>
      window
        .__semloRequireValue(window.__semloRequireFixture("bookmarkFramework").controller, "controller")
        .editor.commands.setTextSelection(1),
    );
    await host.getByRole("button", { name: "选择嵌入内容" }).click();
    await host.getByRole("button", { name: "卡片" }).click();
    await page.waitForFunction(() => window.__semloRequireFixture("bookmarkFramework").pending.length === 1);
    await page.evaluate(() =>
      window.__semloRequireFixture("bookmarkFramework").pending[0].resolve({ title: "原始标题" }),
    );
    await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("原始标题");
    await host.locator(".semlo-editor-embed-bookmark-block").click();
    await host.getByRole("toolbar", { name: "书签操作" }).getByRole("button", { name: "编辑" }).click();
    const input = host.getByLabel("标题", { exact: true });
    await input.fill("中文草稿");
    await input.evaluate((element) =>
      element.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true }),
      ),
    );
    await expect(input).toBeVisible();
    await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("原始标题");
    await input.press("Enter");
    await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("中文草稿");
    await page.evaluate(() =>
      window.__semloRequireValue(window.__semloRequireFixture("bookmarkFramework").controller, "controller").destroy(),
    );
  });
  test(`${kind} survives host destruction on URL-change cancellation`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
    await page.route("https://codepen.io/**", (route) => route.fulfill({ status: 200, body: "Fixture" }));
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({ type: "module", url: "/tests/embed-bookmark-framework.js" });
    await page.waitForFunction(() => Boolean(window.bookmarkFramework));
    await page.evaluate((entry) => window.__semloRequireFixture("bookmarkFramework").mount(entry), kind);
    await page.waitForFunction(() => Boolean(window.bookmarkFramework?.controller));
    const host = page.locator("#framework-bookmark");
    await page.evaluate(() =>
      window
        .__semloRequireValue(window.__semloRequireFixture("bookmarkFramework").controller, "controller")
        .editor.commands.setTextSelection(1),
    );
    await host.getByRole("button", { name: "选择嵌入内容" }).click();
    await host.getByRole("button", { name: "标题" }).click();
    await page.waitForFunction(() => window.__semloRequireFixture("bookmarkFramework").pending.length === 1);
    const error = await page.evaluate(() => {
      const fixture = window.__semloRequireFixture("bookmarkFramework");
      const api = window.__semloRequireValue(fixture.controller, "controller");
      fixture.pending[0].signal.addEventListener("abort", () => api.destroy(), { once: true });
      const editor = api.editor;
      let position = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "semloEditorEmbedBookmarkInline") position = pos;
      });
      const node = editor.state.doc.nodeAt(position)!;
      try {
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(position, undefined, {
            ...node.attrs,
            url: "https://codepen.io/other/pen/abc123",
          }),
        );
        return null;
      } catch (error) {
        return String(error);
      }
    });
    expect(error).toBe(null);
    await page.waitForFunction(
      () =>
        window.__semloRequireValue(window.__semloRequireFixture("bookmarkFramework").controller, "controller").editor
          .isDestroyed,
    );
    expect(errors).toEqual([]);
  });
  test(`${kind} invalidates a bookmark rebuilt in a reentrant transaction`, async ({ page }) => {
    await page.route("https://codepen.io/**", (route) => route.fulfill({ status: 200, body: "Fixture" }));
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({ type: "module", url: "/tests/embed-bookmark-framework.js" });
    await page.waitForFunction(() => Boolean(window.bookmarkFramework));
    await page.evaluate((entry) => window.__semloRequireFixture("bookmarkFramework").mount(entry), kind);
    await page.waitForFunction(() => Boolean(window.bookmarkFramework?.controller));
    await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").registerReentrantRebuild());
    const host = page.locator("#framework-bookmark");
    await page.evaluate(() =>
      window
        .__semloRequireValue(window.__semloRequireFixture("bookmarkFramework").controller, "controller")
        .editor.commands.setTextSelection(1),
    );
    await host.getByRole("button", { name: "选择嵌入内容" }).click();
    await host.getByRole("button", { name: "标题" }).click();
    await page.waitForFunction(() => window.__semloRequireFixture("bookmarkFramework").pending.length === 1);
    await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").triggerReentrantEdit());
    expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").pending[0].signal.aborted)).toBe(
      true,
    );
    await page.waitForFunction(() => window.__semloRequireFixture("bookmarkFramework").pending.length === 2);
    await page.evaluate(() => {
      const pending = window.__semloRequireFixture("bookmarkFramework").pending;
      pending[0].resolve({ title: "旧结果" });
      pending[1].resolve({ title: "新结果" });
    });
    await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("新结果");
    await page.evaluate(() =>
      window.__semloRequireValue(window.__semloRequireFixture("bookmarkFramework").controller, "controller").destroy(),
    );
  });
  test(`${kind} invalidates only the rebuilt bookmark when nodes share a reference`, async ({ page }) => {
    await page.route("https://codepen.io/**", (route) => route.fulfill({ status: 200, body: "Fixture" }));
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({ type: "module", url: "/tests/embed-bookmark-framework.js" });
    await page.waitForFunction(() => Boolean(window.bookmarkFramework));
    await page.evaluate((entry) => window.__semloRequireFixture("bookmarkFramework").mount(entry), kind);
    await page.waitForFunction(() => Boolean(window.bookmarkFramework?.controller));
    const host = page.locator("#framework-bookmark");
    await page.evaluate(() =>
      window
        .__semloRequireValue(window.__semloRequireFixture("bookmarkFramework").controller, "controller")
        .editor.commands.setTextSelection(1),
    );
    await host.getByRole("button", { name: "选择嵌入内容" }).click();
    await host.getByRole("button", { name: "标题" }).click();
    await page.waitForFunction(() => window.__semloRequireFixture("bookmarkFramework").pending.length === 1);
    await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").duplicateBookmarkReference());
    await page.waitForFunction(() => window.__semloRequireFixture("bookmarkFramework").pending.length === 3);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").pending.map((p) => p.signal.aborted)),
    ).toEqual([true, false, false]);
    await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").rebuildFirstDuplicate());
    expect(
      await page.evaluate(() =>
        window
          .__semloRequireFixture("bookmarkFramework")
          .pending.slice(0, 3)
          .map((p) => p.signal.aborted),
      ),
    ).toEqual([true, true, false]);
    await page.waitForFunction(() => window.__semloRequireFixture("bookmarkFramework").pending.length === 4);
    await page.evaluate(() => {
      const pending = window.__semloRequireFixture("bookmarkFramework").pending;
      pending[0].resolve({ title: "旧结果" });
      pending[1].resolve({ title: "旧结果" });
      pending[2].resolve({ title: "保留结果" });
      pending[3].resolve({ title: "新结果" });
    });
    await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText(["新结果", "保留结果"]);
    await page.evaluate(() =>
      window.__semloRequireValue(window.__semloRequireFixture("bookmarkFramework").controller, "controller").destroy(),
    );
  });
  test(`${kind} retains a pending bookmark through a reentrant local edit`, async ({ page }) => {
    await page.route("https://codepen.io/**", (route) => route.fulfill({ status: 200, body: "Fixture" }));
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({ type: "module", url: "/tests/embed-bookmark-framework.js" });
    await page.waitForFunction(() => Boolean(window.bookmarkFramework));
    await page.evaluate((entry) => window.__semloRequireFixture("bookmarkFramework").mount(entry), kind);
    await page.waitForFunction(() => Boolean(window.bookmarkFramework?.controller));
    await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").registerReentrantEdit());
    const host = page.locator("#framework-bookmark");
    await page.evaluate(() =>
      window
        .__semloRequireValue(window.__semloRequireFixture("bookmarkFramework").controller, "controller")
        .editor.commands.setTextSelection(1),
    );
    await host.getByRole("button", { name: "选择嵌入内容" }).click();
    await host.getByRole("button", { name: "标题" }).click();
    await page.waitForFunction(() => window.__semloRequireFixture("bookmarkFramework").pending.length === 1);
    await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").triggerReentrantEdit());
    expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").pending[0].signal.aborted)).toBe(
      false,
    );
    await page.evaluate(() =>
      window.__semloRequireFixture("bookmarkFramework").pending[0].resolve({ title: "原请求" }),
    );
    await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("原请求");
    await page.evaluate(() =>
      window.__semloRequireValue(window.__semloRequireFixture("bookmarkFramework").controller, "controller").destroy(),
    );
  });
  test(`${kind} retains metadata when the same bookmark node moves locally`, async ({ page }) => {
    await page.route("https://codepen.io/**", (route) => route.fulfill({ status: 200, body: "Fixture" }));
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({ type: "module", url: "/tests/embed-bookmark-framework.js" });
    await page.waitForFunction(() => Boolean(window.bookmarkFramework));
    await page.evaluate((entry) => window.__semloRequireFixture("bookmarkFramework").mount(entry), kind);
    await page.waitForFunction(() => Boolean(window.bookmarkFramework?.controller));
    const host = page.locator("#framework-bookmark");
    await page.evaluate(() =>
      window
        .__semloRequireValue(window.__semloRequireFixture("bookmarkFramework").controller, "controller")
        .editor.commands.setTextSelection(1),
    );
    await host.getByRole("button", { name: "选择嵌入内容" }).click();
    await host.getByRole("button", { name: "标题" }).click();
    await page.waitForFunction(() => window.__semloRequireFixture("bookmarkFramework").pending.length === 1);
    await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").moveBookmark());
    expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").pending[0].signal.aborted)).toBe(
      false,
    );
    await page.evaluate(() =>
      window.__semloRequireFixture("bookmarkFramework").pending[0].resolve({ title: "原请求" }),
    );
    await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("原请求");
    await page.evaluate(() =>
      window.__semloRequireValue(window.__semloRequireFixture("bookmarkFramework").controller, "controller").destroy(),
    );
  });

  test(`${kind} invalidates metadata when a bookmark is rebuilt alongside a local edit`, async ({ page }) => {
    await page.route("https://codepen.io/**", (route) => route.fulfill({ status: 200, body: "Fixture" }));
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({ type: "module", url: "/tests/embed-bookmark-framework.js" });
    await page.waitForFunction(() => Boolean(window.bookmarkFramework));
    await page.evaluate((entry) => window.__semloRequireFixture("bookmarkFramework").mount(entry), kind);
    await page.waitForFunction(() => Boolean(window.bookmarkFramework?.controller));
    const host = page.locator("#framework-bookmark");
    await page.evaluate(() =>
      window
        .__semloRequireValue(window.__semloRequireFixture("bookmarkFramework").controller, "controller")
        .editor.commands.setTextSelection(1),
    );
    await host.getByRole("button", { name: "选择嵌入内容" }).click();
    await host.getByRole("button", { name: "标题" }).click();
    await page.waitForFunction(() => window.__semloRequireFixture("bookmarkFramework").pending.length === 1);
    await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").rebuildBookmarkAndEdit());
    expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").pending[0].signal.aborted)).toBe(
      true,
    );
    await page.waitForFunction(() => window.__semloRequireFixture("bookmarkFramework").pending.length === 2);
    await page.evaluate(() => {
      const pending = window.__semloRequireFixture("bookmarkFramework").pending;
      pending[0].resolve({ title: "旧结果" });
      pending[1].resolve({ title: "新结果" });
    });
    await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("新结果");
    await page.evaluate(() =>
      window.__semloRequireValue(window.__semloRequireFixture("bookmarkFramework").controller, "controller").destroy(),
    );
  });

  test(`${kind} invalidates metadata when a net-equal batch rebuilds the bookmark node`, async ({ page }) => {
    await page.route("https://codepen.io/**", (route) => route.fulfill({ status: 200, body: "Fixture" }));
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({ type: "module", url: "/tests/embed-bookmark-framework.js" });
    await page.waitForFunction(() => Boolean(window.bookmarkFramework));
    await page.evaluate((entry) => window.__semloRequireFixture("bookmarkFramework").mount(entry), kind);
    await page.waitForFunction(() => Boolean(window.bookmarkFramework?.controller));
    const host = page.locator("#framework-bookmark");
    await page.evaluate(() =>
      window
        .__semloRequireValue(window.__semloRequireFixture("bookmarkFramework").controller, "controller")
        .editor.commands.setTextSelection(1),
    );
    await host.getByRole("button", { name: "选择嵌入内容" }).click();
    await host.getByRole("button", { name: "标题" }).click();
    await page.waitForFunction(() => window.__semloRequireFixture("bookmarkFramework").pending.length === 1);
    await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").appendNetEqual(true));
    expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").pending[0].signal.aborted)).toBe(
      true,
    );
    await page.waitForFunction(() => window.__semloRequireFixture("bookmarkFramework").pending.length === 2);
    await page.evaluate(() => {
      const pending = window.__semloRequireFixture("bookmarkFramework").pending;
      pending[0].resolve({ title: "旧结果" });
      pending[1].resolve({ title: "新结果" });
    });
    await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("新结果");
    await page.evaluate(() =>
      window.__semloRequireValue(window.__semloRequireFixture("bookmarkFramework").controller, "controller").destroy(),
    );
  });

  test(`${kind} restarts metadata when an equal appended document rebuilds the bookmark node`, async ({ page }) => {
    await page.route("https://codepen.io/**", (route) => route.fulfill({ status: 200, body: "Fixture" }));
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({ type: "module", url: "/tests/embed-bookmark-framework.js" });
    await page.waitForFunction(() => Boolean(window.bookmarkFramework));
    await page.evaluate((entry) => window.__semloRequireFixture("bookmarkFramework").mount(entry), kind);
    await page.waitForFunction(() => Boolean(window.bookmarkFramework?.controller));
    const host = page.locator("#framework-bookmark");
    await page.evaluate(() =>
      window
        .__semloRequireValue(window.__semloRequireFixture("bookmarkFramework").controller, "controller")
        .editor.commands.setTextSelection(1),
    );
    await host.getByRole("button", { name: "选择嵌入内容" }).click();
    await host.getByRole("button", { name: "标题" }).click();
    await page.waitForFunction(() => window.__semloRequireFixture("bookmarkFramework").pending.length === 1);
    await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").appendReplacement(true, true));
    expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").pending[0].signal.aborted)).toBe(
      true,
    );
    await page.waitForFunction(() => window.__semloRequireFixture("bookmarkFramework").pending.length === 2);
    await page.evaluate(() => {
      const pending = window.__semloRequireFixture("bookmarkFramework").pending;
      pending[0].resolve({ title: "旧结果" });
      pending[1].resolve({ title: "新结果" });
    });
    await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("新结果");
    await page.evaluate(() =>
      window.__semloRequireValue(window.__semloRequireFixture("bookmarkFramework").controller, "controller").destroy(),
    );
  });

  test(`${kind} preserves pending metadata when an appended transaction restores the original document`, async ({
    page,
  }) => {
    await page.route("https://codepen.io/**", (route) => route.fulfill({ status: 200, body: "Fixture" }));
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({ type: "module", url: "/tests/embed-bookmark-framework.js" });
    await page.waitForFunction(() => Boolean(window.bookmarkFramework));
    await page.evaluate((entry) => window.__semloRequireFixture("bookmarkFramework").mount(entry), kind);
    await page.waitForFunction(() => Boolean(window.bookmarkFramework?.controller));
    const host = page.locator("#framework-bookmark");
    await page.evaluate(() =>
      window
        .__semloRequireValue(window.__semloRequireFixture("bookmarkFramework").controller, "controller")
        .editor.commands.setTextSelection(1),
    );
    await host.getByRole("button", { name: "选择嵌入内容" }).click();
    await host.getByRole("button", { name: "标题" }).click();
    await page.waitForFunction(() => window.__semloRequireFixture("bookmarkFramework").pending.length === 1);
    await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").appendNetEqual());
    expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").pending[0].signal.aborted)).toBe(
      false,
    );
    await page.evaluate(() =>
      window.__semloRequireFixture("bookmarkFramework").pending[0].resolve({ title: "原请求" }),
    );
    await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("原请求");
    await page.evaluate(() =>
      window.__semloRequireValue(window.__semloRequireFixture("bookmarkFramework").controller, "controller").destroy(),
    );
  });

  test(`${kind} preserves a pending video when an appended transaction restores the original document`, async ({
    page,
  }) => {
    await page.route("https://example.test/**", (route) => route.fulfill({ status: 404 }));
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({ type: "module", url: "/tests/embed-bookmark-framework.js" });
    await page.waitForFunction(() => Boolean(window.bookmarkFramework));
    await page.evaluate((entry) => window.__semloRequireFixture("bookmarkFramework").mount(entry), kind);
    await page.waitForFunction(() => Boolean(window.bookmarkFramework?.controller));
    const host = page.locator("#framework-bookmark");
    await page.evaluate(() =>
      window
        .__semloRequireValue(window.__semloRequireFixture("bookmarkFramework").controller, "controller")
        .editor.commands.setTextSelection(1),
    );
    await host
      .locator('input[data-semlo-editor-media-input="video"]')
      .setInputFiles({ name: "pending.mp4", mimeType: "video/mp4", buffer: Buffer.from("video") });
    await page.waitForFunction(() => window.__semloRequireFixture("bookmarkFramework").pendingUploads.length === 1);
    await page.evaluate(() => {
      const fixture = window.__semloRequireFixture("bookmarkFramework");
      fixture.appendNetEqual();
      fixture.pendingUploads[0].resolve("https://example.test/pending.mp4");
    });
    await expect(host.locator("video")).toHaveAttribute("src", "https://example.test/pending.mp4");
    await page.evaluate(() =>
      window.__semloRequireValue(window.__semloRequireFixture("bookmarkFramework").controller, "controller").destroy(),
    );
  });

  test(`${kind} preserves a pending video after an equal plugin-appended replacement`, async ({ page }) => {
    await page.route("https://example.test/**", (route) => route.fulfill({ status: 404 }));
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({ type: "module", url: "/tests/embed-bookmark-framework.js" });
    await page.waitForFunction(() => Boolean(window.bookmarkFramework));
    await page.evaluate((entry) => window.__semloRequireFixture("bookmarkFramework").mount(entry), kind);
    await page.waitForFunction(() => Boolean(window.bookmarkFramework?.controller));
    const host = page.locator("#framework-bookmark");
    await page.evaluate(() =>
      window
        .__semloRequireValue(window.__semloRequireFixture("bookmarkFramework").controller, "controller")
        .editor.commands.setTextSelection(1),
    );
    await host.locator('input[data-semlo-editor-media-input="video"]').setInputFiles({
      name: "pending.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.from("video"),
    });
    await page.waitForFunction(() => window.__semloRequireFixture("bookmarkFramework").pendingUploads.length === 1);
    await page.evaluate(() => {
      const fixture = window.__semloRequireFixture("bookmarkFramework");
      fixture.appendReplacement(true);
      fixture.pendingUploads[0].resolve("https://example.test/pending.mp4");
    });
    await expect(host.locator("video")).toHaveAttribute("src", "https://example.test/pending.mp4");
    await page.evaluate(() =>
      window.__semloRequireValue(window.__semloRequireFixture("bookmarkFramework").controller, "controller").destroy(),
    );
  });

  test(`${kind} retains pending metadata after an equal plugin-appended replacement`, async ({ page }) => {
    await page.route("https://codepen.io/**", (route) => route.fulfill({ status: 200, body: "Fixture" }));
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({ type: "module", url: "/tests/embed-bookmark-framework.js" });
    await page.waitForFunction(() => Boolean(window.bookmarkFramework));
    await page.evaluate((entry) => window.__semloRequireFixture("bookmarkFramework").mount(entry), kind);
    await page.waitForFunction(() => Boolean(window.bookmarkFramework?.controller));
    const host = page.locator("#framework-bookmark");
    await page.evaluate(() =>
      window
        .__semloRequireValue(window.__semloRequireFixture("bookmarkFramework").controller, "controller")
        .editor.commands.setTextSelection(1),
    );
    await host.getByRole("button", { name: "选择嵌入内容" }).click();
    await host.getByRole("button", { name: "标题" }).click();
    await page.waitForFunction(() => window.__semloRequireFixture("bookmarkFramework").pending.length === 1);
    await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").appendReplacement(true));
    expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").pending[0].signal.aborted)).toBe(
      false,
    );
    expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").pending.length)).toBe(1);
    await page.evaluate(() =>
      window.__semloRequireFixture("bookmarkFramework").pending[0].resolve({ title: "原请求结果" }),
    );
    await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("原请求结果");
    await page.evaluate(() =>
      window.__semloRequireValue(window.__semloRequireFixture("bookmarkFramework").controller, "controller").destroy(),
    );
  });

  test(`${kind} discards a pending video after a plugin-appended whole-document replacement`, async ({ page }) => {
    await page.route("https://example.test/**", (route) => route.fulfill({ status: 404 }));
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({ type: "module", url: "/tests/embed-bookmark-framework.js" });
    await page.waitForFunction(() => Boolean(window.bookmarkFramework));
    await page.evaluate((entry) => window.__semloRequireFixture("bookmarkFramework").mount(entry), kind);
    await page.waitForFunction(() => Boolean(window.bookmarkFramework?.controller));
    const host = page.locator("#framework-bookmark");
    await page.evaluate(() =>
      window
        .__semloRequireValue(window.__semloRequireFixture("bookmarkFramework").controller, "controller")
        .editor.commands.setTextSelection(1),
    );
    await host.locator('input[data-semlo-editor-media-input="video"]').setInputFiles({
      name: "old.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.from("old"),
    });
    await page.waitForFunction(() => window.__semloRequireFixture("bookmarkFramework").pendingUploads.length === 1);
    await page.evaluate(() => {
      const fixture = window.__semloRequireFixture("bookmarkFramework");
      fixture.appendReplacement();
      fixture.pendingUploads[0].resolve("https://example.test/old.mp4");
    });
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
    await expect(host.locator("video")).toHaveCount(0);
    await expect(host.locator(".semlo-editor-prose")).toContainText("追加替换");
    await page.evaluate(() =>
      window.__semloRequireValue(window.__semloRequireFixture("bookmarkFramework").controller, "controller").destroy(),
    );
  });

  test(`${kind} invalidates metadata after a plugin-appended whole-document replacement`, async ({ page }) => {
    await page.route("https://codepen.io/**", (route) => route.fulfill({ status: 200, body: "Fixture" }));
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({ type: "module", url: "/tests/embed-bookmark-framework.js" });
    await page.waitForFunction(() => Boolean(window.bookmarkFramework));
    await page.evaluate((entry) => window.__semloRequireFixture("bookmarkFramework").mount(entry), kind);
    await page.waitForFunction(() => Boolean(window.bookmarkFramework?.controller));
    const host = page.locator("#framework-bookmark");
    await page.evaluate(() =>
      window
        .__semloRequireValue(window.__semloRequireFixture("bookmarkFramework").controller, "controller")
        .editor.commands.setTextSelection(1),
    );
    await host.getByRole("button", { name: "选择嵌入内容" }).click();
    await host.getByRole("button", { name: "标题" }).click();
    await page.waitForFunction(() => window.__semloRequireFixture("bookmarkFramework").pending.length === 1);
    await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").appendReplacement());
    expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").pending[0].signal.aborted)).toBe(
      true,
    );
    await page.waitForFunction(() => window.__semloRequireFixture("bookmarkFramework").pending.length === 2);
    await page.evaluate(() => {
      const pending = window.__semloRequireFixture("bookmarkFramework").pending;
      pending[0].resolve({ title: "过期" });
      pending[1].resolve({ title: "新结果" });
    });
    await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("新结果");
    await expect(host.locator(".semlo-editor-prose")).toContainText("追加替换");
    await page.evaluate(() =>
      window.__semloRequireValue(window.__semloRequireFixture("bookmarkFramework").controller, "controller").destroy(),
    );
  });

  test(`${kind} restarts bookmark metadata when the surrounding document is replaced`, async ({ page }) => {
    await page.route("https://codepen.io/**", (route) => route.fulfill({ status: 200, body: "Fixture" }));
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({ type: "module", url: "/tests/embed-bookmark-framework.js" });
    await page.waitForFunction(() => Boolean(window.bookmarkFramework));
    await page.evaluate((entry) => window.__semloRequireFixture("bookmarkFramework").mount(entry), kind);
    await page.waitForFunction(() => Boolean(window.bookmarkFramework?.controller));
    const host = page.locator("#framework-bookmark");
    await page.evaluate(() =>
      window
        .__semloRequireValue(window.__semloRequireFixture("bookmarkFramework").controller, "controller")
        .editor.commands.setTextSelection(1),
    );
    await host.getByRole("button", { name: "选择嵌入内容" }).click();
    await host.getByRole("button", { name: "标题" }).click();
    await page.waitForFunction(() => window.__semloRequireFixture("bookmarkFramework").pending.length === 1);
    const previousWrites = await page.evaluate(() => {
      const fixture = window.__semloRequireFixture("bookmarkFramework");
      const controller = window.__semloRequireValue(fixture.controller, "controller");
      const content = controller.getSnapshot().json;
      content.content!.push({ type: "paragraph", content: [{ type: "text", text: "新文档" }] });
      const previous = fixture.contentWrites;
      fixture.writeContent(content);
      return previous;
    });
    await page.waitForFunction(
      (previous) => window.__semloRequireFixture("bookmarkFramework").contentWrites > previous,
      previousWrites,
    );
    expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").pending[0].signal.aborted)).toBe(
      true,
    );
    await page.waitForFunction(() => window.__semloRequireFixture("bookmarkFramework").pending.length === 2);
    await page.evaluate(() => {
      const pending = window.__semloRequireFixture("bookmarkFramework").pending;
      pending[0].resolve({ title: "过期结果" });
      pending[1].resolve({ title: "新结果" });
    });
    await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("新结果");
    await expect(host.locator(".semlo-editor-prose")).toContainText("新文档");
    await expect(host.locator(".semlo-editor-prose")).not.toContainText("过期结果");
    await page.evaluate(() =>
      window.__semloRequireValue(window.__semloRequireFixture("bookmarkFramework").controller, "controller").destroy(),
    );
  });

  test(`${kind} uses the updated upload callback for new uploads`, async ({ page }) => {
    await page.route("https://example.test/**", (route) => route.fulfill({ status: 404 }));
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({ type: "module", url: "/tests/embed-bookmark-framework.js" });
    await page.waitForFunction(() => Boolean(window.bookmarkFramework));
    await page.evaluate((entry) => window.__semloRequireFixture("bookmarkFramework").mount(entry), kind);
    await page.waitForFunction(() => Boolean(window.bookmarkFramework?.controller));
    const host = page.locator("#framework-bookmark");
    const input = host.locator('input[data-semlo-editor-media-input="video"]');
    await input.setInputFiles({ name: "first.mp4", mimeType: "video/mp4", buffer: Buffer.from("first") });
    await page.waitForFunction(() => window.__semloRequireFixture("bookmarkFramework").pendingUploads.length === 1);
    const previousWrites = await page.evaluate(() => {
      const fixture = window.__semloRequireFixture("bookmarkFramework");
      const previous = fixture.integrationWrites;
      fixture.replaceUpload();
      return previous;
    });
    await page.waitForFunction(
      (previous) => window.__semloRequireFixture("bookmarkFramework").integrationWrites > previous,
      previousWrites,
    );
    await input.setInputFiles({ name: "second.mp4", mimeType: "video/mp4", buffer: Buffer.from("second") });
    await page.waitForFunction(() => window.__semloRequireFixture("bookmarkFramework").pendingUploads.length === 2);
    expect(
      await page.evaluate(() =>
        window.__semloRequireFixture("bookmarkFramework").pendingUploads.map(({ label, name }) => [label, name]),
      ),
    ).toEqual([
      ["first", "first.mp4"],
      ["second", "second.mp4"],
    ]);
    await page.evaluate(() => {
      const uploads = window.__semloRequireFixture("bookmarkFramework").pendingUploads;
      uploads[0].resolve("https://example.test/first.mp4");
      uploads[1].resolve("https://example.test/second.mp4");
    });
    await expect(host.locator("video")).toHaveCount(2);
    await page.evaluate(() =>
      window.__semloRequireValue(window.__semloRequireFixture("bookmarkFramework").controller, "controller").destroy(),
    );
  });

  test(`${kind} handles in-flight video across equal writes and document replacement`, async ({ page }) => {
    await page.route("https://example.test/**", (route) => route.fulfill({ status: 404 }));
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({ type: "module", url: "/tests/embed-bookmark-framework.js" });
    await page.waitForFunction(() => Boolean(window.bookmarkFramework));
    await page.evaluate((entry) => window.__semloRequireFixture("bookmarkFramework").mount(entry), kind);
    await page.waitForFunction(() => Boolean(window.bookmarkFramework?.controller));
    const host = page.locator("#framework-bookmark");
    await page.evaluate(() => {
      const controller = window.__semloRequireValue(
        window.__semloRequireFixture("bookmarkFramework").controller,
        "controller",
      );
      controller.editor.commands.setTextSelection(1);
    });
    await host.locator('input[data-semlo-editor-media-input="video"]').setInputFiles({
      name: "pending.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.from("video"),
    });
    await page.waitForFunction(() => window.__semloRequireFixture("bookmarkFramework").pendingUploads.length === 1);
    const previousWrites = await page.evaluate(() => {
      const fixture = window.__semloRequireFixture("bookmarkFramework");
      const controller = window.__semloRequireValue(fixture.controller, "controller");
      const previous = fixture.contentWrites;
      fixture.writeContent(controller.getSnapshot().json);
      return previous;
    });
    await page.waitForFunction(
      (previous) => window.__semloRequireFixture("bookmarkFramework").contentWrites > previous,
      previousWrites,
    );
    await page.evaluate(() =>
      window.__semloRequireFixture("bookmarkFramework").pendingUploads[0].resolve("https://example.test/pending.mp4"),
    );
    await expect(host.locator("video")).toHaveAttribute("src", "https://example.test/pending.mp4");
    await host.locator('input[data-semlo-editor-media-input="video"]').setInputFiles({
      name: "old.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.from("old"),
    });
    await page.waitForFunction(() => window.__semloRequireFixture("bookmarkFramework").pendingUploads.length === 2);
    const beforeReplacement = await page.evaluate(() => {
      const fixture = window.__semloRequireFixture("bookmarkFramework");
      const previous = fixture.contentWrites;
      fixture.writeContent({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "新内容" }] }],
      });
      return previous;
    });
    await page.waitForFunction(
      (previous) => window.__semloRequireFixture("bookmarkFramework").contentWrites > previous,
      beforeReplacement,
    );
    await page.evaluate(() =>
      window.__semloRequireFixture("bookmarkFramework").pendingUploads[1].resolve("https://example.test/old.mp4"),
    );
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
    await expect(host.locator("video")).toHaveCount(0);
    await expect(host.locator(".semlo-editor-prose")).toHaveText("新内容");
    await page.evaluate(() =>
      window.__semloRequireValue(window.__semloRequireFixture("bookmarkFramework").controller, "controller").destroy(),
    );
  });

  test(`${kind} metadata integration supports replacement, deletion and mode conversion`, async ({ page }) => {
    await page.route("https://codepen.io/**", (route) => route.fulfill({ status: 200, body: "Fixture" }));
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({ type: "module", url: "/tests/embed-bookmark-framework.js" });
    await page.waitForFunction(() => Boolean(window.bookmarkFramework));
    await page.evaluate((entry) => window.__semloRequireFixture("bookmarkFramework").mount(entry), kind);
    await page.waitForFunction(() => Boolean(window.bookmarkFramework?.controller));
    const host = page.locator("#framework-bookmark");
    await page.evaluate(() =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("bookmarkFramework").controller,
          "bookmarkFramework.controller",
        )
        .editor.commands.setTextSelection(1),
    );
    await host.getByRole("button", { name: "选择嵌入内容" }).click();
    await host.getByRole("button", { name: "标题" }).click();
    await page.waitForFunction(() => window.__semloRequireFixture("bookmarkFramework").pending.length === 1);
    expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").pending[0].url)).toBe(
      "https://codepen.io/Mamboleoo/embed/XWJPxpZ",
    );
    expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").pending[0].canonicalUrl)).toBe(
      "https://codepen.io/Mamboleoo/pen/XWJPxpZ",
    );
    await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").replace());
    await page.waitForFunction(() => window.__semloRequireFixture("bookmarkFramework").pending.length === 2);
    expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").pending[0].signal.aborted)).toBe(
      true,
    );
    expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").pending[1].label)).toBe(
      "second",
    );
    expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").pending[1].url)).toBe(
      "https://codepen.io/Mamboleoo/embed/XWJPxpZ",
    );
    expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").pending[1].canonicalUrl)).toBe(
      "https://codepen.io/Mamboleoo/pen/XWJPxpZ",
    );
    await page.evaluate(() => {
      window.__semloRequireFixture("bookmarkFramework").pending[0].resolve({ title: "过期" });
      window.__semloRequireFixture("bookmarkFramework").pending[1].resolve({ title: "新的标题" });
    });
    await expect(host.locator(".semlo-editor-embed-bookmark-title")).toHaveText("新的标题");
    await host.locator(".semlo-editor-embed-bookmark-inline").click();
    await host.getByRole("toolbar", { name: "书签操作" }).getByRole("button", { name: "卡片" }).click();
    await expect(host.locator(".semlo-editor-embed-bookmark-block .semlo-editor-embed-bookmark-title")).toHaveText(
      "新的标题",
    );
    const saved = await page.evaluate(() =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("bookmarkFramework").controller,
          "bookmarkFramework.controller",
        )
        .getSnapshot(),
    );
    await page.evaluate(() =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("bookmarkFramework").controller,
          "bookmarkFramework.controller",
        )
        .setContent("<p>替换</p>"),
    );
    await page.evaluate(
      (value) =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("bookmarkFramework").controller,
            "bookmarkFramework.controller",
          )
          .setContent(value),
      saved.json,
    );
    expect(
      (
        await page.evaluate(() =>
          window
            .__semloRequireValue(
              window.__semloRequireFixture("bookmarkFramework").controller,
              "bookmarkFramework.controller",
            )
            .getSnapshot(),
        )
      ).json,
    ).toEqual(saved.json);
    await page.evaluate(() =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("bookmarkFramework").controller,
          "bookmarkFramework.controller",
        )
        .setContent("<p>再次替换</p>"),
    );
    await page.evaluate(
      (value) =>
        window
          .__semloRequireValue(
            window.__semloRequireFixture("bookmarkFramework").controller,
            "bookmarkFramework.controller",
          )
          .setContent(value),
      saved.html,
    );
    expect(
      (
        await page.evaluate(() =>
          window
            .__semloRequireValue(
              window.__semloRequireFixture("bookmarkFramework").controller,
              "bookmarkFramework.controller",
            )
            .getSnapshot(),
        )
      ).json,
    ).toEqual(saved.json);
    await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").remove());
    await page.evaluate(() => {
      const editor = window.__semloRequireValue(
        window.__semloRequireFixture("bookmarkFramework").controller,
        "bookmarkFramework.controller",
      ).editor;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "semloEditorEmbedBookmarkBlock") editor.commands.setNodeSelection(pos);
      });
    });
    await host.getByRole("toolbar", { name: "书签操作" }).getByRole("button", { name: "嵌入" }).click();
    await page.evaluate(() =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("bookmarkFramework").controller,
          "bookmarkFramework.controller",
        )
        .editor.commands.setTextSelection(1),
    );
    await host.getByRole("button", { name: "选择嵌入内容" }).click();
    await expect(host.getByRole("button", { name: "标题" })).toBeDisabled();
    await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").replace());
    await expect(host.getByRole("button", { name: "标题" })).toBeEnabled();
    await host.getByRole("button", { name: "标题" }).click();
    await page.waitForFunction(() => window.__semloRequireFixture("bookmarkFramework").pending.length === 3);
    await page.evaluate(() =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("bookmarkFramework").controller,
          "bookmarkFramework.controller",
        )
        .setEditable(false),
    );
    expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").pending[2].signal.aborted)).toBe(
      true,
    );
    await page.evaluate(() =>
      window.__semloRequireFixture("bookmarkFramework").pending[2].resolve({ title: "只读时迟到" }),
    );
    await page.evaluate(() =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("bookmarkFramework").controller,
          "bookmarkFramework.controller",
        )
        .setEditable(true),
    );
    await page.waitForFunction(() => window.__semloRequireFixture("bookmarkFramework").pending.length === 4);
    await page.evaluate(() =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("bookmarkFramework").controller,
          "bookmarkFramework.controller",
        )
        .setContent("<p>已删除</p>"),
    );
    expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").pending[3].signal.aborted)).toBe(
      true,
    );
    await page.evaluate(() =>
      window.__semloRequireFixture("bookmarkFramework").pending[3].resolve({ title: "删除后迟到" }),
    );
    await expect(host.locator(".semlo-editor-prose")).toHaveText("已删除");
    await page.evaluate(() =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("bookmarkFramework").controller,
          "bookmarkFramework.controller",
        )
        .setContent({
          type: "doc",
          content: [
            { type: "paragraph" },
            {
              type: "semloEditorEmbed",
              attrs: { provider: "codepen", url: "https://codepen.io/Mamboleoo/pen/XWJPxpZ" },
            },
          ],
        }),
    );
    await page.evaluate(() =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("bookmarkFramework").controller,
          "bookmarkFramework.controller",
        )
        .editor.commands.setTextSelection(1),
    );
    await host.getByRole("button", { name: "选择嵌入内容" }).click();
    await host.getByRole("button", { name: "卡片" }).click();
    await page.waitForFunction(() => window.__semloRequireFixture("bookmarkFramework").pending.length === 5);
    await page.evaluate(() =>
      window
        .__semloRequireValue(
          window.__semloRequireFixture("bookmarkFramework").controller,
          "bookmarkFramework.controller",
        )
        .destroy(),
    );
    expect(await page.evaluate(() => window.__semloRequireFixture("bookmarkFramework").pending[4].signal.aborted)).toBe(
      true,
    );
  });
}
