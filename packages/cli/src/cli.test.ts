import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { defineKnowledgeEvent } from "@xepha/core";
import { SQLiteKnowledgeStore } from "@xepha/memory";
import { createCliProgram } from "./cli.js";

const execFileAsync = promisify(execFile);

async function withTempDir<T>(
  prefix: string,
  run: (path: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), prefix));

  try {
    return await run(dir);
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

async function createGitRepo(path: string): Promise<void> {
  await git(path, ["init", "--initial-branch=main"]);
  await git(path, ["config", "user.name", "Test User"]);
  await git(path, ["config", "user.email", "test@example.com"]);
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

async function runCli(
  cwd: string,
  args: readonly string[],
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  let stdout = "";
  let stderr = "";
  const program = createCliProgram({
    cwd,
    stderr: {
      write(chunk: string | Uint8Array): boolean {
        stderr += chunk.toString();
        return true;
      },
    },
    stdout: {
      write(chunk: string | Uint8Array): boolean {
        stdout += chunk.toString();
        return true;
      },
    },
  });

  program.exitOverride();
  try {
    await program.parseAsync(["node", "xepha", ...args], {
      from: "node",
    });
  } catch (error: unknown) {
    if (isCommanderExit(error, 0)) {
      return { stderr, stdout };
    }

    throw error;
  }

  return { stderr, stdout };
}

function isCommanderExit(error: unknown, exitCode: number): boolean {
  return error instanceof Error && "exitCode" in error && error.exitCode === exitCode;
}

async function seedKnowledgeEvents(dbPath: string, count: number): Promise<void> {
  await mkdir(dirname(dbPath), { recursive: true });
  const store = await SQLiteKnowledgeStore.open({
    url: `file:${dbPath.replaceAll("\\", "/")}`,
  });

  try {
    for (let index = 0; index < count; index += 1) {
      await store.append(
        defineKnowledgeEvent({
          id: `evt_${index.toString().padStart(2, "0")}`,
          kind: "commit",
          title: `Commit ${index}`,
          summary: `Seed event ${index}`,
          occurredAt: `2026-07-${(index + 1).toString().padStart(2, "0")}T12:00:00.000Z`,
          tags: ["seed"],
        }),
      );
    }
  } finally {
    await store.close();
  }
}

describe("CLI local loop", () => {
  it("prints a branded command overview when no command is provided", async () => {
    await withTempDir("xepha-cli-root-", async (workspacePath) => {
      const result = await runCli(workspacePath, []);

      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("XEPHA");
      expect(result.stdout).toContain("Local project memory");
      expect(result.stdout).toContain("pnpm xepha doctor");
    });
  });

  it("supports -v as a version alias", async () => {
    await withTempDir("xepha-cli-version-", async (workspacePath) => {
      const result = await runCli(workspacePath, ["-v"]);

      expect(result.stderr).toBe("");
      expect(result.stdout.trim()).toBe("0.3.0");
    });
  });

  it("ingests git commits, lists events, and renders a YAML context pack", async () => {
    await withTempDir("xepha-cli-", async (workspacePath) => {
      const repoPath = join(workspacePath, "repo");
      const dbPath = join(workspacePath, "knowledge.db");
      await mkdir(repoPath);
      await createGitRepo(repoPath);
      const hash = await commitFile(
        repoPath,
        "src/index.ts",
        "export const value = 1;\n",
        "feat: add runtime notes",
        "2026-07-06T13:00:00.000Z",
      );
      await commitFile(
        repoPath,
        "docs/website.md",
        "Coming soon.\n",
        "docs: add website notes",
        "2026-07-07T13:00:00.000Z",
      );

      const ingest = await runCli(workspacePath, [
        "ingest",
        "git",
        "--repo",
        repoPath,
        "--db",
        dbPath,
        "--limit",
        "2",
      ]);
      const events = await runCli(workspacePath, ["events", "list", "--db", dbPath]);
      const context = await runCli(workspacePath, [
        "context",
        "continue runtime work",
        "--db",
        dbPath,
        "--format",
        "yaml",
        "--limit",
        "1",
      ]);
      const explainedContext = await runCli(workspacePath, [
        "context",
        "continue runtime work",
        "--db",
        dbPath,
        "--format",
        "yaml",
        "--limit",
        "1",
        "--explain",
      ]);
      const zeroLimitContext = await runCli(workspacePath, [
        "context",
        "continue runtime work",
        "--db",
        dbPath,
        "--format",
        "yaml",
        "--limit",
        "0",
      ]);

      expect(ingest.stdout).toContain("Ingested 2 event");
      expect(ingest.stdout).toContain("Reading git history");
      expect(events.stdout).toContain("feat: add runtime notes");
      expect(events.stdout).toContain(`git:${hash}`);
      expect(context.stderr).toBe("");
      expect(context.stdout).toContain("version: xepha.context.v0");
      expect(context.stdout).toContain("task: continue runtime work");
      expect(context.stdout).toContain('title: "feat: add runtime notes"');
      expect(context.stdout).not.toContain('title: "docs: add website notes"');
      expect(context.stdout).toContain(`uri: git+file://`);
      expect(explainedContext.stdout).toContain("version: xepha.context.v0");
      expect(explainedContext.stdout).not.toContain("Selected git:");
      expect(explainedContext.stderr).toContain(`Selected git:${hash}`);
      expect(explainedContext.stderr).toContain("matched title: runtime");
      expect(zeroLimitContext.stdout).not.toContain(
        "No events found in the local store.",
      );
      expect(zeroLimitContext.stdout).toContain("confidence: 1");
    });
  }, 20_000);

  it("limits event listing output by default", async () => {
    await withTempDir("xepha-cli-events-limit-", async (workspacePath) => {
      const dbPath = join(workspacePath, "knowledge.db");
      await seedKnowledgeEvents(dbPath, 25);

      const events = await runCli(workspacePath, ["events", "list", "--db", dbPath]);
      const eventLines = events.stdout
        .split("\n")
        .filter((line) => line.includes(" evt_"));

      expect(eventLines).toHaveLength(20);
      expect(events.stdout).toContain("evt_24");
      expect(events.stdout).not.toContain("evt_00");
      expect(events.stdout).toContain("Showing 20 of 25 event(s).");
    });
  });

  it("uses .xepha/knowledge.db as the default local database", async () => {
    await withTempDir("xepha-cli-default-db-", async (workspacePath) => {
      const repoPath = join(workspacePath, "repo");
      const dbPath = join(workspacePath, ".xepha", "knowledge.db");
      await mkdir(repoPath);
      await createGitRepo(repoPath);
      await commitFile(
        repoPath,
        "README.md",
        "Xepha\n",
        "docs: add readme",
        "2026-07-06T12:00:00.000Z",
      );

      await runCli(workspacePath, ["ingest", "git", "--repo", repoPath]);

      const dbStats = await stat(dbPath);

      expect(dbStats.isFile()).toBe(true);
    });
  }, 20_000);
});
