import { Editor, Node } from "@tiptap/core";

import { CheckinCard } from "../../../packages/core/src/features/interactive/checkin-card";
import {
  InteractiveCardHostController,
  type InteractiveCardConfig,
} from "../../../packages/core/src/features/interactive/interactive-card-host";
import { VoteCard } from "../../../packages/core/src/features/interactive/vote-card";
const Document = Node.create({ name: "doc", topNode: true, content: "block+" });
const Paragraph = Node.create({
  name: "paragraph",
  group: "block",
  content: "inline*",
  parseHTML: () => [{ tag: "p" }],
  renderHTML: () => ["p", 0],
});
const Text = Node.create({ name: "text", group: "inline" });
declare global {
  interface Window {
    deadlineEditor?: Editor;
    deadlineSyncs?: InteractiveCardConfig[];
    mountDeadline?(kind: "vote" | "checkin", content?: string): void;
  }
}
window.mountDeadline = (kind, content) => {
  window.deadlineSyncs = [];
  const host = new InteractiveCardHostController({
    createActivity: async () => ({ cardId: "unused" }),
    verifyConfiguration: async () => true,
    syncConfiguration: async (_id, config) => {
      window.__semloRequireFixture("deadlineSyncs").push(config);
    },
    checkin: { getStatus: async () => ({ checkedIn: false }), checkIn: async () => ({ checkedIn: true }) },
    vote: {
      getStatus: async () => ({ canVote: true, selectedOptionIds: [] }),
      submitVote: async () => ({ canVote: false, selectedOptionIds: [] }),
    },
  });
  window.deadlineEditor = new Editor({
    element: document.querySelector("#editor")!,
    extensions: [Document, Paragraph, Text, CheckinCard.configure({ host }), VoteCard.configure({ host })],
    content: content ?? {
      type: "doc",
      content: [{ type: kind === "vote" ? "semloEditorVote" : "semloEditorCheckin", attrs: { cardId: "activity" } }],
    },
  });
};
