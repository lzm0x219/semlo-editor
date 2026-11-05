async function _browserTest(page: import("playwright").Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/tests/controlled.html", page.url()).href);
  for (const framework of ["react", "vue", "solid"]) {
    const host = page.locator(`#${framework}`);
    await host.getByRole("button", { name: "状态：初始" }).click();
    const statusEditor = page.getByRole("dialog", { name: "编辑状态" });
    await statusEditor.getByLabel("状态文字").fill("完成");
    if (!(await statusEditor.isVisible())) throw new Error(framework + ": controlled update closed the status editor");
    await statusEditor.getByLabel("状态文字").press("Enter");
    if (!(await host.getByRole("button", { name: "状态：完成" }).count()))
      throw new Error(framework + ": controlled status update lost");
    await host.getByRole("button", { name: /公式：/ }).click();
    const formulaEditor = page.getByRole("dialog", { name: "编辑公式" });
    await formulaEditor.getByLabel("TeX 公式").fill("y^3");
    await formulaEditor.getByRole("button", { name: "确定" }).click();
    if (!(await host.getByRole("button", { name: "公式：y^3" }).count()))
      throw new Error(framework + ": controlled formula update lost");
    await host.locator(".semlo-editor-column p").first().click();
    await page.keyboard.type("受控内容");
    if (!(await host.locator(".semlo-editor-column").first().innerText()).includes("受控内容"))
      throw new Error(framework + ": controlled column update lost");
    await page.keyboard.type(" @");
    const mentions = page.getByRole("listbox", { name: "提及" });
    await mentions.getByRole("option", { name: "测试用户" }).click();
    if (!(await host.locator(".semlo-editor-mention").getByText("@测试用户").count()))
      throw new Error(framework + ": controlled mention lost");
    await host.evaluate((el) => {
      const input = el.querySelector<HTMLInputElement>('input[type="file"][multiple]')!;
      const transfer = new DataTransfer();
      transfer.items.add(new File(["x"], "controlled.txt", { type: "text/plain" }));
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await host.locator(".semlo-editor-attachment").waitFor();
    if (!(await host.locator(".semlo-editor-attachment").innerText()).includes("controlled.txt"))
      throw new Error(framework + ": controlled attachment update lost");
  }
  if (errors.length) throw new Error(errors.join("; "));
  return {
    controlled: ["react", "vue", "solid"],
    status: true,
    formula: true,
    columns: true,
    mention: true,
    attachment: true,
  };
}
