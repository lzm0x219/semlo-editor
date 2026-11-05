import { afterAll, beforeAll, expect, test, type Locator, type Page } from "@rstest/playwright";

import type {} from "../../fixtures/browser/core-source-entry";
import { startCoreSourceServer } from "../../fixtures/browser/core-source-server";
import { readEditorStyles } from "../../fixtures/shared/editor-styles";

let server: Awaited<ReturnType<typeof startCoreSourceServer>>;
beforeAll(async () => {
  server = await startCoreSourceServer();
});
afterAll(async () => server.stop());

async function tabTo(page: Page, target: Locator) {
  for (let index = 0; index < 16; index++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

async function expectUnclipped(page: Page, status: Locator) {
  await status.scrollIntoViewIfNeeded();
  const result = await status.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(element);
    const lines = Array.from(range.getClientRects());
    let ancestor: Element | null = element.parentElement;
    let ancestorClipped = false;
    while (ancestor) {
      const style = getComputedStyle(ancestor);
      const bounds = ancestor.getBoundingClientRect();
      if (
        ["hidden", "clip"].includes(style.overflowX) &&
        (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)
      )
        ancestorClipped = true;
      if (
        ["hidden", "clip"].includes(style.overflowY) &&
        (rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1)
      )
        ancestorClipped = true;
      ancestor = ancestor.parentElement;
    }
    return {
      viewport: innerWidth,
      viewportHeight: innerHeight,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      lineCount: lines.length,
      textClipped: lines.some(
        (line) =>
          line.left < rect.left - 1 ||
          line.right > rect.right + 1 ||
          line.top < rect.top - 1 ||
          line.bottom > rect.bottom + 1,
      ),
      verticalOverflow: element.scrollHeight > element.clientHeight + 1,
      ancestorClipped,
    };
  });
  expect(result.viewport).toBe(375);
  expect(result.left).toBeGreaterThanOrEqual(0);
  expect(result.right).toBeLessThanOrEqual(375);
  expect(result.top).toBeGreaterThanOrEqual(0);
  expect(result.bottom).toBeLessThanOrEqual(result.viewportHeight);
  expect(result.lineCount).toBeGreaterThan(0);
  expect(result.textClipped).toBe(false);
  expect(result.verticalOverflow).toBe(false);
  expect(result.ancestorClipped).toBe(false);
}

for (const kind of ["vote", "checkin"] as const) {
  test(`${kind} 损坏截止日期在窄屏可见，键盘可继续并在数据修复后参与`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    try {
      await page.goto(server.origin);
      await page.evaluate(() => {
        const meta = document.createElement("meta");
        meta.name = "viewport";
        meta.content = "width=device-width, initial-scale=1";
        document.head.append(meta);
      });
      await page.addStyleTag({ content: readEditorStyles() });
      await page.evaluate((type) => {
        const before = document.createElement("button");
        before.textContent = "前一个控件";
        const host = document.createElement("div");
        host.id = "mobile-interactive";
        const after = document.createElement("button");
        after.textContent = "后一个控件";
        document.body.append(before, host, after);
        const calls: string[] = [];
        const interactiveCardHost = {
          createActivity: async () => ({ cardId: "new" }),
          verifyConfiguration: async () => {
            calls.push("verify");
            return true;
          },
          syncConfiguration: async () => {
            calls.push("sync");
          },
          checkin: {
            getStatus: async () => {
              calls.push("checkin-status");
              return { checkedIn: false };
            },
            checkIn: async () => {
              calls.push("checkin");
              return { checkedIn: true };
            },
          },
          vote: {
            getStatus: async () => {
              calls.push("vote-status");
              return { canVote: true, selectedOptionIds: [] };
            },
            submitVote: async () => {
              calls.push("vote");
              return { canVote: false, selectedOptionIds: [] };
            },
          },
        };
        const editor = window.semloSourceCreateEditor({
          element: host,
          toolbar: false,
          outline: false,
          editable: false,
          interactiveCardHost,
          content: {
            type: "doc",
            content: [
              {
                type: type === "vote" ? "semloEditorVote" : "semloEditorCheckin",
                attrs: {
                  cardId: "invalid-mobile",
                  title: "活动标题",
                  ...(type === "vote" ? { options: [{ id: "a", label: "甲选项" }] } : {}),
                  deadline: "2026-02-30",
                },
              },
            ],
          },
        });
        Reflect.set(window, "mobileWarningFixture", { editor, calls });
      }, kind);
      const card = page.locator(kind === "vote" ? ".semlo-editor-vote-card" : ".semlo-editor-checkin-card");
      const warning = card.getByRole("status");
      await expect(warning).toContainText("截止日期格式不受支持");
      await expectUnclipped(page, warning);
      await expect(card.locator("button, input, select, textarea")).toHaveCount(0);
      await warning.tap();
      await page.getByRole("button", { name: "前一个控件" }).focus();
      await tabTo(page, page.getByRole("button", { name: "后一个控件" }));
      await page.keyboard.press("Enter");
      expect(await page.evaluate(() => Reflect.get(window, "mobileWarningFixture").calls)).toEqual([]);

      await page.evaluate(() => {
        const { editor } = Reflect.get(window, "mobileWarningFixture");
        const content = editor.getSnapshot().json;
        content.content[0].attrs.deadline = null;
        editor.setContent(content);
      });
      await page.getByRole("button", { name: "前一个控件" }).focus();
      if (kind === "vote") {
        const option = card.getByRole("radio", { name: "甲选项" });
        await expect(option).toBeEnabled();
        await tabTo(page, option);
        await page.keyboard.press("Space");
        const submit = card.getByRole("button", { name: "投票", exact: true });
        await expect(submit).toBeEnabled();
        await tabTo(page, submit);
        await page.keyboard.press("Enter");
        await expect
          .poll(() => page.evaluate(() => Reflect.get(window, "mobileWarningFixture").calls))
          .toContain("vote");
      } else {
        const action = card.getByRole("button", { name: "我已读" });
        await expect(action).toBeEnabled();
        await tabTo(page, action);
        await page.keyboard.press("Enter");
        await expect
          .poll(() => page.evaluate(() => Reflect.get(window, "mobileWarningFixture").calls))
          .toContain("checkin");
      }
      await page.evaluate(() => Reflect.get(window, "mobileWarningFixture").editor.destroy());
    } finally {
      await context.close();
    }
  });
}

test("日历损坏数据警告在窄屏可见，键盘导航和数据修复后新建仍可用", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
    await page.goto(server.origin);
    await page.evaluate(() => {
      const meta = document.createElement("meta");
      meta.name = "viewport";
      meta.content = "width=device-width, initial-scale=1";
      document.head.append(meta);
    });
    await page.addStyleTag({ content: readEditorStyles() });
    await page.evaluate(() => {
      const before = document.createElement("button");
      before.textContent = "前一个控件";
      const host = document.createElement("div");
      host.id = "mobile-calendar";
      document.body.append(before, host);
      const editor = window.semloSourceCreateEditor({
        element: host,
        toolbar: false,
        outline: false,
        content: {
          type: "doc",
          content: [{ type: "semloEditorCalendar", attrs: { events: { future: "保留" }, nextColorIndex: 9 } }],
        },
      });
      Reflect.set(window, "mobileCalendarEditor", editor);
    });
    const calendar = page.locator("#mobile-calendar .semlo-editor-calendar-node");
    const warning = calendar.getByRole("status");
    await expect(warning).toContainText("日程数据格式不受支持");
    await expect(warning).toContainText("日历颜色顺序格式不受支持");
    await expectUnclipped(page, warning);
    await expect(calendar.locator(".semlo-editor-calendar-add")).toHaveCount(0);
    await calendar.locator('.semlo-editor-calendar-cell[data-date="2026-11-02"]').tap();
    await expect(page.getByRole("dialog", { name: "添加日程" })).toHaveCount(0);
    await page.getByRole("button", { name: "前一个控件" }).focus();
    const previous = calendar.getByRole("button", { name: "日历上个月" });
    await tabTo(page, previous);
    await page.keyboard.press("Enter");
    await expect(calendar.locator(".semlo-editor-calendar-month")).toContainText("10 月");
    await expect(warning).toContainText("日程数据格式不受支持");
    const retained = await page.evaluate(
      () => Reflect.get(window, "mobileCalendarEditor").getSnapshot().json.content[0].attrs,
    );
    expect(retained.events).toEqual({ future: "保留" });
    expect(retained.nextColorIndex).toBe(9);

    await page.evaluate(() => {
      const editor = Reflect.get(window, "mobileCalendarEditor");
      const content = editor.getSnapshot().json;
      content.content[0].attrs.events = [];
      content.content[0].attrs.nextColorIndex = 0;
      editor.setContent(content);
    });
    await expect(calendar.getByRole("status")).toHaveCount(0);
    const add = calendar.locator(".semlo-editor-calendar-add").first();
    await calendar.getByRole("button", { name: "日历上个月" }).focus();
    await tabTo(page, add);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "添加日程" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "添加日程" })).toHaveCount(0);
    await page.evaluate(() => Reflect.get(window, "mobileCalendarEditor").destroy());
  } finally {
    await context.close();
  }
});
