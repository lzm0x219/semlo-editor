async function _browserTest(page: import("playwright").Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/", page.url()).href);
  await page.locator(".semlo-editor-prose > p").last().click();
  await page.keyboard.type("/rl");
  await page.keyboard.press("Enter");
  let calendar = page.locator(".semlo-editor-calendar-node");
  await calendar.waitFor();
  const dates = await page.evaluate(() => {
    const a = new Date(),
      b = new Date(a);
    b.setDate(b.getDate() + 1);
    const f = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { today: f(a), tomorrow: f(b) };
  });
  await calendar.locator(`[data-date="${dates.today}"]`).hover();
  await calendar.getByRole("button", { name: `${dates.today} 添加日程` }).click();
  let dialog = page.getByRole("dialog", { name: "添加日程" });
  await dialog.getByLabel("日程标题").fill("团队会议");
  await dialog.getByLabel("日程颜色").selectOption("1");
  await dialog.getByLabel("结束日期").fill(dates.tomorrow);
  await dialog.getByLabel("日程说明").fill("确认下一步");
  await dialog.getByRole("button", { name: "关闭日程" }).click();
  if (!(await calendar.getByRole("button", { name: "日程：团队会议" }).count()))
    throw new Error("Multi-day event did not render");
  await calendar.getByRole("button", { name: "日程：团队会议" }).first().click();
  dialog = page.getByRole("dialog", { name: "编辑日程" });
  if (
    (await dialog.getByLabel("日程说明").inputValue()) !== "确认下一步" ||
    (await dialog.getByLabel("日程颜色").inputValue()) !== "1"
  )
    throw new Error("Event details not saved");
  await dialog.getByRole("button", { name: "关闭日程" }).click();
  await calendar.getByRole("button", { name: "日历下个月" }).click();
  await calendar.getByRole("button", { name: "今天", exact: true }).click();
  for (const framework of ["React", "SolidJS", "Vue"]) {
    await page.getByRole("button", { name: framework, exact: true }).click();
    calendar = page.locator(".semlo-editor-calendar-node");
    if (!(await calendar.getByRole("button", { name: "日程：团队会议" }).count()))
      throw new Error(framework + ": calendar event lost");
  }
  const roundtrip = await page.evaluate(async (dates) => {
    const { createEditor } = await import("/dist/index.js");
    const host = document.createElement("div");
    document.body.append(host);
    const seed = {
      type: "doc",
      content: [
        {
          type: "semloEditorCalendar",
          attrs: {
            events: [
              {
                id: "event-1",
                title: "本地日程",
                start: dates.today,
                end: dates.tomorrow,
                description: "说明",
                color: 2,
              },
            ],
          },
        },
      ],
    };
    const api = createEditor({ element: host, content: seed });
    const snapshot = api.getSnapshot();
    if (!snapshot.html.includes("data-semlo-editor-calendar") || !snapshot.html.includes("本地日程"))
      throw new Error("Calendar HTML missing");
    api.setContent("<p>reset</p>");
    api.setContent(snapshot.html);
    const htmlEvent = api.getSnapshot().json.content?.[0]?.attrs?.events?.[0];
    if (htmlEvent?.title !== "本地日程" || htmlEvent?.description !== "说明" || htmlEvent?.end !== dates.tomorrow)
      throw new Error("Calendar HTML roundtrip failed");
    api.setContent("<p>reset</p>");
    api.setContent(snapshot.json);
    if (!host.querySelector(".semlo-editor-calendar-event")) throw new Error("Calendar JSON roundtrip failed");
    api.destroy();
    host.remove();
    return true;
  }, dates);
  await page.getByRole("button", { name: "只读预览" }).click();
  if (await calendar.locator(".semlo-editor-calendar-add").count())
    throw new Error("Calendar add visible in read-only mode");
  await calendar.getByRole("button", { name: "日程：团队会议" }).first().click();
  dialog = page.getByRole("dialog", { name: "编辑日程" });
  if (!(await dialog.getByLabel("日程标题").isDisabled())) throw new Error("Read-only event editable");
  if (errors.length) throw new Error(errors.join("; "));
  return {
    dates,
    event: true,
    multiDay: true,
    frameworks: ["React", "SolidJS", "Vue"],
    jsonAndHtml: roundtrip,
    readOnly: true,
  };
}
