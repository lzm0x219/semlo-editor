import { expect, test } from "@rstest/core";

import { selectedImageScale } from "../../../packages/core/src/features/media/image/size-control";

test("a small image selects only its closest preset with stable ties", () => {
  expect(selectedImageScale(2, 4)).toBe(50);
  expect(selectedImageScale(1, 1)).toBe(100);
  expect(selectedImageScale(1, 2)).toBe(50);
  expect(selectedImageScale(1.5, 4)).toBe(25);
  expect(selectedImageScale(300, 320)).toBeNull();
  expect(selectedImageScale(0, 4)).toBeNull();
});
