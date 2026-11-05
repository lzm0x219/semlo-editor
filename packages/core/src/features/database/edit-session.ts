import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import {
  DatabaseContentError,
  databaseLimits,
  databaseValueText,
  type DatabaseActor,
  type DatabaseData,
} from "./model";
import { DatabaseCellStep } from "./transactions";
import { validateDatabaseData } from "./validation";

interface CellSession {
  input: HTMLInputElement;
  databaseId: string;
  recordId: string;
  fieldId: string;
  initial: string;
  initialTime: string | null;
  initialActor: DatabaseActor | null;
  states: { value: string; time: string | null; actor: DatabaseActor | null }[];
  index: number;
  compositionIndex: number | null;
  syncValue(): void;
}

interface EditSessionContext {
  dom: HTMLElement;
  editor: Editor;
  view: EditorView;
  getPos(): number | undefined;
  getCurrent(): ProseMirrorNode;
  setCurrent(node: ProseMirrorNode): void;
  isDestroyed(): boolean;
  getData(): DatabaseData;
  getActor(): DatabaseActor | null;
  reportError(error: DatabaseContentError): void;
  onValueApplied(input: HTMLInputElement): void;
  dispatchWrite(transaction: Transaction, pos: number): void;
  endContinuousEditing(): void;
  finishEditing(input: HTMLElement): void;
}

interface CellInputOptions {
  recordId: string;
  fieldId: string;
  trim: boolean;
  onValueChange?(value: string): void;
}

export function createDatabaseEditSession({
  dom,
  editor,
  view,
  getPos,
  getCurrent,
  setCurrent,
  isDestroyed,
  getData,
  getActor,
  reportError,
  onValueApplied,
  dispatchWrite,
  endContinuousEditing,
  finishEditing,
}: EditSessionContext) {
  const doc = dom.ownerDocument;
  let cellSession: CellSession | null = null;
  let composingInput: HTMLInputElement | null = null;
  const finishCellSession = (input?: HTMLInputElement) => {
    const session = cellSession;
    if (!session || (input && session.input !== input)) return;
    cellSession = null;
    composingInput = null;
    if (isDestroyed() || editor.isDestroyed) return;
    const pos = getPos();
    const live = typeof pos === "number" ? view.state.doc.nodeAt(pos) : null;
    if (typeof pos !== "number" || !live || live !== getCurrent() || live.type !== getCurrent().type) return;
    const data = validateDatabaseData(live.attrs.data);
    const record = data.records.find((item) => item.id === session.recordId);
    const value = record?.values[session.fieldId];
    if (data.id !== session.databaseId || typeof value !== "string" || value === session.initial) return;
    const step = new DatabaseCellStep(
      pos,
      data.id,
      session.recordId,
      session.fieldId,
      session.initial,
      value,
      session.initialTime,
      record?.modifiedAt ?? null,
      session.initialActor,
      record?.modifiedBy ?? null,
    );
    const transaction = closeHistory(view.state.tr.step(step));
    dispatchWrite(transaction, pos);
    setCurrent(view.state.doc.nodeAt(pos) ?? getCurrent());
  };
  const beginCellSession = (input: HTMLInputElement, recordId: string, fieldId: string, syncValue: () => void) => {
    if (!editor.isEditable || isDestroyed() || !dom.contains(input)) return;
    if (cellSession?.input === input) return;
    finishCellSession();
    const data = getData();
    const record = data.records.find((record) => record.id === recordId);
    const value = record?.values[fieldId];
    if (typeof value !== "string") return;
    cellSession = {
      input,
      databaseId: data.id,
      recordId,
      fieldId,
      initial: value,
      initialTime: record?.modifiedAt ?? null,
      initialActor: record?.modifiedBy ?? null,
      states: [{ value, time: record?.modifiedAt ?? null, actor: record?.modifiedBy ?? null }],
      index: 0,
      compositionIndex: null,
      syncValue,
    };
  };
  const refreshRecordMetadata = (recordId: string) => {
    const data = getData();
    const record = data.records.find((entry) => entry.id === recordId);
    if (!record) return;
    const metadataFields = new Map(
      data.fields
        .filter((field) => ["createdTime", "modifiedTime", "createdBy", "modifiedBy"].includes(field.type))
        .map((field) => [field.id, field]),
    );
    for (const cell of dom.querySelectorAll<HTMLElement>(
      ".semlo-editor-database-cell[data-record-id][data-field-id]",
    )) {
      if (cell.dataset.recordId !== recordId) continue;
      const field = metadataFields.get(cell.dataset.fieldId ?? "");
      if (field && cell.firstElementChild)
        cell.firstElementChild.textContent = databaseValueText(field, record.values[field.id]);
    }
  };
  const applySessionValue = (
    session: NonNullable<typeof cellSession>,
    value: string,
    time: string | null,
    actor: DatabaseActor | null,
  ) => {
    if (
      isDestroyed() ||
      editor.isDestroyed ||
      !editor.isEditable ||
      cellSession !== session ||
      !dom.contains(session.input)
    )
      return false;
    const pos = getPos();
    const live = typeof pos === "number" ? view.state.doc.nodeAt(pos) : null;
    if (typeof pos !== "number" || !live || live !== getCurrent() || live.type !== getCurrent().type) return false;
    const data = validateDatabaseData(live.attrs.data);
    const record = data.records.find((record) => record.id === session.recordId);
    const existing = record?.values[session.fieldId];
    if (data.id !== session.databaseId || typeof existing !== "string" || existing === value) return false;
    const step = new DatabaseCellStep(
      pos,
      data.id,
      session.recordId,
      session.fieldId,
      existing,
      value,
      record?.modifiedAt ?? null,
      time,
      record?.modifiedBy ?? null,
      actor,
    );
    const transaction = view.state.tr.step(step).setMeta("addToHistory", false);
    const expectedNode = transaction.doc.nodeAt(pos);
    dispatchWrite(transaction, pos);
    if (cellSession !== session) return false;
    const updatedNode = view.state.doc.nodeAt(pos) ?? getCurrent();
    setCurrent(updatedNode);
    // 如果没有自动元数据列且文档未被追加事务替换，无需再次校验整表并遍历所有单元格。
    if (
      updatedNode !== expectedNode ||
      data.fields.some((field) => ["createdTime", "modifiedTime", "createdBy", "modifiedBy"].includes(field.type))
    )
      refreshRecordMetadata(session.recordId);
    onValueApplied(session.input);
    return true;
  };

  const startComposition = (input: HTMLInputElement, recordId: string, fieldId: string, syncValue: () => void) => {
    beginCellSession(input, recordId, fieldId, syncValue);
    composingInput = input;
    if (cellSession?.input === input) cellSession.compositionIndex = cellSession.index;
  };

  const endComposition = (input: HTMLInputElement) => {
    if (composingInput === input) composingInput = null;
    if (cellSession?.input === input) cellSession.compositionIndex = null;
  };

  const updateInput = (input: HTMLInputElement, recordId: string, fieldId: string, onRestore: () => void) => {
    beginCellSession(input, recordId, fieldId, onRestore);
    const session = cellSession;
    if (!session || session.input !== input || session.states[session.index].value === input.value) return;
    try {
      if (input.value.length > databaseLimits.text)
        throw new DatabaseContentError(`文本长度不能超过 ${databaseLimits.text} 个字符`);
      const time = new Date().toISOString();
      const actor = getActor();
      if (!applySessionValue(session, input.value, time, actor)) return;
      session.states.splice(session.index + 1);
      if (composingInput === input && session.compositionIndex !== null && session.index > session.compositionIndex) {
        session.states[session.index] = { value: input.value, time, actor };
      } else {
        session.states.push({ value: input.value, time, actor });
        session.index++;
      }
    } catch (error) {
      if (cellSession === session && dom.contains(input)) {
        const value = getData().records.find((entry) => entry.id === recordId)?.values[fieldId];
        input.value = typeof value === "string" ? value : "";
        onRestore();
      }
      if (error instanceof DatabaseContentError) reportError(error);
      else throw error;
    }
  };

  const finishInput = (input: HTMLInputElement, trim: boolean) => {
    const session = cellSession;
    if (trim && session?.input === input && input.value !== input.value.trim()) {
      const value = input.value.trim();
      const state = session.states[session.index];
      if (applySessionValue(session, value, state.time, state.actor)) input.value = value;
    }
    finishCellSession(input);
  };

  const handleHistory = (input: HTMLInputElement, isRedo: boolean): boolean => {
    const session = cellSession?.input === input ? cellSession : null;
    if (!session) return false;
    const target = session.index + (isRedo ? 1 : -1);
    if (target >= 0 && target < session.states.length) {
      const previous = input.value;
      input.value = session.states[target].value;
      if (applySessionValue(session, input.value, session.states[target].time, session.states[target].actor)) {
        session.index = target;
        try {
          input.setSelectionRange(input.value.length, input.value.length);
        } catch {
          // 原生日期输入框没有文本光标。
        }
      } else input.value = previous;
      session.syncValue();
      return true;
    }
    if (session.states.length > 1) return true;
    finishCellSession(input);
    return false;
  };

  // 输入框与会话一起管理，避免调用方自行编排输入法、回滚和历史分组的顺序。
  const bindInput = (input: HTMLInputElement, { recordId, fieldId, trim, onValueChange }: CellInputOptions) => {
    input.dataset.semloEditorHistory = "cell";
    input.dataset.recordId = recordId;
    input.dataset.fieldId = fieldId;
    const syncValue = () => onValueChange?.(input.value);
    input.addEventListener("focus", () => {
      endContinuousEditing();
      beginCellSession(input, recordId, fieldId, syncValue);
    });
    input.addEventListener("compositionstart", () => startComposition(input, recordId, fieldId, syncValue));
    input.addEventListener("compositionend", () => {
      doc.defaultView?.setTimeout(() => endComposition(input), 0);
    });
    input.addEventListener("input", () => {
      syncValue();
      updateInput(input, recordId, fieldId, syncValue);
    });
    input.addEventListener("change", () => finishEditing(input));
    input.addEventListener("blur", () => {
      finishInput(input, trim);
      finishEditing(input);
    });
    input.addEventListener("keydown", (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      }
    });
  };

  return {
    reset() {
      cellSession = null;
      composingInput = null;
    },
    finishCellSession,
    bindInput,
    handleHistory,
  };
}
