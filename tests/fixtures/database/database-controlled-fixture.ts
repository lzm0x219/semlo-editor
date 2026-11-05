import { closeHistory } from "@tiptap/pm/history";

import "../list/ordered-restart-controlled-fixture";

import "../../../packages/core/src/features/database/database.css";

declare global {
  interface Window {
    closeDatabaseTestHistory?(): void;
  }
}

window.closeDatabaseTestHistory = () => {
  const fixture = window.restartControlledFixture;
  if (!fixture) throw new Error("Restart controlled fixture is not initialized");
  const editor = fixture.controller.editor;
  editor.view.dispatch(closeHistory(editor.state.tr));
};
