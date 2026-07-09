import { Command } from "commander";
import { GitCommitAdapter } from "@xepha/adapters";
import { XEPHA_PROJECT, type KnowledgeEvent } from "@xepha/core";
import { explainRankedEventsForTask, type RankedKnowledgeEvent } from "@xepha/graph";
import {
  createContextPackV0,
  stringifyContextPackYaml,
  type ContextPackV0,
} from "@xepha/protocol";
import {
  type CliWritable,
  writeIntro,
  writeOutro,
  writeStep,
  writeSuccess,
  writeWordmark,
} from "./ui.js";
import {
  DEFAULT_CONTEXT_LIMIT,
  DEFAULT_DATABASE_PATH,
  DEFAULT_GIT_LIMIT,
  buildWorkspaceContext,
  initializeWorkspace,
  loadWorkspace,
  resolveFromCwd,
  syncWorkspaceSources,
  withStore,
  type XephaWorkspace,
} from "./workspace.js";

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
    .action(async () => {
      const rootOptions = program.opts<RootOptions>();

      if (rootOptions.versionShort) {
        stdout.write(`${XEPHA_PROJECT.version}\n`);
        return;
      }

      const workspace = await loadWorkspace(cwd);

      if (workspace === undefined) {
        writeCommandOverview(stdout);
        return;
      }

      await runSmartWorkspaceLoop(cwd, stdout, workspace);
    });

  program
    .command("init")
    .description("Create a configurable .xepha workspace")
    .action(async () => {
      const result = await initializeWorkspace(cwd);

      writeIntro(stdout, "XEPHA init");
      writeStep(stdout, "Created .xepha/config.json");
      writeStep(stdout, "Created .xepha/sources.json");
      writeStep(stdout, "Created .xepha/rules/project.json");
      writeStep(stdout, "Created .xepha/context/profile.json");
      writeStep(stdout, "Runtime data stays local in .xepha/knowledge.db");
      writeSuccess(
        stdout,
        result.createdFiles.length === 0
          ? ".xepha already initialized"
          : "Initialized .xepha",
      );
      writeOutro(stdout);
    });

  program
    .command("sync")
    .description("Sync configured workspace sources")
    .action(async () => {
      const workspace = await loadWorkspace(cwd);

      if (workspace === undefined) {
        writeCommandOverview(stdout);
        return;
      }

      writeIntro(stdout, "XEPHA sync");
      const result = await syncWorkspaceSources(cwd, stdout, workspace);
      writeWarnings(stdout, result.warnings);
      writeSuccess(stdout, `Synced ${result.ingestedEvents} event(s)`);
      writeOutro(stdout);
    });

  program
    .command("explain")
    .description("Explain the current workspace context")
    .argument("[task]", "Task to explain context for.")
    .action(async (task: string | undefined) => {
      const workspace = await loadWorkspace(cwd);

      if (workspace === undefined) {
        writeCommandOverview(stdout);
        return;
      }

      writeIntro(stdout, "XEPHA explain");
      const syncResult = await syncWorkspaceSources(cwd, stdout, workspace);
      const contextResult = await buildWorkspaceContext(cwd, workspace, task);

      writeWarnings(stdout, syncResult.warnings);
      writeStep(stdout, `Goal: ${contextResult.pack.knowledge.goal}`);
      writeContextExplanationRows(
        stdout,
        contextResult.rankedEvents,
        contextResult.pack.events.length,
      );
      writeOutro(stdout);
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

async function runSmartWorkspaceLoop(
  cwd: string,
  stdout: CliWritable,
  workspace: XephaWorkspace,
): Promise<void> {
  writeIntro(stdout, "XEPHA");
  const syncResult = await syncWorkspaceSources(cwd, stdout, workspace);
  const contextResult = await buildWorkspaceContext(cwd, workspace);

  writeWarnings(stdout, syncResult.warnings);
  writeHumanContext(stdout, contextResult.pack);
  writeSuccess(stdout, "Context ready");
  writeOutro(stdout);
}

function formatEventLine(event: KnowledgeEvent): string {
  return `${event.occurredAt} ${event.kind} ${event.id} ${event.title}\n`;
}

function writeCommandOverview(stdout: CliWritable): void {
  writeWordmark(stdout);
  writeIntro(stdout, "XEPHA");
  writeStep(stdout, "Local project memory for software workspaces.");
  writeStep(stdout, "Run: pnpm xepha init");
  writeStep(stdout, "Then: pnpm xepha");
  writeStep(stdout, "Advanced: pnpm xepha -h");
  writeOutro(stdout);
}

function writeHumanContext(stdout: CliWritable, pack: ContextPackV0): void {
  const knowledgeCount = pack.knowledge.relevantKnowledge.length;
  const itemLabel = knowledgeCount === 1 ? "item" : "items";

  writeStep(stdout, `Goal: ${pack.knowledge.goal}`);
  writeStep(stdout, `Selected ${knowledgeCount} knowledge ${itemLabel}`);

  for (const item of pack.knowledge.relevantKnowledge) {
    writeStep(stdout, item);
  }

  for (const warning of pack.warnings) {
    writeStep(stdout, warning);
  }
}

function writeWarnings(stdout: CliWritable, warnings: readonly string[]): void {
  for (const warning of warnings) {
    writeStep(stdout, warning);
  }
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
  writeIntro(stderr, "XEPHA context");
  writeContextExplanationRows(stderr, rankedEvents, limit);
  writeOutro(stderr);
}

function writeContextExplanationRows(
  output: CliWritable,
  rankedEvents: readonly RankedKnowledgeEvent[],
  limit: number,
): void {
  const selectedEvents = rankedEvents.slice(0, limit);
  const eventLabel = selectedEvents.length === 1 ? "event" : "events";

  writeStep(output, `Explaining ${selectedEvents.length} selected ${eventLabel}`);

  for (const rankedEvent of selectedEvents) {
    writeStep(
      output,
      `Selected ${rankedEvent.event.id} (score ${rankedEvent.score}): ${rankedEvent.reasons.join("; ")}`,
    );
  }
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
