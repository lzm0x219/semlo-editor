import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    uploadRemountEditor?: EditorController;
    uploadRemountImageResolve?: (url: string) => void;
    uploadRemountAttachmentResolve?: (url: string) => void;
  }
}

for (const kind of ["image", "attachment"] as const) {
  for (const destination of ["same document", "iframe"] as const) {
    test(`pending ${kind} widget survives unmount and mount in ${destination}`, async ({ page }) => {
      await installFixtureGuards(page);
      await page.goto(process.env.SEMLO_TEST_ORIGIN!);
      await page.addScriptTag({
        type: "module",
        content: `
        import { createEditor } from '/dist/index.js'
        const host = document.createElement('div')
        host.id = 'upload-remount'
        document.body.replaceChildren(host)
        window.uploadRemountEditor = createEditor({
          element: host, outline: false, content: '<p>前文</p>',
          uploadImage: () => new Promise(resolve => { window.uploadRemountImageResolve = resolve }),
          uploadAttachment: () => new Promise(resolve => { window.uploadRemountAttachmentResolve = resolve }),
        })
      `,
      });
      await page.waitForFunction(() => Boolean(window.uploadRemountEditor));
      if (kind === "image") {
        await page.evaluate(() => {
          const editor = window.__semloRequireFixture("uploadRemountEditor").editor;
          const clipboard = new DataTransfer();
          clipboard.items.add(new File(["image"], "sample.png", { type: "image/png" }));
          editor.view.dom.dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true }));
        });
      } else {
        await page
          .locator('#upload-remount input[type="file"]')
          .nth(1)
          .setInputFiles({
            name: "sample.txt",
            mimeType: "text/plain",
            buffer: Buffer.from("attachment"),
          });
      }
      await expect(page.locator("#upload-remount .semlo-editor-uploading")).toHaveText(
        `正在上传 sample.${kind === "image" ? "png" : "txt"}…`,
      );
      const result = await page.evaluate((destination) => {
        const controller = window.__semloRequireFixture("uploadRemountEditor");
        const before = controller.getSnapshot().json;
        controller.editor.unmount();
        let target: HTMLElement;
        if (destination === "iframe") {
          const iframe = document.createElement("iframe");
          document.body.append(iframe);
          const child = iframe.contentDocument!;
          target = child.createElement("div");
          child.body.append(target);
        } else {
          target = document.createElement("div");
          document.querySelector("#upload-remount .semlo-editor-content")!.append(target);
        }
        let error = "";
        try {
          controller.editor.mount(target);
        } catch (cause) {
          error = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
        }
        return {
          error,
          before,
          after: error ? null : controller.getSnapshot().json,
          hasWidget: !!target.querySelector(".semlo-editor-uploading"),
          ownerMatches: target.querySelector(".semlo-editor-uploading")?.ownerDocument === target.ownerDocument,
        };
      }, destination);
      expect(result.error, `${kind}: ${result.error}`).toBe("");
      expect(result.after).toEqual(result.before);
      expect(result.hasWidget).toBe(true);
      expect(result.ownerMatches).toBe(true);
      await page.evaluate((kind) => {
        if (kind === "image") window.__semloRequireFixture("uploadRemountImageResolve")("/tests/sample-image.svg");
        else window.__semloRequireFixture("uploadRemountAttachmentResolve")("/tests/sample.txt");
      }, kind);
      await page.waitForFunction((kind) => {
        const editor = window.__semloRequireFixture("uploadRemountEditor").editor;
        let present = false;
        editor.state.doc.descendants((node) => {
          if (node.type.name === (kind === "image" ? "image" : "semloEditorAttachment")) present = true;
        });
        return present;
      }, kind);
      expect(
        await page.evaluate(
          () =>
            window
              .__semloRequireFixture("uploadRemountEditor")
              .editor.view.dom.querySelectorAll(".semlo-editor-uploading").length,
        ),
      ).toBe(0);
      await page.evaluate(() => window.__semloRequireFixture("uploadRemountEditor").destroy());
    });
  }
}
