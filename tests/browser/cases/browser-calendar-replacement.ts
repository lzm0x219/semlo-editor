async function _browserTest(page: import("playwright").Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/", page.url()).href);
  const today = await page.evaluate(() => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  });
  await page.evaluate(async (date) => {
    const { createEditor } = await import("/dist/index.js");
    const host = document.createElement("div");
    host.id = "calendar-replacement-test";
    document.body.prepend(host);
    const event = { id: "old", title: "原日程", start: date, end: date, description: "", color: 0 };
    window.calendarReplacementApi = createEditor({
      element: host,
      content: { type: "doc", content: [{ type: "semloEditorCalendar", attrs: { events: [event] } }] },
    });
  }, today);
  const calendar = page.locator("#calendar-replacement-test .semlo-editor-calendar-node");
  const edit = page.getByRole("dialog", { name: "编辑日程" });
  const snapshot = () =>
    page.evaluate(
      () => window.__semloRequireFixture("calendarReplacementApi").getSnapshot().json.content?.[0]?.attrs?.events,
    );

  await calendar.getByRole("button", { name: "日程：原日程" }).click();
  await edit.getByLabel("日程标题").evaluate((input) => (window.oldCalendarTitle = input as HTMLInputElement));
  await page.evaluate((date) => {
    const event = { id: "new", title: "新文档日程", start: date, end: date, description: "", color: 1 };
    window.__semloRequireFixture("calendarReplacementApi").setContent({
      type: "doc",
      content: [{ type: "semloEditorCalendar", attrs: { events: [event] } }],
    });
  }, today);
  if (await edit.count()) await edit.getByLabel("日程标题").fill("旧弹窗写入");
  const afterReplace = await snapshot();
  if (afterReplace.length !== 1 || afterReplace[0].title !== "新文档日程")
    throw new Error(`A stale popup modified the replacement document: ${JSON.stringify(afterReplace)}`);
  if (await edit.count()) throw new Error("Replacing a calendar kept its old event editor open");

  await page.evaluate(() => {
    if (!window.oldCalendarTitle) throw new Error("Calendar title input was not captured");
    window.oldCalendarTitle.value = "迟到输入";
    window.oldCalendarTitle.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const afterLateInput = await snapshot();
  if (afterLateInput.length !== 1 || afterLateInput[0].title !== "新文档日程")
    throw new Error(`A detached popup modified the replacement document: ${JSON.stringify(afterLateInput)}`);

  await calendar.getByRole("button", { name: "日程：新文档日程" }).click();
  await edit.getByLabel("日程标题").fill("连续编辑");
  if (!(await edit.count())) throw new Error("Editing its own event closed the popup");
  await edit.getByLabel("日程说明").fill("连续修改说明");
  const edited = await snapshot();
  if (edited[0].title !== "连续编辑" || edited[0].description !== "连续修改说明")
    throw new Error(`Continuous editing was lost: ${JSON.stringify(edited)}`);
  await edit.getByLabel("日程标题").evaluate((input) => (window.oldCalendarTitle = input as HTMLInputElement));
  await page.evaluate((date) => {
    const editor = window.__semloRequireFixture("calendarReplacementApi").editor;
    const pos = 0;
    const event = { id: "new", title: "宿主替换日程", start: date, end: date, description: "", color: 2 };
    editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { events: [event] }));
  }, today);
  if (await edit.count()) await edit.getByLabel("日程标题").fill("旧弹窗覆盖");
  const afterTransaction = await snapshot();
  if (afterTransaction.length !== 1 || afterTransaction[0].title !== "宿主替换日程")
    throw new Error(`A stale popup overwrote a host transaction: ${JSON.stringify(afterTransaction)}`);
  if (await edit.count()) throw new Error("An external calendar update kept its old event editor open");

  await page.evaluate((date) => {
    const event = { id: "new", title: "宿主替换日程", start: date, end: date, description: "", color: 2 };
    window.__semloRequireFixture("calendarReplacementApi").setContent({
      type: "doc",
      content: [
        { type: "semloEditorCalendar", attrs: { events: [event] } },
        { type: "paragraph", content: [{ type: "text", text: "其他内容" }] },
      ],
    });
  }, today);
  await calendar.getByRole("button", { name: "日程：宿主替换日程" }).click();
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("calendarReplacementApi").editor;
    editor.view.dispatch(editor.state.tr.insertText("新增", 2));
  });
  if (!(await edit.count())) throw new Error("Editing an unrelated paragraph closed the calendar popup");
  await page.evaluate((date) => {
    const event = { id: "new", title: "宿主替换日程", start: date, end: date, description: "", color: 2 };
    window.__semloRequireFixture("calendarReplacementApi").setContent({
      type: "doc",
      content: [
        { type: "semloEditorCalendar", attrs: { events: [event] } },
        { type: "paragraph", content: [{ type: "text", text: "另一篇文档" }] },
      ],
    });
  }, today);
  if (await edit.count()) throw new Error("An equal calendar in a replacement document kept the old popup open");

  await calendar.getByRole("button", { name: "日程：宿主替换日程" }).click();
  await edit.getByLabel("日程标题").evaluate((input) => (window.oldCalendarTitle = input as HTMLInputElement));
  await page.evaluate(() => {
    window.__semloRequireFixture("calendarReplacementApi").setEditable(false);
    window.__semloRequireFixture("calendarReplacementApi").setEditable(true);
    if (!window.oldCalendarTitle) throw new Error("Calendar title input was not captured");
    window.oldCalendarTitle.value = "只读后迟到输入";
    window.oldCalendarTitle.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const afterReadonly = await snapshot();
  if (afterReadonly[0].title !== "宿主替换日程")
    throw new Error(`A closed popup modified the calendar after read-only: ${JSON.stringify(afterReadonly)}`);
  if (await edit.count()) throw new Error("Read-only transition kept its old event editor open");

  await calendar.getByRole("button", { name: "日程：宿主替换日程" }).click();
  await edit.getByLabel("日程标题").evaluate((input) => (window.oldCalendarTitle = input as HTMLInputElement));
  await page.evaluate(() => {
    window.__semloRequireFixture("calendarReplacementApi").destroy();
    if (!window.oldCalendarTitle) throw new Error("Calendar title input was not captured");
    window.oldCalendarTitle.value = "销毁后迟到输入";
    window.oldCalendarTitle.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector("#calendar-replacement-test")!.remove();
  });
  if (await edit.count()) throw new Error("Destroy kept its old event editor open");
  if (errors.length) throw new Error(errors.join("; "));
  return { hostReplacement: true, externalTransaction: true, continuousEditing: true, cleanup: true };
}
