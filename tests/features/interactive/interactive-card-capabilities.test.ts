import { expect, test } from "@rstest/core";

import {
  canCreateInteractiveActivity,
  type InteractiveCardHost,
} from "../../../packages/core/src/features/interactive/interactive-card-host";

function host(): InteractiveCardHost {
  return {
    createActivity: async () => ({ cardId: "created" }),
    verifyConfiguration: async () => true,
    syncConfiguration: async () => {},
  };
}

test("creation availability is specific to each service and requires the cleanup callback", () => {
  const current = host();
  const callback = () => {};
  expect(canCreateInteractiveActivity(null, "vote", callback)).toBe(false);
  expect(canCreateInteractiveActivity(current, "vote", callback)).toBe(false);
  expect(canCreateInteractiveActivity(current, "checkin", callback)).toBe(false);
  current.vote = {
    getStatus: async () => ({ canVote: true, selectedOptionIds: [] }),
    submitVote: async () => ({ canVote: false, selectedOptionIds: [] }),
  };
  expect(canCreateInteractiveActivity(current, "vote", callback)).toBe(true);
  expect(canCreateInteractiveActivity(current, "checkin", callback)).toBe(false);
  expect(canCreateInteractiveActivity(current, "vote", undefined)).toBe(false);
  current.checkin = { getStatus: async () => ({ checkedIn: false }), checkIn: async () => ({ checkedIn: true }) };
  expect(canCreateInteractiveActivity(current, "checkin", callback)).toBe(true);
  expect(
    canCreateInteractiveActivity(
      { ...current, syncConfiguration: undefined } as unknown as InteractiveCardHost,
      "checkin",
      callback,
    ),
  ).toBe(false);
});

test("a check-in-only host does not enable voting", () => {
  const current = host();
  current.checkin = { getStatus: async () => ({ checkedIn: false }), checkIn: async () => ({ checkedIn: true }) };
  expect(canCreateInteractiveActivity(current, "checkin", () => {})).toBe(true);
  expect(canCreateInteractiveActivity(current, "vote", () => {})).toBe(false);
});
