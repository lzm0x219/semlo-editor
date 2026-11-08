import { describe, expect, test } from "@rstest/core";

import { embedProviders, resolveEmbed } from "../../../packages/core/src/features/references/embed-providers";

const legacyFile = "https://www.figma.com/file/qwccoVDBmt1FZ6U4eGus2p/%E8%AF%AD%E9%9B%80%E6%8F%92%E5%9B%BE";
const legacySample = `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(legacyFile)}`;
const wrap = (inner: string) => `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(inner)}`;

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

describe("Figma Embed Kit 1.0 wrappers", () => {
  test("keeps the observed wrapper as both the iframe and direct link target", () => {
    expect(resolveEmbed("figma", legacySample)).toEqual({ url: legacySample, embedUrl: legacySample });
    const target = resolveEmbed("figma", legacySample)!;
    expect(resolveEmbed("figma", target.url)).toEqual(target);
    expect(legacySample).toContain("%25E8%25AF%25AD");
  });

  test("retains validated legacy fields and strips unknown outer and inner fields", () => {
    const inner = "https://figma.com/proto/abc123/Example?node-id=5-3&starting-point-node-id=1%3A2";
    const expected = `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(inner)}`;
    const input = `https://www.figma.com/embed?url=${encodeURIComponent(inner + "&redirect=https://evil.test")}&embed_host=share&client-id=evil`;
    expect(resolveEmbed("figma", input)).toEqual({ url: expected, embedUrl: expected });
    const withNode = wrap("https://www.figma.com/design/abc123") + "&node_id=0-3";
    expect(resolveEmbed("figma", withNode)).toEqual({ url: withNode, embedUrl: withNode });
    const bareHost = legacySample.replace("https://www.figma.com/embed", "https://figma.com/embed");
    expect(resolveEmbed("figma", bareHost)).toEqual({ url: bareHost, embedUrl: bareHost });
  });

  test("rejects noncanonical outer origins, credentials, explicit ports and wrapper paths", () => {
    for (const base of [
      "http://www.figma.com/embed",
      "https://www.figma.com.evil.test/embed",
      "https://evil@www.figma.com/embed",
      "https://user:password@www.figma.com/embed",
      "https://www.figma.com:444/embed",
      "https://www.figma.com:443/embed",
      "https://embed.figma.com/embed",
      "https://www.figma.com/embed/extra",
      "https://www.figma.com/embed/",
    ]) {
      const input = base + legacySample.slice(legacySample.indexOf("?"));
      expect(resolveEmbed("figma", input), input).toBeNull();
    }
  });

  test("rejects unsafe or non-file inner URLs before producing any iframe target", () => {
    for (const inner of [
      "javascript:alert(1)",
      "data:text/html,test",
      "http://www.figma.com/file/abc123",
      "//www.figma.com/file/abc123",
      "https://evil.test/file/abc123",
      "https://www.figma.com.evil.test/file/abc123",
      "https://evil@www.figma.com/file/abc123",
      "https://user:password@www.figma.com/file/abc123",
      "https://www.figma.com:444/file/abc123",
      "https://www.figma.com:443/file/abc123",
      "https://www.figma.com/file/%2Fabc123",
      "https://www.figma.com/file/abc123/extra/path",
      "https://www.figma.com/community/file/abc123",
      "https://embed.figma.com/design/abc123?embed-host=share",
    ]) {
      expect(resolveEmbed("figma", wrap(inner)), inner).toBeNull();
    }
  });

  test("rejects recursive wrappers and fragments rather than unwrapping them repeatedly", () => {
    for (const input of [
      wrap(legacySample),
      wrap(wrap(legacySample)),
      legacySample + "#ignored",
      wrap(legacyFile + "#node-id=0-3"),
    ]) {
      expect(resolveEmbed("figma", input), input).toBeNull();
    }
  });

  test("rejects absent, empty and malformed recognized fields", () => {
    for (const input of [
      "https://www.figma.com/embed",
      "https://www.figma.com/embed?embed_host=share",
      `https://www.figma.com/embed?url=${encodeURIComponent(legacyFile)}`,
      legacySample.replace("embed_host=share", "embed_host="),
      legacySample.replace("embed_host=share", "embed_host=https%3A%2F%2Fevil.test"),
      legacySample.replace("embed_host=share", "embed_host=" + "x".repeat(65)),
      legacySample.replace(encodeURIComponent(legacyFile), ""),
      legacySample.replace(encodeURIComponent(legacyFile), "%ZZ"),
      legacySample + "&node_id=invalid",
      wrap(legacyFile + "?node-id="),
      wrap(legacyFile + "?node-id=invalid"),
      wrap(legacyFile + "?starting-point-node-id=invalid"),
    ]) {
      expect(resolveEmbed("figma", input), input).toBeNull();
    }
  });

  test("rejects duplicate fields and conflicting node locations instead of choosing a value", () => {
    for (const input of [
      legacySample + "&url=" + encodeURIComponent(legacyFile),
      legacySample + "&%75rl=" + encodeURIComponent("https://evil.test"),
      legacySample + "&embed_host=another",
      legacySample + "&node_id=0-3&node_id=0-3",
      legacySample + "&unknown=a&unknown=b",
      wrap(legacyFile + "?node-id=0-3&node-id=0-4"),
      wrap(legacyFile + "?node-id=0-3&node%2Did=0-4"),
      wrap(legacyFile + "?unknown=a&unknown=b"),
      wrap(legacyFile + "?node-id=0-3") + "&node_id=0-3",
    ]) {
      expect(resolveEmbed("figma", input), input).toBeNull();
    }
  });

  test("rejects literal and encoded controls, backslashes and overlong wrappers", () => {
    for (const input of [
      legacySample + "\n",
      legacySample + "&ignored=%0A",
      legacySample + "&ignored=%250A",
      wrap(legacyFile + "\t"),
      wrap(legacyFile + "%0A"),
      wrap(legacyFile + "%250A"),
      wrap(legacyFile + "?ignored=%0D"),
      wrap("https://www.figma.com\\file\\abc123"),
      legacySample.replace("/embed?", "\\embed?"),
      legacySample + "&ignored=" + "x".repeat(2048),
      wrap(legacyFile + "?ignored=" + "x".repeat(2048)),
      "https://www.figma.com/embed?embed_host=share&url=https://www.figma.com/file/abc123/" + "字".repeat(300),
    ]) {
      expect(resolveEmbed("figma", input), input).toBeNull();
    }
  });

  test("accepts a full-budget validated wrapper that remains stable on reconstruction", () => {
    const prefix = "https://www.figma.com/file/abc123/";
    const input = wrap(prefix + "x".repeat(2048 - wrap(prefix).length));
    expect(input).toHaveLength(2048);
    expect(resolveEmbed("figma", input)).toEqual({ url: input, embedUrl: input });
  });
});
