import { describe, expect, it } from "vitest";
import { defineKnowledgeEvent } from "@xepha/core";
import { rankEventsForTask } from "./index.js";

const storageDecision = defineKnowledgeEvent({
  id: "evt_storage",
  kind: "decision",
  title: "Use SQLite for local memory",
  summary: "Persist project history locally before adding remote services.",
  occurredAt: "2026-07-06T12:00:00.000Z",
  tags: ["storage", "sqlite", "memory"],
});

const uiUpdate = defineKnowledgeEvent({
  id: "evt_ui",
  kind: "commit",
  title: "Add coming soon website hero",
  summary: "Introduce the public website identity.",
  occurredAt: "2026-07-07T12:00:00.000Z",
  tags: ["website", "ui"],
});

const protocolDecision = defineKnowledgeEvent({
  id: "evt_protocol",
  kind: "architecture",
  title: "Validate context packs at the protocol boundary",
  summary: "Context output should be parsed before agents use it.",
  occurredAt: "2026-07-06T13:00:00.000Z",
  tags: ["protocol"],
});

describe("rankEventsForTask", () => {
  it("prioritizes tag and text matches over newer unrelated events", () => {
    const ranked = rankEventsForTask({
      task: "continue sqlite storage work",
      events: [uiUpdate, storageDecision],
    });

    expect(ranked.map((event) => event.id)).toEqual(["evt_storage", "evt_ui"]);
  });

  it("boosts explicitly related events after a direct match", () => {
    const ranked = rankEventsForTask({
      task: "continue sqlite storage work",
      events: [uiUpdate, protocolDecision, storageDecision],
      relations: [
        {
          from: "evt_storage",
          to: "evt_protocol",
          kind: "supports",
          reason: "Protocol output depends on local memory.",
        },
      ],
    });

    expect(ranked.map((event) => event.id)).toEqual([
      "evt_storage",
      "evt_protocol",
      "evt_ui",
    ]);
  });

  it("falls back to newest events when the task has no matches", () => {
    const ranked = rankEventsForTask({
      task: "billing dashboard",
      events: [storageDecision, uiUpdate, protocolDecision],
    });

    expect(ranked.map((event) => event.id)).toEqual([
      "evt_ui",
      "evt_protocol",
      "evt_storage",
    ]);
  });
});
