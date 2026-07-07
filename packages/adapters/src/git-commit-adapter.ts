import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { defineKnowledgeEvent, type KnowledgeEvent } from "@xepha/core";

const execFileAsync = promisify(execFile);

const DEFAULT_COMMIT_LIMIT = 20;
const FIELD_SEPARATOR = "\u001f";
const RECORD_SEPARATOR = "\u001e";
const GIT_LOG_FORMAT = ["%H", "%h", "%aI", "%an", "%ae", "%s"].join(FIELD_SEPARATOR);
const MAX_GIT_OUTPUT_BUFFER = 10 * 1024 * 1024;

export interface GitCommitAdapterOptions {
  readonly repositoryPath: string;
  readonly limit?: number;
  readonly revision?: string;
  readonly remoteName?: string;
  readonly remoteUrl?: string;
}

interface GitCommitRecord {
  readonly hash: string;
  readonly shortHash: string;
  readonly authorDate: string;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly subject: string;
}

interface GitCommandError extends Error {
  readonly code?: number | string;
  readonly stderr?: string;
}

export class GitCommitAdapter {
  readonly name = "git-commits";
  readonly #options: GitCommitAdapterOptions;

  constructor(options: GitCommitAdapterOptions) {
    this.#options = options;
  }

  async ingest(): Promise<readonly KnowledgeEvent[]> {
    const limit = getCommitLimit(this.#options.limit);

    if (limit === 0) {
      return [];
    }

    const commits = await this.#readCommits(limit);

    if (commits.length === 0) {
      return [];
    }

    const remoteUrl = await this.#readRemoteUrl();

    return Promise.all(
      commits.map(async (commit) => {
        const files = await this.#readChangedFiles(commit.hash);
        const commitUri = buildCommitUri({
          hash: commit.hash,
          remoteUrl,
          repositoryPath: this.#options.repositoryPath,
        });

        return defineKnowledgeEvent({
          id: `git:${commit.hash}`,
          kind: "commit",
          title: commit.subject,
          summary: buildCommitSummary(commit, files),
          occurredAt: toIsoString(commit.authorDate),
          tags: buildTags(commit, files),
          evidence: [
            {
              label: `Commit ${commit.shortHash}`,
              uri: commitUri,
            },
          ],
        });
      }),
    );
  }

  async #readCommits(limit: number): Promise<readonly GitCommitRecord[]> {
    try {
      const output = await runGit(this.#options.repositoryPath, [
        "log",
        "--no-color",
        `--max-count=${limit}`,
        `--format=${GIT_LOG_FORMAT}${RECORD_SEPARATOR}`,
        ...(this.#options.revision === undefined ? [] : [this.#options.revision]),
      ]);

      return parseGitLog(output);
    } catch (error) {
      if (isEmptyHistoryError(error)) {
        return [];
      }

      throw error;
    }
  }

  async #readChangedFiles(hash: string): Promise<readonly string[]> {
    const output = await runGit(this.#options.repositoryPath, [
      "show",
      "--format=",
      "--name-only",
      "-z",
      hash,
    ]);

    return output
      .split("\0")
      .map((path) => path.trim())
      .filter((path) => path.length > 0);
  }

  async #readRemoteUrl(): Promise<string | undefined> {
    if (this.#options.remoteUrl !== undefined) {
      return this.#options.remoteUrl;
    }

    try {
      const remoteName = this.#options.remoteName ?? "origin";
      const output = await runGit(this.#options.repositoryPath, [
        "config",
        "--get",
        `remote.${remoteName}.url`,
      ]);

      return output.trim() || undefined;
    } catch {
      return undefined;
    }
  }
}

async function runGit(repositoryPath: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repositoryPath, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
    },
    maxBuffer: MAX_GIT_OUTPUT_BUFFER,
  });

  return stdout;
}

function parseGitLog(output: string): readonly GitCommitRecord[] {
  return output
    .split(RECORD_SEPARATOR)
    .map((record) => record.trim())
    .filter((record) => record.length > 0)
    .map((record) => {
      const fields = record.split(FIELD_SEPARATOR);
      const hash = fields[0];
      const shortHash = fields[1];
      const authorDate = fields[2];
      const authorName = fields[3];
      const authorEmail = fields[4];

      if (
        hash === undefined ||
        shortHash === undefined ||
        authorDate === undefined ||
        authorName === undefined ||
        authorEmail === undefined
      ) {
        throw new Error("Unable to parse git log output.");
      }

      return {
        hash,
        shortHash,
        authorDate,
        authorName,
        authorEmail,
        subject: fields.slice(5).join(FIELD_SEPARATOR) || "(no subject)",
      };
    });
}

function buildCommitSummary(commit: GitCommitRecord, files: readonly string[]): string {
  if (files.length === 0) {
    return `Commit ${commit.shortHash} by ${commit.authorName} did not report changed files.`;
  }

  const visibleFiles = files.slice(0, 5);
  const remainingCount = files.length - visibleFiles.length;
  const fileList =
    remainingCount === 0
      ? visibleFiles.join(", ")
      : `${visibleFiles.join(", ")}, and ${remainingCount} more`;
  const fileWord = files.length === 1 ? "file" : "files";

  return `Commit ${commit.shortHash} by ${commit.authorName} touched ${files.length} ${fileWord}: ${fileList}.`;
}

function buildTags(commit: GitCommitRecord, files: readonly string[]): readonly string[] {
  return [
    "git",
    "commit",
    `author:${commit.authorName}`,
    `author-email:${commit.authorEmail}`,
    ...files.map((file) => `file:${file}`),
  ];
}

function buildCommitUri(options: {
  readonly hash: string;
  readonly repositoryPath: string;
  readonly remoteUrl: string | undefined;
}): string {
  const remoteCommitUrl = buildRemoteCommitUri(options.remoteUrl, options.hash);

  if (remoteCommitUrl !== undefined) {
    return remoteCommitUrl;
  }

  return `git+${pathToFileURL(options.repositoryPath).href}#${options.hash}`;
}

function buildRemoteCommitUri(
  remoteUrl: string | undefined,
  hash: string,
): string | undefined {
  if (remoteUrl === undefined || remoteUrl.trim().length === 0) {
    return undefined;
  }

  const normalizedUrl = normalizeRemoteUrl(remoteUrl);
  const githubMatch = normalizedUrl.match(
    /^https:\/\/github\.com\/(?<owner>[^/]+)\/(?<repo>[^/]+)$/u,
  );

  if (githubMatch === null) {
    return undefined;
  }

  return `${normalizedUrl}/commit/${hash}`;
}

function normalizeRemoteUrl(remoteUrl: string): string {
  const trimmedUrl = remoteUrl.trim();
  const sshGithubMatch = trimmedUrl.match(
    /^git@github\.com:(?<owner>[^/]+)\/(?<repo>.+?)(?:\.git)?$/u,
  );

  if (sshGithubMatch?.groups !== undefined) {
    return `https://github.com/${sshGithubMatch.groups.owner}/${sshGithubMatch.groups.repo}`;
  }

  return trimmedUrl.replace(/\.git$/u, "");
}

function getCommitLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_COMMIT_LIMIT;
  }

  if (!Number.isInteger(limit) || limit < 0) {
    throw new TypeError("Git commit adapter limit must be a non-negative integer.");
  }

  return limit;
}

function toIsoString(value: string): string {
  return new Date(value).toISOString();
}

function isEmptyHistoryError(error: unknown): boolean {
  if (!isGitCommandError(error)) {
    return false;
  }

  return (
    error.code === 128 &&
    (error.stderr?.includes("does not have any commits yet") === true ||
      error.stderr?.includes("your current branch") === true)
  );
}

function isGitCommandError(error: unknown): error is GitCommandError {
  return error instanceof Error && ("code" in error || "stderr" in error);
}
