async function _browserTest(page: import("playwright").Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/", page.url()).href);
  await page.locator(".semlo-editor-prose > p").last().click();
  await page.keyboard.type("/rq");
  await page.keyboard.press("Enter");
  let date = page.locator(".semlo-editor-date-node button");
  const initial = await date.getAttribute("aria-label");
  await date.click();
  let picker = page.getByRole("dialog", { name: "选择日期" });
  await picker.getByRole("button", { name: "明天", exact: true }).click();
  const expected = await page.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  if ((await date.getAttribute("aria-label")) !== `日期：${expected}`) throw new Error("Tomorrow shortcut failed");
  await date.click();
  picker = page.getByRole("dialog", { name: "选择日期" });
  await picker.getByRole("button", { name: "下个月" }).click();
  const nextMonth = await page.evaluate((value) => {
    const [y, m] = value.split("-").map(Number);
    const d = new Date(y, m, 1, 12);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  }, expected);
  await picker.getByRole("button", { name: nextMonth, exact: true }).click();
  if ((await date.getAttribute("aria-label")) !== `日期：${nextMonth}`)
    throw new Error("Date picker month navigation failed");
  await date.click();
  picker = page.getByRole("dialog", { name: "选择日期" });
  await picker.getByRole("checkbox", { name: "时刻" }).check();
  await picker.getByRole("button", { name: "选择时刻" }).click();
  await picker.getByRole("option", { name: "12:30", exact: true }).click();
  if ((await date.getAttribute("aria-label")) !== `日期：${nextMonth} 12:30`)
    throw new Error("Date time was not saved");
  await picker.getByRole("button", { name: nextMonth, exact: true }).click();
  if ((await date.getAttribute("aria-label")) !== `日期：${nextMonth} 12:30`)
    throw new Error("Selecting a date lost its time");
  await date.click();
  picker = page.getByRole("dialog", { name: "选择日期" });
  await picker.getByRole("checkbox", { name: "时刻" }).uncheck();
  if ((await date.getAttribute("aria-label")) !== `日期：${nextMonth}`)
    throw new Error("Disabling time did not clear it");
  await picker.getByRole("checkbox", { name: "时刻" }).check();
  await picker.getByRole("button", { name: "选择时刻" }).click();
  await picker.getByRole("option", { name: "12:30", exact: true }).click();
  await picker.getByRole("button", { name: nextMonth, exact: true }).click();
  await page.locator(".semlo-editor-prose > p").last().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/bq");
  await page.keyboard.press("Enter");
  const emoji = page.getByRole("dialog", { name: "选择表情" });
  await emoji.getByLabel("搜索表情").fill("狐狸");
  await emoji.getByRole("button", { name: "狐狸", exact: true }).click();
  await emoji.getByLabel("搜索表情").fill("挥手");
  await emoji.getByLabel("表情肤色").selectOption("3");
  await emoji.getByRole("button", { name: "挥手", exact: true }).click();
  if (!(await page.locator(".semlo-editor-prose").innerText()).includes("🦊👋🏽"))
    throw new Error("Emoji search, insertion or skin tone failed");
  await page.keyboard.press("Escape");
  if (await emoji.count()) throw new Error("Emoji picker did not close");
  for (const framework of ["React", "SolidJS", "Vue"]) {
    await page.getByRole("button", { name: framework, exact: true }).click();
    date = page.locator(".semlo-editor-date-node button");
    if (
      (await date.getAttribute("aria-label")) !== `日期：${nextMonth} 12:30` ||
      !(await page.locator(".semlo-editor-prose").innerText()).includes("🦊👋🏽")
    )
      throw new Error(framework + ": date, time or emoji lost");
  }
  const roundtrip = await page.evaluate(async (value) => {
    const { createEditor } = await import("/dist/index.js");
    const host = document.createElement("div");
    document.body.append(host);
    const api = createEditor({
      element: host,
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "semloEditorDate", attrs: { date: value, time: "12:30" } },
              { type: "text", text: "🦊" },
            ],
          },
        ],
      },
    });
    const snapshot = api.getSnapshot();
    api.setContent("<p>reset</p>");
    api.setContent(snapshot.html);
    const node = api.getSnapshot().json.content?.[0]?.content?.find((item) => item.type === "semloEditorDate");
    const good =
      node?.attrs?.date === value &&
      node.attrs?.time === "12:30" &&
      api.getSnapshot().text.includes("12:30") &&
      api.getSnapshot().text.includes("🦊");
    api.destroy();
    host.remove();
    return good;
  }, nextMonth);
  if (!roundtrip) throw new Error("Date HTML roundtrip failed");
  await page.getByRole("button", { name: "只读预览" }).click();
  if (!(await date.isDisabled())) throw new Error("Date editable in read-only mode");
  if (errors.length) throw new Error(errors.join("; "));
  return {
    initial,
    tomorrow: expected,
    chosen: nextMonth,
    time: "12:30",
    emoji: "🦊👋🏽",
    frameworks: ["React", "SolidJS", "Vue"],
    html: true,
    readOnly: true,
  };
}
