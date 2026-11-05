async function _browserTest(page: import("playwright").Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/", page.url()).href);
  await page.locator(".semlo-editor-prose > p").last().click();
  await page.keyboard.type("/gsk");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "编辑公式" });
  await dialog.getByLabel("TeX 公式").fill("\\sum_{i=1}^{n} i");
  if (!(await dialog.locator(".katex-display").count())) throw new Error("Block formula preview is not display math");
  await dialog.getByLabel("TeX 公式").press("Meta+Enter");
  let block = page.locator(".semlo-editor-block-formula-node");
  if (!(await block.locator(".katex-display").count())) throw new Error("Block formula not rendered");
  for (const framework of ["React", "SolidJS", "Vue"]) {
    await page.getByRole("button", { name: framework, exact: true }).click();
    block = page.locator(".semlo-editor-block-formula-node");
    if (
      !(await block.locator(".katex-display").count()) ||
      !(await block.getByRole("button").getAttribute("aria-label"))?.includes("sum_")
    )
      throw new Error(framework + ": block formula lost");
  }
  const roundtrip = await page.evaluate(async () => {
    const { createEditor } = await import("/dist/index.js");
    const host = document.createElement("div");
    document.body.append(host);
    const seed = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "above" }] },
        { type: "semloEditorBlockFormula", attrs: { id: "block-one", latex: "x^2" } },
        { type: "paragraph", content: [{ type: "text", text: "below" }] },
      ],
    };
    const api = createEditor({ element: host, content: seed });
    const snapshot = api.getSnapshot();
    if (!snapshot.html.includes("data-semlo-editor-block-formula") || !snapshot.html.includes('data-latex="x^2"'))
      throw new Error("Block formula HTML missing");
    api.setContent("<p>reset</p>");
    api.setContent(snapshot.html);
    if (
      api.getSnapshot().json.content?.[1]?.type !== "semloEditorBlockFormula" ||
      api.getSnapshot().json.content?.[1]?.attrs?.latex !== "x^2"
    )
      throw new Error("Block formula HTML roundtrip failed");
    api.setContent("<p>reset</p>");
    api.setContent(snapshot.json);
    if (!host.querySelector(".semlo-editor-block-formula-node .katex-display"))
      throw new Error("Block formula JSON roundtrip failed");
    api.destroy();
    host.remove();
    return true;
  });
  await page.getByRole("button", { name: "只读预览" }).click();
  if (!(await block.getByRole("button").isDisabled())) throw new Error("Read-only formula editable");
  if (errors.length) throw new Error(errors.join("; "));
  return {
    shortcut: true,
    display: true,
    frameworks: ["React", "SolidJS", "Vue"],
    jsonAndHtml: roundtrip,
    readOnly: true,
  };
}
