import { expect, test } from "@rstest/core";
import type { AttachmentUpload, ImageUpload } from "@semlo-editor/core";

test("upload callbacks retain single-argument assignment and direct invocation", async () => {
  const image: ImageUpload = async (file) => `/images/${file.name}`;
  const attachment: AttachmentUpload = async (file) => `/files/${file.name}`;
  const file = new File(["content"], "file.txt");
  expect(await image(file)).toBe("/images/file.txt");
  expect(await attachment(file)).toBe("/files/file.txt");
});

test("upload callbacks can receive an abort signal from a caller", async () => {
  const upload: ImageUpload = async (_file, context) => (context?.signal.aborted ? "aborted" : "active");
  const controller = new AbortController();
  controller.abort();
  expect(await upload(new File([], "file.png"), { signal: controller.signal })).toBe("aborted");
});
