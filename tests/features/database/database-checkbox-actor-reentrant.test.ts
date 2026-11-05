import { expect, test } from "@rstest/playwright";

import { createDatabaseData } from "../../../packages/core/src/features/database/model";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

for (const mode of ["echo", "replace", "nested", "readonly", "destroy"] as const)
  test(`checkbox pending group currentUser ${mode}`, async ({ page }) => {
    await installFixtureGuards(page);
    const data = createDatabaseData();
    const field = data.fields[1];
    field.type = "checkbox";
    field.defaultValue = true;
    data.records.forEach((r) => (r.values[field.id] = false));
    data.views[0].groupFieldId = field.id;
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.evaluate((value) => Reflect.set(window, "pendingActorData", value), data);
    await page.addScriptTag({
      type: "module",
      content: `import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='pending-actor';document.body.prepend(host);let controller;controller=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'semloEditorDatabase',attrs:{data:window.pendingActorData}},{type:'paragraph'}]},currentUser:()=>{const mode=window.pendingActorMode;if(mode){window.pendingActorMode='';if(mode==='echo')controller.setContent(structuredClone(controller.getSnapshot().json));if(mode==='replace'){const next=structuredClone(controller.getSnapshot().json);next.content[0].attrs.data.records[0].values[next.content[0].attrs.data.fields[0].id]='替换';controller.setContent(next)}if(mode==='nested')host.querySelector('button[aria-label="在未勾选分组添加记录"]').click();if(mode==='readonly')controller.setEditable(false);if(mode==='destroy')controller.destroy()}return {id:'u',label:'用户'}}});window.pendingActorEditor=controller`,
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const root = page.locator("#pending-actor .semlo-editor-database");
    await expect(root).toBeVisible();
    await page.evaluate((value) => Reflect.set(window, "pendingActorMode", value), mode);
    await root.getByRole("button", { name: "在未勾选分组添加记录" }).click();
    if (mode === "destroy") await expect(root).toHaveCount(0);
    else {
      const snapshot = await page.evaluate(() => Reflect.get(window, "pendingActorEditor").getSnapshot().json);
      const records = snapshot.content[0].attrs.data.records;
      expect(records).toHaveLength(mode === "nested" || mode === "echo" ? 4 : 3);
      if (mode === "replace") expect(records[0].values[data.fields[0].id]).toBe("替换");
      if (mode === "readonly") await expect(root.getByLabel("第 1 行 文本")).toHaveAttribute("readonly", "");
      if (mode === "nested" || mode === "echo") {
        expect(records[3].values[field.id]).toBe(true);
        const group = await page.evaluate((id) => {
          let row = document.querySelector<HTMLElement>(
            `#pending-actor .semlo-editor-database-cell[data-record-id="${id}"]`,
          )?.parentElement?.previousElementSibling;
          while (row && !row.classList.contains("semlo-editor-database-group-row")) row = row.previousElementSibling;
          return row?.querySelector(".semlo-editor-database-group-heading")?.getAttribute("aria-label");
        }, records[3].id);
        expect(group).toBe("折叠分组 未勾选");
      }
    }
    expect(errors).toEqual([]);
  });
