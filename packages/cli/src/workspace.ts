import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";
import { GitCommitAdapter } from "@xepha/adapters";
import { explainRankedEventsForTask, type RankedKnowledgeEvent } from "@xepha/graph";
import { SQLiteKnowledgeStore } from "@xepha/memory";
import { createContextPackV0, type ContextPackV0 } from "@xepha/protocol";
import { type CliWritable, writeStep } from "./ui.js";

export const DEFAULT_DATABASE_PATH = ".xepha/knowledge.db";
export const DEFAULT_GIT_LIMIT = 20;
export const DEFAULT_CONTEXT_LIMIT = 5;

const WORKSPACE_CONFIG_PATH = ".xepha/config.json";
const WORKSPACE_SOURCES_PATH = ".xepha/sources.json";
const WORKSPACE_RULES_PATH = ".xepha/rules/project.json";
const WORKSPACE_CONTEXT_PROFILE_PATH = ".xepha/context/profile.json";
const WORKSPACE_LOCAL_IGNORE_PATH = ".xepha/.gitignore";

const execFileAsync = promisify(execFile);

export interface WorkspaceConfig {
  readonly version: 1;
  readonly project: {
    readonly name: string;
  };
  readonly storage: {
    readonly database: string;
  };
  readonly context: {
    readonly defaultGoal: string;
    readonly limit: number;
  };
  readonly sources: {
    readonly file: string;
  };
}

export interface WorkspaceSources {
  readonly version: 1;
  readonly sources: readonly WorkspaceSource[];
}

export interface WorkspaceSource {
  readonly id: string;
  readonly type: string;
  readonly path: string;
  readonly enabled: boolean;
  readonly limit?: number;
}

export interface XephaWorkspace {
  readonly config: WorkspaceConfig;
  readonly sources: WorkspaceSources;
}

export interface WorkspaceSyncResult {
  readonly ingestedEvents: number;
  readonly warnings: readonly string[];
}

export interface WorkspaceContextResult {
  readonly pack: ContextPackV0;
  readonly rankedEvents: readonly RankedKnowledgeEvent[];
}

export async function initializeWorkspace(
  cwd: string,
): Promise<{ readonly createdFiles: readonly string[] }> {
  const createdFiles: string[] = [];
  const files = [
    [WORKSPACE_CONFIG_PATH, createDefaultWorkspaceConfig(cwd)],
    [WORKSPACE_SOURCES_PATH, createDefaultWorkspaceSources()],
    [WORKSPACE_RULES_PATH, createDefaultWorkspaceRules()],
    [WORKSPACE_CONTEXT_PROFILE_PATH, createDefaultContextProfile()],
  ] as const;

  for (const [path, contents] of files) {
    const created = await writeJsonFileIfMissing(cwd, path, contents);

    if (created) {
      createdFiles.push(path);
    }
  }

  if (await writeTextFileIfMissing(cwd, WORKSPACE_LOCAL_IGNORE_PATH, getLocalIgnore())) {
    createdFiles.push(WORKSPACE_LOCAL_IGNORE_PATH);
  }

  await mkdir(resolveFromCwd(cwd, ".xepha/cache"), { recursive: true });
  await mkdir(resolveFromCwd(cwd, ".xepha/runs"), { recursive: true });

  return { createdFiles };
}

export async function loadWorkspace(cwd: string): Promise<XephaWorkspace | undefined> {
  const configPath = resolveFromCwd(cwd, WORKSPACE_CONFIG_PATH);

  if (!(await fileExists(configPath))) {
    return undefined;
  }

  const config = normalizeWorkspaceConfig(await readJsonFile(configPath));
  const sourcesPath = resolveFromCwd(cwd, config.sources.file);
  const sources = normalizeWorkspaceSources(await readJsonFile(sourcesPath));

  return {
    config,
    sources,
  };
}

export async function syncWorkspaceSources(
  cwd: string,
  stdout: CliWritable,
  workspace: XephaWorkspace,
): Promise<WorkspaceSyncResult> {
  const enabledSources = workspace.sources.sources.filter((source) => source.enabled);
  const warnings: string[] = [];
  let ingestedEvents = 0;

  if (enabledSources.length === 0) {
    writeStep(stdout, "No enabled sources configured");
    return { ingestedEvents, warnings };
  }

  await withStore(cwd, workspace.config.storage.database, async (store) => {
    for (const source of enabledSources) {
      if (source.type !== "git") {
        warnings.push(
          `Skipped ${source.id}. Source type ${source.type} is not supported yet.`,
        );
        continue;
      }

      writeStep(stdout, "Syncing git history");

      try {
        const adapter = new GitCommitAdapter({
          limit: source.limit ?? DEFAULT_GIT_LIMIT,
          repositoryPath: resolveFromCwd(cwd, source.path),
        });
        const events = await adapter.ingest();

        for (const event of events) {
          await store.append(event);
        }

        ingestedEvents += events.length;
      } catch {
        warnings.push(
          `Couldn't read git source ${source.path}. Check .xepha/sources.json.`,
        );
      }
    }
  });

  return { ingestedEvents, warnings };
}

export async function buildWorkspaceContext(
  cwd: string,
  workspace: XephaWorkspace,
  task?: string,
): Promise<WorkspaceContextResult> {
  const goal =
    task ?? (await inferWorkspaceGoal(cwd, workspace.config.context.defaultGoal));

  return withStore(cwd, workspace.config.storage.database, async (store) => {
    const storedEvents = await store.list();
    const relations = await store.listRelations();
    const rankedEvents = explainRankedEventsForTask({
      task: goal,
      events: storedEvents,
      relations,
    });
    const selectedEvents = rankedEvents
      .slice(0, workspace.config.context.limit)
      .map((score) => score.event);
    const pack = createContextPackV0({
      task: goal,
      events: selectedEvents,
      limit: workspace.config.context.limit,
      confidence: rankedEvents.length === 0 ? 0 : 1,
      warnings: rankedEvents.length === 0 ? ["No events found in the local store."] : [],
    });

    return { pack, rankedEvents };
  });
}

export async function withStore<T>(
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

export function resolveFromCwd(cwd: string, path: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

async function inferWorkspaceGoal(cwd: string, fallback: string): Promise<string> {
  const branch = await readGitBranch(cwd);

  if (
    branch !== undefined &&
    branch !== "main" &&
    branch !== "master" &&
    branch !== "HEAD"
  ) {
    return `continue work on ${branch}`;
  }

  return fallback;
}

async function readGitBranch(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
        },
      },
    );
    const branch = stdout.trim();

    return branch.length > 0 ? branch : undefined;
  } catch {
    return undefined;
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

function createDefaultWorkspaceConfig(cwd: string): WorkspaceConfig {
  return {
    version: 1,
    project: {
      name: basename(cwd),
    },
    storage: {
      database: DEFAULT_DATABASE_PATH,
    },
    context: {
      defaultGoal: "continue the current work",
      limit: DEFAULT_CONTEXT_LIMIT,
    },
    sources: {
      file: WORKSPACE_SOURCES_PATH,
    },
  };
}

function createDefaultWorkspaceSources(): WorkspaceSources {
  return {
    version: 1,
    sources: [
      {
        enabled: true,
        id: "git",
        limit: DEFAULT_GIT_LIMIT,
        path: ".",
        type: "git",
      },
    ],
  };
}

function createDefaultWorkspaceRules(): {
  readonly version: 1;
  readonly rules: readonly string[];
} {
  return {
    version: 1,
    rules: [
      "Prefer existing repository conventions.",
      "Keep generated context evidence-backed.",
      "Treat local workspace files as private unless explicitly configured.",
    ],
  };
}

function createDefaultContextProfile(): {
  readonly version: 1;
  readonly profile: "default";
  readonly include: readonly string[];
} {
  return {
    version: 1,
    profile: "default",
    include: ["knowledge", "recommendedNextSteps", "evidence"],
  };
}

function getLocalIgnore(): string {
  return [
    "knowledge.db",
    "knowledge.db-*",
    "cache/",
    "runs/",
    "last-context.json",
    "",
  ].join("\n");
}

async function writeJsonFileIfMissing(
  cwd: string,
  path: string,
  value: unknown,
): Promise<boolean> {
  return writeTextFileIfMissing(cwd, path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeTextFileIfMissing(
  cwd: string,
  path: string,
  contents: string,
): Promise<boolean> {
  const resolvedPath = resolveFromCwd(cwd, path);

  await mkdir(dirname(resolvedPath), { recursive: true });

  if (await fileExists(resolvedPath)) {
    return false;
  }

  await writeFile(resolvedPath, contents);

  return true;
}

async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function normalizeWorkspaceConfig(value: unknown): WorkspaceConfig {
  if (!isRecord(value)) {
    throw new Error("Couldn't read .xepha/config.json. Expected a JSON object.");
  }

  const storage = isRecord(value.storage) ? value.storage : {};
  const context = isRecord(value.context) ? value.context : {};
  const sources = isRecord(value.sources) ? value.sources : {};
  const project = isRecord(value.project) ? value.project : {};

  return {
    version: 1,
    project: {
      name: getString(project.name, "workspace"),
    },
    storage: {
      database: getString(storage.database, DEFAULT_DATABASE_PATH),
    },
    context: {
      defaultGoal: getString(context.defaultGoal, "continue the current work"),
      limit: getNonNegativeInteger(context.limit, DEFAULT_CONTEXT_LIMIT),
    },
    sources: {
      file: getString(sources.file, WORKSPACE_SOURCES_PATH),
    },
  };
}

function normalizeWorkspaceSources(value: unknown): WorkspaceSources {
  if (!isRecord(value)) {
    throw new Error("Couldn't read .xepha/sources.json. Expected a JSON object.");
  }

  const sources = Array.isArray(value.sources) ? value.sources : [];

  return {
    version: 1,
    sources: sources.filter(isRecord).map((source) => ({
      enabled: getBoolean(source.enabled, true),
      id: getString(source.id, "source"),
      limit:
        source.limit === undefined
          ? undefined
          : getNonNegativeInteger(source.limit, DEFAULT_GIT_LIMIT),
      path: getString(source.path, "."),
      type: getString(source.type, "git"),
    })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function getBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function getNonNegativeInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : fallback;
}
