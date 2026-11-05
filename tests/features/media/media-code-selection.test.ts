import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    codeUploadProbe: {
      controller: EditorController;
      finish: (url: string) => void;
      reported: string[];
    };
  }
}

for (const kind of ["attachment", "audio", "video"] as const) {
  test(`${kind} upload initiated within code preserves code and inserts the result`, async ({ page }) => {
    await installFixtureGuards(page);
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
      import { createEditor } from '/dist/index.js';
      const host = document.createElement('div'); host.id = 'code-upload-probe'; document.body.append(host);
      let finish; const reported = [];
      const controller = createEditor({ element: host, outline: false,
        content: { type: 'doc', content: [{type:'codeBlock',attrs:{language:'javascript'},content:[{type:'text',text:'hello world'}]}] },
        uploadAttachment: () => new Promise(resolve => { finish = resolve }),
        onError: error => reported.push(error.message) });
      controller.editor.commands.setTextSelection(6);
      window.codeUploadProbe = {controller, get finish() {return finish}, reported};
    `,
    });
    await page.waitForFunction(() => Boolean(window.codeUploadProbe));
    const host = page.locator("#code-upload-probe");
    const name = kind === "attachment" ? "one.txt" : kind === "audio" ? "one.wav" : "one.mp4";
    const mimeType = kind === "attachment" ? "text/plain" : kind === "audio" ? "audio/wav" : "video/mp4";
    await page.evaluate(() => window.codeUploadProbe.controller.editor.commands.focus());
    await host.getByRole("button", { name: "插入内容" }).click();
    const chooserPromise = page.waitForEvent("filechooser");
    await page
      .getByRole("dialog", { name: "插入内容" })
      .locator(`.semlo-editor-card-item[data-command="${kind}"]`)
      .click();
    const chooser = await chooserPromise;
    await chooser.setFiles({ name, mimeType, buffer: Buffer.from("local") });
    await page.waitForFunction(() => Boolean(window.codeUploadProbe.finish));
    await page.evaluate((fileName) => window.codeUploadProbe.finish(`/files/${fileName}`), name);
    if (kind === "attachment") await expect(host.locator("a[data-semlo-editor-attachment]")).toHaveText(name);
    else await expect(host.locator(kind)).toHaveAttribute("src", `/files/${name}`);
    expect(await page.evaluate(() => window.codeUploadProbe.controller.getSnapshot().json)).toMatchObject({
      type: "doc",
    });
    console.log(
      "RESULT_JSON",
      kind,
      JSON.stringify(await page.evaluate(() => window.codeUploadProbe.controller.getSnapshot().json)),
    );
    await expect(host.locator(".semlo-editor-code-card")).toContainText("hello world");
    expect(await page.evaluate(() => window.codeUploadProbe.reported)).toEqual([]);
    await page.evaluate(() => window.codeUploadProbe.controller.destroy());
  });
}

test("concurrent uploads anchored after code preserve edits and undo", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js';
    const host = document.createElement('div'); host.id = 'code-upload-probe'; document.body.append(host);
    const pending = [], reported = [];
    const controller = createEditor({ element: host, outline: false,
      content: { type: 'doc', content: [{type:'codeBlock',attrs:{language:'javascript'},content:[{type:'text',text:'hello world'}]}] },
      uploadAttachment: file => new Promise(resolve => pending.push({name:file.name,resolve})),
      onError: error => reported.push(error.message) });
    window.codeUploadConcurrent = {controller,pending,reported};
  `,
  });
  await page.waitForFunction(() => Boolean(window.codeUploadConcurrent));
  const host = page.locator("#code-upload-probe");
  for (const kind of ["attachment", "audio"] as const) {
    await page.evaluate(() => {
      const editor = window.codeUploadConcurrent.controller.editor;
      editor.commands.setTextSelection(6);
      editor.commands.focus();
    });
    await host.getByRole("button", { name: "插入内容" }).click();
    const chooserPromise = page.waitForEvent("filechooser");
    await page
      .getByRole("dialog", { name: "插入内容" })
      .locator(`.semlo-editor-card-item[data-command="${kind}"]`)
      .click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: kind === "audio" ? "voice.wav" : "notes.txt",
      mimeType: kind === "audio" ? "audio/wav" : "text/plain",
      buffer: Buffer.from("local"),
    });
  }
  await page.waitForFunction(() => window.codeUploadConcurrent.pending.length === 2);
  await page.evaluate(() => {
    window.codeUploadConcurrent.controller.editor.commands.insertContentAt(6, "!");
    window.codeUploadConcurrent.pending[1].resolve("/files/voice.wav");
  });
  await expect(host.locator("audio")).toHaveCount(1);
  await page.evaluate(() => window.codeUploadConcurrent.pending[0].resolve("/files/notes.txt"));
  await expect(host.locator("a[data-semlo-editor-attachment]")).toHaveCount(1);
  await expect(host.locator(".semlo-editor-code-card")).toHaveCount(1);
  await expect(host.locator(".semlo-editor-code-card")).toContainText("hello! world");
  await page.evaluate(() => window.codeUploadConcurrent.controller.editor.commands.undo());
  await expect(host.locator("a[data-semlo-editor-attachment]")).toHaveCount(0);
  console.log(
    "UNDO_SNAPSHOT",
    JSON.stringify(await page.evaluate(() => window.codeUploadConcurrent.controller.getSnapshot().json)),
  );
  await expect(host.locator(".semlo-editor-code-card")).toContainText("hello! world");
  expect(await page.evaluate(() => window.codeUploadConcurrent.reported)).toEqual([]);
  await page.evaluate(() => window.codeUploadConcurrent.controller.destroy());
});

declare global {
  interface Window {
    codeUploadConcurrent: {
      controller: EditorController;
      pending: Array<{ name: string; resolve: (url: string) => void }>;
      reported: string[];
    };
  }
}
