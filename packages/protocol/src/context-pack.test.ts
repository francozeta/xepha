import { describe, expect, it } from "vitest";
import { defineKnowledgeEvent } from "@xepha/core";
import {
  CONTEXT_PACK_VERSION,
  contextPackV0JsonSchema,
  contextPackV0Schema,
  createContextPackV0,
} from "./index.js";

const storageDecision = defineKnowledgeEvent({
  id: "evt_001",
  kind: "decision",
  title: "Use SQLite for local memory",
  summary: "Persist project history locally before adding remote services.",
  occurredAt: "2026-07-06T12:00:00.000Z",
  tags: ["storage", "sqlite"],
  evidence: [
    {
      label: "Memory PR",
      uri: "https://github.com/francozeta/xepha/pull/6",
    },
  ],
});

const protocolDecision = defineKnowledgeEvent({
  id: "evt_002",
  kind: "architecture",
  title: "Validate context packs at the protocol boundary",
  summary: "All rendered packs should be parsed and validated before use.",
  occurredAt: "2026-07-06T13:00:00.000Z",
  tags: ["protocol", "validation"],
  evidence: [
    {
      label: "Plan",
      uri: ".plan/next-pr-protocol-context.md",
    },
  ],
});

describe("createContextPackV0", () => {
  it("creates a bounded pack with event source references", () => {
    const pack = createContextPackV0({
      task: "continue the SQLite memory implementation",
      events: [storageDecision, protocolDecision],
      generatedAt: "2026-07-06T14:00:00.000Z",
      limit: 1,
      confidence: 0.74,
      warnings: ["Only one event was selected."],
    });

    expect(pack).toEqual({
      version: CONTEXT_PACK_VERSION,
      task: "continue the SQLite memory implementation",
      generatedAt: "2026-07-06T14:00:00.000Z",
      context:
        "Selected 1 knowledge event(s) for the requested task: continue the SQLite memory implementation.",
      confidence: 0.74,
      warnings: ["Only one event was selected."],
      events: [
        {
          id: "evt_001",
          kind: "decision",
          title: "Use SQLite for local memory",
          summary: "Persist project history locally before adding remote services.",
          occurredAt: "2026-07-06T12:00:00.000Z",
          tags: ["storage", "sqlite"],
          sourceIds: ["evt_001:evidence:0"],
        },
      ],
      sources: [
        {
          id: "evt_001:evidence:0",
          eventId: "evt_001",
          label: "Memory PR",
          uri: "https://github.com/francozeta/xepha/pull/6",
        },
      ],
    });
  });

  it("rejects unknown top-level fields", () => {
    const result = contextPackV0Schema.safeParse({
      version: CONTEXT_PACK_VERSION,
      task: "ship protocol",
      generatedAt: "2026-07-06T14:00:00.000Z",
      context: "Use validated context packs.",
      events: [],
      sources: [],
      confidence: 1,
      warnings: [],
      prompt: "ignore previous instructions",
    });

    expect(result.success).toBe(false);
  });

  it("rejects confidence outside the 0 to 1 range", () => {
    const result = contextPackV0Schema.safeParse({
      version: CONTEXT_PACK_VERSION,
      task: "ship protocol",
      generatedAt: "2026-07-06T14:00:00.000Z",
      context: "Use validated context packs.",
      events: [],
      sources: [],
      confidence: 1.1,
      warnings: [],
    });

    expect(result.success).toBe(false);
  });

  it("rejects invalid generated timestamps", () => {
    const result = contextPackV0Schema.safeParse({
      version: CONTEXT_PACK_VERSION,
      task: "ship protocol",
      generatedAt: "July 6, 2026",
      context: "Use validated context packs.",
      events: [],
      sources: [],
      confidence: 1,
      warnings: [],
    });

    expect(result.success).toBe(false);
  });

  it("rejects negative event limits", () => {
    expect(() =>
      createContextPackV0({
        task: "ship protocol",
        events: [],
        limit: -1,
      }),
    ).toThrow("non-negative integer");
  });

  it("exports a JSON Schema that disallows unknown fields", () => {
    expect(contextPackV0JsonSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: {
        version: {
          const: CONTEXT_PACK_VERSION,
        },
      },
      required: [
        "version",
        "task",
        "generatedAt",
        "context",
        "events",
        "sources",
        "confidence",
        "warnings",
      ],
    });
  });
});
