import { expect, test } from "@rstest/playwright";

import { createDatabaseData, type DatabaseData } from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    databaseFilesEditor?: EditorController;
    resolveDatabaseUpload?: (url: string) => void;
  }
}

test("image and attachment fields upload through the host and preserve data and history", async ({ page }) => {
  const data = createDatabaseData();
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((initial) => Reflect.set(window, "databaseFilesContent", initial), content);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'database-files-test'
      document.body.prepend(host)
      window.databaseFilesEditor = createEditor({
        element: host, outline: false, content: window.databaseFilesContent,
        uploadImage: async file => '/uploads/' + encodeURIComponent(file.name),
        uploadAttachment: async file => '/files/' + encodeURIComponent(file.name),
        onError: error => { window.databaseFilesError = error.message },
      })
    `,
  });
  const root = page.locator("#database-files-test .semlo-editor-database");
  const read = async (): Promise<DatabaseData> =>
    page.evaluate(
      () =>
        window
          .__semloRequireFixture("databaseFilesEditor")
          .getSnapshot()
          .json.content?.find((node) => node.type === "semloEditorDatabase")?.attrs?.data as DatabaseData,
    );
  await root.getByRole("button", { name: "添加列" }).click();
  let dialog = root.getByRole("dialog", { name: "新增列" });
  await dialog.getByLabel("数据表列名").fill("照片");
  await dialog.getByLabel("列类型").selectOption("image");
  await dialog
    .getByLabel("选择图片")
    .setInputFiles({ name: "默认.png", mimeType: "image/png", buffer: Buffer.from("image") });
  await expect(dialog.getByRole("button", { name: "移除默认文件 默认.png" })).toBeVisible();
  await dialog.getByRole("button", { name: "确定" }).click();
  await expect(root.getByLabel("第 1 行 照片").locator("img")).toHaveCount(0);
  await root.getByRole("button", { name: "添加记录", exact: true }).click();
  await expect(root.getByLabel("第 4 行 照片").locator("img")).toHaveAttribute("alt", "默认.png");
  await root.getByRole("button", { name: "添加列" }).click();
  dialog = root.getByRole("dialog", { name: "新增列" });
  await dialog.getByLabel("数据表列名").fill("材料");
  await dialog.getByLabel("列类型").selectOption("attachment");
  await dialog.getByRole("button", { name: "确定" }).click();
  await root.getByLabel("第 1 行 材料").click();
  let picker = root.getByRole("dialog", { name: "材料 文件" });
  await picker
    .getByLabel("选择附件")
    .setInputFiles({ name: "报告.pdf", mimeType: "application/pdf", buffer: Buffer.from("pdf") });
  await expect(root.getByLabel("第 1 行 材料")).toContainText("报告.pdf");
  const saved = await read();
  const field = saved.fields.find((entry) => entry.name === "材料")!;
  expect(saved.records[0].values[field.id]).toEqual([
    expect.objectContaining({ name: "报告.pdf", url: "/files/%E6%8A%A5%E5%91%8A.pdf", size: 3 }),
  ]);
  expect(await page.evaluate(() => window.__semloRequireFixture("databaseFilesEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(root.getByLabel("第 1 行 材料")).not.toContainText("报告.pdf");
  expect(await page.evaluate(() => window.__semloRequireFixture("databaseFilesEditor").editor.commands.redo())).toBe(
    true,
  );
  await root.getByLabel("第 1 行 材料").click();
  picker = root.getByRole("dialog", { name: "材料 文件" });
  await expect(picker.getByRole("link", { name: "报告.pdf" })).toHaveAttribute("href", "/files/%E6%8A%A5%E5%91%8A.pdf");
  await picker.getByRole("button", { name: "删除文件 报告.pdf" }).click();
  await expect(root.getByLabel("第 1 行 材料")).not.toContainText("报告.pdf");
  expect(await page.evaluate(() => window.__semloRequireFixture("databaseFilesEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(root.getByLabel("第 1 行 材料")).toContainText("报告.pdf");
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("databaseFilesEditor").getSnapshot().json);
  await page.evaluate((value) => window.__semloRequireFixture("databaseFilesEditor").setContent(value), snapshot);
  await expect(root.getByLabel("第 1 行 材料")).toContainText("报告.pdf");
  await page.evaluate(() =>
    window
      .__semloRequireFixture("databaseFilesEditor")
      .setIntegrations({ uploadAttachment: async () => "javascript:alert(1)" }),
  );
  await root.getByLabel("第 1 行 材料").click();
  picker = root.getByRole("dialog", { name: "材料 文件" });
  await picker
    .getByLabel("选择附件")
    .setInputFiles({ name: "坏文件.pdf", mimeType: "application/pdf", buffer: Buffer.from("bad") });
  await expect(picker.getByRole("status")).toHaveText("上传失败");
  expect(await page.evaluate(() => Reflect.get(window, "databaseFilesError"))).toBe("上传返回的文件地址无效");
  await picker.getByRole("button", { name: "关闭" }).click();
  await page.evaluate(() =>
    window.__semloRequireFixture("databaseFilesEditor").setIntegrations({
      uploadAttachment: () => new Promise((resolve) => (window.resolveDatabaseUpload = resolve)),
    }),
  );
  await root.getByLabel("第 1 行 材料").click();
  picker = root.getByRole("dialog", { name: "材料 文件" });
  await picker
    .getByLabel("选择附件")
    .setInputFiles({ name: "迟到.pdf", mimeType: "application/pdf", buffer: Buffer.from("late") });
  await expect(picker.getByRole("status")).toHaveText("上传中…");
  const beforeReplacement = await page.evaluate(
    () => window.__semloRequireFixture("databaseFilesEditor").getSnapshot().json,
  );
  const replacement = structuredClone(beforeReplacement);
  replacement.content?.push({ type: "paragraph", content: [{ type: "text", text: "替换内容" }] });
  await page.evaluate((value) => window.__semloRequireFixture("databaseFilesEditor").setContent(value), replacement);
  const afterReplacement = await page.evaluate(
    () => window.__semloRequireFixture("databaseFilesEditor").getSnapshot().json,
  );
  await page.evaluate(() => window.__semloRequireFixture("resolveDatabaseUpload")("/late.pdf"));
  await expect(root.getByLabel("第 1 行 材料")).not.toContainText("迟到.pdf");
  expect(await page.evaluate(() => window.__semloRequireFixture("databaseFilesEditor").getSnapshot().json)).toEqual(
    afterReplacement,
  );
  await page.evaluate(() =>
    window
      .__semloRequireFixture("databaseFilesEditor")
      .setIntegrations({ uploadAttachment: async () => "/replacement.pdf" }),
  );
  await root.getByLabel("第 1 行 材料").click();
  picker = root.getByRole("dialog", { name: "材料 文件" });
  await picker
    .getByLabel("选择附件")
    .setInputFiles({ name: "新.pdf", mimeType: "application/pdf", buffer: Buffer.from("new") });
  await expect(root.getByLabel("第 1 行 材料")).toContainText("新.pdf");
  await root.getByLabel("第 1 行 材料").click();
  await expect(root.getByRole("dialog", { name: "材料 文件" }).getByRole("link", { name: "新.pdf" })).toHaveAttribute(
    "href",
    "/replacement.pdf",
  );
  await root.getByRole("dialog", { name: "材料 文件" }).getByRole("button", { name: "关闭" }).click();
  await page.evaluate(() =>
    window
      .__semloRequireFixture("databaseFilesEditor")
      .setIntegrations({ uploadImage: async () => "/replacement.png" }),
  );
  await root.getByLabel("第 1 行 照片").click();
  await root
    .getByRole("dialog", { name: "照片 文件" })
    .getByLabel("选择图片")
    .setInputFiles({
      name: "替换.png",
      mimeType: "image/png",
      buffer: Buffer.from("image"),
    });
  await expect(root.getByLabel("第 1 行 照片").locator("img")).toHaveAttribute("src", "/replacement.png");
  const html = await page.evaluate(() => window.__semloRequireFixture("databaseFilesEditor").getSnapshot().html);
  await page.evaluate((value) => window.__semloRequireFixture("databaseFilesEditor").setContent(value), html);
  await expect(root.getByLabel("第 1 行 照片").locator("img")).toHaveAttribute("src", "/replacement.png");
  await expect(root.getByLabel("第 1 行 材料")).toContainText("新.pdf");
  await page.evaluate(() => window.__semloRequireFixture("databaseFilesEditor").setIntegrations({}));
  await root.getByLabel("第 1 行 照片").click();
  picker = root.getByRole("dialog", { name: "照片 文件" });
  await picker
    .getByLabel("选择图片")
    .setInputFiles({ name: "无服务.png", mimeType: "image/png", buffer: Buffer.from("image") });
  await expect(picker.getByRole("status")).toHaveText("请先配置图片上传");
  await picker.getByRole("button", { name: "关闭" }).click();
  await page.evaluate(() =>
    window.__semloRequireFixture("databaseFilesEditor").setIntegrations({
      uploadImage: async () => "/dropped.png",
      uploadAttachment: async () => "/pasted.pdf",
    }),
  );
  await root.getByLabel("第 1 行 照片").click();
  picker = root.getByRole("dialog", { name: "照片 文件" });
  await picker.getByRole("group", { name: "粘贴或拖拽图片" }).evaluate((zone) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["image"], "拖拽.png", { type: "image/png" }));
    zone.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await expect(root.getByLabel("第 1 行 照片").locator("img")).toHaveCount(2);
  await root.getByLabel("第 1 行 材料").click();
  picker = root.getByRole("dialog", { name: "材料 文件" });
  await picker.getByRole("group", { name: "粘贴或拖拽附件" }).evaluate((zone) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["pdf"], "粘贴.pdf", { type: "application/pdf" }));
    zone.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
  });
  await expect(root.getByLabel("第 1 行 材料")).toContainText("粘贴.pdf");
});
