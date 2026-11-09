import { expect, test } from "@rstest/playwright";

import type { EditorContent } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    imageControlledResolve?: (url: string) => void;
    imageControlledReject?: (error: Error) => void;
    imageControlledUpload?: (file: File) => Promise<string>;
  }
}

const original: EditorContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "image", attrs: { src: "/tests/sample-image.svg", alt: "原图", width: 300, height: 130 } }],
    },
  ],
};

for (const framework of ["react", "vue", "solid"] as const) {
  for (const replacementKind of ["image", "surrounding"] as const) {
    test(`${framework} keeps an unfinished size draft through equal content but closes it on ${replacementKind} replacement`, async ({
      page,
    }) => {
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
      const image = host.locator(".semlo-editor-image-frame img");
      await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(600);
      await image.click();
      await host.getByRole("button", { name: "图片尺寸" }).click();
      const panel = host.locator(".semlo-editor-image-size-panel");
      await panel.getByLabel("图片宽度").fill("420");
      const before = await page.evaluate(
        () => window.__semloRequireFixture("dynamicEditor").controller.getSnapshot().json,
      );
      await page.evaluate(async (content) => {
        const editor = window.__semloRequireFixture("dynamicEditor");
        editor.setIntegrations({ content: structuredClone(content) } as never);
        await (editor as unknown as { settle(): Promise<void> }).settle();
      }, before);
      await expect(panel).toBeVisible();
      await expect(panel.getByLabel("图片宽度")).toHaveValue("420");
      expect(
        await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").controller.getSnapshot().json),
      ).toEqual(before);
      const replacement: EditorContent = structuredClone(original);
      if (replacementKind === "image") {
        const attrs = replacement.content![0].content![0].attrs!;
        attrs.alt = "外部替换";
        attrs.width = 320;
      } else replacement.content![0].content!.push({ type: "text", text: "外部内容" });
      await page.evaluate(async (content) => {
        const editor = window.__semloRequireFixture("dynamicEditor");
        editor.setIntegrations({ content } as never);
        await (editor as unknown as { settle(): Promise<void> }).settle();
      }, replacement);
      await expect(panel).toBeHidden();
      const after = await page.evaluate(
        () => window.__semloRequireFixture("dynamicEditor").controller.getSnapshot().json,
      );
      expect(after.content?.[0].content?.[0].attrs).toMatchObject(
        replacementKind === "image" ? { alt: "外部替换", width: 320 } : { alt: "原图", width: 300 },
      );
      await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").destroy());
    });
  }

  test(`${framework} does not commit an unfinished caption composition to a replacement image`, async ({ page }) => {
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
    const image = host.locator(".semlo-editor-image-frame img");
    await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(600);
    await image.click();
    await host.getByRole("button", { name: "图片描述" }).click();
    const caption = host.getByRole("textbox", { name: "图片描述内容" });
    const before = await page.evaluate(
      () => window.__semloRequireFixture("dynamicEditor").controller.getSnapshot().json,
    );
    await caption.evaluate((element) => {
      const input = element as HTMLTextAreaElement;
      input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      input.value = "未完成输入";
      input.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));
    });
    await page.evaluate(async (content) => {
      const editor = window.__semloRequireFixture("dynamicEditor");
      editor.setIntegrations({ content: structuredClone(content) } as never);
      await (editor as unknown as { settle(): Promise<void> }).settle();
    }, before);
    await expect(caption).toHaveValue("未完成输入");
    expect(
      await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").controller.getSnapshot().json),
    ).toEqual(before);
    const replacement: EditorContent = structuredClone(original);
    replacement.content![0].content![0].attrs!.alt = "外部替换";
    await page.evaluate(async (content) => {
      const editor = window.__semloRequireFixture("dynamicEditor");
      editor.setIntegrations({ content } as never);
      await (editor as unknown as { settle(): Promise<void> }).settle();
    }, replacement);
    const replaced = await page.evaluate(
      () => window.__semloRequireFixture("dynamicEditor").controller.getSnapshot().json,
    );
    await host.locator(".semlo-editor-image-caption-input").dispatchEvent("compositionend", { bubbles: true });
    expect(
      await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").controller.getSnapshot().json),
    ).toEqual(replaced);
    expect(replaced.content?.[0].content?.[0].attrs).toMatchObject({ alt: "外部替换", semloEditorCaption: "" });
    await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").destroy());
  });

  test(`${framework} ignores a pending image upload after controlled document replacement`, async ({ page }) => {
    await installFixtureGuards(page);
    await page.goto(`${process.env.SEMLO_TEST_ORIGIN!}/tests/controlled.html`);
    await page.evaluate(async (name) => {
      await window.__semloRequireFixture("mountDynamicEditor").bind(window)(name);
      window.imageControlledUpload = () => new Promise((resolve) => (window.imageControlledResolve = resolve));
      const editor = window.__semloRequireFixture("dynamicEditor");
      editor.setIntegrations({ content: "<p></p>", uploadImage: window.imageControlledUpload } as never);
      await (editor as unknown as { settle(): Promise<void> }).settle();
      const transfer = new DataTransfer();
      transfer.items.add(new File(["image"], "pending.png", { type: "image/png" }));
      editor.controller.editor.view.dom.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
    }, framework);
    await page.waitForFunction(() => Boolean(window.imageControlledResolve));
    await page.evaluate(async () => {
      const editor = window.__semloRequireFixture("dynamicEditor");
      editor.setIntegrations({ content: "<p>外部替换</p>", uploadImage: window.imageControlledUpload } as never);
      await (editor as unknown as { settle(): Promise<void> }).settle();
      window.imageControlledResolve!("/tests/sample-image.svg?late");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const host = page.locator("#dynamic-editor");
    await expect(host.locator(".semlo-editor-prose")).toHaveText("外部替换");
    await expect(host.locator(".semlo-editor-image-node")).toHaveCount(0);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").errors),
      JSON.stringify(
        await page.evaluate(
          () => (window as unknown as { __debugIntegrationErrors?: string[] }).__debugIntegrationErrors,
        ),
      ),
    ).toEqual([]);
    await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").destroy());
  });

  test(`${framework} ignores a late image upload failure after the editor is unmounted`, async ({ page }) => {
    await installFixtureGuards(page);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`${process.env.SEMLO_TEST_ORIGIN!}/tests/controlled.html`);
    await page.evaluate(async (name) => {
      await window.__semloRequireFixture("mountDynamicEditor").bind(window)(name);
      window.imageControlledUpload = () => new Promise((_resolve, reject) => (window.imageControlledReject = reject));
      const editor = window.__semloRequireFixture("dynamicEditor");
      editor.setIntegrations({ content: "<p></p>", uploadImage: window.imageControlledUpload } as never);
      await (editor as unknown as { settle(): Promise<void> }).settle();
      const transfer = new DataTransfer();
      transfer.items.add(new File(["image"], "pending.png", { type: "image/png" }));
      editor.controller.editor.view.dom.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
    }, framework);
    await page.waitForFunction(() => Boolean(window.imageControlledReject));
    await page.evaluate(async () => {
      window.__semloRequireFixture("dynamicEditor").destroy();
      window.imageControlledReject!(new Error("迟到失败"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await expect(page.locator("#dynamic-editor")).toHaveCount(0);
    expect(pageErrors).toEqual([]);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").errors),
      JSON.stringify(
        await page.evaluate(
          () => (window as unknown as { __debugIntegrationErrors?: string[] }).__debugIntegrationErrors,
        ),
      ),
    ).toEqual([]);
  });
}
