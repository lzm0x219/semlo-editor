import { Editor, Node } from "@tiptap/core";

import { CheckinCard } from "../../../packages/core/src/features/interactive/checkin-card";
import {
  InteractiveCardHostController,
  type InteractiveCardHost,
} from "../../../packages/core/src/features/interactive/interactive-card-host";
import {
  insertInteractiveCard,
  defaultCheckinConfig,
  defaultVoteConfig,
  type InteractiveInsertResult,
  type InteractiveInsertReason,
  type InteractiveInsertTarget,
} from "../../../packages/core/src/features/interactive/interactive-card-insert";
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
const BulletList = Node.create({
  name: "bulletList",
  group: "block",
  content: "listItem+",
  parseHTML: () => [{ tag: "ul" }],
  renderHTML: () => ["ul", 0],
});
const ListItem = Node.create({
  name: "listItem",
  content: "paragraph block*",
  parseHTML: () => [{ tag: "li" }],
  renderHTML: () => ["li", 0],
});
declare global {
  interface Window {
    insertEditor?: Editor;
    insertHost?: InteractiveCardHostController;
    insertCancel?: AbortController;
    insertPending?: Array<{
      signal: AbortSignal;
      resolve: (value: { cardId: string }) => void;
      reject: (error: Error) => void;
    }>;
    insertReports?: Array<{ cardId: string; reason: InteractiveInsertReason }>;
    insertResult?: InteractiveInsertResult | null;
    setupInsert?(): void;
    startInsert?(kind: "checkin" | "vote", target?: InteractiveInsertTarget): void;
    docChanges?: number;
  }
}
window.setupInsert = () => {
  window.insertPending = [];
  window.insertReports = [];
  window.insertResult = null;
  window.insertCancel = new AbortController();
  const service: InteractiveCardHost = {
    createActivity: (_config, _copiedFrom, signal) =>
      new Promise((resolve, reject) => window.__semloRequireFixture("insertPending").push({ signal, resolve, reject })),
    verifyConfiguration: async () => false,
    syncConfiguration: async () => {},
  };
  window.insertHost = new InteractiveCardHostController(service);
  window.insertEditor = new Editor({
    element: document.querySelector("#editor")!,
    extensions: [
      Document,
      Paragraph,
      Text,
      BulletList,
      ListItem,
      CheckinCard.configure({ host: window.insertHost }),
      VoteCard.configure({ host: window.insertHost }),
    ],
    content: "<p>内容</p>",
  });
};
window.startInsert = (kind, target) => {
  window.docChanges = 0;
  window.__semloRequireFixture("insertEditor").on("transaction", ({ transaction }) => {
    if (transaction.docChanged) window.__semloIncrementFixture("docChanges");
  });
  void insertInteractiveCard({
    editor: window.__semloRequireFixture("insertEditor"),
    host: window.__semloRequireFixture("insertHost"),
    config: kind === "vote" ? defaultVoteConfig() : defaultCheckinConfig(),
    signal: window.__semloRequireFixture("insertCancel").signal,
    target,
    onAbandoned: ({ cardId, reason }) => window.__semloRequireFixture("insertReports").push({ cardId, reason }),
  }).then((result) => {
    window.insertResult = result;
  });
};
