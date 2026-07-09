import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { MarkdownContextAdapter } from "./index.js";

async function withTempDir<T>(run: (path: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "xepha-markdown-adapter-"));

  try {
    return await run(dir);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

describe("MarkdownContextAdapter", () => {
  it("maps markdown files to evidence-backed knowledge events", async () => {
    await withTempDir(async (workspacePath) => {
      const contextDir = join(workspacePath, ".xepha", "context");
      const filePath = join(contextDir, "handoff.md");
      await mkdir(contextDir, { recursive: true });
      await writeFile(
        filePath,
        [
          "# Continue CLI readable knowledge",
          "",
          "Use readable snapshots so agents can resume work without opening SQLite.",
          "",
          "- Keep the database internal.",
        ].join("\n"),
      );

      const adapter = new MarkdownContextAdapter({
        rootPath: workspacePath,
        sourcePath: ".xepha/context",
      });

      await expect(adapter.ingest()).resolves.toEqual([
        expect.objectContaining({
          id: "markdown:.xepha/context/handoff.md",
          kind: "discussion",
          title: "Continue CLI readable knowledge",
          summary:
            "Use readable snapshots so agents can resume work without opening SQLite.",
          tags: expect.arrayContaining([
            "markdown",
            "context",
            "file:.xepha/context/handoff.md",
          ]),
          evidence: [
            {
              label: ".xepha/context/handoff.md",
              uri: pathToFileURL(filePath).href,
            },
          ],
        }),
      ]);
    });
  });

  it("returns no events when the context directory is missing", async () => {
    await withTempDir(async (workspacePath) => {
      const adapter = new MarkdownContextAdapter({
        rootPath: workspacePath,
        sourcePath: ".xepha/context",
      });

      await expect(adapter.ingest()).resolves.toEqual([]);
    });
  });
});
