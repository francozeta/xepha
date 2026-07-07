import { describe, expect, it } from "vitest";
import { defineKnowledgeEvent } from "@xepha/core";
import {
  createContextPackV0,
  parseContextPackYaml,
  stringifyContextPackYaml,
} from "./index.js";

describe("context pack YAML codec", () => {
  it("serializes and parses a context pack", () => {
    const pack = createContextPackV0({
      task: "prepare a protocol PR",
      generatedAt: "2026-07-06T14:00:00.000Z",
      events: [
        defineKnowledgeEvent({
          id: "evt_001",
          kind: "decision",
          title: "Use YAML only at protocol boundaries",
          summary: "Keep SQLite as canonical storage.",
          occurredAt: "2026-07-06T12:00:00.000Z",
        }),
      ],
      context: "Validated machine-readable context for agent tools.",
    });

    const yaml = stringifyContextPackYaml(pack);
    const result = parseContextPackYaml(yaml);

    expect(result).toEqual({
      ok: true,
      data: pack,
    });
  });

  it("returns structured errors for malformed YAML", () => {
    const result = parseContextPackYaml("version: xepha.context.v0\n  task: bad");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]).toMatchObject({
        code: "yaml_parse_error",
      });
      expect(result.issues[0]?.message).toContain("bad indentation");
    }
  });

  it("returns validation errors for unknown fields in YAML", () => {
    const result = parseContextPackYaml(`
version: xepha.context.v0
task: prepare a protocol PR
generatedAt: "2026-07-06T14:00:00.000Z"
context: Validated machine-readable context for agent tools.
events: []
sources: []
confidence: 1
warnings: []
extra: reject me
`);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          code: "validation_error",
        }),
      );
    }
  });

  it("preserves multiline context using literal blocks", () => {
    const pack = createContextPackV0({
      task: "preserve long context",
      generatedAt: "2026-07-06T14:00:00.000Z",
      context: [
        "Use ContextPackV0 as the boundary.",
        "Do not trust raw YAML without validation.",
        "Keep generated instructions separate from canonical storage.",
      ].join("\n"),
      events: [],
    });

    const yaml = stringifyContextPackYaml(pack);
    const result = parseContextPackYaml(yaml);

    expect(yaml).toContain("context: |");
    expect(result).toEqual({
      ok: true,
      data: pack,
    });
  });
});
