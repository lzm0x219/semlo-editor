async function _browserTest(page: import("playwright").Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/", page.url()).href);
  await page.evaluate(async () => {
    const { createEditor } = await import("/dist/index.js");
    const host = document.createElement("div");
    host.id = "dialog-test";
    document.body.append(host);
    window.dialogApi = createEditor({
      element: host,
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "semloEditorStatus", attrs: { label: "初始", color: 0 } },
              { type: "text", text: " " },
              { type: "semloEditorFormula", attrs: { id: "sample", latex: "x^2" } },
            ],
          },
        ],
      },
    });
  });
  const host = page.locator("#dialog-test");
  await host.getByRole("button", { name: "状态：初始" }).click();
  const statusDialog = page.getByRole("dialog", { name: "编辑状态" });
  for (const [name, color] of [
    ["红色", "rgb(248, 206, 211)"],
    ["黄色", "rgb(246, 225, 172)"],
    ["绿色", "rgb(219, 241, 183)"],
    ["灰色", "rgb(239, 240, 240)"],
    ["蓝色", "rgb(192, 221, 252)"],
    ["紫色", "rgb(192, 202, 252)"],
  ]) {
    await statusDialog.getByRole("button", { name }).click();
    if ((await host.locator(".semlo-editor-status").evaluate((el) => getComputedStyle(el).backgroundColor)) !== color)
      throw new Error(name + " status color failed");
  }
  await statusDialog.getByLabel("状态文字").press("Escape");
  await host.getByRole("button", { name: "公式：x^2" }).click();
  let formulaDialog = page.getByRole("dialog", { name: "编辑公式" });
  await formulaDialog.getByLabel("TeX 公式").fill("\\frac{");
  if (!(await formulaDialog.getByLabel("公式预览").innerText()).includes("公式语法有误"))
    throw new Error("Invalid formula was not reported");
  await formulaDialog.getByLabel("TeX 公式").fill("x^2");
  await formulaDialog.getByLabel("TeX 公式").press("Escape");
  if (!(await host.getByRole("button", { name: "公式：x^2" }).count())) throw new Error("Escape lost formula");
  await host.getByRole("button", { name: "公式：x^2" }).click();
  formulaDialog = page.getByRole("dialog", { name: "编辑公式" });
  await formulaDialog.getByLabel("TeX 公式").fill("\\href{javascript:alert(1)}{x}");
  if (await formulaDialog.locator('a[href^="javascript:"]').count()) throw new Error("Unsafe formula URL rendered");
  await page.evaluate(() => window.__semloRequireFixture("dialogApi").setEditable(false));
  if (await page.getByRole("dialog", { name: "编辑公式" }).count())
    throw new Error("Read-only transition left popup open");
  await page.evaluate(() => window.__semloRequireFixture("dialogApi").setEditable(true));
  await host.getByRole("button", { name: "公式：x^2" }).click();
  await page.evaluate(() => window.__semloRequireFixture("dialogApi").destroy());
  if (await page.getByRole("dialog", { name: "编辑公式" }).count()) throw new Error("Destroy left popup open");
  await page.evaluate(() => document.querySelector("#dialog-test")!.remove());
  if (errors.length) throw new Error(errors.join("; "));
  return { colors: 6, invalidFormula: true, escapeRetains: true, unsafeURLBlocked: true, popupCleanup: true };
}
