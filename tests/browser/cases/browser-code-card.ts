async function _browserTest(page: import("playwright").Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/", page.url()).href);
  await page.evaluate(async () => {
    const { createEditor } = await import("/dist/index.js");
    const host = document.createElement("div");
    host.id = "code-test";
    document.body.append(host);
    window.codeTest = createEditor({ element: host, content: "<p></p>" });
    window.__semloRequireFixture("codeTest").editor.commands.setTextSelection(1);
    window.__semloRequireFixture("codeTest").editor.commands.toggleCodeBlock();
    window.__semloRequireFixture("codeTest").editor.commands.insertContent("const answer = 42\nconsole.log(answer)");
  });
  const card = page.locator("#code-test .semlo-editor-code-card");
  await card.waitFor();
  await card.hover();
  await card.getByLabel("代码块名称").fill("示例代码");
  if (
    !(await page.evaluate(() => window.__semloRequireFixture("codeTest").getSnapshot().html)).includes(
      'data-title="示例代码"',
    )
  )
    throw new Error("Title was not saved while typing");
  await card.getByLabel("代码块名称").press("Tab");
  await card.getByLabel("代码语言").click();
  await page.getByRole("option", { name: "JavaScript", exact: true }).click();
  await card.getByLabel("代码主题").click();
  await page.getByRole("option", { name: "One Dark Pro", exact: true }).click();
  const rendered = await card.locator("code").innerText();
  const lines = await card.locator(".semlo-editor-code-numbers").textContent();
  const highlighted = await card.locator(".hljs-keyword").count();
  if (!rendered.includes("const answer = 42") || lines !== "1\n2" || !highlighted)
    throw new Error("Code text, line numbers, or highlighting incorrect");
  await card.getByLabel("收起代码块").click();
  if (await card.locator(".semlo-editor-code-body").isVisible()) throw new Error("Code did not collapse");
  const saved = await page.evaluate(() => window.__semloRequireFixture("codeTest").getSnapshot());
  if (
    !saved.html.includes('data-title="示例代码"') ||
    !saved.html.includes('data-theme="dark"') ||
    !saved.html.includes('data-collapsed="true"') ||
    !saved.html.includes("language-javascript")
  )
    throw new Error("Code attributes missing in HTML: " + saved.html);
  const attrs = saved.json.content?.find((node) => node.type === "codeBlock")?.attrs;
  if (
    attrs?.title !== "示例代码" ||
    attrs?.language !== "javascript" ||
    attrs?.theme !== "dark" ||
    attrs?.collapsed !== true
  )
    throw new Error("Code attributes missing in JSON");
  await page.evaluate(() => window.__semloRequireFixture("codeTest").setEditable(false));
  if (!(await card.getByLabel("代码块名称").isDisabled())) throw new Error("Read-only code title is editable");
  await card.getByLabel("展开代码块").click();
  if (!(await card.locator(".semlo-editor-code-body").isVisible()))
    throw new Error("Read-only code cannot be expanded");
  if (
    !(await page.evaluate(() => window.__semloRequireFixture("codeTest").getSnapshot().json)).content?.find(
      (node) => node.type === "codeBlock",
    )?.attrs?.collapsed
  )
    throw new Error("Read-only toggle changed the saved document");
  await page.evaluate(() => window.__semloRequireFixture("codeTest").setEditable(true));
  if ((await card.getByLabel("代码块名称").isDisabled()) || (await card.getByLabel("展开代码块").isDisabled()))
    throw new Error("Code controls did not restore");
  await card.getByLabel("展开代码块").click();
  if (!(await card.locator(".semlo-editor-code-body").isVisible())) throw new Error("Code did not expand");
  await page.evaluate((saved) => {
    window.__semloRequireFixture("codeTest").setContent("<p>different</p>");
    window.__semloRequireFixture("codeTest").setContent(saved.html);
  }, saved);
  if (
    !(await card.getByLabel("展开代码块").count()) ||
    (await card.getByLabel("代码块名称").inputValue()) !== "示例代码" ||
    (await card.getByLabel("代码语言").getAttribute("data-value")) !== "javascript"
  )
    throw new Error("HTML roundtrip failed");
  await page.evaluate((saved) => {
    window.__semloRequireFixture("codeTest").setContent("<p>different</p>");
    window.__semloRequireFixture("codeTest").setContent(saved.json);
  }, saved);
  if (!(await card.getByLabel("展开代码块").count())) throw new Error("JSON roundtrip failed");
  await page.evaluate(() => {
    window.__semloRequireFixture("codeTest").destroy();
    document.querySelector("#code-test")!.remove();
  });
  if (errors.length) throw new Error(errors.join("; "));
  return { rendered, lines, highlighted, attributes: attrs, readOnly: true, jsonAndHtmlRoundtrip: true };
}
