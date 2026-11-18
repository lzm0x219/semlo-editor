import { expect, test } from "@rstest/playwright";

import { appendText, chooseExample, useDocsHome } from "../fixtures/docs/docs-home-helpers";

const openHome = useDocsHome();

test("示例分别保留草稿，恢复前可以取消或确认", async ({ page }) => {
  const editor = await openHome(page);
  await appendText(page, "起始草稿");
  await chooseExample(page, "公式与绘图");
  await appendText(page, "公式草稿");
  await chooseExample(page, "数据表");
  await page.getByLabel("第 1 行 事项").fill("数据表草稿");
  await chooseExample(page, "开始写作");
  await expect(editor).toContainText("起始草稿");
  await chooseExample(page, "数据表");
  await expect(page.getByLabel("第 1 行 事项")).toHaveValue("数据表草稿");
  await chooseExample(page, "公式与绘图");
  await expect(editor).toContainText("公式草稿");

  await chooseExample(page, "公式与绘图");
  await expect(editor).toContainText("公式草稿");
  await page.getByRole("button", { name: "恢复示例" }).click();
  const confirmation = page.getByRole("group", { name: "确认恢复示例" });
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole("button", { name: "取消" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirmation).not.toBeVisible();
  await expect(editor).toContainText("公式草稿");

  await page.getByRole("button", { name: "恢复示例" }).click();
  await confirmation.getByRole("button", { name: "确认恢复" }).click();
  await expect(editor).not.toContainText("公式草稿");
  await chooseExample(page, "开始写作");
  await expect(editor).toContainText("起始草稿");
  await page.getByRole("button", { name: "恢复示例" }).click();
  await confirmation.getByRole("button", { name: "确认恢复" }).click();
  await expect(editor).not.toContainText("起始草稿");
});

test("切换示例后的撤销不会带回其他示例", async ({ page }) => {
  const editor = await openHome(page);
  await appendText(page, "其他示例的草稿");
  await chooseExample(page, "公式与绘图");
  const undo = page.getByRole("button", { name: "撤销", exact: true });
  await expect(undo).toBeDisabled();
  await appendText(page, "当前示例的新文字");
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(editor).toContainText("公式与绘图");
  await expect(editor).not.toContainText("当前示例的新文字");
  await expect(editor).not.toContainText("其他示例的草稿");
  await chooseExample(page, "开始写作");
  await expect(editor).toContainText("其他示例的草稿");
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(editor).not.toContainText("其他示例的草稿");
  const redo = page.getByRole("button", { name: "重做", exact: true });
  await redo.click();
  await expect(editor).toContainText("其他示例的草稿");
});

test("每个示例独立保留撤销和重做，恢复示例也可撤销", async ({ page }) => {
  const editor = await openHome(page);
  const undo = page.getByRole("button", { name: "撤销", exact: true });
  const redo = page.getByRole("button", { name: "重做", exact: true });
  await appendText(page, "起始历史");
  await undo.click();
  await expect(redo).toBeEnabled();

  await chooseExample(page, "公式与绘图");
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();
  await appendText(page, "公式历史");
  await undo.click();
  await expect(redo).toBeEnabled();

  await chooseExample(page, "开始写作");
  await expect(redo).toBeEnabled();
  await redo.click();
  await expect(editor).toContainText("起始历史");
  await expect(editor).not.toContainText("公式历史");

  await chooseExample(page, "公式与绘图");
  await expect(redo).toBeEnabled();
  await redo.click();
  await expect(editor).toContainText("公式历史");
  await page.getByRole("button", { name: "恢复示例" }).click();
  await page.getByRole("group", { name: "确认恢复示例" }).getByRole("button", { name: "确认恢复" }).click();
  await expect(editor).not.toContainText("公式历史");
  await undo.click();
  await expect(editor).toContainText("公式历史");
  await redo.click();
  await expect(editor).not.toContainText("公式历史");
});

test("数据表编辑的撤销历史随示例保留", async ({ page }) => {
  await openHome(page);
  await chooseExample(page, "数据表");
  await page.getByLabel("第 1 行 事项").fill("表格历史");
  await chooseExample(page, "开始写作");
  await chooseExample(page, "数据表");
  const field = page.getByLabel("第 1 行 事项");
  await expect(field).toHaveValue("表格历史");
  const undo = page.getByRole("button", { name: "撤销", exact: true });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(field).toHaveValue("收集灵感");
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(field).toHaveValue("表格历史");
});

test("能力入口定位真实示例且保留试写", async ({ page }) => {
  const editor = await openHome(page);
  await appendText(page, "从能力入口返回后保留");
  await page.getByRole("button", { name: "试试表格" }).click();
  await expect(page.getByRole("button", { name: /当前：列表与表格/ })).toBeFocused();
  const host = page.locator(".semlo-editor-editor-host");
  const table = host.locator(".tableWrapper").first();
  await expect(table).toBeVisible();
  const hostBox = await host.boundingBox();
  const tableBox = await table.boundingBox();
  expect(hostBox && tableBox && tableBox.y >= hostBox.y && tableBox.y < hostBox.y + hostBox.height).toBeTruthy();
  await page.getByRole("button", { name: "试试分栏" }).click();
  await expect(page.getByRole("button", { name: /当前：内容块与分栏/ })).toBeFocused();
  await page.getByRole("button", { name: "试试公式" }).click();
  await expect(page.getByRole("button", { name: /当前：公式与绘图/ })).toBeFocused();
  await chooseExample(page, "开始写作");
  await expect(editor).toContainText("从能力入口返回后保留");
});

test("能力入口的悬停反馈遵循减少动态效果设置", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openHome(page, true);
  const action = page.getByRole("button", { name: "试试表格" });
  const arrow = action.locator("span");
  await action.hover();
  await expect(arrow).not.toHaveCSS("transform", "none");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(arrow).toHaveCSS("transform", "none");
  await expect(arrow).toHaveCSS("transition-duration", "0s");
});
