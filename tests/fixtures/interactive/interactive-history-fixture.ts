import { Editor, Extension, Node } from "@tiptap/core";
import { history, undo, redo, isHistoryTransaction } from "@tiptap/pm/history";

import { CheckinCard } from "../../../packages/core/src/features/interactive/checkin-card";
import {
  InteractiveCardHostController,
  type InteractiveCardConfig,
  type InteractiveCardHost,
} from "../../../packages/core/src/features/interactive/interactive-card-host";
import { VoteCard } from "../../../packages/core/src/features/interactive/vote-card";
const Document = Node.create({ name: "doc", topNode: true, content: "block+" });
const Paragraph = Node.create({ name: "paragraph", group: "block", content: "inline*", renderHTML: () => ["p", 0] });
const Text = Node.create({ name: "text", group: "inline" });
const History = Extension.create({ name: "testHistory", addProseMirrorPlugins: () => [history()] });
declare global {
  interface Window {
    historyCardEditor?: Editor;
    historyCardHost?: InteractiveCardHostController;
    historyCardSyncs?: Array<{ service: string; config: InteractiveCardConfig }>;
    mountHistoryCard?(kind: "vote" | "checkin"): void;
    swapHostOnHistory?: boolean;
    noopOnHistory?: boolean;
    historyCardUndo?(): void;
    historyCardRedo?(): void;
    replaceHistoryHost?(): void;
  }
}
window.mountHistoryCard = (kind) => {
  window.historyCardSyncs = [];
  window.swapHostOnHistory = false;
  window.noopOnHistory = false;
  let saved: InteractiveCardConfig =
    kind === "vote"
      ? {
          kind,
          title: "原标题",
          options: [
            { id: "a", label: "甲" },
            { id: "b", label: "乙" },
          ],
          multiple: false,
          deadline: null,
        }
      : { kind, title: "原标题", buttonLabel: "我已读", deadline: null };
  const makeHost = (service: string): InteractiveCardHost => ({
    createActivity: async () => ({ cardId: "unused" }),
    verifyConfiguration: async (_id, config) => JSON.stringify(config) === JSON.stringify(saved),
    syncConfiguration: async (_id, config) => {
      window.__semloRequireFixture("historyCardSyncs").push({ service, config: structuredClone(config) });
      saved = structuredClone(config);
    },
    checkin: { getStatus: async () => ({ checkedIn: false }), checkIn: async () => ({ checkedIn: true }) },
    vote: {
      getStatus: async () => ({ canVote: true, selectedOptionIds: [] }),
      submitVote: async (_id, ids) => ({ canVote: false, selectedOptionIds: ids }),
    },
  });
  const host = new InteractiveCardHostController(makeHost("old"));
  window.historyCardHost = host;
  window.replaceHistoryHost = () => host.setHost(makeHost("new"));
  const { kind: _kind, ...attrs } = saved;
  window.historyCardEditor = new Editor({
    onTransaction: ({ editor, transaction }) => {
      if (window.__semloRequireFixture("noopOnHistory") && isHistoryTransaction(transaction)) {
        window.noopOnHistory = false;
        editor.view.dispatch(editor.state.tr.setMeta("interactive-test-noop", true));
      }
      if (window.__semloRequireFixture("swapHostOnHistory") && isHistoryTransaction(transaction)) {
        window.swapHostOnHistory = false;
        window.__semloRequireFixture("replaceHistoryHost")();
      }
    },
    element: document.querySelector("#editor")!,
    extensions: [Document, Paragraph, Text, History, CheckinCard.configure({ host }), VoteCard.configure({ host })],
    content: {
      type: "doc",
      content: [
        { type: kind === "vote" ? "semloEditorVote" : "semloEditorCheckin", attrs: { cardId: "activity", ...attrs } },
      ],
    },
  });
  window.historyCardUndo = () => {
    undo(
      window.__semloRequireFixture("historyCardEditor").state,
      window.__semloRequireFixture("historyCardEditor").view.dispatch,
    );
  };
  window.historyCardRedo = () => {
    redo(
      window.__semloRequireFixture("historyCardEditor").state,
      window.__semloRequireFixture("historyCardEditor").view.dispatch,
    );
  };
};
