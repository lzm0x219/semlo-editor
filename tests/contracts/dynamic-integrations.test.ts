import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController, EditorOptions, MentionItem } from "../../packages/core/src/types";
import { installFixtureGuards } from "../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

type Integrations = Pick<EditorOptions, "content" | "uploadImage" | "uploadAttachment" | "searchMentions">;
type Framework = "react" | "vue" | "solid";

declare global {
  interface Window {
    mountDynamicEditor?(framework: Framework): Promise<void>;
    dynamicEditor?: {
      controller: EditorController;
      setIntegrations(integrations: Integrations): void;
      errors: string[];
      settle(): Promise<void>;
      destroy(): void;
    };
    dynamicProviders?: Record<string, Integrations>;
    dynamicCalls?: string[];
    dynamicSearches?: Array<{ signal: AbortSignal; resolve: (items: MentionItem[]) => void }>;
    dynamicSearchSettled?: boolean;
    dynamicUploads?: Array<{ name: string; resolve: (url: string) => void }>;
    dynamicUploadsSettled?: string[];
    reentrantEditor?: EditorController;
    reentrantChanges?: number;
  }
}

test("updating mention search inside onChange refreshes safely and can be destroyed", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'reentrant-editor'
      document.body.prepend(host)
      window.reentrantChanges = 0
      const currentSearch = () => [{ id: 'new', label: '新用户', kind: 'person' }]
      window.reentrantEditor = createEditor({
        element: host,
        content: '<p></p>',
        searchMentions: () => [{ id: 'old', label: '旧用户', kind: 'person' }],
        onChange: () => {
          window.reentrantChanges++
          window.reentrantEditor.setIntegrations({ searchMentions: currentSearch })
        },
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.reentrantEditor));
  await page.locator("#reentrant-editor .semlo-editor-prose p").click();
  await page.keyboard.type("@");
  const menu = page.getByRole("listbox", { name: "提及" });
  await expect(menu.getByRole("option", { name: "新用户" })).toBeVisible();
  await expect(menu.getByRole("option", { name: "旧用户" })).toHaveCount(0);
  expect(await page.evaluate(() => window.reentrantChanges)).toBeGreaterThan(0);

  await page.evaluate(async () => {
    window.__semloRequireFixture("reentrantEditor").setIntegrations({
      searchMentions: () => [{ id: "later", label: "后续用户", kind: "person" }],
    });
    window.__semloRequireFixture("reentrantEditor").destroy();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
  });
  await expect(menu).toHaveCount(0);
  expect(errors).toEqual([]);
});

async function mount(page: Page, framework: Framework) {
  await page.goto(`${process.env.SEMLO_TEST_ORIGIN}/tests/controlled.html`);
  await page.evaluate((name) => window.__semloRequireFixture("mountDynamicEditor").bind(window)(name), framework);
  await page.evaluate(() => {
    window.dynamicCalls = [];
    window.dynamicSearches = [];
    window.dynamicSearchSettled = false;
    window.dynamicProviders = Object.fromEntries(
      ["甲", "乙"].map((label) => [
        label,
        {
          uploadImage: async (file: File) => {
            window.__semloRequireFixture("dynamicCalls").push(`image:${label}:${file.name}`);
            return URL.createObjectURL(file);
          },
          uploadAttachment: async (file: File) => {
            window.__semloRequireFixture("dynamicCalls").push(`attachment:${label}:${file.name}`);
            return URL.createObjectURL(file);
          },
          searchMentions: () => [{ id: label, label: `${label}用户`, kind: "person" as const }],
        },
      ]),
    );
    window.__semloRequireFixture("dynamicProviders").pending = {
      ...window.__semloRequireFixture("dynamicProviders").甲,
      searchMentions: async (_query, signal) => {
        const result = await new Promise<MentionItem[]>((resolve) =>
          window.__semloRequireFixture("dynamicSearches").push({ signal, resolve }),
        );
        window.dynamicSearchSettled = true;
        return result;
      },
    };
  });
  return page.locator("#dynamic-editor");
}

async function pasteImage(page: Page, name: string) {
  await page.evaluate((filename) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["image"], filename, { type: "image/png" }));
    window
      .__semloRequireFixture("dynamicEditor")
      .controller.editor.view.dom.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
  }, name);
}

for (const framework of ["react", "vue", "solid"] as const) {
  test(`${framework} applies added, replaced and removed integration callbacks`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const host = await mount(page, framework);
    const prose = host.locator(".semlo-editor-prose");
    const mention = page.getByRole("listbox", { name: "提及" });
    await prose.locator("p").first().click();
    await page.keyboard.type("@");
    await expect(mention.getByText("未配置提及搜索")).toBeVisible();

    await page.evaluate(() =>
      window
        .__semloRequireFixture("dynamicEditor")
        .setIntegrations(window.__semloRequireFixture("dynamicProviders").甲),
    );
    await expect(mention.getByRole("option", { name: "甲用户" })).toBeVisible();
    await page.evaluate(() =>
      window
        .__semloRequireFixture("dynamicEditor")
        .setIntegrations(window.__semloRequireFixture("dynamicProviders").乙),
    );
    await expect(mention.getByRole("option", { name: "乙用户" })).toBeVisible();
    await expect(mention.getByRole("option", { name: "甲用户" })).toHaveCount(0);

    await page.evaluate(() =>
      window
        .__semloRequireFixture("dynamicEditor")
        .setIntegrations(window.__semloRequireFixture("dynamicProviders").pending),
    );
    await page.waitForFunction(() => window.__semloRequireFixture("dynamicSearches").length > 0);
    await page.evaluate(() =>
      window
        .__semloRequireFixture("dynamicEditor")
        .setIntegrations(window.__semloRequireFixture("dynamicProviders").甲),
    );
    await expect(mention.getByRole("option", { name: "甲用户" })).toBeVisible();
    expect(await page.evaluate(() => window.__semloRequireFixture("dynamicSearches")[0].signal.aborted)).toBe(true);
    await page.evaluate(() =>
      window.__semloRequireFixture("dynamicSearches")[0].resolve([{ id: "stale", label: "旧用户", kind: "person" }]),
    );
    await page.waitForFunction(() => window.dynamicSearchSettled);
    await expect(mention.getByRole("option", { name: "旧用户" })).toHaveCount(0);
    await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").setIntegrations({}));
    await expect(mention.getByText("未配置提及搜索")).toBeVisible();
    await page.keyboard.press("Escape");

    await host.getByRole("button", { name: "插入内容" }).click();
    await page
      .getByRole("dialog", { name: "插入内容" })
      .locator('.semlo-editor-card-item[data-command="image"]')
      .click();
    const imageForm = page.getByRole("dialog", { name: "插入图片" });
    await imageForm.getByLabel("图片地址").fill("https://example.com/example.png");
    await expect(imageForm.getByRole("button", { name: "上传图片" })).toHaveCount(0);
    await page.evaluate(() =>
      window
        .__semloRequireFixture("dynamicEditor")
        .setIntegrations(window.__semloRequireFixture("dynamicProviders").甲),
    );
    await expect(imageForm.getByRole("button", { name: "上传图片" })).toBeVisible();
    await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").setIntegrations({}));
    await expect(imageForm.getByRole("button", { name: "上传图片" })).toHaveCount(0);
    await expect(imageForm.getByLabel("图片地址")).toHaveValue("https://example.com/example.png");
    await imageForm.getByRole("button", { name: "取消" }).click();

    await host.locator('input[type="file"][multiple]').setInputFiles({
      name: "missing.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("missing"),
    });
    await expect(host.getByRole("alert")).toHaveText("请先配置附件上传");
    await expect(host.locator(".semlo-editor-attachment")).toHaveCount(0);

    await page.evaluate(() =>
      window
        .__semloRequireFixture("dynamicEditor")
        .setIntegrations(window.__semloRequireFixture("dynamicProviders").甲),
    );
    await prose.locator("p").first().click();
    await page.keyboard.press("End");
    await page.keyboard.type(" @");
    await expect(mention.getByRole("option", { name: "甲用户" })).toBeVisible();
    await page.keyboard.press("Escape");
    await pasteImage(page, "a.png");
    await host.locator('input[type="file"][multiple]').setInputFiles({
      name: "a.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("a"),
    });
    await expect(host.locator(".semlo-editor-image-node")).toHaveCount(1);
    await expect(host.locator(".semlo-editor-attachment")).toHaveCount(1);

    await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").controller.setContent("<p></p>"));
    await prose.locator("p").first().click();
    await page.keyboard.type("@");
    await page.evaluate(() =>
      window
        .__semloRequireFixture("dynamicEditor")
        .setIntegrations(window.__semloRequireFixture("dynamicProviders").乙),
    );
    await expect(mention.getByRole("option", { name: "乙用户" })).toBeVisible();
    await page.keyboard.press("Escape");
    await pasteImage(page, "b.png");
    await host.locator('input[type="file"][multiple]').setInputFiles({
      name: "b.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("b"),
    });
    await expect(host.locator(".semlo-editor-image-node")).toHaveCount(1);
    await expect(host.locator(".semlo-editor-attachment")).toHaveCount(1);
    expect(await page.evaluate(() => window.dynamicCalls)).toEqual([
      "image:甲:a.png",
      "attachment:甲:a.txt",
      "image:乙:b.png",
      "attachment:乙:b.txt",
    ]);

    await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").setIntegrations({}));
    await host.getByRole("button", { name: "插入内容" }).click();
    await page
      .getByRole("dialog", { name: "插入内容" })
      .locator('.semlo-editor-card-item[data-command="attachment"]')
      .click();
    await expect(host.getByRole("alert")).toHaveText("请先配置附件上传");
    expect(errors).toEqual([]);
    await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").destroy());
  });

  test(`${framework} drops pending uploads when made read-only or destroyed`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const host = await mount(page, framework);
    await page.evaluate(() => {
      window.dynamicUploads = [];
      window.dynamicUploadsSettled = [];
      const pendingUpload = async (file: File) => {
        const url = await new Promise<string>((resolve) =>
          window.__semloRequireFixture("dynamicUploads").push({ name: file.name, resolve }),
        );
        window.__semloRequireFixture("dynamicUploadsSettled").push(file.name);
        return url;
      };
      window.__semloRequireFixture("dynamicProviders").uploadPending = {
        uploadImage: pendingUpload,
        uploadAttachment: pendingUpload,
        searchMentions: () => [{ id: "pending", label: "等待上传", kind: "person" }],
      };
      window.__semloRequireFixture("dynamicEditor").setIntegrations({
        ...window.__semloRequireFixture("dynamicProviders").uploadPending,
      });
    });
    await host.getByRole("button", { name: "插入内容" }).click();
    await page
      .getByRole("dialog", { name: "插入内容" })
      .locator('.semlo-editor-card-item[data-command="image"]')
      .click();
    const form = page.getByRole("dialog", { name: "插入图片" });
    await expect(form.getByRole("button", { name: "上传图片" })).toBeVisible();
    await form.getByRole("button", { name: "取消" }).click();

    await pasteImage(page, "original.png");
    await page.waitForFunction(() => window.__semloRequireFixture("dynamicUploads").length === 1);
    await page.evaluate(() =>
      window
        .__semloRequireFixture("dynamicEditor")
        .setIntegrations(window.__semloRequireFixture("dynamicProviders").乙),
    );
    await host.locator(".semlo-editor-prose p").first().click();
    await page.keyboard.type("@");
    await expect(page.getByRole("listbox", { name: "提及" }).getByRole("option", { name: "乙用户" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.evaluate(() =>
      window.__semloRequireFixture("dynamicUploads")[0].resolve("https://example.com/original.png"),
    );
    await expect(host.locator(".semlo-editor-image-node")).toHaveCount(1);
    await page.evaluate(() => {
      window.__semloRequireFixture("dynamicEditor").controller.setContent("<p></p>");
      window
        .__semloRequireFixture("dynamicEditor")
        .setIntegrations(window.__semloRequireFixture("dynamicProviders").uploadPending);
    });
    await host.locator(".semlo-editor-prose p").first().click();
    await page.keyboard.type("@");
    await expect(page.getByRole("listbox", { name: "提及" }).getByRole("option", { name: "等待上传" })).toBeVisible();
    await page.keyboard.press("Escape");
    await host.getByRole("button", { name: "插入内容" }).click();
    await page
      .getByRole("dialog", { name: "插入内容" })
      .locator('.semlo-editor-card-item[data-command="image"]')
      .click();
    await expect(form.getByRole("button", { name: "上传图片" })).toBeVisible();
    await form.getByRole("button", { name: "取消" }).click();
    await pasteImage(page, "pending.png");
    await host.locator('input[type="file"][multiple]').setInputFiles({
      name: "pending.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("pending"),
    });
    await page.waitForFunction(() => window.__semloRequireFixture("dynamicUploads").length === 3);
    await page.evaluate(() => {
      window.__semloRequireFixture("dynamicEditor").controller.setEditable(false);
      window
        .__semloRequireFixture("dynamicUploads")
        .forEach((upload) => upload.resolve(`https://example.com/${upload.name}`));
    });
    await page.waitForFunction(() => window.__semloRequireFixture("dynamicUploadsSettled").includes("pending.txt"));
    await expect(host.locator(".semlo-editor-uploading")).toHaveCount(0);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").controller.getSnapshot().html),
    ).not.toContain("pending");

    await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").controller.setEditable(true));
    await pasteImage(page, "destroyed.png");
    await page.waitForFunction(() => window.__semloRequireFixture("dynamicUploads").length === 4);
    await page.evaluate(() => {
      window.__semloRequireFixture("dynamicEditor").destroy();
      window.__semloRequireFixture("dynamicUploads")[3].resolve("https://example.com/destroyed.png");
    });
    await page.waitForFunction(() => window.__semloRequireFixture("dynamicUploadsSettled").includes("destroyed.png"));
    await expect(host).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
