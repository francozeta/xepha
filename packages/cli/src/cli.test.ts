import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { XEPHA_PROJECT, defineKnowledgeEvent } from "@xepha/core";
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
  it("prints init guidance when no command is provided outside a Xepha workspace", async () => {
    await withTempDir("xepha-cli-root-", async (workspacePath) => {
      const result = await runCli(workspacePath, []);

      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("XEPHA");
      expect(result.stdout).toContain("Local project memory");
      expect(result.stdout).toContain("Run: pnpm xepha init");
      expect(result.stdout).not.toContain("pnpm xepha ingest git --repo .");
    });
  });

  it("initializes a white-box .xepha workspace", async () => {
    await withTempDir("xepha-cli-init-", async (workspacePath) => {
      const result = await runCli(workspacePath, ["init"]);
      const config = JSON.parse(
        await readFile(join(workspacePath, ".xepha", "config.json"), "utf8"),
      ) as {
        readonly storage: { readonly database: string };
        readonly context: { readonly defaultGoal: string; readonly limit: number };
        readonly knowledge: { readonly index: string };
      };
      const sources = JSON.parse(
        await readFile(join(workspacePath, ".xepha", "sources.json"), "utf8"),
      ) as {
        readonly sources: ReadonlyArray<{
          readonly id: string;
          readonly type: string;
          readonly path: string;
          readonly enabled: boolean;
        }>;
      };
      const rules = JSON.parse(
        await readFile(join(workspacePath, ".xepha", "rules", "project.json"), "utf8"),
      ) as { readonly rules: readonly string[] };
      const profile = JSON.parse(
        await readFile(join(workspacePath, ".xepha", "context", "profile.json"), "utf8"),
      ) as { readonly include: readonly string[] };
      const localIgnore = await readFile(
        join(workspacePath, ".xepha", ".gitignore"),
        "utf8",
      );

      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Initialized .xepha");
      expect(config.storage.database).toBe(".xepha/knowledge.db");
      expect(config.knowledge.index).toBe(".xepha/knowledge/index.md");
      expect(config.context.defaultGoal).toBe("continue the current work");
      expect(config.context.limit).toBe(5);
      expect(sources.sources).toContainEqual(
        expect.objectContaining({
          enabled: true,
          id: "git",
          path: ".",
          type: "git",
        }),
      );
      expect(sources.sources).toContainEqual(
        expect.objectContaining({
          enabled: true,
          id: "project-context",
          path: ".xepha/context",
          type: "markdown",
        }),
      );
      expect(
        await readFile(join(workspacePath, ".xepha", "context", "project.md"), "utf8"),
      ).toMatch(/^# Project Context\n\nProject: /u);
      expect(rules.rules).toContain("Prefer existing repository conventions.");
      expect(profile.include).toContain("knowledge");
      expect(localIgnore).toContain("knowledge.db");
      expect(localIgnore).toContain("knowledge/");
      expect(localIgnore).toContain("cache/");
      expect(localIgnore).toContain("runs/");
    });
  });

  it("upgrades an existing .xepha workspace without replacing configured sources", async () => {
    await withTempDir("xepha-cli-init-upgrade-", async (workspacePath) => {
      await mkdir(join(workspacePath, ".xepha"), { recursive: true });
      await writeFile(
        join(workspacePath, ".xepha", "config.json"),
        JSON.stringify(
          {
            version: 1,
            project: {
              name: "existing-project",
            },
            storage: {
              database: ".xepha/knowledge.db",
            },
            context: {
              defaultGoal: "keep going",
              limit: 3,
            },
            sources: {
              file: ".xepha/sources.json",
            },
          },
          null,
          2,
        ),
      );
      await writeFile(
        join(workspacePath, ".xepha", "sources.json"),
        JSON.stringify(
          {
            version: 1,
            sources: [
              {
                enabled: false,
                id: "git",
                limit: 7,
                path: ".",
                type: "git",
              },
            ],
          },
          null,
          2,
        ),
      );
      await writeFile(join(workspacePath, ".xepha", ".gitignore"), "knowledge.db\n");
      await mkdir(join(workspacePath, ".xepha", "context"), { recursive: true });
      await writeFile(
        join(workspacePath, ".xepha", "context", "project.md"),
        JSON.stringify("# Project Context\n\nProject: existing-project\n"),
      );

      const result = await runCli(workspacePath, ["init"]);
      const config = JSON.parse(
        await readFile(join(workspacePath, ".xepha", "config.json"), "utf8"),
      ) as {
        readonly context: { readonly defaultGoal: string; readonly limit: number };
        readonly knowledge: { readonly index: string };
        readonly project: { readonly name: string };
      };
      const sources = JSON.parse(
        await readFile(join(workspacePath, ".xepha", "sources.json"), "utf8"),
      ) as {
        readonly sources: ReadonlyArray<{
          readonly id: string;
          readonly enabled: boolean;
          readonly limit?: number;
          readonly type: string;
        }>;
      };
      const localIgnore = await readFile(
        join(workspacePath, ".xepha", ".gitignore"),
        "utf8",
      );

      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Updated .xepha/config.json");
      expect(result.stdout).toContain("Updated .xepha/sources.json");
      expect(result.stdout).toContain("Updated .xepha/context/project.md");
      expect(config.project.name).toBe("existing-project");
      expect(config.context.defaultGoal).toBe("keep going");
      expect(config.context.limit).toBe(3);
      expect(config.knowledge.index).toBe(".xepha/knowledge/index.md");
      expect(sources.sources).toContainEqual(
        expect.objectContaining({
          enabled: false,
          id: "git",
          limit: 7,
          type: "git",
        }),
      );
      expect(sources.sources).toContainEqual(
        expect.objectContaining({
          enabled: true,
          id: "project-context",
          type: "markdown",
        }),
      );
      expect(localIgnore).toContain("knowledge.db");
      expect(localIgnore).toContain("knowledge/");
      expect(localIgnore).toContain("cache/");
      expect(
        await readFile(join(workspacePath, ".xepha", "context", "project.md"), "utf8"),
      ).toMatch(/^# Project Context\n\nProject: existing-project\n/u);
    });
  });

  it("ingests markdown context and writes a readable knowledge snapshot", async () => {
    await withTempDir("xepha-cli-readable-knowledge-", async (workspacePath) => {
      await runCli(workspacePath, ["init"]);
      await writeFile(
        join(workspacePath, ".xepha", "sources.json"),
        JSON.stringify(
          {
            version: 1,
            sources: [
              {
                enabled: true,
                id: "project-context",
                path: ".xepha/context",
                type: "markdown",
              },
            ],
          },
          null,
          2,
        ),
      );
      await writeFile(
        join(workspacePath, ".xepha", "context", "handoff.md"),
        [
          "# Continue CLI readable knowledge",
          "",
          "Use readable snapshots so agents can resume work without opening SQLite.",
        ].join("\n"),
      );

      const result = await runCli(workspacePath, []);
      const snapshot = await readFile(
        join(workspacePath, ".xepha", "knowledge", "index.md"),
        "utf8",
      );

      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Syncing markdown context");
      expect(result.stdout).toContain("Knowledge: .xepha/knowledge/index.md");
      expect(snapshot).toContain("# Xepha Knowledge");
      expect(snapshot).toContain("Read this file before asking an agent to work");
      expect(snapshot).toContain("Continue CLI readable knowledge");
      expect(snapshot).toContain(
        "Use readable snapshots so agents can resume work without opening SQLite.",
      );
      expect(snapshot).toContain(".xepha/context/handoff.md");
    });
  });

  it("runs the smart workspace loop without a task argument", async () => {
    await withTempDir("xepha-cli-smart-loop-", async (workspacePath) => {
      await createGitRepo(workspacePath);
      await git(workspacePath, ["checkout", "-b", "feat/cli-smart-workspace"]);
      await commitFile(
        workspacePath,
        "src/index.ts",
        "export const value = 1;\n",
        "feat(cli): add smart workspace loop",
        "2026-07-08T13:00:00.000Z",
      );

      await runCli(workspacePath, ["init"]);

      const result = await runCli(workspacePath, []);
      const dbStats = await stat(join(workspacePath, ".xepha", "knowledge.db"));

      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Syncing git history");
      expect(result.stdout).toContain("Goal: continue work on feat/cli-smart-workspace");
      expect(result.stdout).toContain("Selected 2 knowledge items");
      expect(result.stdout).toContain("CLI: add smart workspace loop.");
      expect(result.stdout).toContain("Context ready");
      expect(result.stdout).not.toContain("version: xepha.context.v0");
      expect(dbStats.isFile()).toBe(true);
    });
  }, 20_000);

  it("explains the smart workspace loop without a task argument", async () => {
    await withTempDir("xepha-cli-smart-explain-", async (workspacePath) => {
      await createGitRepo(workspacePath);
      await git(workspacePath, ["checkout", "-b", "feat/cli-smart-workspace"]);
      const hash = await commitFile(
        workspacePath,
        "src/index.ts",
        "export const value = 1;\n",
        "feat(cli): explain smart workspace loop",
        "2026-07-08T13:00:00.000Z",
      );

      await runCli(workspacePath, ["init"]);

      const result = await runCli(workspacePath, ["explain"]);

      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Explaining 2 selected events");
      expect(result.stdout).toContain(`Selected git:${hash}`);
      expect(result.stdout).toContain("matched title: cli");
    });
  }, 20_000);

  it("supports -v as a version alias", async () => {
    await withTempDir("xepha-cli-version-", async (workspacePath) => {
      const result = await runCli(workspacePath, ["-v"]);

      expect(result.stderr).toBe("");
      expect(result.stdout.trim()).toBe(XEPHA_PROJECT.version);
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
