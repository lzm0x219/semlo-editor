import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../fixtures/browser/fixture-browser-runtime";
import type {} from "../fixtures/lifecycle/upload-abort-fixture";

let origin = "";
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const build = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/lifecycle/upload-abort-fixture.ts" } },
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
  await page.waitForFunction(() => typeof window.mountUploadAbort === "function");
  await page.evaluate(() => window.__semloRequireFixture("mountUploadAbort")());
});

for (const kind of ["image", "attachment"] as const) {
  for (const action of ["document", "readonly", "destroy"] as const) {
    test(`${kind} ${action} aborts only the owning editor and leaves no stale error`, async ({ page }) => {
      await page.evaluate(
        ({ kind }) => {
          const fixture = window.__semloRequireFixture("uploadAbortFixture");
          fixture.start(kind, "first", ["first", "queued"]);
          fixture.start(kind, "second", ["second"]);
        },
        { kind },
      );
      await page.waitForFunction(() => window.uploadAbortFixture?.requests.length === 2);
      const state = await page.evaluate(
        ({ action }) => {
          const fixture = window.__semloRequireFixture("uploadAbortFixture");
          if (action === "document") fixture.first.setContent("<p>new document</p>");
          if (action === "readonly") fixture.first.setEditable(false);
          if (action === "destroy") fixture.first.destroy();
          const first = fixture.requests.find((item) => item.name === "first")!;
          const second = fixture.requests.find((item) => item.name === "second")!;
          first.reject(new Error("cancelled"));
          return { first: first.signal?.aborted, second: second.signal?.aborted };
        },
        { action },
      );
      expect(state).toEqual({ first: true, second: false });
      await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
      expect(
        await page.evaluate(() => {
          const fixture = window.__semloRequireFixture("uploadAbortFixture");
          return { names: fixture.requests.map((request) => request.name), errors: fixture.errors };
        }),
      ).toEqual({ names: ["first", "second"], errors: [] });
    });
  }

  test(`${kind} aborts when a direct document transaction removes its placeholder`, async ({ page }) => {
    await page.evaluate(
      (kind) => window.__semloRequireFixture("uploadAbortFixture").start(kind, "first", ["first"]),
      kind,
    );
    await page.waitForFunction(() => window.uploadAbortFixture?.requests.length === 1);
    await page.evaluate(() =>
      window.__semloRequireFixture("uploadAbortFixture").first.editor.commands.setContent("<p>other text</p>"),
    );
    await page.waitForFunction(() => window.uploadAbortFixture?.requests[0].signal?.aborted);
    expect(await page.evaluate(() => window.__semloRequireFixture("uploadAbortFixture").errors)).toEqual([]);
  });

  test(`${kind} aborts when the exposed editor becomes read-only`, async ({ page }) => {
    await page.evaluate(
      (kind) => window.__semloRequireFixture("uploadAbortFixture").start(kind, "first", ["first"]),
      kind,
    );
    await page.waitForFunction(() => window.uploadAbortFixture?.requests.length === 1);
    await page.evaluate(() => window.__semloRequireFixture("uploadAbortFixture").first.editor.setEditable(false));
    await page.waitForFunction(() => window.uploadAbortFixture?.requests[0].signal?.aborted, { timeout: 2000 });
    await expect(page.locator(".semlo-editor-uploading")).toHaveCount(0);
    expect(await page.evaluate(() => window.__semloRequireFixture("uploadAbortFixture").errors)).toEqual([]);
  });

  test(`${kind} host cancellation removes its placeholder without reporting an error`, async ({ page }) => {
    await page.evaluate(
      (kind) => window.__semloRequireFixture("uploadAbortFixture").start(kind, "first", ["first"]),
      kind,
    );
    await page.waitForFunction(() => window.uploadAbortFixture?.requests.length === 1);
    await page.evaluate(() =>
      window
        .__semloRequireFixture("uploadAbortFixture")
        .requests[0].reject(new DOMException("cancelled", "AbortError")),
    );
    await expect(page.locator(".semlo-editor-uploading")).toHaveCount(0);
    expect(await page.evaluate(() => window.__semloRequireFixture("uploadAbortFixture").errors)).toEqual([]);
  });
}

test("gallery selection cancellation aborts its own requests, not another selection", async ({ page }) => {
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("uploadAbortFixture");
    Object.assign(window, {
      cancelGalleryFirst: fixture.startGallery("one.png"),
      cancelGallerySecond: fixture.startGallery("two.png"),
    });
  });
  await page.waitForFunction(() => window.uploadAbortFixture?.requests.length === 2);
  const state = await page.evaluate(() => {
    (Reflect.get(window, "cancelGalleryFirst") as () => void)();
    const fixture = window.__semloRequireFixture("uploadAbortFixture");
    return fixture.requests.map((request) => request.signal?.aborted);
  });
  expect(state).toEqual([true, false]);
  await page.evaluate(() => window.__semloRequireFixture("uploadAbortFixture").destroyGallery());
  expect(
    await page.evaluate(() => window.__semloRequireFixture("uploadAbortFixture").requests[1].signal?.aborted),
  ).toBe(true);
});

test("gallery dialog aborts its upload when the exposed editor becomes read-only", async ({ page }) => {
  await page.evaluate(() =>
    window.__semloRequireFixture("uploadAbortFixture").galleryEditor.editor.commands.setNodeSelection(0),
  );
  await page.locator("#gallery-upload-abort").getByRole("button", { name: "编辑图册" }).click();
  const dialog = page.getByRole("dialog", { name: "图册设置" });
  await dialog
    .getByLabel("选择图片文件")
    .setInputFiles({ name: "new.png", mimeType: "image/png", buffer: Buffer.from("image") });
  await page.waitForFunction(() => window.uploadAbortFixture?.requests.length === 1);
  await page.evaluate(() => window.__semloRequireFixture("uploadAbortFixture").galleryEditor.editor.setEditable(false));
  await expect(dialog).toHaveCount(0);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("uploadAbortFixture").requests[0].signal?.aborted),
  ).toBe(true);
});

for (const type of ["image", "attachment"] as const) {
  for (const action of ["close", "document", "readonly", "raw-readonly", "destroy"] as const) {
    test(`database ${type} upload aborts when its session ends (${action})`, async ({ page }) => {
      const root = page.locator("#database-upload-abort .semlo-editor-database");
      await root.getByRole("button", { name: "添加列" }).click();
      const dialog = root.getByRole("dialog", { name: "新增列" });
      await dialog.getByLabel("数据表列名").fill("材料");
      await dialog.getByLabel("列类型").selectOption(type);
      await dialog.getByRole("button", { name: "确定" }).click();
      await root.getByLabel("第 1 行 材料").click();
      const picker = root.getByRole("dialog", { name: "材料 文件" });
      await picker.getByLabel(type === "image" ? "选择图片" : "选择附件").setInputFiles({
        name: type === "image" ? "sample.png" : "sample.pdf",
        mimeType: type === "image" ? "image/png" : "application/pdf",
        buffer: Buffer.from("data"),
      });
      await page.waitForFunction(() => window.uploadAbortFixture?.requests.length === 1);
      if (action === "close") await picker.getByRole("button", { name: "关闭" }).click();
      else
        await page.evaluate((action) => {
          const editor = window.__semloRequireFixture("uploadAbortFixture").database;
          if (action === "document") editor.setContent("<p>new content</p>");
          if (action === "readonly") editor.setEditable(false);
          if (action === "raw-readonly") editor.editor.setEditable(false);
          if (action === "destroy") editor.destroy();
        }, action);
      const aborted = await page.evaluate(() => {
        const fixture = window.__semloRequireFixture("uploadAbortFixture");
        const request = fixture.requests[0];
        request.reject(new Error("cancelled"));
        return request.signal?.aborted;
      });
      expect(aborted).toBe(true);
      await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
      expect(await page.evaluate(() => window.__semloRequireFixture("uploadAbortFixture").errors)).toEqual([]);
    });
  }
}

test("database upload abort can synchronously open a different popup", async ({ page }) => {
  const root = page.locator("#database-upload-abort .semlo-editor-database");
  await root.getByRole("button", { name: "添加列" }).click();
  const dialog = root.getByRole("dialog", { name: "新增列" });
  await dialog.getByLabel("数据表列名").fill("材料");
  await dialog.getByLabel("列类型").selectOption("attachment");
  await dialog.getByRole("button", { name: "确定" }).click();
  await root.getByLabel("第 1 行 材料").click();
  const picker = root.getByRole("dialog", { name: "材料 文件" });
  await picker
    .getByLabel("选择附件")
    .setInputFiles({ name: "sample.pdf", mimeType: "application/pdf", buffer: Buffer.from("data") });
  await page.waitForFunction(() => window.uploadAbortFixture?.requests.length === 1);
  await page.evaluate(() => {
    const request = window.__semloRequireFixture("uploadAbortFixture").requests[0];
    request.signal?.addEventListener(
      "abort",
      () => {
        document.querySelector<HTMLButtonElement>('#database-upload-abort button[aria-label="添加列"]')!.click();
      },
      { once: true },
    );
  });
  await picker.getByRole("button", { name: "关闭" }).click();
  await expect(root.getByRole("dialog", { name: "新增列" })).toBeVisible();
});
