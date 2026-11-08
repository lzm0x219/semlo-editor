import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../fixtures/browser/fixture-rsbuild";
import type {} from "../fixtures/contracts/content-replacement-result-fixture";

let origin = "";
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  ({ origin, stop } = await startFixtureServer("./tests/fixtures/contracts/content-replacement-result-fixture.ts", {
    framework: true,
  }));
});
afterAll(async () => stop?.());
test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountReplacementResult === "function");
});

for (const framework of ["core", "react", "vue", "solid"] as const) {
  test(`${framework} reports applied and unchanged while preserving controlled echo and isolation`, async ({
    page,
  }) => {
    await page.evaluate((name) => window.__semloRequireFixture("mountReplacementResult")(name), framework);
    const result = await page.evaluate(async () => {
      const fixture = window.__semloRequireFixture("replacementResultFixture");
      const apply = Reflect.get(fixture.controller, "trySetContent").bind(fixture.controller);
      const applied = apply("<p>replacement</p>");
      const same = apply(fixture.controller.getSnapshot().json);
      const beforeChanges = fixture.changes.length;
      fixture.controller.editor.commands.insertContent("X");
      await fixture.settle();
      const echoed = apply(fixture.controller.getSnapshot().json);
      const content = fixture.controller.getSnapshot().text;
      const other = fixture.other.getSnapshot().text;
      const changes = fixture.changes.length;
      fixture.controller.destroy();
      const unavailable = apply("<p>later</p>");
      fixture.destroy();
      return {
        applied,
        same,
        echoed,
        beforeChanges,
        changes,
        content,
        other,
        unavailable,
        errors: fixture.errors.length,
      };
    });
    expect(result).toEqual({
      applied: { status: "applied" },
      same: { status: "unchanged" },
      echoed: { status: "unchanged" },
      beforeChanges: 0,
      changes: 1,
      content: "replacementX",
      other: "other",
      unavailable: { status: "unavailable" },
      errors: 0,
    });
  });
}

test("applied replacement retains undo and redo history", async ({ page }) => {
  await page.evaluate(() => window.__semloRequireFixture("mountReplacementResult")("core"));
  const result = await page.evaluate(() => {
    const f = window.__semloRequireFixture("replacementResultFixture");
    const applied = Reflect.get(f.controller, "trySetContent").call(f.controller, "<p>replacement</p>");
    const undo = f.controller.editor.commands.undo();
    const undone = f.controller.getSnapshot().text;
    const redo = f.controller.editor.commands.redo();
    const redone = f.controller.getSnapshot().text;
    f.destroy();
    return { applied, undo, undone, redo, redone };
  });
  expect(result).toEqual({
    applied: { status: "applied" },
    undo: true,
    undone: "original",
    redo: true,
    redone: "replacement",
  });
});

test("Vue exposed getEditor returns the result-capable instance and clears it on unmount", async ({ page }) => {
  await page.evaluate(() => window.__semloRequireFixture("mountReplacementResult")("vue"));
  const result = await page.evaluate(() => {
    const f = window.__semloRequireFixture("replacementResultFixture");
    const exposed = f.getVueEditor();
    const same = exposed === f.controller;
    const replacement = exposed?.trySetContent("<p>via ref</p>");
    f.destroy();
    return { same, replacement, cleared: f.getVueEditor() === undefined };
  });
  expect(result).toEqual({ same: true, replacement: { status: "applied" }, cleared: true });
});

for (const mode of ["filter", "append"] as const) {
  test(`a ${mode} transaction cannot be reported as applied unless the final document matches`, async ({ page }) => {
    await page.evaluate(() => window.__semloRequireFixture("mountReplacementResult")("core"));
    const result = await page.evaluate((mode) => {
      const f = window.__semloRequireFixture("replacementResultFixture");
      const Plugin = window.__semloRequireFixture("replacementResultPlugin");
      f.controller.editor.registerPlugin(
        new Plugin({
          filterTransaction: (transaction) => mode !== "filter" || !transaction.getMeta("preventUpdate"),
          appendTransaction: (transactions, _before, state) =>
            mode === "append" && transactions.some((transaction) => transaction.getMeta("preventUpdate"))
              ? state.tr.insertText("!", state.doc.content.size - 1)
              : null,
        }),
      );
      const replacement = f.controller.trySetContent("<p>replacement</p>");
      const text = f.controller.getSnapshot().text;
      const errors = f.errors.length;
      f.destroy();
      return { replacement, text, errors };
    }, mode);
    expect(result).toEqual({
      replacement: { status: "interrupted", reason: "not-applied" },
      text: mode === "filter" ? "original" : "replacement!",
      errors: 0,
    });
  });
}

test("a reentrant document replacement is not overwritten by the older call", async ({ page }) => {
  await page.evaluate(() => window.__semloRequireFixture("mountReplacementResult")("core"));
  const result = await page.evaluate(() => {
    const f = window.__semloRequireFixture("replacementResultFixture");
    f.controller.editor.view.dom.addEventListener(
      "semlo-editor:document-replace",
      () => f.controller.setContent("<p>newer</p>"),
      { once: true },
    );
    const replacement = f.controller.trySetContent("<p>older</p>");
    const text = f.controller.getSnapshot().text;
    f.destroy();
    return { replacement, text };
  });
  expect(result).toEqual({ replacement: { status: "interrupted", reason: "superseded" }, text: "newer" });
});

test("reentry during input parsing cannot overwrite the newer document", async ({ page }) => {
  await page.evaluate(() => window.__semloRequireFixture("mountReplacementResult")("core"));
  const result = await page.evaluate(() => {
    const f = window.__semloRequireFixture("replacementResultFixture");
    const content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "older" }] }] };
    let entered = false;
    Object.defineProperty(content, "attrs", {
      enumerable: true,
      get() {
        if (!entered) {
          entered = true;
          f.controller.setContent("<p>newer</p>");
        }
        return undefined;
      },
    });
    const replacement = f.controller.trySetContent(content);
    const text = f.controller.getSnapshot().text;
    f.destroy();
    return { replacement, text };
  });
  expect(result).toEqual({ replacement: { status: "interrupted", reason: "superseded" }, text: "newer" });
});

for (const mode of ["result", "legacy"] as const) {
  test(`a parser exception after reentry is reported without replacing the newer document (${mode})`, async ({
    page,
  }) => {
    await page.evaluate(() => window.__semloRequireFixture("mountReplacementResult")("core"));
    const result = await page.evaluate((mode) => {
      const f = window.__semloRequireFixture("replacementResultFixture");
      const failure = new Error("host parser failure");
      const content = { type: "doc" };
      Object.defineProperty(content, "attrs", {
        enumerable: true,
        get() {
          f.controller.setContent("<p>newer</p>");
          throw failure;
        },
      });
      let status = "legacy-returned";
      let sameError = false;
      try {
        if (mode === "result") {
          const replacement = f.controller.trySetContent(content);
          status =
            replacement.status === "interrupted" ? `${replacement.status}/${replacement.reason}` : replacement.status;
          sameError = "error" in replacement && replacement.error === failure;
        } else f.controller.setContent(content);
      } catch (error) {
        status = `threw ${String(error)}`;
      }
      const reported = f.errors[0] === failure;
      const text = f.controller.getSnapshot().text;
      f.destroy();
      return { status, sameError, reported, text };
    }, mode);
    expect(result).toEqual({
      status: mode === "result" ? "interrupted/superseded" : "legacy-returned",
      sameError: mode === "result",
      reported: true,
      text: "newer",
    });
  });
}

test("a parser callback exception is reported as parse-failed without claiming the input is invalid", async ({
  page,
}) => {
  await page.evaluate(() => window.__semloRequireFixture("mountReplacementResult")("core"));
  const result = await page.evaluate(() => {
    const f = window.__semloRequireFixture("replacementResultFixture");
    const failure = new Error("host parser failure");
    const content = { type: "doc" };
    Object.defineProperty(content, "attrs", {
      enumerable: true,
      get() {
        throw failure;
      },
    });
    const replacement = f.controller.trySetContent(content);
    const sameError = "error" in replacement && replacement.error === failure && f.errors[0] === failure;
    const text = f.controller.getSnapshot().text;
    f.destroy();
    return { status: replacement.status, sameError, text };
  });
  expect(result).toEqual({ status: "parse-failed", sameError: true, text: "original" });
});

test("invalid input reports its original error even when onError synchronously replaces content", async ({ page }) => {
  await page.evaluate(() => window.__semloRequireFixture("mountReplacementResult")("core"));
  const result = await page.evaluate(() => {
    const f = window.__semloRequireFixture("replacementResultFixture");
    f.setOnError(() => f.controller.setContent("<p>recovered</p>"));
    const replacement = f.controller.trySetContent({ type: "doc", content: [{ type: "unknownNode" }] });
    const text = f.controller.getSnapshot().text;
    const sameError = "error" in replacement && replacement.error === f.errors[0];
    f.destroy();
    return { status: replacement.status, sameError, text, errors: f.errors.length };
  });
  expect(result).toEqual({ status: "parse-failed", sameError: true, text: "recovered", errors: 1 });
});

test("invalid input remains invalid if onError destroys the editor", async ({ page }) => {
  await page.evaluate(() => window.__semloRequireFixture("mountReplacementResult")("core"));
  const result = await page.evaluate(() => {
    const f = window.__semloRequireFixture("replacementResultFixture");
    f.setOnError(() => f.controller.destroy());
    const invalid = f.controller.trySetContent({ type: "doc", content: [{ type: "unknownNode" }] });
    const unavailable = f.controller.trySetContent("<p>later</p>");
    const sameError = "error" in invalid && invalid.error === f.errors[0];
    f.destroy();
    return { status: invalid.status, sameError, unavailable, destroyed: f.controller.editor.isDestroyed };
  });
  expect(result).toEqual({
    status: "parse-failed",
    sameError: true,
    unavailable: { status: "unavailable" },
    destroyed: true,
  });
});

test("an exception from onError remains observable to the caller", async ({ page }) => {
  await page.evaluate(() => window.__semloRequireFixture("mountReplacementResult")("core"));
  const sameError = await page.evaluate(() => {
    const f = window.__semloRequireFixture("replacementResultFixture");
    const failure = new Error("onError failed");
    f.setOnError(() => {
      throw failure;
    });
    let caught: unknown;
    try {
      f.controller.trySetContent({ type: "doc", content: [{ type: "unknownNode" }] });
    } catch (error) {
      caught = error;
    }
    f.destroy();
    return caught === failure;
  });
  expect(sameError).toBe(true);
});

test("upload cancellation reentry cannot overwrite the newer replacement", async ({ page }) => {
  await page.evaluate(() => window.__semloRequireFixture("mountReplacementResult")("core"));
  const result = await page.evaluate(async () => {
    const f = window.__semloRequireFixture("replacementResultFixture");
    let signal: AbortSignal | undefined;
    f.controller.setIntegrations({
      uploadImage: async (_file, context) => {
        signal = context?.signal;
        return await new Promise<string>((resolve) =>
          signal?.addEventListener(
            "abort",
            () => {
              f.controller.setContent("<p>newer</p>");
              resolve("/late.png");
            },
            { once: true },
          ),
        );
      },
    });
    const input = document.querySelector<HTMLInputElement>('#replacement-result input[type="file"][accept="image/*"]')!;
    const transfer = new DataTransfer();
    transfer.items.add(new File(["image"], "image.png", { type: "image/png" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    if (!signal) throw new Error("upload was not started");
    const replacement = f.controller.trySetContent("<p>older</p>");
    await Promise.resolve();
    const text = f.controller.getSnapshot().text;
    const aborted = signal.aborted;
    f.destroy();
    return { replacement, text, aborted, errors: f.errors.length };
  });
  expect(result).toEqual({
    replacement: { status: "interrupted", reason: "superseded" },
    text: "newer",
    aborted: true,
    errors: 0,
  });
});

test("operational failures remain distinct from invalid input", async ({ page }) => {
  await page.evaluate(() => window.__semloRequireFixture("mountReplacementResult")("core"));
  const result = await page.evaluate(() => {
    const f = window.__semloRequireFixture("replacementResultFixture");
    const failure = new Error("host transaction failure");
    f.controller.editor.on("beforeTransaction", ({ transaction }) => {
      if (transaction.getMeta("preventUpdate")) throw failure;
    });
    const replacement = f.controller.trySetContent("<p>replacement</p>");
    const sameError = "error" in replacement && replacement.error === failure && f.errors[0] === failure;
    const text = f.controller.getSnapshot().text;
    f.destroy();
    return { status: replacement.status, sameError, text };
  });
  expect(result).toEqual({ status: "failed", sameError: true, text: "original" });
});

test("a transaction reentry returns its guard error while the outer transaction commits", async ({ page }) => {
  await page.evaluate(() => window.__semloRequireFixture("mountReplacementResult")("core"));
  const result = await page.evaluate(() => {
    const f = window.__semloRequireFixture("replacementResultFixture");
    let nested: ReturnType<typeof f.controller.trySetContent> | undefined;
    f.controller.editor.on("beforeTransaction", ({ transaction }) => {
      if (transaction.getMeta("result-reentry")) nested = f.controller.trySetContent("<p>inner</p>");
    });
    let outer: unknown;
    try {
      f.controller.editor.view.dispatch(
        f.controller.editor.state.tr.insertText("X", 1).setMeta("result-reentry", true),
      );
    } catch (error) {
      outer = error;
    }
    const error = nested?.status === "interrupted" ? nested.error?.name : "";
    const summary = {
      status: nested?.status,
      reason: nested?.status === "interrupted" ? nested.reason : "",
      error,
      outer: outer instanceof Error ? outer.name : "",
      text: f.controller.getSnapshot().text,
    };
    f.destroy();
    return summary;
  });
  expect(result).toEqual({
    status: "interrupted",
    reason: "reentrant",
    error: "ReentrantTransactionError",
    outer: "",
    text: "Xoriginal",
  });
});

test("legacy setContent still throws the original transaction guard error", async ({ page }) => {
  await page.evaluate(() => window.__semloRequireFixture("mountReplacementResult")("core"));
  const result = await page.evaluate(() => {
    const f = window.__semloRequireFixture("replacementResultFixture");
    let inner: unknown;
    f.controller.editor.on("beforeTransaction", ({ transaction }) => {
      if (!transaction.getMeta("legacy-reentry")) return;
      try {
        f.controller.setContent("<p>inner</p>");
      } catch (error) {
        inner = error;
      }
    });
    f.controller.editor.view.dispatch(f.controller.editor.state.tr.insertText("X", 1).setMeta("legacy-reentry", true));
    const summary = {
      error: inner instanceof Error ? inner.name : "",
      text: f.controller.getSnapshot().text,
      reported: f.errors.length,
    };
    f.destroy();
    return summary;
  });
  expect(result).toEqual({ error: "ReentrantTransactionError", text: "Xoriginal", reported: 0 });
});

test("a temporarily unmounted editor reports the actual replacement and supports remount", async ({ page }) => {
  await page.evaluate(() => window.__semloRequireFixture("mountReplacementResult")("core"));
  const result = await page.evaluate(() => {
    const f = window.__semloRequireFixture("replacementResultFixture");
    f.controller.editor.unmount();
    const replacement = f.controller.trySetContent("<p>while unmounted</p>");
    const mount = document.createElement("div");
    document.querySelector("#replacement-result .semlo-editor-content")!.append(mount);
    f.controller.editor.mount(mount);
    const text = f.controller.getSnapshot().text;
    f.destroy();
    return { replacement, text };
  });
  expect(result).toEqual({ replacement: { status: "applied" }, text: "while unmounted" });
});

test("destruction before commit returns a destroyed interruption", async ({ page }) => {
  await page.evaluate(() => window.__semloRequireFixture("mountReplacementResult")("core"));
  const result = await page.evaluate(() => {
    const f = window.__semloRequireFixture("replacementResultFixture");
    f.controller.editor.on("beforeTransaction", ({ transaction }) => {
      if (transaction.getMeta("preventUpdate")) f.controller.destroy();
    });
    const replacement = f.controller.trySetContent("<p>replacement</p>");
    const summary = {
      status: replacement.status,
      reason: replacement.status === "interrupted" ? replacement.reason : "",
      error: "error" in replacement ? replacement.error?.name : "",
      destroyed: f.controller.editor.isDestroyed,
    };
    f.destroy();
    return summary;
  });
  expect(result).toEqual({
    status: "interrupted",
    reason: "destroyed",
    error: "TransactionAbortedError",
    destroyed: true,
  });
});

test("temporary unmount before commit is distinguished from destruction", async ({ page }) => {
  await page.evaluate(() => window.__semloRequireFixture("mountReplacementResult")("core"));
  const result = await page.evaluate(() => {
    const f = window.__semloRequireFixture("replacementResultFixture");
    f.controller.editor.on("beforeTransaction", ({ transaction }) => {
      if (transaction.getMeta("preventUpdate")) f.controller.editor.unmount();
    });
    const replacement = f.controller.trySetContent("<p>replacement</p>");
    const mount = document.createElement("div");
    document.querySelector("#replacement-result .semlo-editor-content")!.append(mount);
    f.controller.editor.mount(mount);
    const summary = {
      status: replacement.status,
      reason: replacement.status === "interrupted" ? replacement.reason : "",
      error: "error" in replacement ? replacement.error?.name : "",
      text: f.controller.getSnapshot().text,
    };
    f.destroy();
    return summary;
  });
  expect(result).toEqual({
    status: "interrupted",
    reason: "unmounted",
    error: "TransactionAbortedError",
    text: "original",
  });
});
