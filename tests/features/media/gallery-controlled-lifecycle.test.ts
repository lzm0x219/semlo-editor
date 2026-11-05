import { expect, test } from "@rstest/playwright";

import type { EditorContent } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    galleryControlledResolve?: (url: string) => void;
    galleryControlledUpload?: (file: File) => Promise<string>;
  }
}

const original: EditorContent = {
  type: "doc",
  content: [
    {
      type: "semloEditorGallery",
      attrs: {
        data: {
          id: "controlled-gallery",
          layout: "grid",
          images: [{ id: "one", src: "/tests/sample-image.svg", title: "原图", href: "" }],
        },
      },
    },
    { type: "paragraph" },
  ],
};

for (const framework of ["react", "vue", "solid"] as const) {
  test(`${framework} preserves an open gallery draft on an equivalent echo and discards it on replacement`, async ({
    page,
  }) => {
    await installFixtureGuards(page);
    await page.goto(`${process.env.SEMLO_TEST_ORIGIN!}/tests/controlled.html`);
    await page.evaluate(
      async ({ name, content }) => {
        await window.__semloRequireFixture("mountDynamicEditor").bind(window)(name);
        window.galleryControlledUpload = () => new Promise((resolve) => (window.galleryControlledResolve = resolve));
        const editor = window.__semloRequireFixture("dynamicEditor");
        editor.setIntegrations({ content, uploadImage: window.galleryControlledUpload } as never);
        await (editor as unknown as { settle(): Promise<void> }).settle();
      },
      { name: framework, content: original },
    );
    const host = page.locator("#dynamic-editor");
    await host.locator(".semlo-editor-gallery-surface").click({ position: { x: 5, y: 5 } });
    await host.getByRole("button", { name: "编辑图册" }).click();
    const panel = page.getByRole("dialog", { name: "图册设置" });
    await panel.getByLabel("标题（图片一）").fill("尚未提交");
    const before = await page.evaluate(
      () => window.__semloRequireFixture("dynamicEditor").controller.getSnapshot().json,
    );
    await page.evaluate(async (content) => {
      const editor = window.__semloRequireFixture("dynamicEditor");
      editor.setIntegrations({
        content: structuredClone(content),
        uploadImage: window.galleryControlledUpload,
      } as never);
      await (editor as unknown as { settle(): Promise<void> }).settle();
    }, before);
    await expect(panel).toBeVisible();
    await expect(panel.getByLabel("标题（图片一）")).toHaveValue("尚未提交");
    expect(
      await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").controller.getSnapshot().json),
    ).toEqual(before);

    await panel.locator('input[aria-label="选择图片文件"]').setInputFiles({
      name: "pending.png",
      mimeType: "image/png",
      buffer: Buffer.from("fixture"),
    });
    await expect(panel.getByRole("button", { name: "确定", exact: true })).toBeDisabled();
    await page.waitForFunction(() => Boolean(window.galleryControlledResolve));
    const replacement: EditorContent = structuredClone(original);
    (replacement.content![0].attrs!.data as { images: Array<{ title: string }> }).images[0].title = "外部替换";
    await page.evaluate(async (content) => {
      const editor = window.__semloRequireFixture("dynamicEditor");
      editor.setIntegrations({ content, uploadImage: window.galleryControlledUpload } as never);
      await (editor as unknown as { settle(): Promise<void> }).settle();
    }, replacement);
    await expect(panel).toHaveCount(0);
    const replaced = await page.evaluate(
      () => window.__semloRequireFixture("dynamicEditor").controller.getSnapshot().json,
    );
    await page.evaluate(async () => {
      window.galleryControlledResolve!("/tests/sample-image.svg?late");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(
      await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").controller.getSnapshot().json),
    ).toEqual(replaced);
    const gallery = replaced.content?.[0].attrs?.data as { images: Array<{ title: string }> };
    expect(gallery.images.map((image) => image.title)).toEqual(["外部替换"]);
    await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").destroy());
  });

  test(`${framework} keeps gallery undo and redo after a controlled echo of a committed draft`, async ({ page }) => {
    await installFixtureGuards(page);
    await page.goto(`${process.env.SEMLO_TEST_ORIGIN!}/tests/controlled.html`);
    await page.evaluate(
      async ({ name, content }) => {
        await window.__semloRequireFixture("mountDynamicEditor").bind(window)(name);
        const editor = window.__semloRequireFixture("dynamicEditor");
        editor.setIntegrations({ content } as never);
        await (editor as unknown as { settle(): Promise<void> }).settle();
      },
      { name: framework, content: original },
    );
    const host = page.locator("#dynamic-editor");
    await host.locator(".semlo-editor-gallery-surface").click({ position: { x: 5, y: 5 } });
    await host.getByRole("button", { name: "编辑图册" }).click();
    const panel = page.getByRole("dialog", { name: "图册设置" });
    await panel.getByLabel("标题（图片一）").fill("已提交");
    await panel.getByRole("button", { name: "确定", exact: true }).click();
    const saved = await page.evaluate(
      () => window.__semloRequireFixture("dynamicEditor").controller.getSnapshot().json,
    );
    const savedGallery = saved.content?.[0].attrs?.data as { images: Array<{ title: string }> };
    expect(savedGallery.images[0].title).toBe("已提交");
    await page.evaluate(async (content) => {
      const editor = window.__semloRequireFixture("dynamicEditor");
      editor.setIntegrations({ content: structuredClone(content) } as never);
      await (editor as unknown as { settle(): Promise<void> }).settle();
    }, saved);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").controller.editor.commands.undo()),
    ).toBe(true);
    const undone = await page.evaluate(
      () => window.__semloRequireFixture("dynamicEditor").controller.getSnapshot().json,
    );
    const undoneGallery = undone.content?.[0].attrs?.data as { images: Array<{ title: string }> } | undefined;
    expect(undoneGallery?.images[0]?.title).toBe("原图");
    expect(
      await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").controller.editor.commands.redo()),
    ).toBe(true);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").controller.getSnapshot().json),
    ).toEqual(saved);
    await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").destroy());
  });

  test(`${framework} discards a gallery draft when the surrounding document is replaced`, async ({ page }) => {
    await installFixtureGuards(page);
    await page.goto(`${process.env.SEMLO_TEST_ORIGIN!}/tests/controlled.html`);
    await page.evaluate(
      async ({ name, content }) => {
        await window.__semloRequireFixture("mountDynamicEditor").bind(window)(name);
        window.galleryControlledUpload = () => new Promise((resolve) => (window.galleryControlledResolve = resolve));
        const editor = window.__semloRequireFixture("dynamicEditor");
        editor.setIntegrations({ content, uploadImage: window.galleryControlledUpload } as never);
        await (editor as unknown as { settle(): Promise<void> }).settle();
      },
      { name: framework, content: original },
    );
    const host = page.locator("#dynamic-editor");
    await host.locator(".semlo-editor-gallery-surface").click({ position: { x: 5, y: 5 } });
    await host.getByRole("button", { name: "编辑图册" }).click();
    const panel = page.getByRole("dialog", { name: "图册设置" });
    await panel.getByLabel("标题（图片一）").fill("旧草稿");
    await panel.locator('input[aria-label="选择图片文件"]').setInputFiles({
      name: "pending.png",
      mimeType: "image/png",
      buffer: Buffer.from("fixture"),
    });
    await page.waitForFunction(() => Boolean(window.galleryControlledResolve));
    const replacement: EditorContent = structuredClone(original);
    replacement.content![1].content = [{ type: "text", text: "外部段落" }];
    await page.evaluate(async (content) => {
      const editor = window.__semloRequireFixture("dynamicEditor");
      editor.setIntegrations({ content, uploadImage: window.galleryControlledUpload } as never);
      await (editor as unknown as { settle(): Promise<void> }).settle();
    }, replacement);
    await expect(panel).toHaveCount(0);
    const replaced = await page.evaluate(
      () => window.__semloRequireFixture("dynamicEditor").controller.getSnapshot().json,
    );
    await page.evaluate(async () => {
      window.galleryControlledResolve!("/tests/sample-image.svg?late");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(
      await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").controller.getSnapshot().json),
    ).toEqual(replaced);
    expect(replaced.content?.[1].content?.[0].text).toBe("外部段落");
    const gallery = replaced.content?.[0].attrs?.data as { images: Array<{ title: string }> };
    expect(gallery.images.map((image) => image.title)).toEqual(["原图"]);
    await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").destroy());
  });

  test(`${framework} keeps a direct upload through an equal echo but cancels it on document replacement`, async ({
    page,
  }) => {
    await installFixtureGuards(page);
    await page.goto(`${process.env.SEMLO_TEST_ORIGIN!}/tests/controlled.html`);
    await page.evaluate(
      async ({ name, content }) => {
        await window.__semloRequireFixture("mountDynamicEditor").bind(window)(name);
        window.galleryControlledUpload = () => new Promise((resolve) => (window.galleryControlledResolve = resolve));
        const editor = window.__semloRequireFixture("dynamicEditor");
        editor.setIntegrations({ content, uploadImage: window.galleryControlledUpload } as never);
        await (editor as unknown as { settle(): Promise<void> }).settle();
      },
      { name: framework, content: original },
    );
    const host = page.locator("#dynamic-editor");
    const input = host.locator('input[aria-label="选择图册图片"]');
    const file = { name: "pending.png", mimeType: "image/png", buffer: Buffer.from("fixture") };
    await input.setInputFiles(file);
    await page.waitForFunction(() => Boolean(window.galleryControlledResolve));
    const initial = await page.evaluate(
      () => window.__semloRequireFixture("dynamicEditor").controller.getSnapshot().json,
    );
    await page.evaluate(async (content) => {
      const editor = window.__semloRequireFixture("dynamicEditor");
      editor.setIntegrations({
        content: structuredClone(content),
        uploadImage: window.galleryControlledUpload,
      } as never);
      await (editor as unknown as { settle(): Promise<void> }).settle();
      window.galleryControlledResolve!("/tests/sample-image.svg?first");
    }, initial);
    await expect(host.locator(".semlo-editor-gallery-grid img")).toHaveCount(2);
    const withFirst = await page.evaluate(
      () => window.__semloRequireFixture("dynamicEditor").controller.getSnapshot().json,
    );
    await page.evaluate(() => (window.galleryControlledResolve = undefined));
    await input.setInputFiles(file);
    await page.waitForFunction(() => Boolean(window.galleryControlledResolve));
    const replacement = structuredClone(withFirst);
    replacement.content![1].content = [{ type: "text", text: "外部段落" }];
    await page.evaluate(async (content) => {
      const editor = window.__semloRequireFixture("dynamicEditor");
      editor.setIntegrations({ content, uploadImage: window.galleryControlledUpload } as never);
      await (editor as unknown as { settle(): Promise<void> }).settle();
      window.galleryControlledResolve!("/tests/sample-image.svg?late");
      await new Promise((resolve) => setTimeout(resolve, 0));
    }, replacement);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").controller.getSnapshot().json),
    ).toEqual(replacement);
    await expect(host.locator(".semlo-editor-gallery-grid img")).toHaveCount(2);
    await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").destroy());
  });

  test(`${framework} unmounting a gallery with a pending upload closes its draft and ignores late completion`, async ({
    page,
  }) => {
    await installFixtureGuards(page);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`${process.env.SEMLO_TEST_ORIGIN!}/tests/controlled.html`);
    await page.evaluate(
      async ({ name, content }) => {
        await window.__semloRequireFixture("mountDynamicEditor").bind(window)(name);
        window.galleryControlledUpload = () => new Promise((resolve) => (window.galleryControlledResolve = resolve));
        const editor = window.__semloRequireFixture("dynamicEditor");
        editor.setIntegrations({ content, uploadImage: window.galleryControlledUpload } as never);
        await (editor as unknown as { settle(): Promise<void> }).settle();
      },
      { name: framework, content: original },
    );
    const host = page.locator("#dynamic-editor");
    await host.locator(".semlo-editor-gallery-surface").click({ position: { x: 5, y: 5 } });
    await host.getByRole("button", { name: "编辑图册" }).click();
    const panel = page.getByRole("dialog", { name: "图册设置" });
    await panel.getByLabel("标题（图片一）").fill("不应保存");
    await panel.locator('input[aria-label="选择图片文件"]').setInputFiles({
      name: "pending.png",
      mimeType: "image/png",
      buffer: Buffer.from("fixture"),
    });
    await page.waitForFunction(() => Boolean(window.galleryControlledResolve));
    await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").destroy());
    await expect(panel).toHaveCount(0);
    await page.evaluate(async () => {
      window.galleryControlledResolve!("/tests/sample-image.svg?late");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await expect(host).toHaveCount(0);
    expect(pageErrors).toEqual([]);
    expect(await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").errors)).toEqual([]);
  });
}
