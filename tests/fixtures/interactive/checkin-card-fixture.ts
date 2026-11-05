import { Editor, Node } from "@tiptap/core";

import { CheckinCard, type CheckinService } from "../../../packages/core/src/features/interactive/checkin-card";
import {
  InteractiveCardHostController,
  type InteractiveCardHost,
} from "../../../packages/core/src/features/interactive/interactive-card-host";

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
    checkinEditor?: Editor;
    checkinHost?: InteractiveCardHostController;
    checkinTestHost?: InteractiveCardHost | null;
    checkinVerify?: boolean;
    checkinSyncFails?: boolean;
    checkinCalls?: string[];
    checkinPending?: Array<{
      signal: AbortSignal;
      resolve: (value: { checkedIn: boolean }) => void;
      reject: () => void;
    }>;
    mountCheckin?(serviceEnabled: boolean, content?: string): void;
  }
}
window.checkinCalls = [];
window.checkinPending = [];
window.mountCheckin = (serviceEnabled, content) => {
  const service: CheckinService = {
    getStatus: (id, signal) =>
      new Promise((resolve, reject) => {
        window.__semloRequireFixture("checkinCalls").push(`get:${id}`);
        window.__semloRequireFixture("checkinPending").push({ signal, resolve, reject });
      }),
    checkIn: (id, signal) =>
      new Promise((resolve, reject) => {
        window.__semloRequireFixture("checkinCalls").push(`submit:${id}`);
        window.__semloRequireFixture("checkinPending").push({ signal, resolve, reject });
      }),
  };
  window.checkinVerify = true;
  window.checkinSyncFails = false;
  const host = new InteractiveCardHostController(
    serviceEnabled
      ? ({
          createActivity: async () => ({ cardId: "created" }),
          verifyConfiguration: async () => {
            if (window.checkinVerify === undefined) throw new Error("Check-in verification is not initialized");
            return window.checkinVerify;
          },
          syncConfiguration: async () => {
            if (window.checkinSyncFails === undefined) throw new Error("Check-in sync state is not initialized");
            if (window.checkinSyncFails) throw new Error("sync failed");
            window.checkinVerify = true;
          },
          checkin: service,
          vote: {
            getStatus: async () => ({ canVote: false, selectedOptionIds: [] }),
            submitVote: async () => ({ canVote: false, selectedOptionIds: [] }),
          },
        } as InteractiveCardHost)
      : null,
  );
  window.checkinHost = host;
  window.checkinTestHost = host.getHost();
  window.checkinEditor = new Editor({
    element: document.querySelector("#editor")!,
    extensions: [Document, Paragraph, Text, CheckinCard.configure({ host })],
    content: content ?? { type: "doc", content: [{ type: "semloEditorCheckin", attrs: { cardId: "card-1" } }] },
  });
};
