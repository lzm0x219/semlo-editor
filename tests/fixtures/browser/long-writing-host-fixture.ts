import { createEditor, type EditorController } from "@semlo-editor/core";

declare global {
  interface Window {
    semloHostArticle?: EditorController;
  }
}

export async function mountLongWritingHost() {
  const save = document.createElement("button");
  save.textContent = "保存";
  save.type = "button";
  save.disabled = true;
  const status = document.createElement("div");
  status.setAttribute("role", "status");
  const host = document.createElement("main");
  document.body.append(save, status, host);

  const response = await fetch("/long-writing-content");
  if (!response.ok) throw new Error(`读取失败（${response.status}）`);
  const editor = createEditor({ element: host, content: await response.text(), outline: false });
  window.semloHostArticle = editor;
  save.disabled = false;
  save.addEventListener("click", async () => {
    save.disabled = true;
    status.textContent = "保存中";
    try {
      const saved = await fetch("/long-writing-content", { method: "PUT", body: editor.getSnapshot().html });
      if (!saved.ok) throw new Error(`保存失败（${saved.status}）`);
      status.textContent = "已保存";
    } catch (error) {
      status.textContent = String(error);
    } finally {
      save.disabled = false;
    }
  });
}
