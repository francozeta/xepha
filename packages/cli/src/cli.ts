import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { Command } from "commander";
import { GitCommitAdapter } from "@xepha/adapters";
import { XEPHA_PROJECT, type KnowledgeEvent } from "@xepha/core";
import { SQLiteKnowledgeStore } from "@xepha/memory";
import { createContextPackV0, stringifyContextPackYaml } from "@xepha/protocol";

const DEFAULT_DATABASE_PATH = ".xepha/knowledge.db";
const DEFAULT_GIT_LIMIT = 20;
const DEFAULT_CONTEXT_LIMIT = 8;

interface CliWritable {
  write(chunk: string | Uint8Array): boolean;
}

export interface CreateCliProgramOptions {
  readonly cwd?: string;
  readonly stdout?: CliWritable;
  readonly stderr?: CliWritable;
}

interface DatabaseOptions {
  readonly db: string;
}

interface GitIngestOptions extends DatabaseOptions {
  readonly limit: number;
  readonly repo: string;
}

interface ContextOptions extends DatabaseOptions {
  readonly format: "json" | "yaml";
  readonly limit: number;
}

export function createCliProgram(options: CreateCliProgramOptions = {}): Command {
  const cwd = options.cwd ?? process.cwd();
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const program = new Command();

  program.configureOutput({
    writeErr: (message) => {
      stderr.write(message);
    },
    writeOut: (message) => {
      stdout.write(message);
    },
  });

  program
    .name("xepha")
    .description("Local project memory for software workspaces.")
    .version(XEPHA_PROJECT.version);

  program
    .command("doctor")
    .description("Print the current Xepha workspace baseline.")
    .action(() => {
      stdout.write(`${XEPHA_PROJECT.name} ${XEPHA_PROJECT.version}\n`);
      stdout.write(`${XEPHA_PROJECT.summary}\n`);
    });

  const ingest = program.command("ingest").description("Ingest project data.");

  ingest
    .command("git")
    .description("Ingest recent commits from a local git repository.")
    .option("--db <path>", "SQLite database path.", DEFAULT_DATABASE_PATH)
    .option("--repo <path>", "Git repository path.", ".")
    .option(
      "--limit <number>",
      "Maximum number of commits to ingest.",
      parseNonNegativeInteger,
      DEFAULT_GIT_LIMIT,
    )
    .action(async (commandOptions: GitIngestOptions) => {
      await withStore(cwd, commandOptions.db, async (store) => {
        const adapter = new GitCommitAdapter({
          limit: commandOptions.limit,
          repositoryPath: resolveFromCwd(cwd, commandOptions.repo),
        });
        const events = await adapter.ingest();

        for (const event of events) {
          await store.append(event);
        }

        stdout.write(`Ingested ${events.length} event(s).\n`);
      });
    });

  const events = program.command("events").description("Inspect stored events.");

  events
    .command("list")
    .description("List events stored in local memory.")
    .option("--db <path>", "SQLite database path.", DEFAULT_DATABASE_PATH)
    .action(async (commandOptions: DatabaseOptions) => {
      await withStore(cwd, commandOptions.db, async (store) => {
        const storedEvents = await store.list();

        if (storedEvents.length === 0) {
          stdout.write("No events found.\n");
          return;
        }

        for (const event of storedEvents) {
          stdout.write(formatEventLine(event));
        }
      });
    });

  program
    .command("context")
    .description("Render a context pack for a task.")
    .argument("<task>", "Task to build context for.")
    .option("--db <path>", "SQLite database path.", DEFAULT_DATABASE_PATH)
    .option(
      "--format <format>",
      "Output format: yaml or json.",
      parseContextFormat,
      "yaml",
    )
    .option(
      "--limit <number>",
      "Maximum number of events to include.",
      parseNonNegativeInteger,
      DEFAULT_CONTEXT_LIMIT,
    )
    .action(async (task: string, commandOptions: ContextOptions) => {
      await withStore(cwd, commandOptions.db, async (store) => {
        const storedEvents = await store.list();
        const newestFirstEvents = [...storedEvents].reverse();
        const pack = createContextPackV0({
          task,
          events: newestFirstEvents,
          limit: commandOptions.limit,
          confidence: newestFirstEvents.length === 0 ? 0 : 1,
          warnings:
            newestFirstEvents.length === 0 ? ["No events found in the local store."] : [],
        });

        if (commandOptions.format === "json") {
          stdout.write(`${JSON.stringify(pack, null, 2)}\n`);
          return;
        }

        stdout.write(stringifyContextPackYaml(pack));
      });
    });

  return program;
}

export async function main(
  argv: readonly string[] = process.argv,
  options: CreateCliProgramOptions = {},
): Promise<void> {
  await createCliProgram(options).parseAsync([...argv], {
    from: "node",
  });
}

async function withStore<T>(
  cwd: string,
  dbPath: string,
  run: (store: SQLiteKnowledgeStore) => Promise<T>,
): Promise<T> {
  const store = await openStore(cwd, dbPath);

  try {
    return await run(store);
  } finally {
    await store.close();
  }
}

async function openStore(cwd: string, dbPath: string): Promise<SQLiteKnowledgeStore> {
  if (dbPath.startsWith("file:")) {
    return SQLiteKnowledgeStore.open({
      url: dbPath,
    });
  }

  const resolvedPath = resolveFromCwd(cwd, dbPath);
  await mkdir(dirname(resolvedPath), { recursive: true });

  return SQLiteKnowledgeStore.open({
    url: `file:${resolvedPath.replaceAll("\\", "/")}`,
  });
}

function resolveFromCwd(cwd: string, path: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

function formatEventLine(event: KnowledgeEvent): string {
  return `${event.occurredAt} ${event.kind} ${event.id} ${event.title}\n`;
}

function parseNonNegativeInteger(value: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("Expected a non-negative integer.");
  }

  return parsed;
}

function parseContextFormat(value: string): "json" | "yaml" {
  if (value === "json" || value === "yaml") {
    return value;
  }

  throw new Error("Expected format to be yaml or json.");
}
