import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor, Extension, Plugin } from '/dist/index.js'
      window.transactionGuardTools = {Extension, Plugin}
      window.createTransactionGuardProbe = (enabled, extensions = [], options = {}) => {
        const host = document.createElement('div'); document.body.append(host)
        return createEditor({element:host, outline:false, toolbar:false, content:'<p>alpha</p>', extensions, ...options})
      }
      window.transactionGuardProbe = window.createTransactionGuardProbe(true)
    `,
  });
  await page.waitForFunction(() => Boolean(Reflect.get(window, "transactionGuardProbe")));
});

test("real controller rejects reentrant setContent before commit without silently reporting success", async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const controller = Reflect.get(window, "transactionGuardProbe");
    const editor = controller.editor;
    let armed = true;
    let innerResult = "not-called";
    let replaceEvents = 0;
    editor.view.dom.addEventListener("semlo-editor:document-replace", () => replaceEvents++);
    editor.on("beforeTransaction", () => {
      if (!armed) return;
      armed = false;
      try {
        controller.setContent("<p>replacement</p>");
        innerResult = "returned";
      } catch (error) {
        innerResult = error instanceof Error ? error.name : String(error);
      }
    });
    const result = editor.commands.insertContent("X");
    return { result, innerResult, replaceEvents, text: editor.state.doc.textContent };
  });
  expect(result).toEqual({ result: true, innerResult: "ReentrantTransactionError", replaceEvents: 0, text: "alphaX" });
});

test("real controller permits document replacement after commit", async ({ page }) => {
  const result = await page.evaluate(() => {
    const controller = Reflect.get(window, "transactionGuardProbe");
    const editor = controller.editor;
    let armed = true;
    editor.on("transaction", () => {
      if (!armed) return;
      armed = false;
      controller.setContent("<p>replacement</p>");
    });
    editor.commands.insertContent("X");
    return editor.state.doc.textContent;
  });
  expect(result).toBe("replacement");
});

test("raw editor destruction before commit cannot report a successful transaction", async ({ page }) => {
  const result = await page.evaluate(() => {
    const controller = Reflect.get(window, "transactionGuardProbe");
    const editor = controller.editor;
    let armed = true;
    editor.on("beforeTransaction", () => {
      if (!armed) return;
      armed = false;
      editor.destroy();
    });
    let outcome = "not-called";
    try {
      outcome = String(editor.commands.insertContent("X"));
    } catch (error) {
      outcome = error instanceof Error ? error.name : String(error);
    }
    return { outcome, destroyed: editor.isDestroyed };
  });
  expect(result.destroyed).toBe(true);
  expect(result.outcome).toBe("TransactionAbortedError");
});

test("raw editor destruction after commit remains available", async ({ page }) => {
  const result = await page.evaluate(() => {
    const controller = Reflect.get(window, "transactionGuardProbe");
    const editor = controller.editor;
    let armed = true;
    editor.on("transaction", () => {
      if (!armed) return;
      armed = false;
      editor.destroy();
    });
    let outcome = "not-called";
    try {
      outcome = String(editor.commands.insertContent("X"));
    } catch (error) {
      outcome = error instanceof Error ? error.name : String(error);
    }
    return { outcome, destroyed: editor.isDestroyed };
  });
  expect(result.destroyed).toBe(true);
  expect(result.outcome).toBe("true");
});

test("controller setContent propagates interruption when editor is destroyed before commit", async ({ page }) => {
  const result = await page.evaluate(() => {
    const controller = Reflect.get(window, "transactionGuardProbe");
    const editor = controller.editor;
    let armed = true;
    editor.on("beforeTransaction", () => {
      if (!armed) return;
      armed = false;
      editor.destroy();
    });
    let outcome = "returned";
    try {
      controller.setContent("<p>replacement</p>");
    } catch (error) {
      outcome = error instanceof Error ? error.name : String(error);
    }
    return { outcome, destroyed: editor.isDestroyed };
  });
  expect(result).toEqual({ outcome: "TransactionAbortedError", destroyed: true });
});

test("plugin view.update can dispatch after the new state is installed", async ({ page }) => {
  const result = await page.evaluate(() => {
    const { Extension, Plugin } = Reflect.get(window, "transactionGuardTools");
    let armed = false;
    let inner = "not-called";
    const extension = Extension.create({
      name: "viewUpdateReentryExperiment",
      addProseMirrorPlugins() {
        return [
          new Plugin({
            view() {
              return {
                update(view: any) {
                  if (!armed) return;
                  armed = false;
                  try {
                    view.dispatch(view.state.tr.insertText("Y", view.state.doc.content.size - 1));
                    inner = "returned";
                  } catch (error) {
                    inner = error instanceof Error ? error.name : String(error);
                  }
                },
              };
            },
          }),
        ];
      },
    });
    const controller = Reflect.get(window, "createTransactionGuardProbe")(true, [extension]);
    armed = true;
    const outer = controller.editor.commands.insertContent("X");
    return { inner, outer, text: controller.editor.state.doc.textContent };
  });
  expect(result).toEqual({ inner: "returned", outer: true, text: "alphaXY" });
});

test("plugin filter rejects synchronous nested dispatch while permitting the outer change", async ({ page }) => {
  const result = await page.evaluate(() => {
    const { Extension, Plugin } = Reflect.get(window, "transactionGuardTools");
    let armed = false;
    let inner = "not-called";
    let editor: any;
    const extension = Extension.create({
      name: "filterReentryExperiment",
      addProseMirrorPlugins() {
        return [
          new Plugin({
            filterTransaction() {
              if (!armed) return true;
              armed = false;
              try {
                editor.commands.insertContent("Y");
                inner = "returned";
              } catch (error) {
                inner = error instanceof Error ? error.name : String(error);
              }
              return true;
            },
          }),
        ];
      },
    });
    const controller = Reflect.get(window, "createTransactionGuardProbe")(true, [extension]);
    editor = controller.editor;
    armed = true;
    const outer = editor.commands.insertContent("X");
    return { inner, outer, text: editor.state.doc.textContent };
  });
  expect(result).toEqual({ inner: "ReentrantTransactionError", outer: true, text: "alphaX" });
});

test("a plugin may return a normal appended transaction", async ({ page }) => {
  const result = await page.evaluate(() => {
    const { Extension, Plugin } = Reflect.get(window, "transactionGuardTools");
    let armed = false;
    const extension = Extension.create({
      name: "appendReentryExperiment",
      addProseMirrorPlugins() {
        return [
          new Plugin({
            appendTransaction(_transactions: any, _oldState: any, state: any) {
              if (!armed) return null;
              armed = false;
              return state.tr.insertText("Y", state.doc.content.size - 1);
            },
          }),
        ];
      },
    });
    const controller = Reflect.get(window, "createTransactionGuardProbe")(true, [extension]);
    armed = true;
    const outer = controller.editor.commands.insertContent("X");
    return { outer, text: controller.editor.state.doc.textContent };
  });
  expect(result).toEqual({ outer: true, text: "alphaXY" });
});

test("a no-op setContent during beforeTransaction returns normally", async ({ page }) => {
  const result = await page.evaluate(() => {
    const controller = Reflect.get(window, "transactionGuardProbe");
    const editor = controller.editor;
    let armed = true;
    let innerResult = "not-called";
    editor.on("beforeTransaction", () => {
      if (!armed) return;
      armed = false;
      try {
        controller.setContent(controller.getSnapshot().json);
        innerResult = "returned";
      } catch (error) {
        innerResult = error instanceof Error ? error.name : String(error);
      }
    });
    const outer = editor.commands.insertContent("X");
    return { innerResult, outer, text: editor.state.doc.textContent };
  });
  expect(result).toEqual({ innerResult: "returned", outer: true, text: "alphaX" });
});

test("one editor may replace another during beforeTransaction", async ({ page }) => {
  const result = await page.evaluate(() => {
    const first = Reflect.get(window, "transactionGuardProbe");
    const second = Reflect.get(window, "createTransactionGuardProbe")(true);
    let armed = true;
    first.editor.on("beforeTransaction", () => {
      if (!armed) return;
      armed = false;
      second.setContent("<p>other replacement</p>");
    });
    const outer = first.editor.commands.insertContent("X");
    return { outer, first: first.editor.state.doc.textContent, second: second.editor.state.doc.textContent };
  });
  expect(result).toEqual({ outer: true, first: "alphaX", second: "other replacement" });
});

test("host setProps wrapper cannot suppress a failed reentrant transaction", async ({ page }) => {
  const result = await page.evaluate(() => {
    const controller = Reflect.get(window, "transactionGuardProbe");
    const editor = controller.editor;
    const view = editor.view;
    const prior = view.props.dispatchTransaction;
    view.setProps({
      dispatchTransaction(transaction: unknown) {
        try {
          prior.call(this, transaction);
        } catch {}
      },
    });
    let armed = true;
    editor.on("beforeTransaction", () => {
      if (!armed) return;
      armed = false;
      controller.setContent("<p>replacement</p>");
    });
    let result: string;
    try {
      result = String(editor.commands.insertContent("X"));
    } catch (error) {
      result = error instanceof Error ? error.name : String(error);
    }
    return { result, text: editor.state.doc.textContent };
  });
  expect(result.result).toBe("ReentrantTransactionError");
  expect(result.text).toBe("alpha");
});

test("middleware cannot dispatch the same transaction again before forwarding", async ({ page }) => {
  const result = await page.evaluate(() => {
    const controller = Reflect.get(window, "transactionGuardProbe");
    const view = controller.editor.view;
    const prior = view.props.dispatchTransaction;
    let armed = true;
    let inner = "not-called";
    view.setProps({
      dispatchTransaction(transaction: any) {
        if (armed) {
          armed = false;
          try {
            view.dispatch(transaction);
            inner = "returned";
          } catch (error) {
            inner = error instanceof Error ? error.name : String(error);
          }
        }
        prior.call(this, transaction);
      },
    });
    const outer = controller.editor.commands.insertContent("X");
    return { inner, outer, text: controller.editor.state.doc.textContent };
  });
  expect(result).toEqual({ inner: "ReentrantTransactionError", outer: true, text: "alphaX" });
});

test("constructor-captured dispatch cannot hide conflict after setProps", async ({ page }) => {
  const result = await page.evaluate(() => {
    const { Extension, Plugin } = Reflect.get(window, "transactionGuardTools");
    let captured: ((transaction: any) => void) | undefined;
    const host = Extension.create({
      name: "captureDispatchExperiment",
      addProseMirrorPlugins() {
        return [
          new Plugin({
            view(view: any) {
              captured ??= view.dispatch;
              return {};
            },
          }),
        ];
      },
    });
    const controller = Reflect.get(window, "createTransactionGuardProbe")(true, [host]);
    const editor = controller.editor;
    const view = editor.view;
    const prior = view.props.dispatchTransaction;
    view.setProps({
      dispatchTransaction(transaction: any) {
        try {
          prior.call(this, transaction);
        } catch {}
      },
    });
    let armed = true;
    editor.on("beforeTransaction", () => {
      if (!armed) return;
      armed = false;
      controller.setContent("<p>replacement</p>");
    });
    let outer = "returned";
    try {
      captured!(view.state.tr.insertText("X", 1));
    } catch (error) {
      outer = error instanceof Error ? error.name : String(error);
    }
    return { outer, text: editor.state.doc.textContent };
  });
  expect(result).toEqual({ outer: "ReentrantTransactionError", text: "alpha" });
});

test("first dispatch captured on remount cannot hide conflict", async ({ page }) => {
  const result = await page.evaluate(() => {
    const { Extension, Plugin } = Reflect.get(window, "transactionGuardTools");
    const captures: Array<(transaction: any) => void> = [];
    const host = Extension.create({
      name: "remountCaptureExperiment",
      addProseMirrorPlugins() {
        return [
          new Plugin({
            view(view: any) {
              captures.push(view.dispatch);
              return {};
            },
          }),
        ];
      },
    });
    const controller = Reflect.get(window, "createTransactionGuardProbe")(true, [host]);
    const editor = controller.editor;
    const mount = editor.view.dom.parentElement;
    editor.unmount();
    const firstRemount = captures.length;
    editor.mount(mount);
    const view = editor.view;
    const prior = view.props.dispatchTransaction;
    view.setProps({
      dispatchTransaction(transaction: any) {
        try {
          prior.call(this, transaction);
        } catch {}
      },
    });
    let armed = true;
    editor.on("beforeTransaction", () => {
      if (!armed) return;
      armed = false;
      controller.setContent("<p>replacement</p>");
    });
    let outer = "returned";
    try {
      captures[firstRemount](view.state.tr.insertText("X", 1));
    } catch (error) {
      outer = error instanceof Error ? error.name : String(error);
    }
    return { outer, text: editor.state.doc.textContent, captures: captures.length - firstRemount };
  });
  expect(result.captures).toBeGreaterThan(0);
  expect(result.outer).toBe("ReentrantTransactionError");
  expect(result.text).toBe("alpha");
});

test("host-prepended plugin cannot capture an unguarded remount dispatch", async ({ page }) => {
  const result = await page.evaluate(() => {
    const { Plugin } = Reflect.get(window, "transactionGuardTools");
    const captures: Array<(transaction: any) => void> = [];
    const controller = Reflect.get(window, "createTransactionGuardProbe")(true);
    const editor = controller.editor;
    editor.registerPlugin(
      new Plugin({
        view(view: any) {
          captures.push(view.dispatch);
          return {};
        },
      }),
      (plugin: any, plugins: any[]) => [plugin, ...plugins],
    );
    const mount = editor.view.dom.parentElement;
    editor.unmount();
    const firstRemount = captures.length;
    editor.mount(mount);
    const view = editor.view;
    const prior = view.props.dispatchTransaction;
    view.setProps({
      dispatchTransaction(transaction: any) {
        try {
          prior.call(this, transaction);
        } catch {}
      },
    });
    let armed = true;
    editor.on("beforeTransaction", () => {
      if (!armed) return;
      armed = false;
      controller.setContent("<p>replacement</p>");
    });
    let outer = "returned";
    try {
      captures[firstRemount](view.state.tr.insertText("X", 1));
    } catch (error) {
      outer = error instanceof Error ? error.name : String(error);
    }
    return { outer, text: editor.state.doc.textContent, captures: captures.length - firstRemount };
  });
  expect(result.captures).toBeGreaterThan(0);
  expect(result.outer).toBe("ReentrantTransactionError");
  expect(result.text).toBe("alpha");
});

test("table insertion survives rejected replacement in beforeTransaction", async ({ page }) => {
  const result = await page.evaluate(() => {
    const controller = Reflect.get(window, "transactionGuardProbe");
    const editor = controller.editor;
    let armed = true;
    let inner = "not-called";
    editor.on("beforeTransaction", () => {
      if (!armed) return;
      armed = false;
      try {
        controller.setContent("<p>replacement</p>");
        inner = "returned";
      } catch (error) {
        inner = error instanceof Error ? error.name : String(error);
      }
    });
    const outer = editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: false });
    return { outer, inner, html: editor.getHTML() };
  });
  expect(result.inner).toBe("ReentrantTransactionError");
  expect(result.outer).toBe(true);
  expect(result.html).toContain("<table");
  expect(result.html).not.toContain("replacement");
});

test("rejected replacement does not cancel pending image upload", async ({ page }) => {
  await page.evaluate(() => {
    let resolveUpload: ((url: string) => void) | undefined;
    const controller = Reflect.get(window, "createTransactionGuardProbe")(true, [], {
      uploadImage: () =>
        new Promise<string>((resolve) => {
          resolveUpload = resolve;
        }),
    });
    Reflect.set(window, "transactionGuardUpload", {
      controller,
      resolve: () => resolveUpload?.("/tests/sample-image.svg"),
      inner: "not-called",
    });
    let armed = true;
    controller.editor.on("beforeTransaction", ({ transaction }: any) => {
      if (
        !armed ||
        !Object.entries(transaction.meta).some(
          ([key, value]: any) => key.startsWith("semlo-editor-image-upload") && value?.add,
        )
      )
        return;
      armed = false;
      try {
        controller.setContent("<p>replacement</p>");
      } catch (error) {
        Reflect.get(window, "transactionGuardUpload").inner = error instanceof Error ? error.name : String(error);
      }
    });
    const transfer = new DataTransfer();
    transfer.items.add(new File(["x"], "one.png", { type: "image/png" }));
    controller.editor.view.dom.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
    );
  });
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "transactionGuardUpload").inner))
    .toBe("ReentrantTransactionError");
  await expect(page.locator(".semlo-editor-uploading")).toHaveCount(1);
  await page.evaluate(() => Reflect.get(window, "transactionGuardUpload").resolve());
  await expect(page.locator(".semlo-editor-image-node")).toHaveCount(1);
});

for (const framework of ["react", "vue", "solid"] as const) {
  test(`${framework} wrapper preserves a post-commit replacement`, async ({ page }) => {
    await page.goto(`${process.env.SEMLO_TEST_ORIGIN!}/tests/controlled.html`);
    await page.evaluate((name) => window.__semloRequireFixture("mountDynamicEditor").bind(window)(name), framework);
    const result = await page.evaluate(() => {
      const fixture = window.__semloRequireFixture("dynamicEditor");
      const editor = fixture.controller.editor;
      let armed = true;
      editor.on("transaction", () => {
        if (!armed) return;
        armed = false;
        fixture.controller.setContent("<p>replacement</p>");
      });
      editor.commands.insertContent("X");
      return { text: editor.state.doc.textContent, errors: fixture.errors };
    });
    expect(result).toEqual({ text: "replacement", errors: [] });
  });
  test(`${framework} rejects the interrupted transaction after synchronous destruction`, async ({ page }) => {
    await page.goto(`${process.env.SEMLO_TEST_ORIGIN!}/tests/controlled.html`);
    await page.evaluate((name) => window.__semloRequireFixture("mountDynamicEditor").bind(window)(name), framework);
    const result = await page.evaluate(() => {
      const fixture = window.__semloRequireFixture("dynamicEditor");
      const editor = fixture.controller.editor;
      let armed = true;
      editor.on("beforeTransaction", () => {
        if (!armed) return;
        armed = false;
        editor.destroy();
      });
      let outcome = "not-called";
      try {
        outcome = String(editor.commands.insertContent("X"));
      } catch (error) {
        outcome = error instanceof Error ? error.name : String(error);
      }
      return { outcome, destroyed: editor.isDestroyed, errors: fixture.errors };
    });
    expect(result).toEqual({ outcome: "TransactionAbortedError", destroyed: true, errors: [] });
  });
}
