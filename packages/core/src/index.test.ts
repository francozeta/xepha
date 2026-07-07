import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { defineKnowledgeEvent, XEPHA_PROJECT } from "./index.js";

interface RootPackageJson {
  readonly version: string;
}

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

describe("XEPHA_PROJECT", () => {
  it("uses the root package version", async () => {
    const rootPackage = JSON.parse(
      await readFile(new URL("../../../package.json", import.meta.url), "utf8"),
    ) as RootPackageJson;

    expect(XEPHA_PROJECT.version).toBe(rootPackage.version);
  });
});
