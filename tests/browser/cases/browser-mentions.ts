async function _browserTest(page: import("playwright").Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/", page.url()).href);

  // The demo's search results are explicitly marked as examples.
  await page.locator(".semlo-editor-prose > p").last().click();
  await page.keyboard.type("@");
  let menu = page.getByRole("listbox", { name: "提及" });
  await menu.getByRole("option", { name: "小语（示例）" }).waitFor();
  if (!(await menu.getByRole("option", { name: "入门文档（示例）" }).count()))
    throw new Error("Initial mention results did not include people and documents");
  await menu.getByRole("tab", { name: "人" }).click();
  if (await menu.getByRole("option", { name: "入门文档（示例）" }).count())
    throw new Error("Person filter did not hide documents");
  await menu.getByRole("tab", { name: "内容" }).click();
  if (await menu.getByRole("option", { name: "小语（示例）" }).count())
    throw new Error("Document filter did not hide people");
  await menu.getByRole("option", { name: "入门文档（示例）" }).click();
  if (!(await page.locator(".semlo-editor-mention").getByText("@入门文档（示例）").count()))
    throw new Error("Document mention not inserted");
  for (const framework of ["React", "SolidJS", "Vue"]) {
    await page.getByRole("button", { name: framework, exact: true }).click();
    if (!(await page.locator(".semlo-editor-mention").getByText("@入门文档（示例）").count()))
      throw new Error(`${framework}: mention lost`);
  }

  await page.evaluate(async () => {
    const { createEditor } = await import("/dist/index.js");
    const host = document.createElement("div");
    host.id = "mention-test";
    document.body.prepend(host);
    window.mentionRequests = [];
    window.mentionErrors = [];
    window.mentionApi = createEditor({
      element: host,
      content: "<p>abc</p>",
      searchMentions: (query, signal) =>
        new Promise((resolve, reject) =>
          window.__semloRequireFixture("mentionRequests").push({ query, signal, resolve, reject }),
        ),
      onError: (error) => window.__semloRequireFixture("mentionErrors").push(error.message),
    });
  });
  const host = page.locator("#mention-test");
  await host.locator(".semlo-editor-prose p").click();
  await page.keyboard.press("End");
  await page.keyboard.type("@");
  if (await menu.count()) throw new Error("An ordinary @ after text triggered mention");
  await page.keyboard.press("Backspace");
  await host.getByRole("button", { name: "插入内容" }).click();
  const insert = page.getByRole("dialog", { name: "插入内容" });
  await insert.getByLabel("搜索插入内容").fill("提及");
  await insert.getByRole("option", { name: /提及/ }).click();
  await menu.waitFor();
  if (!(await host.locator(".semlo-editor-prose").innerText()).includes("abc@"))
    throw new Error("Insert menu changed adjacent text");
  await page.waitForFunction(() =>
    window.__semloRequireFixture("mentionRequests").some((request) => request.query === ""),
  );
  await page.keyboard.type("a");
  await page.waitForFunction(() =>
    window.__semloRequireFixture("mentionRequests").some((request) => request.query === "a"),
  );
  await page.keyboard.type("b");
  await page.waitForFunction(() =>
    window.__semloRequireFixture("mentionRequests").some((request) => request.query === "ab"),
  );
  const aborted = await page.evaluate(
    () => window.__semloRequireFixture("mentionRequests").find((request) => request.query === "a")!.signal.aborted,
  );
  if (!aborted) throw new Error("Previous search was not aborted");
  await page.evaluate(() => {
    window
      .__semloRequireFixture("mentionRequests")
      .find((request) => request.query === "ab")!
      .resolve([{ id: "p1", label: "AB 用户", kind: "person", href: "https://example.com/u" }]);
  });
  await menu.getByRole("option", { name: "AB 用户" }).waitFor();
  await page.evaluate(() =>
    window
      .__semloRequireFixture("mentionRequests")
      .find((request) => request.query === "a")!
      .resolve([{ id: "old", label: "旧结果", kind: "person" }]),
  );
  await page.waitForTimeout(30);
  if (await menu.getByRole("option", { name: "旧结果" }).count())
    throw new Error("Stale search overwrote latest result");
  await menu.getByRole("option", { name: "AB 用户" }).click();
  const roundtrip = await page.evaluate(() => {
    const snapshot = window.__semloRequireFixture("mentionApi").getSnapshot();
    if (
      !snapshot.text.includes("abc@AB 用户") ||
      !snapshot.html.includes("data-semlo-editor-mention") ||
      !snapshot.html.includes('data-href="https://example.com/u"')
    )
      return false;
    window.__semloRequireFixture("mentionApi").setContent("<p>reset</p>");
    window.__semloRequireFixture("mentionApi").setContent(snapshot.html);
    const mention = window
      .__semloRequireFixture("mentionApi")
      .getSnapshot()
      .json.content![0].content!.find((item) => item.type === "semloEditorMention");
    return (
      mention?.attrs!.id === "p1" &&
      mention.attrs!.label === "AB 用户" &&
      mention.attrs!.href === "https://example.com/u"
    );
  });
  if (!roundtrip) throw new Error("Mention text/HTML roundtrip failed");

  await page.evaluate(() => window.__semloRequireFixture("mentionApi").setContent("<p></p>"));
  await host.locator(".semlo-editor-prose p").click();
  await page.keyboard.type("@");
  await menu.waitFor();
  await menu.getByRole("option", { name: "自定义日期" }).click();
  const datePicker = page.getByRole("dialog", { name: "选择日期" });
  await datePicker.waitFor();
  await datePicker.getByRole("button", { name: "明天", exact: true }).click();
  if (!(await host.locator(".semlo-editor-date-node").count())) throw new Error("Custom date mention failed");
  await page.evaluate(() => window.__semloRequireFixture("mentionApi").setContent("<p></p>"));
  await host.locator(".semlo-editor-prose p").click();
  await page.keyboard.type("@");
  await menu.waitFor();
  await page.keyboard.press("Escape");
  if (await menu.count()) throw new Error("Escape did not close mention");
  await page.keyboard.type("x");
  if (await menu.count()) throw new Error("Escape did not dismiss suggestion");
  await page.evaluate(() => window.__semloRequireFixture("mentionApi").setContent("<p></p>"));
  await host.locator(".semlo-editor-prose p").click();
  await page.keyboard.type("@");
  await menu.waitFor();
  await page.locator("header").click();
  if (await menu.count()) throw new Error("Outside click did not close mention");
  await page.evaluate(() => window.__semloRequireFixture("mentionApi").setContent("<p></p>"));
  await host.locator(".semlo-editor-prose p").click();
  await page.keyboard.type("@");
  await menu.waitFor();
  await page.evaluate(() => window.__semloRequireFixture("mentionApi").setContent("<p>另一篇文档</p>"));
  if (await menu.count()) throw new Error("Replacing content left mention open");
  await page.evaluate(() => window.__semloRequireFixture("mentionApi").setContent("<p></p>"));
  await host.locator(".semlo-editor-prose p").click();
  await page.keyboard.type("@");
  await menu.waitFor();
  await page.evaluate(() => window.__semloRequireFixture("mentionApi").setEditable(false));
  if (await menu.count()) throw new Error("Read-only transition left mention open");
  await page.evaluate(() => {
    window.__semloRequireFixture("mentionApi").setEditable(true);
    window.__semloRequireFixture("mentionApi").setContent("<p></p>");
  });
  await host.locator(".semlo-editor-prose p").click();
  await page.keyboard.type("@");
  await menu.waitFor();
  await page.evaluate(() => {
    window.__semloRequireFixture("mentionApi").destroy();
    document.querySelector("#mention-test")!.remove();
  });
  if (await menu.count()) throw new Error("Destroy left mention open");

  await page.evaluate(async () => {
    const { createEditor } = await import("/dist/index.js");
    const host = document.createElement("div");
    host.id = "mention-empty-test";
    document.body.prepend(host);
    window.mentionEmptyApi = createEditor({ element: host, content: "<p></p>" });
  });
  await page.locator("#mention-empty-test .semlo-editor-prose p").click();
  await page.keyboard.type("@");
  await menu.waitFor();
  await menu.getByText("未配置提及搜索").waitFor();
  await page.evaluate(() => {
    window.__semloRequireFixture("mentionEmptyApi").destroy();
    document.querySelector("#mention-empty-test")!.remove();
  });
  await page.evaluate(async () => {
    const { createEditor } = await import("/dist/index.js");
    const host = document.createElement("div");
    host.id = "mention-error-test";
    document.body.prepend(host);
    window.mentionErrorApi = createEditor({
      element: host,
      content: "<p></p>",
      searchMentions: async () => {
        throw new Error("搜索服务不可用");
      },
    });
  });
  await page.locator("#mention-error-test .semlo-editor-prose p").click();
  await page.keyboard.type("@");
  await page.locator("#mention-error-test").getByRole("alert").getByText("搜索服务不可用").waitFor();
  await page.evaluate(() => {
    window.__semloRequireFixture("mentionErrorApi").destroy();
    document.querySelector("#mention-error-test")!.remove();
  });
  if (errors.length) throw new Error(errors.join("; "));
  return {
    insertion: true,
    frameworks: ["React", "SolidJS", "Vue"],
    adjacentText: true,
    asyncCancellation: true,
    htmlAndText: true,
    customDate: true,
    cleanup: true,
    unconfigured: true,
    errorFeedback: true,
  };
}
