import { expect, test } from "@rstest/playwright";
import { closeHistory, history, redo, redoDepth, undo, undoDepth } from "@tiptap/pm/history";
import { Schema } from "@tiptap/pm/model";
import { EditorState, Plugin, TextSelection, type Transaction } from "@tiptap/pm/state";

import { isProvableRedo } from "../../../packages/core/src/runtime/history-redo-probe";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    heading: { group: "block", content: "text*" },
    text: { group: "inline" },
  },
});

function setup() {
  const hooks = { init: 0, apply: 0, filter: 0, append: 0 };
  const host = new Plugin({
    state: {
      init: () => {
        hooks.init += 1;
        return 0;
      },
      apply: (_tr, value) => {
        hooks.apply += 1;
        return value + 1;
      },
    },
    filterTransaction: () => {
      hooks.filter += 1;
      return true;
    },
    appendTransaction: () => {
      hooks.append += 1;
      return null;
    },
  });
  let state = EditorState.create({
    schema,
    doc: schema.node("doc", null, [schema.node("heading")]),
    plugins: [history(), host],
  });
  state = state.apply(state.tr.insertText("test", 1));
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 5)));
  state = state.apply(closeHistory(state.tr).deleteSelection());
  undo(state, (tr) => {
    state = state.apply(tr);
  });
  let undoTx: Transaction | undefined;
  let redoTx: Transaction | undefined;
  undo(state, (tr) => {
    undoTx = tr;
  });
  redo(state, (tr) => {
    redoTx = tr;
  });
  if (!undoTx || !redoTx) throw new Error("Missing history transaction");
  return { state, undoTx, redoTx, host, hooks };
}

test("isolated history trial distinguishes identical undo/redo transactions without running hosts", () => {
  const { state, undoTx, redoTx, hooks } = setup();
  expect(undoTx.doc.toJSON()).toEqual(redoTx.doc.toJSON());
  expect(undoTx.selection.toJSON()).toEqual(redoTx.selection.toJSON());
  expect(undoTx.steps.map((step) => step.toJSON())).toEqual(redoTx.steps.map((step) => step.toJSON()));
  const oldHooks = { ...hooks };
  const oldState = {
    doc: state.doc.toJSON(),
    selection: state.selection.toJSON(),
    done: undoDepth(state),
    undone: redoDepth(state),
  };
  const oldTransaction = {
    doc: redoTx.doc.toJSON(),
    selection: redoTx.selection.toJSON(),
    steps: redoTx.steps.map((step) => step.toJSON()),
    prevented: redoTx.getMeta("preventClearDocument"),
  };
  expect(isProvableRedo(state, undoTx)).toBe(false);
  expect(isProvableRedo(state, redoTx)).toBe(true);
  expect(hooks).toEqual(oldHooks);
  expect({
    doc: state.doc.toJSON(),
    selection: state.selection.toJSON(),
    done: undoDepth(state),
    undone: redoDepth(state),
  }).toEqual(oldState);
  expect({
    doc: redoTx.doc.toJSON(),
    selection: redoTx.selection.toJSON(),
    steps: redoTx.steps.map((step) => step.toJSON()),
    prevented: redoTx.getMeta("preventClearDocument"),
  }).toEqual(oldTransaction);
});

test("missing history, ordinary transactions and mismatched documents fail closed", () => {
  const { state, redoTx, host } = setup();
  expect(isProvableRedo(state.reconfigure({ plugins: [host] }), redoTx)).toBe(false);
  expect(isProvableRedo(state, state.tr)).toBe(false);
  const changed = state.apply(state.tr.insertText("x", 1).setMeta("addToHistory", false));
  expect(redoDepth(changed)).toBeGreaterThan(0);
  expect(isProvableRedo(changed, redoTx)).toBe(false);
});

test("reconfiguration failures or unproven depth changes fail closed", () => {
  const { state, redoTx } = setup();
  const broken: EditorState = Object.create(state);
  Object.defineProperty(broken, "reconfigure", {
    value: () => {
      throw new Error("fixture");
    },
  });
  expect(isProvableRedo(broken, redoTx)).toBe(false);
  const stagnant: EditorState = Object.create(state);
  Object.defineProperty(stagnant, "reconfigure", {
    value: () => {
      const shadow = state.reconfigure({ plugins: [history()] });
      Object.defineProperty(shadow, "apply", { value: () => shadow });
      return shadow;
    },
  });
  expect(isProvableRedo(stagnant, redoTx)).toBe(false);
});

test("redo direction remains detectable at a configured history capacity boundary", () => {
  let state = EditorState.create({
    schema,
    doc: schema.node("doc", null, [schema.node("heading")]),
    plugins: [history({ depth: 5 })],
  });
  for (let i = 0; i < 25; i += 1) state = state.apply(closeHistory(state.tr).insertText("x", 1));
  expect(undoDepth(state)).toBe(25);
  undo(state, (tr) => {
    state = state.apply(tr);
  });
  let transaction: Transaction | undefined;
  redo(state, (tr) => {
    transaction = tr;
  });
  if (!transaction) throw new Error("Missing capacity redo");
  expect(isProvableRedo(state, transaction)).toBe(true);
});
