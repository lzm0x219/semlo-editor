async function _browserTest(page: import("playwright").Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/", page.url()).href);
  await page.evaluate(async () => {
    localStorage.removeItem("semlo-editor.recent-commands.v1");
    const { createEditor } = await import("/dist/index.js");
    const host = document.createElement("div");
    host.id = "recent-test";
    document.body.prepend(host);
    window.recentApi = createEditor({ element: host, content: "<p></p>" });
  });
  const host = page.locator("#recent-test"),
    prose = host.locator(".semlo-editor-prose"),
    menu = page.getByRole("dialog", { name: "插入内容" });
  const blank = async () => {
    await page.evaluate(() => window.__semloRequireFixture("recentApi").setContent("<p></p>"));
    await prose.locator("p").click();
  };
  const open = async () => {
    await host.getByRole("button", { name: "插入内容" }).click();
    await menu.waitFor();
  };
  const labels = async () => menu.locator(".semlo-editor-recent-list button").allTextContents();
  await prose.locator("p").click();
  await open();
  if (await menu.locator(".semlo-editor-recent-section").count())
    throw new Error("Recent section appeared without history");
  await menu.getByRole("option", { name: /状态/ }).click();
  await blank();
  await page.keyboard.type("/rq");
  await page.keyboard.press("Enter");
  await blank();
  await page.keyboard.type("/");
  await page.locator(".semlo-editor-slash-menu .semlo-editor-quick-grid").getByRole("button", { name: "链接" }).click();
  await page.getByRole("dialog", { name: "插入链接" }).waitFor();
  await page.keyboard.press("Escape");
  await open();
  if ((await labels()).join("|") !== "链接|日期|状态")
    throw new Error("Recent order incorrect: " + (await labels()).join("|"));
  await menu.getByLabel("搜索插入内容").fill("glk");
  if (await menu.locator(".semlo-editor-recent-section").count())
    throw new Error("Recent commands remained in filtered search");
  await menu.getByLabel("搜索插入内容").fill("");
  await menu.locator(".semlo-editor-recent-list").getByRole("button", { name: "链接", exact: true }).click();
  await page.getByRole("dialog", { name: "插入链接" }).waitFor();
  await page.keyboard.press("Escape");
  await blank();
  await page.keyboard.type("/");
  const slash = page.getByRole("listbox", { name: "插入内容" });
  await slash.locator(".semlo-editor-recent-list").getByRole("button", { name: "日期", exact: true }).click();
  if (!(await prose.locator(".semlo-editor-date-node").count()) || (await prose.innerText()).includes("/"))
    throw new Error("Recent slash command lost selection or slash was not removed");
  await blank();
  await open();
  await menu.getByRole("option", { name: "表格 插入表格", exact: true }).hover();
  await page.getByLabel("2行3列").click();
  if (!(await prose.locator("table").count())) throw new Error("Table picker failed");
  await blank();
  await open();
  await menu.getByRole("option", { name: /分栏卡片/ }).hover();
  await page.getByRole("menuitem", { name: "三栏" }).click();
  await blank();
  await open();
  if ((await labels()).join("|") !== "分栏卡片|表格|日期")
    throw new Error("Picker history or limit incorrect: " + (await labels()).join("|"));
  await menu.locator(".semlo-editor-recent-list").getByRole("button", { name: "表格", exact: true }).click();
  if (!(await prose.locator("table").count())) throw new Error("Recent table was not reusable");
  await page.evaluate(async () => {
    const { createEditor } = await import("/dist/index.js");
    const host = document.createElement("div");
    host.id = "recent-second";
    document.body.prepend(host);
    window.recentSecond = createEditor({ element: host, content: "<p></p>" });
  });
  await page.locator("#recent-second .semlo-editor-prose p").click();
  await page.locator("#recent-second").getByRole("button", { name: "插入内容" }).click();
  if ((await labels())[0] !== "表格") throw new Error("Recent history was not shared across editors");
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    window.__semloRequireFixture("recentApi").destroy();
    window.__semloRequireFixture("recentSecond").destroy();
    document.querySelector("#recent-test")!.remove();
    document.querySelector("#recent-second")!.remove();
  });
  await page.reload();
  for (const framework of ["React", "SolidJS", "Vue"]) {
    await page.getByRole("button", { name: framework, exact: true }).click();
    await page.locator(".semlo-editor-prose > p").last().click();
    await page.getByRole("button", { name: "插入内容" }).click();
    if ((await labels())[0] !== "表格")
      throw new Error(framework + ": recent history did not survive reload or adapter switch");
    await page.keyboard.press("Escape");
  }
  await page.evaluate(() => localStorage.setItem("semlo-editor.recent-commands.v1", "{bad json"));
  await page.reload();
  await page.locator(".semlo-editor-prose > p").last().click();
  await page.getByRole("button", { name: "插入内容" }).click();
  if (await menu.locator(".semlo-editor-recent-section").count()) throw new Error("Malformed history was displayed");
  await menu.getByRole("option", { name: /状态/ }).click();
  if ((await page.evaluate(() => localStorage.getItem("semlo-editor.recent-commands.v1"))) !== '["status"]')
    throw new Error("Malformed history was not repaired");
  await page.reload();
  await page.evaluate(() =>
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    }),
  );
  await page.locator(".semlo-editor-prose > p").last().click();
  await page.getByRole("button", { name: "插入内容" }).click();
  await menu.getByRole("option", { name: /状态/ }).click();
  await page.getByRole("button", { name: "插入内容" }).click();
  if (!(await menu.locator(".semlo-editor-recent-list").getByRole("button", { name: "状态", exact: true }).count()))
    throw new Error("Storage fallback failed");
  if (errors.length) throw new Error(errors.join("; "));
  return {
    order: true,
    limit: 3,
    search: true,
    toolbar: true,
    slash: true,
    table: true,
    columns: true,
    crossEditor: true,
    reloadAndAdapters: true,
    malformedStorage: true,
    storageFallback: true,
  };
}
