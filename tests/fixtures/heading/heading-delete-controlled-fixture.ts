import { closeHistory } from "@tiptap/pm/history";

import "./heading-restart-controlled-fixture";

declare global {
  interface Window {
    closeHeadingDeleteHistory?(): void;
  }
}

window.closeHeadingDeleteHistory = () => {
  const editor = window.__semloRequireFixture("restartControlledFixture").controller.editor;
  editor.view.dispatch(closeHistory(editor.state.tr).setMeta("addToHistory", false));
};
