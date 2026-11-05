import type { Editor } from "@tiptap/core";

import type { CanvasData, CanvasShape } from "./model";
import type { CanvasViewState } from "./state";

interface CanvasShapeTextOptions {
  doc: Document;
  stage: HTMLElement;
  editor: Editor;
  state: Pick<CanvasViewState, "current" | "documentEpoch" | "destroyed">;
  getData(): CanvasData;
  commit(data: CanvasData): boolean;
  paint(): void;
}

export function createCanvasShapeTextEditing({
  doc,
  stage,
  editor,
  state,
  getData,
  commit,
  paint,
}: CanvasShapeTextOptions) {
  const laneTitleEditor = (
    button: HTMLButtonElement,
    item: CanvasShape,
    title: HTMLSpanElement,
    label: string,
    index: number,
  ) => {
    const editTitle = () => {
      if (!editor.isEditable) return;
      const editNode = state.current;
      const editEpoch = state.documentEpoch;
      const field = doc.createElement("input");
      field.value = label;
      field.className = "semlo-editor-canvas-lane-editor";
      field.style.fontSize = `${(item.fontSize ?? 14) / 8}cqw`;
      field.style.fontWeight = item.bold === false ? "normal" : "bold";
      field.style.fontStyle = item.italic ? "italic" : "normal";
      field.style.textDecoration = title.style.textDecoration;
      field.style.color = item.textColor ?? "#222222";
      field.setAttribute("aria-label", `编辑泳道 ${index + 1} 名称`);
      title.replaceWith(field);
      const editingShape = doc.createElement("div");
      editingShape.className = button.className;
      editingShape.style.cssText = button.style.cssText;
      editingShape.dataset.shapeId = item.id;
      editingShape.append(...button.childNodes);
      button.replaceWith(editingShape);
      field.addEventListener("pointerdown", (e) => e.stopPropagation());
      field.addEventListener("click", (e) => e.stopPropagation());
      let done = false;
      const finish = (save: boolean, restoreFocus = false) => {
        if (done) return;
        done = true;
        if (state.destroyed || state.documentEpoch !== editEpoch || !state.current.eq(editNode)) return;
        const focusShape = () => {
          if (!restoreFocus) return;
          Array.from(stage.querySelectorAll<HTMLButtonElement>(".semlo-editor-canvas-shape"))
            .find((shape) => shape.dataset.shapeId === item.id)
            ?.focus();
        };
        if (save && field.value !== label) {
          const next = getData();
          const target = next.shapes.find((shape) => shape.id === item.id);
          if (target?.lanes && index < target.lanes.length) {
            target.lanes[index] = field.value;
            if (commit(next)) {
              focusShape();
              return;
            }
          }
        }
        paint();
        focusShape();
      };
      field.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Escape" && !e.isComposing) {
          e.preventDefault();
          finish(false, true);
        }
        if (e.key === "Enter" && !e.isComposing) {
          e.preventDefault();
          finish(true, true);
        }
      });
      field.addEventListener("blur", () => finish(true));
      field.focus();
      field.select();
    };
    return editTitle;
  };
  const bindShape = (
    button: HTMLButtonElement,
    data: CanvasData,
    item: CanvasShape,
    laneTitleEditors: Array<() => void>,
  ) => {
    button.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      if (!editor.isEditable) return;
      if (item.shape === "image") return;
      if (item.lanes) {
        const title = doc.elementFromPoint(event.clientX, event.clientY)?.closest(".semlo-editor-canvas-lane-title");
        const index = Array.from(button.querySelectorAll(".semlo-editor-canvas-lane-title")).indexOf(title as Element);
        if (index >= 0) laneTitleEditors[index]?.();
        return;
      }
      const editNode = state.current;
      const editEpoch = state.documentEpoch;
      const field = doc.createElement("textarea");
      field.className = "semlo-editor-canvas-text";
      field.value = item.text;
      field.setAttribute("aria-label", "编辑图形文字");
      button.replaceWith(field);
      field.style.cssText = button.style.cssText;
      field.style.fontSize = `${(item.fontSize ?? 14) / 8}cqw`;
      field.style.fontWeight = item.bold ? "bold" : "normal";
      field.style.fontStyle = item.italic ? "italic" : "normal";
      field.style.textDecoration =
        [item.underline && "underline", item.strike && "line-through"].filter(Boolean).join(" ") || "none";
      if (item.shape !== "actor" && item.verticalAlign && item.verticalAlign !== "middle") {
        field.style.lineHeight = "1.2";
        const positionText = () => {
          const inset = stage.getBoundingClientRect().width / 100;
          if (item.verticalAlign === "top") {
            field.style.paddingTop = `${inset}px`;
            return;
          }
          const computed = doc.defaultView!.getComputedStyle(field);
          const mirror = doc.createElement("div");
          mirror.style.cssText = "position:fixed;visibility:hidden;white-space:pre-wrap;overflow-wrap:break-word;";
          mirror.style.width = `${Math.max(0, field.clientWidth - parseFloat(computed.paddingLeft) - parseFloat(computed.paddingRight))}px`;
          mirror.style.font = computed.font;
          mirror.style.lineHeight = computed.lineHeight;
          mirror.textContent = `${field.value}\u200b`;
          doc.body.append(mirror);
          const textHeight = mirror.getBoundingClientRect().height;
          mirror.remove();
          field.style.paddingTop = `${Math.max(inset, field.clientHeight - textHeight - inset)}px`;
        };
        positionText();
        field.addEventListener("input", positionText);
      }
      field.style.color = item.textColor ?? (item.shape === "text" ? item.stroke : undefined) ?? "#222222";
      let done = false;
      const finish = (save: boolean) => {
        if (done) return;
        done = true;
        if (state.destroyed || state.documentEpoch !== editEpoch || !state.current.eq(editNode)) return;
        if (save && field.value !== item.text) {
          item.text = field.value;
          if (commit(data)) return;
        }
        if (!state.destroyed) paint();
      };
      field.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.isComposing) return;
        if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        }
      });
      field.addEventListener("blur", () => finish(true));
      field.focus();
      field.select();
    });
  };
  return { laneTitleEditor, bindShape };
}

export type CanvasShapeTextEditing = ReturnType<typeof createCanvasShapeTextEditing>;
