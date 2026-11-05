import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import type {} from "../../fixtures/browser/core-source-entry";
import { startCoreSourceServer } from "../../fixtures/browser/core-source-server";

let server: Awaited<ReturnType<typeof startCoreSourceServer>>;
beforeAll(async () => {
  server = await startCoreSourceServer();
});
afterAll(async () => server.stop());

test("unsupported calendar color sequence survives HTML and cannot be overwritten by a new event", async ({ page }) => {
  await page.goto(server.origin);
  const values = [9, -1, 1.5, "future", { version: 2 }, true];
  const results = await page.evaluate(
    (inputs) =>
      inputs.map((value) => {
        const host = document.createElement("div");
        document.body.append(host);
        const editor = window.semloSourceCreateEditor({
          element: host,
          content: {
            type: "doc",
            content: [{ type: "semloEditorCalendar", attrs: { events: [], nextColorIndex: value } }],
          },
        });
        const before = editor.getSnapshot();
        editor.setContent(before.html);
        const after = editor.getSnapshot();
        const result = {
          before: before.json.content![0].attrs!.nextColorIndex,
          after: after.json.content![0].attrs!.nextColorIndex,
          warning: host.querySelector(".semlo-editor-calendar-payload-warning")?.textContent,
          addButtons: host.querySelectorAll(".semlo-editor-calendar-add").length,
        };
        editor.destroy();
        host.remove();
        return result;
      }),
    values,
  );
  for (let index = 0; index < values.length; index++) {
    expect(results[index].before).toEqual(values[index]);
    expect(results[index].after).toEqual(values[index]);
    expect(results[index].warning).toContain("颜色");
    expect(results[index].addButtons).toBe(0);
  }
});

test("malformed encoded color sequence reports an error and retains the current document", async ({ page }) => {
  await page.goto(server.origin);
  const result = await page.evaluate(() => {
    const host = document.createElement("div");
    document.body.append(host);
    const errors: string[] = [];
    const editor = window.semloSourceCreateEditor({
      element: host,
      content: "<p>保留的正文</p>",
      onError: (error) => errors.push(error.message),
    });
    const before = editor.getSnapshot().json;
    editor.setContent('<div data-semlo-editor-calendar data-events="[]" data-next-color-index-json="{bad"></div>');
    const after = editor.getSnapshot().json;
    editor.destroy();
    host.remove();
    return { before, after, errors };
  });
  expect(result.after).toEqual(result.before);
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0]).toContain("日历颜色顺序数据损坏");
});
