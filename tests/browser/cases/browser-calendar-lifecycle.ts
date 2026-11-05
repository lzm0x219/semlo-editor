async function _browserTest(page: import("playwright").Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/", page.url()).href);
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  await page.evaluate(async (date) => {
    const { createEditor } = await import("/dist/index.js");
    const host = document.createElement("div");
    host.id = "calendar-test";
    document.body.prepend(host);
    window.calendarApi = createEditor({
      element: host,
      content: {
        type: "doc",
        content: [
          {
            type: "semloEditorCalendar",
            attrs: { events: [{ id: "event", title: "原日程", start: date, end: date, description: "", color: 0 }] },
          },
        ],
      },
    });
  }, today);
  const host = page.locator("#calendar-test"),
    calendar = host.locator(".semlo-editor-calendar-node");
  await calendar.getByRole("button", { name: "日程：原日程" }).click();
  let dialog = page.getByRole("dialog", { name: "编辑日程" });
  await dialog.getByLabel("日程标题").fill("修改日程");
  await dialog.getByRole("button", { name: "关闭日程" }).click();
  await page.keyboard.press("Meta+z");
  if (!(await calendar.getByRole("button", { name: "日程：原日程" }).count()))
    throw new Error("Event edit undo failed");
  await calendar.getByRole("button", { name: "日程：原日程" }).click();
  dialog = page.getByRole("dialog", { name: "编辑日程" });
  await dialog.getByRole("button", { name: "删除日程" }).click();
  if (await calendar.getByRole("button", { name: "日程：原日程" }).count()) throw new Error("Event delete failed");
  await page.keyboard.press("Meta+z");
  if (!(await calendar.getByRole("button", { name: "日程：原日程" }).count()))
    throw new Error("Event delete undo failed");
  await calendar.getByRole("button", { name: `${today} 添加日程` }).click();
  dialog = page.getByRole("dialog", { name: "添加日程" });
  await dialog.getByRole("button", { name: "关闭日程" }).click();
  const events = await page.evaluate(
    () => window.__semloRequireFixture("calendarApi").getSnapshot().json.content?.[0]?.attrs?.events,
  );
  if (events?.length !== 2 || !events.some((event: { title: string }) => event.title === ""))
    throw new Error("Empty calendar event was not saved");
  await calendar.getByRole("button", { name: "日程：原日程" }).click();
  await page.evaluate(() => window.__semloRequireFixture("calendarApi").setEditable(false));
  if (await page.getByRole("dialog", { name: "编辑日程" }).count())
    throw new Error("Read-only transition left event editor open");
  await page.evaluate(() => window.__semloRequireFixture("calendarApi").setEditable(true));
  await calendar.getByRole("button", { name: "日程：原日程" }).click();
  await page.evaluate(() => {
    window.__semloRequireFixture("calendarApi").destroy();
    document.querySelector("#calendar-test")!.remove();
  });
  if (await page.getByRole("dialog", { name: "编辑日程" }).count()) throw new Error("Destroy left event editor open");
  if (errors.length) throw new Error(errors.join("; "));
  return { editUndo: true, deleteUndo: true, emptyEvent: true, cleanup: true };
}
