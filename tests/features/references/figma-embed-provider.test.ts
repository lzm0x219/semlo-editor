import { describe, expect, test } from "@rstest/core";

import { embedProviders, resolveEmbed } from "../../../packages/core/src/features/references/embed-providers";

describe("Figma embeds", () => {
  test("reconstructs supported links and preserves the selected node and prototype start", () => {
    expect(
      resolveEmbed(
        "figma",
        "https://www.figma.com/proto/abc123/Example?node-id=5-3&starting-point-node-id=1%3A2&client-id=evil",
      ),
    ).toEqual({
      url: "https://www.figma.com/proto/abc123?node-id=5-3&starting-point-node-id=1%3A2",
      embedUrl: "https://embed.figma.com/proto/abc123?node-id=5-3&starting-point-node-id=1%3A2&embed-host=semlo",
    });
    expect(resolveEmbed("figma", embedProviders.figma.example)?.embedUrl).toBe(
      "https://embed.figma.com/design/nrPSsILSYjesyc5UHjYYa4?embed-host=semlo",
    );
    for (const type of ["file", "design", "board", "proto", "slides", "deck"]) {
      expect(resolveEmbed("figma", `https://figma.com/${type}/abc123`)).not.toBeNull();
    }
  });
  test("rejects untrusted hosts and paths and never forwards arbitrary query parameters", () => {
    for (const input of [
      "https://figma.com.evil.test/design/abc",
      "https://evil@figma.com/design/abc",
      "http://figma.com/design/abc",
      "https://figma.com/design/%2Fabc",
      "https://figma.com/embed?url=https://evil.test",
      "https://figma.com/design/abc/extra/path",
    ]) {
      expect(resolveEmbed("figma", input)).toBeNull();
    }
    expect(
      resolveEmbed("figma", "https://embed.figma.com/design/abc?node-id=oops&redirect=https://evil.test")?.embedUrl,
    ).toBe("https://embed.figma.com/design/abc?embed-host=semlo");
  });
});
