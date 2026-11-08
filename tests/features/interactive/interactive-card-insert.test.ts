import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { beforeAll, afterAll, expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { createInlineFixtureRsbuild, readInlineFixtureBundle } from "../../fixtures/browser/fixture-bundle";
import type {} from "../../fixtures/interactive/interactive-card-insert-fixture";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

let directory: string;
let bundle: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "semlo-editor-insert-"));
  const builder = await createInlineFixtureRsbuild(
    "insert",
    resolve("tests/fixtures/interactive/interactive-card-insert-fixture.ts"),
    directory,
  );
  await builder.build();
  bundle = await readInlineFixtureBundle(directory);
});
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function mount(page: import("@rstest/playwright").Page, kind: "checkin" | "vote" = "checkin") {
  await page.setContent('<div id="editor"></div>');
  await page.addScriptTag({ content: bundle });
  await page.evaluate((value) => {
    window.__semloRequireFixture("setupInsert")();
    window.__semloRequireFixture("startInsert")(value);
  }, kind);
  await page.waitForFunction(() => window.__semloRequireFixture("insertPending").length === 1);
}

for (const kind of ["checkin", "vote"] as const) {
  test(`${kind} inserts only after the host creates an activity`, async ({ page }) => {
    await mount(page, kind);
    expect(
      await page.evaluate(() => JSON.stringify(window.__semloRequireFixture("insertEditor").getJSON())),
    ).not.toContain("semloEditorCheckin");
    await page.evaluate(() => window.__semloRequireFixture("insertPending")[0].resolve({ cardId: "created-1" }));
    await page.waitForFunction(() => window.__semloRequireDefined("insertResult") !== null);
    expect(await page.evaluate(() => window.__semloRequireDefined("insertResult"))).toEqual({
      status: "inserted",
      cardId: "created-1",
    });
    const document = await page.evaluate(() => window.__semloRequireFixture("insertEditor").getJSON());
    const node = document.content!.find(
      (item) => item.type === (kind === "vote" ? "semloEditorVote" : "semloEditorCheckin"),
    )!;
    expect(node.attrs!.cardId).toBe("created-1");
    if (kind === "vote") {
      expect(node.attrs!.title).toBe("");
      expect(node.attrs!.options.map((option: { label: string }) => option.label)).toEqual(["", ""]);
    } else expect(node.attrs!.buttonLabel).toBe("我已读");
    expect(await page.evaluate(() => window.__semloRequireFixture("insertReports"))).toEqual([]);
  });
}

for (const change of ["selection", "document", "readonly", "destroy", "cancel", "host"] as const) {
  test(`${change} invalidates insertion and reports a late creation`, async ({ page }) => {
    await mount(page);
    await page.evaluate((kind) => {
      if (kind === "selection") window.__semloRequireFixture("insertEditor").commands.setTextSelection(2);
      if (kind === "document") window.__semloRequireFixture("insertEditor").commands.insertContent("变");
      if (kind === "readonly") window.__semloRequireFixture("insertEditor").setEditable(false);
      if (kind === "destroy") window.__semloRequireFixture("insertEditor").destroy();
      if (kind === "cancel") window.__semloRequireFixture("insertCancel").abort();
      if (kind === "host") window.__semloRequireFixture("insertHost").setHost(null);
    }, change);
    await page.waitForFunction(() => window.__semloRequireDefined("insertResult") !== null);
    expect((await page.evaluate(() => window.__semloRequireDefined("insertResult")))?.status).toBe("cancelled");
    expect(await page.evaluate(() => window.__semloRequireFixture("insertPending")[0].signal.aborted)).toBe(true);
    await page.evaluate(() => window.__semloRequireFixture("insertPending")[0].resolve({ cardId: "orphan" }));
    await page.waitForFunction(() => window.__semloRequireFixture("insertReports").length === 1);
    expect(await page.evaluate(() => window.__semloRequireFixture("insertReports"))).toEqual([
      {
        cardId: "orphan",
        reason: change === "cancel" ? "cancelled" : change === "host" ? "host-changed" : "target-changed",
      },
    ]);
    if (change !== "destroy")
      expect(
        await page.evaluate(() => JSON.stringify(window.__semloRequireFixture("insertEditor").getJSON())),
      ).not.toContain("orphan");
  });
}

test("creation failure leaves the document unchanged", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => window.__semloRequireFixture("insertPending")[0].reject(new Error("failed")));
  await page.waitForFunction(() => window.__semloRequireDefined("insertResult") !== null);
  expect((await page.evaluate(() => window.__semloRequireDefined("insertResult")))?.status).toBe("failed");
  expect(await page.evaluate(() => window.__semloRequireFixture("insertReports"))).toEqual([]);
  expect(
    await page.evaluate(() => JSON.stringify(window.__semloRequireFixture("insertEditor").getJSON())),
  ).not.toContain("semloEditorCheckin");
});

test("reports a created activity when insertion fails", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    Object.defineProperty(window.__semloRequireFixture("insertEditor"), "commands", {
      configurable: true,
      value: { insertContentAt: () => false },
    });
    window.__semloRequireFixture("insertPending")[0].resolve({ cardId: "uninserted" });
  });
  await page.waitForFunction(() => window.__semloRequireDefined("insertResult") !== null);
  expect((await page.evaluate(() => window.__semloRequireDefined("insertResult")))?.status).toBe("failed");
  expect(await page.evaluate(() => window.__semloRequireFixture("insertReports"))).toEqual([
    { cardId: "uninserted", reason: "insert-failed" },
  ]);
});

test("reports an ID conflict without inserting a second card", async ({ page }) => {
  await page.setContent('<div id="editor"></div>');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => {
    window.__semloRequireFixture("setupInsert")();
    window
      .__semloRequireFixture("insertEditor")
      .commands.insertContent({ type: "semloEditorCheckin", attrs: { cardId: "existing" } });
    window.__semloRequireFixture("startInsert")("checkin");
    window.__semloRequireFixture("insertPending")[0].resolve({ cardId: "existing" });
  });
  await page.waitForFunction(() => window.__semloRequireDefined("insertResult") !== null);
  expect((await page.evaluate(() => window.__semloRequireDefined("insertResult")))?.status).toBe("failed");
  expect(await page.evaluate(() => window.__semloRequireFixture("insertReports"))).toEqual([
    { cardId: "existing", reason: "id-conflict" },
  ]);
  expect(await page.locator(".semlo-editor-checkin-card").count()).toBe(1);
});

for (const outcome of ["success", "failure", "changed"] as const) {
  test(`slash range ${outcome} preserves text until an atomic successful insertion`, async ({ page }) => {
    await page.setContent('<div id="editor"></div>');
    await page.addScriptTag({ content: bundle });
    await page.evaluate(() => {
      window.__semloRequireFixture("setupInsert")();
      window.__semloRequireFixture("insertEditor").commands.setContent("<p>/投票</p>");
      window.__semloRequireFixture("insertEditor").commands.setTextSelection(4);
      window.__semloRequireFixture("startInsert")("vote", { kind: "slash", range: { from: 1, to: 4 } });
    });
    expect(await page.evaluate(() => window.__semloRequireFixture("insertEditor").getText())).toBe("/投票");
    expect(await page.evaluate(() => window.__semloRequireFixture("docChanges"))).toBe(0);
    if (outcome === "failure")
      await page.evaluate(() => window.__semloRequireFixture("insertPending")[0].reject(new Error("failed")));
    if (outcome === "changed")
      await page.evaluate(() => {
        window.__semloRequireFixture("insertEditor").commands.insertContent("x");
        window.__semloRequireFixture("insertPending")[0].resolve({ cardId: "unused" });
      });
    if (outcome === "success")
      await page.evaluate(() => window.__semloRequireFixture("insertPending")[0].resolve({ cardId: "vote-created" }));
    await page.waitForFunction(() => window.__semloRequireDefined("insertResult") !== null);
    if (outcome === "success") {
      expect((await page.evaluate(() => window.__semloRequireDefined("insertResult")))?.status).toBe("inserted");
      expect(await page.evaluate(() => window.__semloRequireFixture("insertEditor").getText())).not.toContain("/投票");
      expect(await page.locator(".semlo-editor-vote-card").count()).toBe(1);
      expect(await page.evaluate(() => window.__semloRequireFixture("docChanges"))).toBe(1);
    } else {
      expect((await page.evaluate(() => window.__semloRequireDefined("insertResult")))?.status).toBe(
        outcome === "changed" ? "cancelled" : "failed",
      );
      expect(await page.evaluate(() => window.__semloRequireFixture("insertEditor").getText())).toContain("/投票");
      expect(await page.locator(".semlo-editor-vote-card").count()).toBe(0);
    }
  });
}

for (const targetKind of ["block", "item"] as const) {
  test(`insert below ${targetKind} changes the document only after creation`, async ({ page }) => {
    await page.setContent('<div id="editor"></div>');
    await page.addScriptTag({ content: bundle });
    await page.evaluate((kind) => {
      window.__semloRequireFixture("setupInsert")();
      window
        .__semloRequireFixture("insertEditor")
        .commands.setContent(kind === "block" ? "<p>原块</p><p>后块</p>" : "<ul><li><p>原项</p></li></ul>");
      let found:
        | { pos: number; after: number; node: import("@tiptap/pm/model").Node; kind: "block" | "item" }
        | undefined;
      window.__semloRequireFixture("insertEditor").state.doc.descendants((node, pos) => {
        if (!found && node.type.name === (kind === "block" ? "paragraph" : "listItem"))
          found = { pos, after: pos + node.nodeSize, node, kind };
      });
      window.__semloRequireFixture("startInsert")("checkin", { kind: "below", target: found! });
    }, targetKind);
    expect(await page.evaluate(() => window.__semloRequireFixture("docChanges"))).toBe(0);
    expect(await page.locator(".semlo-editor-checkin-card").count()).toBe(0);
    await page.evaluate(() => window.__semloRequireFixture("insertPending")[0].resolve({ cardId: "created-below" }));
    await page.waitForFunction(() => window.__semloRequireDefined("insertResult") !== null);
    expect((await page.evaluate(() => window.__semloRequireDefined("insertResult")))?.status).toBe("inserted");
    expect(await page.evaluate(() => window.__semloRequireFixture("docChanges"))).toBe(1);
    const document = await page.evaluate(() => window.__semloRequireFixture("insertEditor").getJSON());
    if (targetKind === "block")
      expect(document.content!.map((node) => node.type)).toEqual(["paragraph", "semloEditorCheckin", "paragraph"]);
    else expect(document.content![0].content!.map((node) => node.type)).toEqual(["listItem", "listItem"]);
    await expect(page.locator(".semlo-editor-checkin-card")).toHaveCount(1);
  });
}

test("inserting below rejects stale targets without creating an activity", async ({ page }) => {
  await page.setContent('<div id="editor"></div>');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => {
    window.__semloRequireFixture("setupInsert")();
    const node = window.__semloRequireFixture("insertEditor").state.doc.nodeAt(0)!;
    window.__semloRequireFixture("startInsert")("checkin", {
      kind: "below",
      target: { pos: 0, after: node.nodeSize + 1, node, kind: "block" },
    });
  });
  await page.waitForFunction(() => window.__semloRequireDefined("insertResult") !== null);
  expect(await page.evaluate(() => window.__semloRequireFixture("insertPending").length)).toBe(0);
  expect((await page.evaluate(() => window.__semloRequireDefined("insertResult")))?.status).toBe("cancelled");
});

test("an observer error after insertion does not report a live activity for cleanup", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    const insert = window.__semloRequireFixture("insertEditor").commands.insertContentAt;
    Object.defineProperty(window.__semloRequireFixture("insertEditor"), "commands", {
      configurable: true,
      value: {
        insertContentAt: (...args: Parameters<typeof insert>) => {
          insert(...args);
          throw new Error("observer failed");
        },
      },
    });
    window.__semloRequireFixture("insertPending")[0].resolve({ cardId: "live" });
  });
  await page.waitForFunction(() => window.__semloRequireDefined("insertResult") !== null);
  expect(await page.evaluate(() => window.__semloRequireDefined("insertResult"))).toEqual({
    status: "inserted",
    cardId: "live",
  });
  expect(await page.evaluate(() => window.__semloRequireFixture("insertReports"))).toEqual([]);
  await expect(page.locator(".semlo-editor-checkin-card")).toHaveCount(1);
});

test("late creation reports a conflict when its ID is already used by a card", async ({ page }) => {
  await page.setContent('<div id="editor"></div>');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => {
    window.__semloRequireFixture("setupInsert")();
    window
      .__semloRequireFixture("insertEditor")
      .commands.insertContent({ type: "semloEditorCheckin", attrs: { cardId: " existing " } });
    window.__semloRequireFixture("startInsert")("checkin");
    window.__semloRequireFixture("insertCancel").abort();
    window.__semloRequireFixture("insertPending")[0].resolve({ cardId: "existing" });
  });
  await page.waitForFunction(() => window.__semloRequireFixture("insertReports").length === 1);
  expect(await page.evaluate(() => window.__semloRequireFixture("insertReports"))).toEqual([
    { cardId: "existing", reason: "id-conflict" },
  ]);
});

test("a late creation detects a card added while creation was pending", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    window
      .__semloRequireFixture("insertEditor")
      .commands.insertContent({ type: "semloEditorVote", attrs: { cardId: "created" } });
    window.__semloRequireFixture("insertPending")[0].resolve({ cardId: "created" });
  });
  await page.waitForFunction(() => window.__semloRequireFixture("insertReports").length === 1);
  expect(await page.evaluate(() => window.__semloRequireFixture("insertReports"))).toEqual([
    { cardId: "created", reason: "id-conflict" },
  ]);
});

test("an existing activity ID with surrounding whitespace still blocks insertion", async ({ page }) => {
  await page.setContent('<div id="editor"></div>');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => {
    window.__semloRequireFixture("setupInsert")();
    window
      .__semloRequireFixture("insertEditor")
      .commands.insertContent({ type: "semloEditorCheckin", attrs: { cardId: " existing " } });
    window.__semloRequireFixture("startInsert")("checkin");
    window.__semloRequireFixture("insertPending")[0].resolve({ cardId: "existing" });
  });
  await page.waitForFunction(() => window.__semloRequireDefined("insertResult") !== null);
  expect((await page.evaluate(() => window.__semloRequireDefined("insertResult")))?.status).toBe("failed");
  expect(await page.evaluate(() => window.__semloRequireFixture("insertReports"))).toEqual([
    { cardId: "existing", reason: "id-conflict" },
  ]);
  expect(await page.locator(".semlo-editor-checkin-card").count()).toBe(1);
});
