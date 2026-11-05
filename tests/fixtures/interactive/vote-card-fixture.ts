import { Editor, Node } from "@tiptap/core";

import {
  InteractiveCardHostController,
  type InteractiveCardHost,
  type InteractiveCardConfig,
} from "../../../packages/core/src/features/interactive/interactive-card-host";
import { VoteCard, type VoteService, type VoteStatus } from "../../../packages/core/src/features/interactive/vote-card";

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
    voteEditor?: Editor;
    voteHost?: InteractiveCardHostController;
    voteSyncs?: InteractiveCardConfig[];
    voteSyncFails?: boolean;
    voteCalls?: Array<{ kind: string; id: string; choices?: string[] }>;
    votePending?: Array<{ signal: AbortSignal; resolve: (value: VoteStatus) => void; reject: () => void }>;
    mountVote?(serviceEnabled: boolean, content?: string): void;
  }
}
window.voteCalls = [];
window.votePending = [];
window.voteSyncs = [];
window.voteSyncFails = false;
window.mountVote = (serviceEnabled, content) => {
  const pending = (signal: AbortSignal) =>
    new Promise<VoteStatus>((resolve, reject) =>
      window.__semloRequireFixture("votePending").push({ signal, resolve, reject }),
    );
  const service: VoteService = {
    getStatus: (id, signal) => {
      window.__semloRequireFixture("voteCalls").push({ kind: "get", id });
      return pending(signal);
    },
    submitVote: (id, choices, signal) => {
      window.__semloRequireFixture("voteCalls").push({ kind: "submit", id, choices });
      return pending(signal);
    },
  };
  const host = new InteractiveCardHostController(
    serviceEnabled
      ? ({
          createActivity: async () => ({ cardId: "created" }),
          verifyConfiguration: async () => true,
          syncConfiguration: async (_id, config) => {
            window.__semloRequireFixture("voteSyncs").push(config);
            if (window.__semloRequireFixture("voteSyncFails")) throw new Error("sync failed");
          },
          vote: service,
          checkin: { getStatus: async () => ({ checkedIn: false }), checkIn: async () => ({ checkedIn: false }) },
        } as InteractiveCardHost)
      : null,
  );
  window.voteHost = host;
  window.voteEditor = new Editor({
    element: document.querySelector("#editor")!,
    extensions: [Document, Paragraph, Text, VoteCard.configure({ host })],
    content: content ?? {
      type: "doc",
      content: [
        {
          type: "semloEditorVote",
          attrs: {
            cardId: "vote-1",
            title: "选择",
            options: [
              { id: "a", label: "甲" },
              { id: "b", label: "乙" },
            ],
          },
        },
      ],
    },
  });
};
