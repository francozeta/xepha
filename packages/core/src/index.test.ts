import { describe, expect, it } from "vitest";
import { defineKnowledgeEvent } from "./index.js";

describe("defineKnowledgeEvent", () => {
  it("normalizes optional tags and evidence", () => {
    const event = defineKnowledgeEvent({
      id: "evt_001",
      kind: "decision",
      title: "Use TypeScript for the MVP",
      summary: "The first runtime should optimize for speed of iteration.",
      occurredAt: "2026-07-06T00:00:00.000Z",
    });

    expect(event.tags).toEqual([]);
    expect(event.evidence).toEqual([]);
  });
});
