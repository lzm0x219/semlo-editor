import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

type Deferred = { resolve: (url: string) => void; reject: (error: Error) => void };
type Subscription = { name: string; callback: unknown; removed: boolean };
type Fixture = {
  controller: EditorController;
  pending: Deferred[];
  calls: string[];
  errors: string[];
  changes: string[];
  newCalls?: string[];
  subscriptions: Subscription[];
  trackedBeforeMount?: Subscription[];
};
declare global {
  interface Window {
    suspendedUpload?: Fixture;
  }
}

async function start(page: Page, kind: "image" | "attachment", count = 1, failDestroy = false, withOnError = true) {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'suspended-upload'
      document.body.replaceChildren(host)
      const pending = [], calls = [], errors = [], changes = []
      const upload = file => {
        calls.push(file.name)
        return new Promise((resolve, reject) => pending.push({ resolve, reject }))
      }
      const controller = createEditor({
        element: host, outline: false, content: '<p>原文</p>',
        uploadImage: upload, uploadAttachment: upload,
        onError: ${withOnError ? "error => errors.push(error.message)" : "undefined"},
        onChange: snapshot => changes.push(snapshot.text),
      })
      if (${JSON.stringify(failDestroy)}) controller.editor.on('destroy', () => { throw new Error('host-destroy-failure') })
      const subscriptions = []
      const editor = controller.editor
      const on = editor.on.bind(editor), off = editor.off.bind(editor)
      editor.on = (name, callback) => {
        if (name === 'mount' || name === 'destroy') subscriptions.push({ name, callback, removed: false })
        return on(name, callback)
      }
      editor.off = (name, callback) => {
        for (const item of subscriptions) if (item.name === name && item.callback === callback) item.removed = true
        return off(name, callback)
      }
      window.suspendedUpload = { controller, pending, calls, errors, changes, subscriptions }
    `,
  });
  await page.waitForFunction(() => Boolean(window.suspendedUpload));
  if (kind === "image") {
    await page.evaluate((count) => {
      const editor = window.__semloRequireFixture("suspendedUpload").controller.editor;
      const transfer = new DataTransfer();
      for (let index = 1; index <= count; index++)
        transfer.items.add(new File([`image-${index}`], `${index}.png`, { type: "image/png" }));
      editor.view.dom.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
    }, count);
  } else {
    await page
      .locator('#suspended-upload input[type="file"]')
      .nth(1)
      .setInputFiles(
        Array.from({ length: count }, (_, index) => ({
          name: `${index + 1}.txt`,
          mimeType: "text/plain",
          buffer: Buffer.from(`attachment-${index + 1}`),
        })),
      );
  }
  await page.waitForFunction(() => window.__semloRequireFixture("suspendedUpload").pending.length === 1);
  await expect(page.locator("#suspended-upload .semlo-editor-uploading")).toHaveCount(count);
}

for (const kind of ["image", "attachment"] as const) {
  test(`${kind} does not leave upload waiters when a host destroy listener throws`, async ({ page }) => {
    await start(page, kind, 1, true);
    const result = await page.evaluate(async (kind) => {
      const fixture = window.__semloRequireFixture("suspendedUpload");
      const editor = fixture.controller.editor;
      editor.unmount();
      fixture.pending[0].resolve(kind === "image" ? "/tests/sample-image.svg" : "/tests/sample.txt");
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const waiters = fixture.subscriptions.slice();
      let error = "";
      try {
        editor.destroy();
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      return { error, leaked: waiters.filter((entry) => !entry.removed).map((entry) => entry.name) };
    }, kind);
    expect(result.error).toBe("host-destroy-failure");
    expect(result.leaked).toEqual([]);
  });
}

for (const kind of ["image", "attachment"] as const) {
  for (const mode of ["success", "reject", "replace", "readonly", "destroy", "rapid remount"] as const) {
    test(`${kind} upload handles ${mode} while unmounted`, async ({ page }) => {
      await start(page, kind);
      const result = await page.evaluate(
        async ({ kind, mode }) => {
          const fixture = window.__semloRequireFixture("suspendedUpload");
          const { controller, pending, errors } = fixture;
          const editor = controller.editor;
          editor.unmount();
          if (mode === "replace") editor.commands.setContent("<p>宿主新文档</p>");
          if (mode === "readonly") editor.setEditable(false, false);
          if (mode === "destroy") editor.destroy();
          if (mode === "reject") pending[0].reject(new Error("上传失败测试"));
          else pending[0].resolve(kind === "image" ? "/tests/sample-image.svg" : "/tests/sample.txt");
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          const beforeMountSubscriptions = fixture.subscriptions.slice();
          let rapidWaiters = 0;
          let rapidWaiterLeak = 0;
          if (mode !== "destroy") {
            let hostMount: (() => void) | undefined;
            if (mode === "rapid remount") {
              let firstMount = true;
              hostMount = () => {
                if (!firstMount) return;
                firstMount = false;
                editor.unmount();
              };
              editor.on("mount", hostMount);
            }
            const target = document.createElement("div");
            document.querySelector("#suspended-upload .semlo-editor-content")!.append(target);
            editor.mount(target);
            if (mode === "rapid remount") {
              await new Promise<void>((resolve) => setTimeout(resolve, 0));
              if (!editor.isDestroyed) throw new Error("First remount was expected to be immediately unmounted");
              const waiters = fixture.subscriptions.filter(
                (entry) => entry.name === "mount" && entry.callback !== hostMount && !entry.removed,
              );
              rapidWaiters = waiters.length;
              const second = document.createElement("div");
              document.querySelector("#suspended-upload .semlo-editor-content")!.append(second);
              editor.mount(second);
              await new Promise<void>((resolve) => setTimeout(resolve, 0));
              rapidWaiterLeak = waiters.filter((entry) => !entry.removed).length;
              if (hostMount) editor.off("mount", hostMount);
            }
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          }
          const nodes: string[] = [];
          editor.state.doc.descendants((node) => {
            nodes.push(node.type.name);
          });
          const placeholder =
            mode === "destroy" ? null : editor.view.dom.querySelectorAll(".semlo-editor-uploading").length;
          const text = editor.state.doc.textContent;
          const leaked = beforeMountSubscriptions.filter((entry) => !entry.removed).map((entry) => entry.name);
          if (mode !== "destroy") controller.destroy();
          return { nodes, placeholder, text, errors, calls: fixture.calls, leaked, rapidWaiters, rapidWaiterLeak };
        },
        { kind, mode },
      );
      const type = kind === "image" ? "image" : "semloEditorAttachment";
      if (mode === "success" || mode === "rapid remount") expect(result.nodes).toContain(type);
      else expect(result.nodes).not.toContain(type);
      if (mode !== "destroy") expect(result.placeholder).toBe(0);
      if (mode === "replace") expect(result.text).toBe("宿主新文档");
      if (mode === "reject") expect(result.errors).toEqual(["上传失败测试"]);
      else if (mode === "readonly" && kind === "image") expect(result.errors).toEqual(["编辑器已设为只读，图片未插入"]);
      else expect(result.errors).toEqual([]);
      expect(result.calls).toEqual([kind === "image" ? "1.png" : "1.txt"]);
      expect(result.leaked).toEqual([]);
      if (mode === "rapid remount") {
        expect(result.rapidWaiters).toBe(1);
        expect(result.rapidWaiterLeak).toBe(0);
      }
    });
  }
}

for (const kind of ["image", "attachment"] as const) {
  test(`${kind} queue continues in order after a result arrives while unmounted`, async ({ page }) => {
    await start(page, kind, 2);
    const first = await page.evaluate(async (kind) => {
      const fixture = window.__semloRequireFixture("suspendedUpload");
      const editor = fixture.controller.editor;
      editor.unmount();
      fixture.pending[0].resolve(kind === "image" ? "/tests/one.svg" : "/tests/one.txt");
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      fixture.trackedBeforeMount = fixture.subscriptions.slice();
      const beforeRemount = [...fixture.calls];
      const target = document.createElement("div");
      document.querySelector("#suspended-upload .semlo-editor-content")!.append(target);
      editor.mount(target);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      return { beforeRemount, afterRemount: [...fixture.calls] };
    }, kind);
    expect(first.beforeRemount).toEqual([kind === "image" ? "1.png" : "1.txt"]);
    expect(first.afterRemount).toEqual(kind === "image" ? ["1.png", "2.png"] : ["1.txt", "2.txt"]);
    const final = await page.evaluate(async (kind) => {
      const fixture = window.__semloRequireFixture("suspendedUpload");
      fixture.pending[1].resolve(kind === "image" ? "/tests/two.svg" : "/tests/two.txt");
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const names: string[] = [];
      fixture.controller.editor.state.doc.descendants((node) => {
        if (node.type.name === "image") names.push(String(node.attrs.alt));
        if (node.type.name === "semloEditorAttachment") names.push(String(node.attrs.name));
      });
      const placeholders = fixture.controller.editor.view.dom.querySelectorAll(".semlo-editor-uploading").length;
      const leaked = fixture.trackedBeforeMount!.filter((entry) => !entry.removed).map((entry) => entry.name);
      fixture.controller.destroy();
      return { names, placeholders, errors: fixture.errors, leaked };
    }, kind);
    expect(final.names).toEqual(kind === "image" ? ["1.png", "2.png"] : ["1.txt", "2.txt"]);
    expect(final.placeholders).toBe(0);
    expect(final.errors).toEqual([]);
    expect(final.leaked).toEqual([]);
  });
}

for (const kind of ["image", "attachment"] as const) {
  test(`${kind} readonly toggle while unmounted cancels the whole queued batch`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await start(page, kind, 2);
    const result = await page.evaluate(async (kind) => {
      const fixture = window.__semloRequireFixture("suspendedUpload");
      const { controller, pending } = fixture;
      const editor = controller.editor;
      editor.unmount();
      let error = "";
      try {
        controller.setEditable(false);
        controller.setEditable(true);
      } catch (cause) {
        error = String(cause);
      }
      pending[0].resolve(kind === "image" ? "/tests/sample-image.svg" : "/tests/sample.txt");
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const target = document.createElement("div");
      document.querySelector("#suspended-upload .semlo-editor-content")!.append(target);
      editor.mount(target);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const nodes: string[] = [];
      editor.state.doc.descendants((node) => {
        nodes.push(node.type.name);
      });
      const placeholders = editor.view.dom.querySelectorAll(".semlo-editor-uploading").length;
      const calls = [...fixture.calls],
        errors = [...fixture.errors];
      controller.destroy();
      return { error, nodes, placeholders, calls, errors };
    }, kind);
    expect(result.error).toBe("");
    expect(result.nodes).not.toContain(kind === "image" ? "image" : "semloEditorAttachment");
    expect(result.placeholders).toBe(0);
    expect(result.calls).toEqual([kind === "image" ? "1.png" : "1.txt"]);
    expect(result.errors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  for (const withOnError of [true, false]) {
    test(`${kind} document replacement while unmounted cancels uploads (onError=${withOnError})`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await start(page, kind, 2, false, withOnError);
      const result = await page.evaluate(async (kind) => {
        const fixture = window.__semloRequireFixture("suspendedUpload");
        const { controller, pending } = fixture;
        const editor = controller.editor;
        editor.unmount();
        const changesBefore = fixture.changes.length;
        controller.setContent("<p>卸载时的新文档</p>");
        const textBeforeMount = editor.state.doc.textContent;
        const changesAfter = fixture.changes.length;
        const errorBox = document.querySelector<HTMLElement>("#suspended-upload .semlo-editor-error")!;
        const errorVisible = !errorBox.hidden;
        pending[0].resolve(kind === "image" ? "/tests/sample-image.svg" : "/tests/sample.txt");
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        const target = document.createElement("div");
        document.querySelector("#suspended-upload .semlo-editor-content")!.append(target);
        editor.mount(target);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        const nodes: string[] = [];
        editor.state.doc.descendants((node) => {
          nodes.push(node.type.name);
        });
        const text = editor.state.doc.textContent;
        const placeholders = editor.view.dom.querySelectorAll(".semlo-editor-uploading").length;
        const calls = [...fixture.calls],
          errors = [...fixture.errors];
        controller.destroy();
        return { textBeforeMount, text, nodes, placeholders, calls, errors, errorVisible, changesBefore, changesAfter };
      }, kind);
      expect(result.textBeforeMount).toBe("卸载时的新文档");
      expect(result.text).toBe("卸载时的新文档");
      expect(result.nodes).not.toContain(kind === "image" ? "image" : "semloEditorAttachment");
      expect(result.placeholders).toBe(0);
      expect(result.calls).toEqual([kind === "image" ? "1.png" : "1.txt"]);
      expect(result.errors).toEqual([]);
      expect(result.errorVisible).toBe(false);
      expect(result.changesAfter).toBe(result.changesBefore);
      expect(pageErrors).toEqual([]);
    });
  }

  test(`${kind} provider changes while unmounted leave the in-flight batch on its original provider`, async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await start(page, kind, 2);
    const first = await page.evaluate(async (kind) => {
      const fixture = window.__semloRequireFixture("suspendedUpload");
      const { controller, pending } = fixture;
      const editor = controller.editor;
      editor.unmount();
      const newCalls: string[] = [];
      fixture.newCalls = newCalls;
      const nextUpload = (file: File) => {
        newCalls.push(file.name);
        return Promise.resolve(kind === "image" ? "/tests/new.svg" : "/tests/new.txt");
      };
      controller.setIntegrations({ uploadImage: nextUpload, uploadAttachment: nextUpload });
      pending[0].resolve(kind === "image" ? "/tests/one.svg" : "/tests/one.txt");
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const target = document.createElement("div");
      document.querySelector("#suspended-upload .semlo-editor-content")!.append(target);
      editor.mount(target);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      return { calls: [...fixture.calls], newCalls };
    }, kind);
    expect(first.calls).toEqual(kind === "image" ? ["1.png", "2.png"] : ["1.txt", "2.txt"]);
    expect(first.newCalls).toEqual([]);
    const result = await page.evaluate(async (kind) => {
      const fixture = window.__semloRequireFixture("suspendedUpload");
      fixture.pending[1].resolve(kind === "image" ? "/tests/two.svg" : "/tests/two.txt");
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const names: string[] = [];
      fixture.controller.editor.state.doc.descendants((node) => {
        if (node.type.name === "image") names.push(String(node.attrs.alt));
        if (node.type.name === "semloEditorAttachment") names.push(String(node.attrs.name));
      });
      const placeholders = fixture.controller.editor.view.dom.querySelectorAll(".semlo-editor-uploading").length;
      const errors = [...fixture.errors];
      return { names, placeholders, errors };
    }, kind);
    expect(result.names).toEqual(kind === "image" ? ["1.png", "2.png"] : ["1.txt", "2.txt"]);
    expect(result.placeholders).toBe(0);
    expect(result.errors).toEqual([]);
    if (kind === "image") {
      await page.evaluate(() => {
        const editor = window.__semloRequireFixture("suspendedUpload").controller.editor;
        const transfer = new DataTransfer();
        transfer.items.add(new File(["third"], "third.png", { type: "image/png" }));
        editor.view.dom.dispatchEvent(
          new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
        );
      });
    } else {
      await page
        .locator('#suspended-upload input[type="file"]')
        .nth(1)
        .setInputFiles({
          name: "third.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("third"),
        });
    }
    await page.waitForFunction(() => window.__semloRequireFixture("suspendedUpload").newCalls?.length === 1);
    const after = await page.evaluate(() => {
      const fixture = window.__semloRequireFixture("suspendedUpload");
      const calls = [...(fixture.newCalls ?? [])];
      fixture.controller.destroy();
      return calls;
    });
    expect(after).toEqual([kind === "image" ? "third.png" : "third.txt"]);
    expect(pageErrors).toEqual([]);
  });

  test(`${kind} host destruction during an unmounted readonly change cancels pending work`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await start(page, kind, 2);
    const result = await page.evaluate(async (kind) => {
      const fixture = window.__semloRequireFixture("suspendedUpload");
      const { controller, pending } = fixture;
      const editor = controller.editor;
      editor.unmount();
      let reentered = false;
      editor.on("transaction", () => {
        if (reentered) return;
        reentered = true;
        controller.destroy();
      });
      let error = "";
      try {
        controller.setEditable(false);
      } catch (cause) {
        error = String(cause);
      }
      pending[0].resolve(kind === "image" ? "/tests/sample-image.svg" : "/tests/sample.txt");
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      return {
        reentered,
        error,
        destroyed: editor.isDestroyed,
        shell: !!document.querySelector("#suspended-upload .semlo-editor"),
        calls: [...fixture.calls],
        errors: [...fixture.errors],
        leaked: fixture.subscriptions.filter((entry) => !entry.removed).map((entry) => entry.name),
      };
    }, kind);
    expect(result.reentered).toBe(true);
    expect(result.error).toBe("");
    expect(result.destroyed).toBe(true);
    expect(result.shell).toBe(false);
    expect(result.calls).toEqual([kind === "image" ? "1.png" : "1.txt"]);
    expect(result.errors).toEqual([]);
    expect(result.leaked).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test(`${kind} host destruction during an unmounted document replacement cancels pending work`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await start(page, kind, 2);
    const result = await page.evaluate(async (kind) => {
      const fixture = window.__semloRequireFixture("suspendedUpload");
      const { controller, pending } = fixture;
      const editor = controller.editor;
      editor.unmount();
      let reentered = false;
      editor.on("transaction", () => {
        if (reentered) return;
        reentered = true;
        controller.destroy();
      });
      let error = "";
      try {
        controller.setContent("<p>宿主替换</p>");
      } catch (cause) {
        error = String(cause);
      }
      pending[0].resolve(kind === "image" ? "/tests/sample-image.svg" : "/tests/sample.txt");
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      return {
        reentered,
        error,
        destroyed: editor.isDestroyed,
        shell: !!document.querySelector("#suspended-upload .semlo-editor"),
        calls: [...fixture.calls],
        errors: [...fixture.errors],
        leaked: fixture.subscriptions.filter((entry) => !entry.removed).map((entry) => entry.name),
      };
    }, kind);
    expect(result.reentered).toBe(true);
    expect(result.error).toBe("");
    expect(result.destroyed).toBe(true);
    expect(result.shell).toBe(false);
    expect(result.calls).toEqual([kind === "image" ? "1.png" : "1.txt"]);
    expect(result.errors).toEqual([]);
    expect(result.leaked).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test(`${kind} controller destruction while unmounted cancels the settled queue`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await start(page, kind, 2);
    const result = await page.evaluate(async (kind) => {
      const fixture = window.__semloRequireFixture("suspendedUpload");
      const { controller, pending } = fixture;
      controller.editor.unmount();
      pending[0].resolve(kind === "image" ? "/tests/sample-image.svg" : "/tests/sample.txt");
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const waiters = fixture.subscriptions.slice();
      let error = "";
      try {
        controller.destroy();
      } catch (cause) {
        error = String(cause);
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      return {
        error,
        destroyed: controller.editor.isDestroyed,
        calls: [...fixture.calls],
        errors: [...fixture.errors],
        leaked: waiters.filter((entry) => !entry.removed).map((entry) => entry.name),
      };
    }, kind);
    expect(result.error).toBe("");
    expect(result.destroyed).toBe(true);
    expect(result.calls).toEqual([kind === "image" ? "1.png" : "1.txt"]);
    expect(result.errors).toEqual([]);
    expect(result.leaked).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
}
