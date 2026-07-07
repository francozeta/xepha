import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
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
  await program.parseAsync(["node", "xepha", ...args], {
    from: "node",
  });

  return { stderr, stdout };
}

describe("CLI local loop", () => {
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

      const ingest = await runCli(workspacePath, [
        "ingest",
        "git",
        "--repo",
        repoPath,
        "--db",
        dbPath,
        "--limit",
        "1",
      ]);
      const events = await runCli(workspacePath, ["events", "list", "--db", dbPath]);
      const context = await runCli(workspacePath, [
        "context",
        "continue runtime work",
        "--db",
        dbPath,
        "--format",
        "yaml",
      ]);

      expect(ingest.stdout).toContain("Ingested 1 event");
      expect(events.stdout).toContain("feat: add runtime notes");
      expect(events.stdout).toContain(`git:${hash}`);
      expect(context.stderr).toBe("");
      expect(context.stdout).toContain("version: xepha.context.v0");
      expect(context.stdout).toContain("task: continue runtime work");
      expect(context.stdout).toContain('title: "feat: add runtime notes"');
      expect(context.stdout).toContain(`uri: git+file://`);
    });
  }, 20_000);

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
