import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../fixtures/browser/fixture-rsbuild";
import type {} from "../fixtures/lifecycle/destroy-audit-fixture";
let origin = "";
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  ({ origin, stop } = await startFixtureServer("./tests/fixtures/lifecycle/destroy-audit-fixture.ts"));
});
afterAll(async () => stop?.());
test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountDestroyAudit === "function");
});

test("direct editor destruction releases its UI, preserves document and leaves the other editor usable", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  const result = await page.evaluate(async () => {
    window.__semloRequireFixture("mountDestroyAudit")();
    const fixture = window.__semloRequireFixture("destroyAuditFixture");
    const { first, second } = fixture;
    const before = window.__semloRequireFixture("destroyAuditRaw")(first);
    second.editor.view.focus();
    const secondFocusedBefore = second.editor.view.hasFocus();
    first.editor.destroy();
    const afterDirect = {
      destroyed: first.editor.isDestroyed,
      firstShell: !!document.querySelector("#destroy-first .semlo-editor"),
      secondShell: !!document.querySelector("#destroy-second .semlo-editor"),
      secondFocusedBefore,
      secondFocusedAfter: second.editor.view.hasFocus(),
      tableToolbar: document.querySelectorAll(".semlo-editor-table-toolbar").length,
    };
    const finalSnapshot = window.__semloRequireFixture("destroyAuditRaw")(first);
    const mutable = window.__semloRequireFixture("destroyAuditRaw")(first);
    mutable.json.content?.splice(0);
    const freshSnapshot = window.__semloRequireFixture("destroyAuditRaw")(first);
    first.setContent("<p>replacement</p>");
    first.setEditable(false);
    first.setIntegrations({ searchMentions: async () => [] });
    first.focus();
    first.destroy();
    first.destroy();
    const secondEdit = second.editor.commands.insertContent("X");
    const secondText = second.getSnapshot().text;
    second.destroy();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return {
      before,
      afterDirect,
      finalSnapshot,
      freshSnapshot,
      secondEdit,
      secondText,
      final: {
        listeners: fixture.listenerCounts(),
        observers: fixture.observerCounts(),
        errors: fixture.errors,
        changes: fixture.changes,
      },
    };
  });
  expect(result.afterDirect).toEqual({
    destroyed: true,
    firstShell: false,
    secondShell: true,
    secondFocusedBefore: true,
    secondFocusedAfter: true,
    tableToolbar: 1,
  });
  expect(result.finalSnapshot).toEqual(result.before);
  expect(result.freshSnapshot).toEqual(result.before);
  expect(result.secondEdit).toBe(true);
  expect(result.secondText).toBe("secondX");
  expect(result.final).toEqual({
    listeners: {},
    observers: { mutations: 0, resizes: 0 },
    errors: [],
    changes: ["second"],
  });
  expect(pageErrors).toEqual([]);
});

for (const mode of ["editor-transaction", "controller-transaction", "editor-change", "controller-change"] as const) {
  test(`synchronous ${mode} reentry completes, preserves state and clears both instances`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    const result = await page.evaluate(async (mode) => {
      window.__semloRequireFixture("mountDestroyAudit")(mode);
      const fixture = window.__semloRequireFixture("destroyAuditFixture");
      const { first, second } = fixture;
      first.editor.view.dispatch(first.editor.state.tr.insertText("X", 1).setMeta("destroyAudit", true));
      const finalText = window.__semloRequireFixture("destroyAuditRaw")(first).text;
      const firstDestroyed = first.editor.isDestroyed;
      first.destroy();
      first.destroy();
      second.editor.commands.insertContent("Y");
      const secondText = second.getSnapshot().text;
      second.destroy();
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return {
        firstDestroyed,
        finalText,
        secondText,
        changes: fixture.changes,
        errors: fixture.errors,
        listeners: fixture.listenerCounts(),
        observers: fixture.observerCounts(),
        firstShell: !!document.querySelector("#destroy-first .semlo-editor"),
      };
    }, mode);
    expect(result.firstDestroyed).toBe(true);
    expect(result.finalText).toContain("Xfirst");
    expect(result.secondText).toBe("secondY");
    expect(result.firstShell).toBe(false);
    expect(result.listeners).toEqual({});
    expect(result.observers).toEqual({ mutations: 0, resizes: 0 });
    expect(result.errors).toEqual([]);
    expect(result.changes).toEqual(mode.endsWith("change") ? ["first", "second"] : ["second"]);
    expect(pageErrors).toEqual([]);
  });
}

test("host onDestroy can reenter controller destruction before its destroy listener", async ({ page }) => {
  const result = await page.evaluate(async () => {
    window.__semloRequireFixture("mountDestroyAudit")("controller-in-editor-destroy");
    const { first, second, ...fixture } = window.__semloRequireFixture("destroyAuditFixture");
    const before = window.__semloRequireFixture("destroyAuditRaw")(first);
    first.editor.destroy();
    first.destroy();
    const after = window.__semloRequireFixture("destroyAuditRaw")(first);
    second.editor.commands.insertContent("Y");
    const secondText = second.getSnapshot().text;
    second.destroy();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return {
      before,
      after,
      secondText,
      listeners: fixture.listenerCounts(),
      observers: fixture.observerCounts(),
      errors: fixture.errors,
    };
  });
  expect(result.after).toEqual(result.before);
  expect(result.secondText).toBe("secondY");
  expect(result.listeners).toEqual({});
  expect(result.observers).toEqual({ mutations: 0, resizes: 0 });
  expect(result.errors).toEqual([]);
});

for (const kind of ["find", "translation", "link", "painter"] as const) {
  test(`direct destruction closes active ${kind} UI and releases document observers`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    const opened = await page.evaluate(async (kind) => {
      window.__semloRequireFixture("mountDestroyAudit")();
      const fixture = window.__semloRequireFixture("destroyAuditFixture");
      fixture.first.editor.commands.setTextSelection({ from: 1, to: 6 });
      const root = document.querySelector<HTMLElement>("#destroy-first")!;
      const labels = { find: "查找替换", translation: "翻译", link: "链接", painter: "格式刷" };
      root.querySelector<HTMLButtonElement>(`button[aria-label="${labels[kind]}"]`)!.click();
      await Promise.resolve();
      return {
        find: !!document.querySelector(".semlo-editor-find-panel"),
        translation: !root.querySelector<HTMLElement>(".semlo-editor-translation-panel")!.hidden,
        link: !!document.querySelector(".semlo-editor-link-form"),
        painter: root.querySelector('[aria-label="格式刷"]')?.getAttribute("aria-pressed") === "true",
        requests: fixture.translationSignals.length,
      };
    }, kind);
    expect(opened[kind]).toBe(true);
    if (kind === "translation") expect(opened.requests).toBe(1);
    const result = await page.evaluate(async () => {
      const fixture = window.__semloRequireFixture("destroyAuditFixture");
      fixture.first.editor.destroy();
      const aborted = fixture.translationSignals.every((signal) => signal.aborted);
      const removed = {
        shell: !document.querySelector("#destroy-first .semlo-editor"),
        find: !document.querySelector(".semlo-editor-find-panel"),
        link: !document.querySelector(".semlo-editor-link-form"),
      };
      fixture.second.editor.commands.insertContent("Z");
      const secondText = fixture.second.getSnapshot().text;
      fixture.second.destroy();
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return {
        aborted,
        removed,
        secondText,
        listeners: fixture.listenerCounts(),
        observers: fixture.observerCounts(),
        errors: fixture.errors,
      };
    });
    expect(result.aborted).toBe(true);
    expect(result.removed).toEqual({ shell: true, find: true, link: true });
    expect(result.secondText).toBe("secondZ");
    expect(result.listeners).toEqual({});
    expect(result.observers).toEqual({ mutations: 0, resizes: 0 });
    expect(result.errors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
}

for (const mode of ["direct", "controller", "unmount"] as const) {
  test(`${mode} destruction during a table resize clears the active drag and keeps the other editor`, async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.evaluate(() => window.__semloRequireFixture("mountDestroyAudit")());
    const before = await page.evaluate(() =>
      window.__semloRequireFixture("destroyAuditRaw")(window.__semloRequireFixture("destroyAuditFixture").first),
    );
    const cell = page.locator("#destroy-first .semlo-editor-prose td").first();
    await cell.click();
    const box = await cell.boundingBox();
    if (!box) throw new Error("table cell has no layout");
    const x = box.x + box.width - 1;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await expect(page.locator("#destroy-first .column-resize-handle").first()).toBeVisible();
    await page.mouse.down();
    await page.mouse.move(x + 20, y);
    const result = await page.evaluate((mode) => {
      const fixture = window.__semloRequireFixture("destroyAuditFixture");
      const during = fixture.listenerCounts();
      if (mode === "direct") fixture.first.editor.destroy();
      else if (mode === "controller") fixture.first.destroy();
      else {
        fixture.first.editor.unmount();
        fixture.first.destroy();
      }
      const snapshot = window.__semloRequireFixture("destroyAuditRaw")(fixture.first);
      const after = fixture.listenerCounts();
      fixture.second.editor.commands.insertContent("Q");
      return { during, after, snapshot, secondText: fixture.second.getSnapshot().text };
    }, mode);
    await page.mouse.up();
    const final = await page.evaluate(async () => {
      const fixture = window.__semloRequireFixture("destroyAuditFixture");
      const secondText = fixture.second.getSnapshot().text;
      fixture.second.destroy();
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return {
        secondText,
        listeners: fixture.listenerCounts(),
        observers: fixture.observerCounts(),
        errors: fixture.errors,
      };
    });
    expect(result.snapshot).toEqual(before);
    expect(result.during["window:mousemove:false"]).toBe(1);
    expect(result.during["window:mouseup:false"]).toBe(1);
    expect(result.after["window:mousemove:false"]).toBeUndefined();
    expect(result.after["window:mouseup:false"]).toBeUndefined();
    expect(result.secondText).toBe("secondQ");
    expect(final.secondText).toBe("secondQ");
    expect(final.listeners).toEqual({});
    expect(final.observers).toEqual({ mutations: 0, resizes: 0 });
    expect(final.errors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
}

for (const mode of ["direct", "controller"] as const) {
  test(`${mode} destruction during the table drag-start transaction does not register stale listeners`, async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.evaluate(() => window.__semloRequireFixture("mountDestroyAudit")());
    const cell = page.locator("#destroy-first .semlo-editor-prose td").first();
    await cell.click();
    const box = await cell.boundingBox();
    if (!box) throw new Error("table cell has no layout");
    const x = box.x + box.width - 1;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await expect(page.locator("#destroy-first .column-resize-handle").first()).toBeVisible();
    await page.evaluate((mode) => {
      const fixture = window.__semloRequireFixture("destroyAuditFixture");
      let fired = false;
      fixture.first.editor.on("transaction", () => {
        if (fired) return;
        fired = true;
        if (mode === "direct") fixture.first.editor.destroy();
        else fixture.first.destroy();
      });
    }, mode);
    await page.mouse.down();
    const observed = await page.evaluate(() => {
      const fixture = window.__semloRequireFixture("destroyAuditFixture");
      return {
        destroyed: fixture.first.editor.isDestroyed,
        listeners: fixture.listenerCounts(),
        snapshot: window.__semloRequireFixture("destroyAuditRaw")(fixture.first),
      };
    });
    await page.mouse.up();
    const final = await page.evaluate(async () => {
      const fixture = window.__semloRequireFixture("destroyAuditFixture");
      fixture.second.editor.commands.insertContent("T");
      const secondText = fixture.second.getSnapshot().text;
      fixture.second.destroy();
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return {
        secondText,
        listeners: fixture.listenerCounts(),
        observers: fixture.observerCounts(),
        errors: fixture.errors,
      };
    });
    expect(observed.destroyed).toBe(true);
    expect(observed.listeners["window:mousemove:false"]).toBeUndefined();
    expect(observed.listeners["window:mouseup:false"]).toBeUndefined();
    expect(observed.snapshot.text).toContain("first");
    expect(final.secondText).toBe("secondT");
    expect(final.listeners).toEqual({});
    expect(final.observers).toEqual({ mutations: 0, resizes: 0 });
    expect(final.errors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
}

for (const eventName of ["semlo-editor:document-replace", "semlo-editor:editable"] as const) {
  test(`host destroys editor while ${eventName} is being dispatched`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const result = await page.evaluate(async (name) => {
      window.__semloRequireFixture("mountDestroyAudit")();
      const fixture = window.__semloRequireFixture("destroyAuditFixture");
      const { first, second } = fixture;
      const before = window.__semloRequireFixture("destroyAuditRaw")(first);
      first.editor.view.dom.addEventListener(name, () => first.editor.destroy(), { once: true });
      if (name === "semlo-editor:document-replace") first.setContent("<p>replacement</p>");
      else first.setEditable(false);
      const after = window.__semloRequireFixture("destroyAuditRaw")(first);
      first.destroy();
      second.editor.commands.insertContent("R");
      const secondText = second.getSnapshot().text;
      second.destroy();
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return {
        before,
        after,
        secondText,
        listeners: fixture.listenerCounts(),
        observers: fixture.observerCounts(),
        errors: fixture.errors,
      };
    }, eventName);
    expect(result.after).toEqual(result.before);
    expect(result.secondText).toBe("secondR");
    expect(result.listeners).toEqual({});
    expect(result.observers).toEqual({ mutations: 0, resizes: 0 });
    expect(result.errors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
}

test("queued mention refresh is cancelled when the editor is destroyed in the same turn", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const result = await page.evaluate(async () => {
    window.__semloRequireFixture("mountDestroyAudit")();
    const fixture = window.__semloRequireFixture("destroyAuditFixture");
    fixture.first.setIntegrations({ searchMentions: async () => [] });
    fixture.first.editor.destroy();
    await Promise.resolve();
    fixture.second.editor.commands.insertContent("W");
    const secondText = fixture.second.getSnapshot().text;
    fixture.second.destroy();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return {
      secondText,
      listeners: fixture.listenerCounts(),
      observers: fixture.observerCounts(),
      errors: fixture.errors,
    };
  });
  expect(result.secondText).toBe("secondW");
  expect(result.listeners).toEqual({});
  expect(result.observers).toEqual({ mutations: 0, resizes: 0 });
  expect(result.errors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("host onDestroy cannot mutate the document through the controller after destruction starts", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const result = await page.evaluate(async () => {
    window.__semloRequireFixture("mountDestroyAudit")("mutations-in-editor-destroy");
    const fixture = window.__semloRequireFixture("destroyAuditFixture");
    const before = window.__semloRequireFixture("destroyAuditRaw")(fixture.first);
    fixture.first.editor.destroy();
    const after = window.__semloRequireFixture("destroyAuditRaw")(fixture.first);
    fixture.first.destroy();
    fixture.second.destroy();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return {
      before,
      after,
      changes: fixture.changes,
      errors: fixture.errors,
      listeners: fixture.listenerCounts(),
      observers: fixture.observerCounts(),
    };
  });
  expect(result.after).toEqual(result.before);
  expect(result.changes).toEqual([]);
  expect(result.errors).toEqual([]);
  expect(result.listeners).toEqual({});
  expect(result.observers).toEqual({ mutations: 0, resizes: 0 });
  expect(pageErrors).toEqual([]);
});

test("setContent handles destruction during upload-cleanup transaction", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const result = await page.evaluate(async () => {
    window.__semloRequireFixture("mountDestroyAudit")();
    const fixture = window.__semloRequireFixture("destroyAuditFixture");
    const { first, second } = fixture;
    const before = window.__semloRequireFixture("destroyAuditRaw")(first);
    first.editor.on("transaction", () => first.editor.destroy());
    first.setContent("<p>replacement</p>");
    const after = window.__semloRequireFixture("destroyAuditRaw")(first);
    first.destroy();
    second.destroy();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return {
      before,
      after,
      errors: fixture.errors,
      listeners: fixture.listenerCounts(),
      observers: fixture.observerCounts(),
    };
  });
  expect(result.after).toEqual(result.before);
  expect(result.errors).toEqual([]);
  expect(result.listeners).toEqual({});
  expect(result.observers).toEqual({ mutations: 0, resizes: 0 });
  expect(pageErrors).toEqual([]);
});

test("setEditable handles destruction from translation abort handler", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const result = await page.evaluate(async () => {
    window.__semloRequireFixture("mountDestroyAudit")();
    const fixture = window.__semloRequireFixture("destroyAuditFixture");
    const { first, second } = fixture;
    first.editor.commands.setTextSelection({ from: 1, to: 6 });
    document.querySelector<HTMLButtonElement>('#destroy-first button[aria-label="翻译"]')!.click();
    await Promise.resolve();
    const signal = fixture.translationSignals[0];
    if (!signal) throw new Error("translation request did not start");
    signal.addEventListener("abort", () => first.editor.destroy(), { once: true });
    let error = "";
    try {
      first.setEditable(false);
    } catch (cause) {
      error = String(cause);
    }
    const snapshot = window.__semloRequireFixture("destroyAuditRaw")(first);
    first.destroy();
    second.destroy();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return {
      error,
      aborted: signal.aborted,
      snapshot,
      errors: fixture.errors,
      listeners: fixture.listenerCounts(),
      observers: fixture.observerCounts(),
    };
  });
  expect(result.error).toBe("");
  expect(result.aborted).toBe(true);
  expect(result.snapshot.text).toContain("first");
  expect(result.errors).toEqual([]);
  expect(result.listeners).toEqual({});
  expect(result.observers).toEqual({ mutations: 0, resizes: 0 });
  expect(pageErrors).toEqual([]);
});

test("setIntegrations handles destruction from embed resolver notification", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const result = await page.evaluate(async () => {
    window.__semloRequireFixture("mountDestroyAudit")();
    const fixture = window.__semloRequireFixture("destroyAuditFixture");
    const { first, second } = fixture;
    const before = window.__semloRequireFixture("destroyAuditRaw")(first);
    let destroyedState: typeof first.editor.state | undefined;
    first.editor.view.dom.addEventListener(
      "semlo-editor:embed-metadata",
      () => {
        first.editor.destroy();
        destroyedState = first.editor.state;
      },
      { once: true },
    );
    let error = "";
    try {
      first.setIntegrations({
        resolveEmbedMetadata: async () => null,
        interactiveCardHost: {
          createActivity: async () => ({ cardId: "id" }),
          verifyConfiguration: async () => true,
          syncConfiguration: async () => {},
        },
      });
    } catch (cause) {
      error = String(cause);
    }
    const after = window.__semloRequireFixture("destroyAuditRaw")(first);
    first.destroy();
    second.destroy();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return {
      before,
      after,
      error,
      unchangedState: first.editor.state === destroyedState,
      errors: fixture.errors,
      listeners: fixture.listenerCounts(),
      observers: fixture.observerCounts(),
    };
  });
  expect(result.error).toBe("");
  expect(result.after).toEqual(result.before);
  expect(result.unchangedState).toBe(true);
  expect(result.errors).toEqual([]);
  expect(result.listeners).toEqual({});
  expect(result.observers).toEqual({ mutations: 0, resizes: 0 });
  expect(pageErrors).toEqual([]);
});

test("controller destruction after a direct Tiptap unmount releases the remaining resources", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const result = await page.evaluate(async () => {
    window.__semloRequireFixture("mountDestroyAudit")();
    const fixture = window.__semloRequireFixture("destroyAuditFixture");
    const before = window.__semloRequireFixture("destroyAuditRaw")(fixture.first);
    fixture.first.editor.unmount();
    fixture.first.destroy();
    fixture.first.destroy();
    const after = window.__semloRequireFixture("destroyAuditRaw")(fixture.first);
    const schemaReleased = fixture.first.editor.schema == null;
    fixture.second.editor.commands.insertContent("S");
    const secondText = fixture.second.getSnapshot().text;
    fixture.second.destroy();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return {
      before,
      after,
      schemaReleased,
      secondText,
      errors: fixture.errors,
      listeners: fixture.listenerCounts(),
      observers: fixture.observerCounts(),
    };
  });
  expect(result.after).toEqual(result.before);
  expect(result.schemaReleased).toBe(true);
  expect(result.secondText).toBe("secondS");
  expect(result.errors).toEqual([]);
  expect(result.listeners).toEqual({});
  expect(result.observers).toEqual({ mutations: 0, resizes: 0 });
  expect(pageErrors).toEqual([]);
});

test("rejected table drag-start does not register listeners or modify document", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.evaluate(() => window.__semloRequireFixture("mountDestroyAudit")());
  const cell = page.locator("#destroy-first .semlo-editor-prose td").first();
  await cell.click();
  const before = await page.evaluate(() =>
    window.__semloRequireFixture("destroyAuditRaw")(window.__semloRequireFixture("destroyAuditFixture").first),
  );
  const box = await cell.boundingBox();
  if (!box) throw new Error("table cell has no layout");
  const x = box.x + box.width - 1;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await expect(page.locator("#destroy-first .column-resize-handle").first()).toBeVisible();
  await page.evaluate(() => window.__semloRequireFixture("destroyAuditFixture").rejectNextResize());
  await page.mouse.down();
  const observed = await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("destroyAuditFixture");
    return {
      listeners: fixture.listenerCounts(),
      snapshot: window.__semloRequireFixture("destroyAuditRaw")(fixture.first),
    };
  });
  await page.mouse.move(x + 20, y);
  await page.mouse.up();
  const final = await page.evaluate(async () => {
    const fixture = window.__semloRequireFixture("destroyAuditFixture");
    const snapshot = window.__semloRequireFixture("destroyAuditRaw")(fixture.first);
    fixture.first.destroy();
    fixture.second.destroy();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return {
      snapshot,
      listeners: fixture.listenerCounts(),
      observers: fixture.observerCounts(),
      errors: fixture.errors,
    };
  });
  expect(observed.listeners["window:mousemove:false"]).toBeUndefined();
  expect(observed.listeners["window:mouseup:false"]).toBeUndefined();
  expect(observed.snapshot).toEqual(before);
  expect(final.snapshot).toEqual(before);
  expect(final.listeners).toEqual({});
  expect(final.observers).toEqual({ mutations: 0, resizes: 0 });
  expect(final.errors).toEqual([]);
  expect(errors).toEqual([]);
});

for (const mode of ["editor", "controller"] as const) {
  test(`${mode} host onDestroy exception propagates while owned resources and the second editor remain safe`, async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const result = await page.evaluate(async (mode) => {
      window.__semloRequireFixture("mountDestroyAudit")("throw-in-editor-destroy");
      const fixture = window.__semloRequireFixture("destroyAuditFixture");
      const before = window.__semloRequireFixture("destroyAuditRaw")(fixture.first);
      let thrown = "";
      try {
        if (mode === "editor") fixture.first.editor.destroy();
        else fixture.first.destroy();
      } catch (error) {
        thrown = String(error);
      }
      const editorDestroyed = fixture.first.editor.isDestroyed;
      fixture.first.destroy();
      fixture.first.destroy();
      const after = window.__semloRequireFixture("destroyAuditRaw")(fixture.first);
      fixture.second.editor.commands.insertContent("U");
      const secondText = fixture.second.getSnapshot().text;
      fixture.second.destroy();
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return {
        thrown,
        editorDestroyed,
        before,
        after,
        secondText,
        errors: fixture.errors,
        listeners: fixture.listenerCounts(),
        observers: fixture.observerCounts(),
        shells: document.querySelectorAll(".semlo-editor").length,
      };
    }, mode);
    expect(result.thrown).toBe("Error: host destroy failure");
    expect(result.editorDestroyed).toBe(true);
    expect(result.before).toEqual(result.after);
    expect(result.secondText).toBe("secondU");
    expect(result.errors).toEqual([]);
    expect(result.listeners).toEqual({});
    expect(result.observers).toEqual({ mutations: 0, resizes: 0 });
    expect(result.shells).toBe(0);
    expect(pageErrors).toEqual([]);
  });
}

test("destroy preserves both the host destroy error and a host unmount error", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const result = await page.evaluate(async () => {
    window.__semloRequireFixture("mountDestroyAudit")("throw-in-editor-destroy");
    const fixture = window.__semloRequireFixture("destroyAuditFixture");
    const before = window.__semloRequireFixture("destroyAuditRaw")(fixture.first);
    fixture.first.editor.on("unmount", () => {
      throw new Error("host unmount failure");
    });
    let name = "";
    let errors: string[] = [];
    try {
      fixture.first.editor.destroy();
    } catch (error) {
      name = error instanceof Error ? error.name : "unknown";
      errors = error instanceof AggregateError ? error.errors.map(String) : [String(error)];
    }
    const after = window.__semloRequireFixture("destroyAuditRaw")(fixture.first);
    const editorDestroyed = fixture.first.editor.isDestroyed;
    fixture.first.destroy();
    fixture.second.destroy();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return {
      name,
      errors,
      before,
      after,
      editorDestroyed,
      listeners: fixture.listenerCounts(),
      observers: fixture.observerCounts(),
    };
  });
  expect(result.name).toBe("AggregateError");
  expect(result.errors).toEqual(["Error: host destroy failure", "Error: host unmount failure"]);
  expect(result.editorDestroyed).toBe(true);
  expect(result.after).toEqual(result.before);
  expect(result.listeners).toEqual({});
  expect(result.observers).toEqual({ mutations: 0, resizes: 0 });
  expect(pageErrors).toEqual([]);
});

for (const axis of ["行", "列"] as const) {
  for (const mode of ["editor", "controller"] as const) {
    test(`${axis} edge selection survives synchronous ${mode} destroy`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.evaluate(() => window.__semloRequireFixture("mountDestroyAudit")());
      await page.locator("#destroy-first .semlo-editor-prose td").first().hover();
      const edge = page.getByRole("button", { name: `选择第 1 ${axis}` });
      await expect(edge).toBeVisible();
      const box = await edge.boundingBox();
      if (!box) throw new Error("table edge has no layout");
      await page.evaluate((mode) => {
        const fixture = window.__semloRequireFixture("destroyAuditFixture");
        let fired = false;
        fixture.first.editor.on("transaction", () => {
          if (fired) return;
          fired = true;
          if (mode === "editor") fixture.first.editor.destroy();
          else fixture.first.destroy();
        });
      }, mode);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      const afterDown = await page.evaluate(() => {
        const fixture = window.__semloRequireFixture("destroyAuditFixture");
        return {
          destroyed: fixture.first.editor.isDestroyed,
          snapshot: window.__semloRequireFixture("destroyAuditRaw")(fixture.first),
          firstShell: !!document.querySelector("#destroy-first .semlo-editor"),
          edges: document.querySelectorAll(".semlo-editor-table-edges").length,
        };
      });
      await page.mouse.up();
      const final = await page.evaluate(async () => {
        const fixture = window.__semloRequireFixture("destroyAuditFixture");
        fixture.second.editor.commands.insertContent("V");
        const secondText = fixture.second.getSnapshot().text;
        fixture.second.destroy();
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        return {
          secondText,
          listeners: fixture.listenerCounts(),
          observers: fixture.observerCounts(),
          errors: fixture.errors,
        };
      });
      expect(afterDown.destroyed).toBe(true);
      expect(afterDown.snapshot.text).toContain("first");
      expect(afterDown.firstShell).toBe(false);
      expect(afterDown.edges).toBe(1);
      expect(final.secondText).toBe("secondV");
      expect(final.listeners).toEqual({});
      expect(final.observers).toEqual({ mutations: 0, resizes: 0 });
      expect(final.errors).toEqual([]);
      expect(pageErrors).toEqual([]);
    });
  }
}

test("host onDestroy may recursively call editor.destroy without duplicated callbacks or leaks", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const result = await page.evaluate(async () => {
    window.__semloRequireFixture("mountDestroyAudit")("recursive-editor-destroy");
    const fixture = window.__semloRequireFixture("destroyAuditFixture");
    const before = window.__semloRequireFixture("destroyAuditRaw")(fixture.first);
    fixture.first.editor.destroy();
    fixture.first.editor.destroy();
    fixture.first.destroy();
    const after = window.__semloRequireFixture("destroyAuditRaw")(fixture.first);
    fixture.second.editor.commands.insertContent("R");
    const secondText = fixture.second.getSnapshot().text;
    fixture.second.destroy();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return {
      before,
      after,
      callbacks: fixture.destroyCallbacks(),
      secondText,
      listeners: fixture.listenerCounts(),
      observers: fixture.observerCounts(),
      errors: fixture.errors,
    };
  });
  expect(result.after).toEqual(result.before);
  expect(result.callbacks).toBe(1);
  expect(result.secondText).toBe("secondR");
  expect(result.listeners).toEqual({});
  expect(result.observers).toEqual({ mutations: 0, resizes: 0 });
  expect(result.errors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("after remount, editable notifications reach the new editor DOM and destruction releases both views", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const result = await page.evaluate(async () => {
    window.__semloRequireFixture("mountDestroyAudit")();
    const fixture = window.__semloRequireFixture("destroyAuditFixture");
    const { first, second } = fixture;
    const before = window.__semloRequireFixture("destroyAuditRaw")(first);
    const oldDOM = first.editor.view.dom;
    first.editor.unmount();
    const mount = document.createElement("div");
    document.querySelector("#destroy-first .semlo-editor-content")!.append(mount);
    first.editor.mount(mount);
    const newDOM = first.editor.view.dom;
    let notifications = 0;
    newDOM.addEventListener("semlo-editor:editable", () => {
      notifications++;
    });
    first.setEditable(false);
    const editable = first.editor.isEditable;
    const after = window.__semloRequireFixture("destroyAuditRaw")(first);
    first.editor.destroy();
    first.destroy();
    second.editor.commands.insertContent("Y");
    const secondText = second.getSnapshot().text;
    second.destroy();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return {
      before,
      after,
      differentDOM: oldDOM !== newDOM,
      editable,
      notifications,
      secondText,
      listeners: fixture.listenerCounts(),
      observers: fixture.observerCounts(),
      errors: fixture.errors,
    };
  });
  expect(result.differentDOM).toBe(true);
  expect(result.editable).toBe(false);
  expect(result.notifications).toBe(1);
  expect(result.after).toEqual(result.before);
  expect(result.secondText).toBe("secondY");
  expect(result.listeners).toEqual({});
  expect(result.observers).toEqual({ mutations: 0, resizes: 0 });
  expect(result.errors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

for (const mode of ["editor", "controller"] as const) {
  test(`${mode} cleanup continues if a host ResizeObserver wrapper throws once`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.evaluate(() => window.__semloRequireFixture("mountDestroyAudit")());
    await page.locator("#destroy-first .semlo-editor-prose td").first().click();
    const result = await page.evaluate(async (mode) => {
      const fixture = window.__semloRequireFixture("destroyAuditFixture");
      const before = window.__semloRequireFixture("destroyAuditRaw")(fixture.first);
      fixture.failNextResizeDisconnect();
      let error = "";
      let retainsResizeError = false;
      try {
        if (mode === "editor") fixture.first.editor.destroy();
        else fixture.first.destroy();
      } catch (cause) {
        error = String(cause);
        retainsResizeError = cause === fixture.expectedFailures().resize;
      }
      const editorDestroyed = fixture.first.editor.isDestroyed;
      fixture.first.destroy();
      const after = window.__semloRequireFixture("destroyAuditRaw")(fixture.first);
      fixture.second.editor.commands.insertContent("E");
      const secondText = fixture.second.getSnapshot().text;
      fixture.second.destroy();
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return {
        before,
        after,
        error,
        retainsResizeError,
        editorDestroyed,
        secondText,
        errors: fixture.errors,
        shells: document.querySelectorAll(".semlo-editor").length,
        listeners: fixture.listenerCounts(),
        observers: fixture.observerCounts(),
      };
    }, mode);
    expect(result.error).toBe("Error: host ResizeObserver disconnect failure");
    expect(result.retainsResizeError).toBe(true);
    expect(result.editorDestroyed).toBe(true);
    expect(result.after).toEqual(result.before);
    expect(result.secondText).toBe("secondE");
    expect(result.errors).toEqual([]);
    expect(result.shells).toBe(0);
    expect(result.listeners).toEqual({});
    expect(result.observers).toEqual({ mutations: 0, resizes: 0 });
    expect(pageErrors).toEqual([]);
  });
}

for (const operation of ["content", "editable", "integrations"] as const) {
  test(`controller handles ${operation} updates during a temporary unmount`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const result = await page.evaluate(async (operation) => {
      window.__semloRequireFixture("mountDestroyAudit")();
      const fixture = window.__semloRequireFixture("destroyAuditFixture");
      const { first, second } = fixture;
      const before = first.editor.getJSON();
      first.editor.unmount();
      let updateError = "";
      try {
        if (operation === "content") first.setContent("<p>updated while unmounted</p>");
        else if (operation === "editable") first.setEditable(false);
        else first.setIntegrations({});
      } catch (error) {
        updateError = String(error);
      }
      const errorsDuringUpdate = [...fixture.errors];
      const mount = document.createElement("div");
      document.querySelector("#destroy-first .semlo-editor-content")!.append(mount);
      first.editor.mount(mount);
      const after = first.editor.getJSON();
      const text = first.editor.state.doc.textContent;
      const editable = first.editor.isEditable;
      const translateDisabled = document.querySelector<HTMLButtonElement>(
        '#destroy-first button[aria-label="翻译"]',
      )!.disabled;
      first.destroy();
      second.editor.commands.insertContent("Q");
      const secondText = second.getSnapshot().text;
      second.destroy();
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return {
        before,
        after,
        text,
        editable,
        translateDisabled,
        updateError,
        errorsDuringUpdate,
        secondText,
        listeners: fixture.listenerCounts(),
        observers: fixture.observerCounts(),
      };
    }, operation);
    expect(result.updateError).toBe("");
    if (operation === "content") {
      // Either apply the replacement or report that the unmounted view cannot
      // accept it; silently dropping a request would lose the host update.
      if (result.text !== "updated while unmounted") {
        expect(result.after).toEqual(result.before);
        expect(result.errorsDuringUpdate).toHaveLength(1);
      }
    } else {
      expect(result.after).toEqual(result.before);
      expect(result.errorsDuringUpdate).toEqual([]);
      if (operation === "editable") expect(result.editable).toBe(false);
      else expect(result.translateDisabled).toBe(true);
    }
    expect(result.secondText).toBe("secondQ");
    expect(result.listeners).toEqual({});
    expect(result.observers).toEqual({ mutations: 0, resizes: 0 });
    expect(pageErrors).toEqual([]);
  });
}

for (const mode of ["editor", "controller"] as const) {
  test(`${mode} cleanup preserves simultaneous host and observer exceptions`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.evaluate(() => window.__semloRequireFixture("mountDestroyAudit")("throw-in-editor-destroy"));
    await page.locator("#destroy-first .semlo-editor-prose td").first().click();
    const result = await page.evaluate(async (mode) => {
      const fixture = window.__semloRequireFixture("destroyAuditFixture");
      fixture.failNextResizeDisconnect();
      let thrown: unknown;
      try {
        if (mode === "editor") fixture.first.editor.destroy();
        else fixture.first.destroy();
      } catch (error) {
        thrown = error;
      }
      const failures = thrown instanceof AggregateError ? [...thrown.errors] : [thrown];
      const expected = fixture.expectedFailures();
      const retainsHost = failures.includes(expected.host);
      const retainsResize = failures.includes(expected.resize);
      const destroyed = fixture.first.editor.isDestroyed;
      fixture.second.editor.commands.insertContent("Z");
      const secondText = fixture.second.getSnapshot().text;
      fixture.second.destroy();
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return {
        aggregate: thrown instanceof AggregateError,
        retainsHost,
        retainsResize,
        destroyed,
        secondText,
        shells: document.querySelectorAll(".semlo-editor").length,
        listeners: fixture.listenerCounts(),
        observers: fixture.observerCounts(),
      };
    }, mode);
    expect(result.aggregate).toBe(true);
    expect(result.retainsHost).toBe(true);
    expect(result.retainsResize).toBe(true);
    expect(result.destroyed).toBe(true);
    expect(result.secondText).toBe("secondZ");
    expect(result.shells).toBe(0);
    expect(result.listeners).toEqual({});
    expect(result.observers).toEqual({ mutations: 0, resizes: 0 });
    expect(pageErrors).toEqual([]);
  });
}

for (const mode of ["editor", "controller"] as const) {
  test(`host can read its snapshot during ${mode} destruction`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const result = await page.evaluate(async (mode) => {
      window.__semloRequireFixture("mountDestroyAudit")("read-in-editor-destroy");
      const fixture = window.__semloRequireFixture("destroyAuditFixture");
      const before = fixture.first.getSnapshot();
      if (mode === "editor") fixture.first.editor.destroy();
      else fixture.first.destroy();
      const read = fixture.destroyRead();
      fixture.second.destroy();
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return { before, read, listeners: fixture.listenerCounts(), observers: fixture.observerCounts() };
    }, mode);
    expect(result.read.error).toBe("");
    expect(result.read.value).toEqual(result.before);
    expect(result.listeners).toEqual({});
    expect(result.observers).toEqual({ mutations: 0, resizes: 0 });
    expect(pageErrors).toEqual([]);
  });
}

test("destroy does not invoke a host document serializer", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const result = await page.evaluate(async () => {
    window.__semloRequireFixture("mountDestroyAudit")("throwing-serializer");
    const fixture = window.__semloRequireFixture("destroyAuditFixture");
    fixture.armHostSerializer();
    fixture.first.destroy();
    const attempts = fixture.serializerAttempts();
    const destroyed = fixture.first.editor.isDestroyed;
    fixture.second.destroy();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return { attempts, destroyed, listeners: fixture.listenerCounts(), observers: fixture.observerCounts() };
  });
  expect(result.attempts).toBe(0);
  expect(result.destroyed).toBe(true);
  expect(result.listeners).toEqual({});
  expect(result.observers).toEqual({ mutations: 0, resizes: 0 });
  expect(pageErrors).toEqual([]);
});
