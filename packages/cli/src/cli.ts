import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { Command } from "commander";
import { GitCommitAdapter } from "@xepha/adapters";
import { XEPHA_PROJECT, type KnowledgeEvent } from "@xepha/core";
import { explainRankedEventsForTask, type RankedKnowledgeEvent } from "@xepha/graph";
import { SQLiteKnowledgeStore } from "@xepha/memory";
import { createContextPackV0, stringifyContextPackYaml } from "@xepha/protocol";
import {
  type CliWritable,
  writeIntro,
  writeOutro,
  writeStep,
  writeSuccess,
  writeWordmark,
} from "./ui.js";

const DEFAULT_DATABASE_PATH = ".xepha/knowledge.db";
const DEFAULT_GIT_LIMIT = 20;
const DEFAULT_CONTEXT_LIMIT = 5;
const DEFAULT_EVENTS_LIMIT = 20;

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

interface EventListOptions extends DatabaseOptions {
  readonly limit: number;
}

interface ContextOptions extends DatabaseOptions {
  readonly explain?: boolean;
  readonly format: "json" | "yaml";
  readonly limit: number;
}

interface RootOptions {
  readonly versionShort?: boolean;
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
    .version(XEPHA_PROJECT.version)
    .option("-v, --version-short", "output the version number")
    .action(() => {
      const rootOptions = program.opts<RootOptions>();

      if (rootOptions.versionShort) {
        stdout.write(`${XEPHA_PROJECT.version}\n`);
        return;
      }

      writeCommandOverview(stdout);
    });

  program
    .command("doctor")
    .description("Print the current Xepha workspace baseline.")
    .action(() => {
      writeWordmark(stdout);
      writeIntro(stdout, "XEPHA");
      writeStep(stdout, `${XEPHA_PROJECT.name} ${XEPHA_PROJECT.version}`);
      writeStep(stdout, XEPHA_PROJECT.summary);
      writeSuccess(stdout, "Workspace baseline ready");
      writeOutro(stdout);
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
      writeIntro(stdout, "XEPHA ingest");
      writeStep(stdout, `Source: ${resolveFromCwd(cwd, commandOptions.repo)}`);
      writeStep(stdout, `Database: ${commandOptions.db}`);
      writeStep(stdout, "Reading git history");

      await withStore(cwd, commandOptions.db, async (store) => {
        const adapter = new GitCommitAdapter({
          limit: commandOptions.limit,
          repositoryPath: resolveFromCwd(cwd, commandOptions.repo),
        });
        const events = await adapter.ingest();

        for (const event of events) {
          await store.append(event);
        }

        writeSuccess(stdout, `Ingested ${events.length} event(s)`);
        writeOutro(stdout);
      });
    });

  const events = program.command("events").description("Inspect stored events.");

  events
    .command("list")
    .description("List events stored in local memory.")
    .option("--db <path>", "SQLite database path.", DEFAULT_DATABASE_PATH)
    .option(
      "--limit <number>",
      "Maximum number of events to list.",
      parseNonNegativeInteger,
      DEFAULT_EVENTS_LIMIT,
    )
    .action(async (commandOptions: EventListOptions) => {
      await withStore(cwd, commandOptions.db, async (store) => {
        const storedEvents = await store.list();
        const listedEvents = [...storedEvents]
          .sort(compareEventsByRecency)
          .slice(0, commandOptions.limit);

        if (storedEvents.length === 0) {
          stdout.write("No events found.\n");
          return;
        }

        for (const event of listedEvents) {
          stdout.write(formatEventLine(event));
        }

        if (listedEvents.length < storedEvents.length) {
          stdout.write(
            `Showing ${listedEvents.length} of ${storedEvents.length} event(s). Use --limit to show more.\n`,
          );
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
    .option("--explain", "Write ranking reasons to stderr.")
    .action(async (task: string, commandOptions: ContextOptions) => {
      await withStore(cwd, commandOptions.db, async (store) => {
        const storedEvents = await store.list();
        const relations = await store.listRelations();
        const rankedEvents = explainRankedEventsForTask({
          task,
          events: storedEvents,
          relations,
        });
        const selectedEvents = rankedEvents
          .slice(0, commandOptions.limit)
          .map((score) => score.event);
        const pack = createContextPackV0({
          task,
          events: selectedEvents,
          limit: commandOptions.limit,
          confidence: rankedEvents.length === 0 ? 0 : 1,
          warnings:
            rankedEvents.length === 0 ? ["No events found in the local store."] : [],
        });

        if (commandOptions.explain) {
          writeContextExplanation(stderr, rankedEvents, commandOptions.limit);
        }

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

function writeCommandOverview(stdout: CliWritable): void {
  writeWordmark(stdout);
  writeIntro(stdout, "XEPHA");
  writeStep(stdout, "Local project memory for software workspaces.");
  writeStep(stdout, "Try: pnpm xepha doctor");
  writeStep(stdout, "Try: pnpm xepha ingest git --repo .");
  writeStep(stdout, 'Try: pnpm xepha context "continue the current work"');
  writeOutro(stdout);
}

function compareEventsByRecency(left: KnowledgeEvent, right: KnowledgeEvent): number {
  const leftTime = Date.parse(left.occurredAt);
  const rightTime = Date.parse(right.occurredAt);

  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }

  return left.id.localeCompare(right.id);
}

function writeContextExplanation(
  stderr: CliWritable,
  rankedEvents: readonly RankedKnowledgeEvent[],
  limit: number,
): void {
  const selectedEvents = rankedEvents.slice(0, limit);

  writeIntro(stderr, "XEPHA context");
  writeStep(stderr, `Explaining ${selectedEvents.length} selected event(s)`);

  for (const rankedEvent of selectedEvents) {
    writeStep(
      stderr,
      `Selected ${rankedEvent.event.id} (score ${rankedEvent.score}): ${rankedEvent.reasons.join("; ")}`,
    );
  }

  writeOutro(stderr);
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
