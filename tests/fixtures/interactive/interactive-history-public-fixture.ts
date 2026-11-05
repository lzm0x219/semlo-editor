import {
  createEditor,
  type EditorController,
  type InteractiveCardConfig,
  type InteractiveCardHost,
} from "../../../packages/core/src/index";
declare global {
  interface Window {
    publicHistoryEditor?: EditorController;
    publicHistorySyncs?: InteractiveCardConfig[];
    mountPublicHistory?(kind: "vote" | "checkin"): void;
  }
}
window.mountPublicHistory = (kind) => {
  window.publicHistorySyncs = [];
  let saved: InteractiveCardConfig =
    kind === "vote"
      ? {
          kind,
          title: "原始标题",
          options: [
            { id: "a", label: "甲" },
            { id: "b", label: "乙" },
          ],
          multiple: false,
          deadline: null,
        }
      : { kind, title: "原始标题", buttonLabel: "我已读", deadline: null };
  const host: InteractiveCardHost = {
    createActivity: async () => ({ cardId: "unused" }),
    verifyConfiguration: async (_id, config) => JSON.stringify(config) === JSON.stringify(saved),
    syncConfiguration: async (_id, config) => {
      saved = structuredClone(config);
      window.__semloRequireFixture("publicHistorySyncs").push(saved);
    },
    checkin: { getStatus: async () => ({ checkedIn: false }), checkIn: async () => ({ checkedIn: true }) },
    vote: {
      getStatus: async () => ({ canVote: true, selectedOptionIds: [] }),
      submitVote: async (_id, ids) => ({ canVote: false, selectedOptionIds: ids }),
    },
  };
  const { kind: _kind, ...attrs } = saved;
  window.publicHistoryEditor = createEditor({
    element: document.querySelector("#editor")!,
    toolbar: false,
    interactiveCardHost: host,
    onInteractiveCardAbandoned: () => {},
    content: {
      type: "doc",
      content: [
        { type: kind === "vote" ? "semloEditorVote" : "semloEditorCheckin", attrs: { cardId: "activity", ...attrs } },
      ],
    },
  });
};
