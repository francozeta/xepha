import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";
import { GitCommitAdapter, MarkdownContextAdapter } from "@xepha/adapters";
import { explainRankedEventsForTask, type RankedKnowledgeEvent } from "@xepha/graph";
import { SQLiteKnowledgeStore } from "@xepha/memory";
import { createContextPackV0, type ContextPackV0 } from "@xepha/protocol";
import { type CliWritable, writeStep } from "./ui.js";

export const DEFAULT_DATABASE_PATH = ".xepha/knowledge.db";
export const DEFAULT_KNOWLEDGE_INDEX_PATH = ".xepha/knowledge/index.md";
export const DEFAULT_GIT_LIMIT = 20;
export const DEFAULT_CONTEXT_LIMIT = 5;

const WORKSPACE_CONFIG_PATH = ".xepha/config.json";
const WORKSPACE_SOURCES_PATH = ".xepha/sources.json";
const WORKSPACE_RULES_PATH = ".xepha/rules/project.json";
const WORKSPACE_CONTEXT_PROFILE_PATH = ".xepha/context/profile.json";
const WORKSPACE_PROJECT_CONTEXT_PATH = ".xepha/context/project.md";
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
  readonly knowledge: {
    readonly index: string;
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
  readonly snapshotPath: string;
}

export async function initializeWorkspace(cwd: string): Promise<{
  readonly createdFiles: readonly string[];
  readonly updatedFiles: readonly string[];
}> {
  const createdFiles: string[] = [];
  const updatedFiles: string[] = [];

  if (
    await writeJsonFileIfMissing(
      cwd,
      WORKSPACE_CONFIG_PATH,
      createDefaultWorkspaceConfig(cwd),
    )
  ) {
    createdFiles.push(WORKSPACE_CONFIG_PATH);
  }

  if (await ensureWorkspaceConfigDefaults(cwd)) {
    updatedFiles.push(WORKSPACE_CONFIG_PATH);
  }

  const config = normalizeWorkspaceConfig(
    await readJsonFile(resolveFromCwd(cwd, WORKSPACE_CONFIG_PATH)),
  );

  if (
    await writeJsonFileIfMissing(
      cwd,
      config.sources.file,
      createDefaultWorkspaceSources(),
    )
  ) {
    createdFiles.push(config.sources.file);
  }

  if (await ensureWorkspaceSourcesDefaults(cwd, config.sources.file)) {
    updatedFiles.push(config.sources.file);
  }

  const files = [
    [WORKSPACE_RULES_PATH, createDefaultWorkspaceRules()],
    [WORKSPACE_CONTEXT_PROFILE_PATH, createDefaultContextProfile()],
  ] as const;

  for (const [path, contents] of files) {
    const created = await writeJsonFileIfMissing(cwd, path, contents);

    if (created) {
      createdFiles.push(path);
    }
  }

  if (
    await writeTextFileIfMissing(
      cwd,
      WORKSPACE_PROJECT_CONTEXT_PATH,
      createDefaultProjectContext(cwd),
    )
  ) {
    createdFiles.push(WORKSPACE_PROJECT_CONTEXT_PATH);
  } else if (await ensureProjectContextReadable(cwd)) {
    updatedFiles.push(WORKSPACE_PROJECT_CONTEXT_PATH);
  }

  if (await writeTextFileIfMissing(cwd, WORKSPACE_LOCAL_IGNORE_PATH, getLocalIgnore())) {
    createdFiles.push(WORKSPACE_LOCAL_IGNORE_PATH);
  } else if (await ensureLocalIgnoreDefaults(cwd)) {
    updatedFiles.push(WORKSPACE_LOCAL_IGNORE_PATH);
  }

  await mkdir(resolveFromCwd(cwd, ".xepha/cache"), { recursive: true });
  await mkdir(resolveFromCwd(cwd, ".xepha/runs"), { recursive: true });

  return {
    createdFiles: [...new Set(createdFiles)],
    updatedFiles: [...new Set(updatedFiles)].filter(
      (path) => !createdFiles.includes(path),
    ),
  };
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
        if (source.type === "markdown") {
          writeStep(stdout, "Syncing markdown context");

          const adapter = new MarkdownContextAdapter({
            rootPath: cwd,
            sourcePath: source.path,
          });
          const events = await adapter.ingest();

          for (const event of events) {
            await store.append(event);
          }

          ingestedEvents += events.length;
          continue;
        }

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

    const snapshotPath = await writeKnowledgeSnapshot(cwd, workspace, pack);

    return { pack, rankedEvents, snapshotPath };
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
    knowledge: {
      index: DEFAULT_KNOWLEDGE_INDEX_PATH,
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
      {
        enabled: true,
        id: "project-context",
        path: ".xepha/context",
        type: "markdown",
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

function createDefaultProjectContext(cwd: string): string {
  return [
    "# Project Context",
    "",
    `Project: ${basename(cwd)}`,
    "",
    "Use this file for durable notes that should survive agent sessions and context compaction.",
    "",
    "## Current Direction",
    "",
    "- Keep context explicit, local, and evidence-backed.",
    "- Prefer small source adapters over one large context file.",
    "",
  ].join("\n");
}

function getLocalIgnore(): string {
  return [
    "knowledge.db",
    "knowledge.db-*",
    "knowledge/",
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

async function ensureWorkspaceConfigDefaults(cwd: string): Promise<boolean> {
  const configPath = resolveFromCwd(cwd, WORKSPACE_CONFIG_PATH);
  const value = await readJsonFile(configPath);

  if (!isRecord(value)) {
    throw new Error("Couldn't read .xepha/config.json. Expected a JSON object.");
  }

  const next: Record<string, unknown> = { ...value };
  let changed = false;

  if (next.version !== 1) {
    next.version = 1;
    changed = true;
  }

  const project = copyRecord(next.project);
  if (!hasText(project.name)) {
    project.name = basename(cwd);
    changed = true;
  }
  if (next.project !== project) {
    next.project = project;
  }

  const storage = copyRecord(next.storage);
  if (!hasText(storage.database)) {
    storage.database = DEFAULT_DATABASE_PATH;
    changed = true;
  }
  if (next.storage !== storage) {
    next.storage = storage;
  }

  const knowledge = copyRecord(next.knowledge);
  if (!hasText(knowledge.index)) {
    knowledge.index = DEFAULT_KNOWLEDGE_INDEX_PATH;
    changed = true;
  }
  if (next.knowledge !== knowledge) {
    next.knowledge = knowledge;
  }

  const context = copyRecord(next.context);
  if (!hasText(context.defaultGoal)) {
    context.defaultGoal = "continue the current work";
    changed = true;
  }
  if (!isNonNegativeInteger(context.limit)) {
    context.limit = DEFAULT_CONTEXT_LIMIT;
    changed = true;
  }
  if (next.context !== context) {
    next.context = context;
  }

  const sources = copyRecord(next.sources);
  if (!hasText(sources.file)) {
    sources.file = WORKSPACE_SOURCES_PATH;
    changed = true;
  }
  if (next.sources !== sources) {
    next.sources = sources;
  }

  if (!changed) {
    return false;
  }

  await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`);

  return true;
}

async function ensureWorkspaceSourcesDefaults(
  cwd: string,
  sourcesPath: string,
): Promise<boolean> {
  const resolvedPath = resolveFromCwd(cwd, sourcesPath);
  const value = await readJsonFile(resolvedPath);

  if (!isRecord(value)) {
    throw new Error("Couldn't read .xepha/sources.json. Expected a JSON object.");
  }

  const next: Record<string, unknown> = { ...value };
  const sources = Array.isArray(next.sources) ? [...next.sources] : [];
  let changed = false;

  if (next.version !== 1) {
    next.version = 1;
    changed = true;
  }

  if (!Array.isArray(next.sources)) {
    changed = true;
  }

  for (const source of createDefaultWorkspaceSources().sources) {
    const hasSource = sources.some(
      (candidate) => isRecord(candidate) && candidate.id === source.id,
    );

    if (!hasSource) {
      sources.push(source);
      changed = true;
    }
  }

  if (!changed) {
    return false;
  }

  next.sources = sources;
  await writeFile(resolvedPath, `${JSON.stringify(next, null, 2)}\n`);

  return true;
}

async function ensureLocalIgnoreDefaults(cwd: string): Promise<boolean> {
  const ignorePath = resolveFromCwd(cwd, WORKSPACE_LOCAL_IGNORE_PATH);
  const contents = await readFile(ignorePath, "utf8");
  const lines = contents.split(/\r?\n/u);
  const existingLines = new Set(lines.map((line) => line.trim()));
  const missingLines = getLocalIgnore()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !existingLines.has(line));

  if (missingLines.length === 0) {
    return false;
  }

  const normalizedContents = contents.endsWith("\n") ? contents : `${contents}\n`;
  await writeFile(ignorePath, `${normalizedContents}${missingLines.join("\n")}\n`);

  return true;
}

async function ensureProjectContextReadable(cwd: string): Promise<boolean> {
  const projectContextPath = resolveFromCwd(cwd, WORKSPACE_PROJECT_CONTEXT_PATH);
  const contents = await readFile(projectContextPath, "utf8");
  const trimmedContents = contents.trim();

  if (!trimmedContents.startsWith('"')) {
    return false;
  }

  try {
    const decoded = JSON.parse(trimmedContents) as unknown;

    if (typeof decoded !== "string" || !decoded.startsWith("#")) {
      return false;
    }

    await writeFile(
      projectContextPath,
      decoded.endsWith("\n") ? decoded : `${decoded}\n`,
    );

    return true;
  } catch {
    return false;
  }
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
    knowledge: {
      index: getString(
        isRecord(value.knowledge) ? value.knowledge.index : undefined,
        DEFAULT_KNOWLEDGE_INDEX_PATH,
      ),
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
  return isNonNegativeInteger(value) ? value : fallback;
}

function copyRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? { ...value } : {};
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

async function writeKnowledgeSnapshot(
  cwd: string,
  workspace: XephaWorkspace,
  pack: ContextPackV0,
): Promise<string> {
  const snapshotPath = resolveFromCwd(cwd, workspace.config.knowledge.index);
  await mkdir(dirname(snapshotPath), { recursive: true });
  await writeFile(snapshotPath, formatKnowledgeSnapshot(workspace, pack));

  return workspace.config.knowledge.index;
}

function formatKnowledgeSnapshot(workspace: XephaWorkspace, pack: ContextPackV0): string {
  const lines = [
    "# Xepha Knowledge",
    "",
    "Read this file before asking an agent to work on this project.",
    "It is the human-readable snapshot of the local Xepha store.",
    "",
    `Project: ${workspace.config.project.name}`,
    `Generated: ${pack.generatedAt}`,
    `Goal: ${pack.knowledge.goal}`,
    `Database: ${workspace.config.storage.database}`,
    "",
    "## Summary",
    "",
    pack.knowledge.summary,
    "",
    "## Relevant Knowledge",
    "",
    ...formatList(pack.knowledge.relevantKnowledge),
    "",
    "## Recommended Next Steps",
    "",
    ...formatList(pack.knowledge.recommendedNextSteps),
    "",
    "## Evidence",
    "",
    ...formatList(
      pack.sources.map((source) =>
        source.eventId === undefined
          ? `${source.label} (${source.uri})`
          : `${source.label} -> ${source.eventId} (${source.uri})`,
      ),
    ),
    "",
  ];

  return `${lines.join("\n")}\n`;
}

function formatList(values: readonly string[]): readonly string[] {
  if (values.length === 0) {
    return ["- None"];
  }

  return values.map((value) => `- ${value}`);
}
