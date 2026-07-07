import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defineKnowledgeEvent } from "@xepha/core";
import {
  InMemoryKnowledgeStore,
  SQLiteKnowledgeStore,
  type KnowledgeRelation,
} from "./index.js";

async function withTempDatabase<T>(run: (url: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "xepha-memory-"));
  const dbPath = join(dir, "knowledge.db").replaceAll("\\", "/");

  try {
    return await run(`file:${dbPath}`);
  } finally {
    await rm(dir, { force: true, recursive: true }).catch((error: unknown) => {
      if (
        error instanceof Error &&
        "code" in error &&
        (error.code === "EBUSY" || error.code === "ENOTEMPTY")
      ) {
        return;
      }

      throw error;
    });
  }
}

describe("InMemoryKnowledgeStore", () => {
  it("stores relations in insertion order", async () => {
    const store = new InMemoryKnowledgeStore();
    const relation: KnowledgeRelation = {
      from: "evt_001",
      to: "evt_002",
      kind: "relates_to",
      reason: "Both describe the storage baseline.",
    };

    await store.addRelation(relation);

    await expect(store.listRelations()).resolves.toEqual([relation]);
  });
});

describe("SQLiteKnowledgeStore", () => {
  it("persists events with tags and evidence across store instances", async () => {
    await withTempDatabase(async (url) => {
      const firstStore = await SQLiteKnowledgeStore.open({ url });

      await firstStore.append(
        defineKnowledgeEvent({
          id: "evt_001",
          kind: "decision",
          title: "Use SQLite for local project memory",
          summary: "The first persistent store should be embedded and local.",
          occurredAt: "2026-07-06T12:00:00.000Z",
          tags: ["storage", "sqlite"],
          evidence: [
            {
              label: "ADR",
              uri: "docs/adr/0001-mvp-stack.md",
            },
          ],
        }),
      );

      await firstStore.close();

      const secondStore = await SQLiteKnowledgeStore.open({ url });

      await expect(secondStore.list()).resolves.toEqual([
        {
          id: "evt_001",
          kind: "decision",
          title: "Use SQLite for local project memory",
          summary: "The first persistent store should be embedded and local.",
          occurredAt: "2026-07-06T12:00:00.000Z",
          tags: ["storage", "sqlite"],
          evidence: [
            {
              label: "ADR",
              uri: "docs/adr/0001-mvp-stack.md",
            },
          ],
        },
      ]);

      await secondStore.close();
    });
  });

  it("replaces tags and evidence when appending an existing event", async () => {
    await withTempDatabase(async (url) => {
      const store = await SQLiteKnowledgeStore.open({ url });

      await store.append(
        defineKnowledgeEvent({
          id: "evt_001",
          kind: "decision",
          title: "Initial title",
          summary: "Initial summary",
          occurredAt: "2026-07-06T12:00:00.000Z",
          tags: ["old"],
          evidence: [{ label: "Old", uri: "old.md" }],
        }),
      );
      await store.append(
        defineKnowledgeEvent({
          id: "evt_001",
          kind: "decision",
          title: "Updated title",
          summary: "Updated summary",
          occurredAt: "2026-07-06T13:00:00.000Z",
          tags: ["new"],
          evidence: [{ label: "New", uri: "new.md" }],
        }),
      );

      await expect(store.list()).resolves.toEqual([
        {
          id: "evt_001",
          kind: "decision",
          title: "Updated title",
          summary: "Updated summary",
          occurredAt: "2026-07-06T13:00:00.000Z",
          tags: ["new"],
          evidence: [{ label: "New", uri: "new.md" }],
        },
      ]);

      await store.close();
    });
  });

  it("persists event relations and can filter by event id", async () => {
    await withTempDatabase(async (url) => {
      const store = await SQLiteKnowledgeStore.open({ url });
      const storageDecision = defineKnowledgeEvent({
        id: "evt_001",
        kind: "decision",
        title: "Use SQLite",
        summary: "Persist project memory locally.",
        occurredAt: "2026-07-06T12:00:00.000Z",
      });
      const apiDecision = defineKnowledgeEvent({
        id: "evt_002",
        kind: "architecture",
        title: "Keep storage behind a package boundary",
        summary: "NestJS should orchestrate instead of owning persistence.",
        occurredAt: "2026-07-06T13:00:00.000Z",
      });
      const relation: KnowledgeRelation = {
        from: storageDecision.id,
        to: apiDecision.id,
        kind: "supports",
        reason: "Local persistence supports a pure TypeScript core.",
      };

      await store.append(storageDecision);
      await store.append(apiDecision);
      await store.addRelation(relation);

      await expect(store.listRelations()).resolves.toEqual([relation]);
      await expect(store.listRelations("evt_002")).resolves.toEqual([relation]);
      await expect(store.listRelations("evt_missing")).resolves.toEqual([]);

      await store.close();
    });
  });
});
