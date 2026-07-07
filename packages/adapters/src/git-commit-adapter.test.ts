import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { GitCommitAdapter } from "./index.js";

const execFileAsync = promisify(execFile);

async function withTempRepo<T>(run: (path: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "xepha-git-adapter-"));

  try {
    await git(dir, ["init", "--initial-branch=main"]);
    await git(dir, ["config", "user.name", "Test User"]);
    await git(dir, ["config", "user.email", "test@example.com"]);

    return await run(dir);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

async function git(
  cwd: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = {},
): Promise<string> {
  const { stdout } = await execFileAsync("git", [...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });

  return stdout.trim();
}

async function commitFile(
  repoPath: string,
  path: string,
  contents: string,
  message: string,
  date: string,
): Promise<string> {
  const filePath = join(repoPath, path);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
  await git(repoPath, ["add", path]);
  await git(repoPath, ["commit", "-m", message], {
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  });

  return git(repoPath, ["rev-parse", "HEAD"]);
}

describe("GitCommitAdapter", () => {
  it("maps recent commits to knowledge events with changed files and local evidence", async () => {
    await withTempRepo(async (repoPath) => {
      await commitFile(
        repoPath,
        "docs/plan.md",
        "Use SQLite first.\n",
        "docs: add project plan",
        "2026-07-06T12:00:00.000Z",
      );
      const latestHash = await commitFile(
        repoPath,
        "src/index.ts",
        "export const value = 1;\n",
        "feat: add runtime notes",
        "2026-07-06T13:00:00.000Z",
      );

      const adapter = new GitCommitAdapter({
        repositoryPath: repoPath,
        limit: 1,
      });

      await expect(adapter.ingest()).resolves.toEqual([
        expect.objectContaining({
          id: `git:${latestHash}`,
          kind: "commit",
          title: "feat: add runtime notes",
          occurredAt: "2026-07-06T13:00:00.000Z",
          tags: expect.arrayContaining([
            "git",
            "commit",
            "author:Test User",
            "file:src/index.ts",
          ]),
          evidence: [
            {
              label: `Commit ${latestHash.slice(0, 7)}`,
              uri: `git+${pathToFileURL(repoPath).href}#${latestHash}`,
            },
          ],
        }),
      ]);
    });
  }, 30_000);

  it("uses the origin remote URL when it can create a commit link", async () => {
    await withTempRepo(async (repoPath) => {
      const hash = await commitFile(
        repoPath,
        "README.md",
        "Xepha\n",
        "docs: add readme",
        "2026-07-06T12:00:00.000Z",
      );
      await git(repoPath, [
        "remote",
        "add",
        "origin",
        "git@github.com:francozeta/xepha.git",
      ]);

      const adapter = new GitCommitAdapter({
        repositoryPath: repoPath,
      });

      await expect(adapter.ingest()).resolves.toEqual([
        expect.objectContaining({
          evidence: [
            {
              label: `Commit ${hash.slice(0, 7)}`,
              uri: `https://github.com/francozeta/xepha/commit/${hash}`,
            },
          ],
        }),
      ]);
    });
  }, 30_000);

  it("returns no events for an empty git history", async () => {
    await withTempRepo(async (repoPath) => {
      const adapter = new GitCommitAdapter({
        repositoryPath: repoPath,
      });

      await expect(adapter.ingest()).resolves.toEqual([]);
    });
  });
});
