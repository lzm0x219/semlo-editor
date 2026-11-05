import { expect, test } from "@rstest/playwright";

import { createDatabaseData } from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    databaseActorReentrantEditor?: EditorController;
    databaseActorReentrantMode?: string;
  }
}

for (const action of ["create", "update"] as const) {
  for (const mode of ["replace", "replace-new", "nested", "readonly", "destroy", "echo", "adjacent"] as const) {
    test(`${action}/${mode}: currentUser reentrancy preserves the live document`, async ({ page }) => {
      await installFixtureGuards(page);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const data = createDatabaseData();
      if (action === "update") {
        data.fields[2].type = "checkbox";
        data.fields[2].defaultValue = false;
        for (const record of data.records) record.values[data.fields[2].id] = false;
      }
      const content = {
        type: "doc",
        content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }],
      };
      await page.goto(process.env.SEMLO_TEST_ORIGIN!);
      await page.evaluate((value) => Reflect.set(window, "databaseActorReentrantContent", value), content);
      await page.addScriptTag({
        type: "module",
        content: `
      import { createEditor } from '/dist/index.js'
      const host=document.createElement('div');host.id='database-actor-reentrant';document.body.prepend(host)
      let controller
      controller=createEditor({element:host,outline:false,content:window.databaseActorReentrantContent,
        currentUser:()=>{
          const mode=window.databaseActorReentrantMode
          if(mode){window.databaseActorReentrantMode=undefined
            if(mode==='destroy') controller.destroy()
            else if(mode==='readonly') controller.setEditable(false)
            else if(mode==='nested') host.querySelector('button[aria-label="添加记录"]').click()
            else if(mode==='echo') controller.setContent(structuredClone(controller.getSnapshot().json))
            else if(mode==='adjacent') controller.editor.commands.insertContentAt(controller.editor.state.doc.content.size - 1, '旁')
            else {const replacement=structuredClone(controller.getSnapshot().json);const data=replacement.content[0].attrs.data;data.records[0].values[data.fields[0].id]='新内容';controller.setContent(replacement);if(mode==='replace-new') host.querySelector('button[aria-label="添加记录"]').click()}
          }
          return {id:'user',label:'用户'}
        }})
      window.databaseActorReentrantEditor=controller
    `,
      });
      const root = page.locator("#database-actor-reentrant .semlo-editor-database");
      await expect(root).toBeVisible();
      await page.evaluate((value) => {
        window.databaseActorReentrantMode = value;
      }, mode);
      if (action === "create") await root.getByRole("button", { name: "添加记录", exact: true }).click();
      else await root.getByLabel("第 1 行 日期").click();
      if (mode === "destroy") await expect(root).toHaveCount(0);
      else {
        const snapshot = await page.evaluate(
          () => window.__semloRequireFixture("databaseActorReentrantEditor").getSnapshot().json,
        );
        const saved = snapshot.content![0].attrs!.data;
        const allowed = mode === "echo" || mode === "adjacent";
        expect(saved.records).toHaveLength(
          mode === "replace-new" || mode === "nested" || (action === "create" && allowed) ? 4 : 3,
        );
        if (action === "update") expect(saved.records[0].values[data.fields[2].id]).toBe(allowed);
        if (mode === "replace" || mode === "replace-new")
          expect(saved.records[0].values[data.fields[0].id]).toBe("新内容");
        else if (mode === "readonly") await expect(root.getByLabel("第 1 行 文本")).toHaveAttribute("readonly", "");
        if (mode === "replace-new" || mode === "nested") {
          const undo = await page.evaluate(() =>
            window.__semloRequireFixture("databaseActorReentrantEditor").editor.commands.undo(),
          );
          expect(undo).toBe(true);
          const undone = await page.evaluate(
            () =>
              window.__semloRequireFixture("databaseActorReentrantEditor").getSnapshot().json.content![0].attrs!.data,
          );
          expect(undone.records).toHaveLength(3);
          if (mode === "replace-new") expect(undone.records[0].values[data.fields[0].id]).toBe("新内容");
          expect(
            await page.evaluate(() =>
              window.__semloRequireFixture("databaseActorReentrantEditor").editor.commands.redo(),
            ),
          ).toBe(true);
          const redone = await page.evaluate(
            () =>
              window.__semloRequireFixture("databaseActorReentrantEditor").getSnapshot().json.content![0].attrs!.data,
          );
          expect(redone.records).toHaveLength(4);
        }
      }
      expect(errors).toEqual([]);
    });
  }
}
