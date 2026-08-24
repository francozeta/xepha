import { readdir, readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { defineKnowledgeEvent, type KnowledgeEvent } from "@xepha/core";

export interface MarkdownContextAdapterOptions {
  readonly rootPath: string;
  readonly sourcePath: string;
}

interface MarkdownFile {
  readonly absolutePath: string;
  readonly relativePath: string;
}

export class MarkdownContextAdapter {
  readonly name = "markdown-context";
  readonly #options: MarkdownContextAdapterOptions;

  constructor(options: MarkdownContextAdapterOptions) {
    this.#options = options;
  }

  async ingest(): Promise<readonly KnowledgeEvent[]> {
    const sourceRoot = resolve(this.#options.rootPath, this.#options.sourcePath);
    const files = await listMarkdownFiles(this.#options.rootPath, sourceRoot);

    return Promise.all(files.map((file) => this.#readKnowledgeEvent(file)));
  }

  async #readKnowledgeEvent(file: MarkdownFile): Promise<KnowledgeEvent> {
    const [contents, metadata] = await Promise.all([
      readFile(file.absolutePath, "utf8"),
      stat(file.absolutePath),
    ]);
    const title = readMarkdownTitle(contents) ?? file.relativePath;
    const summary = readMarkdownSummary(contents, title) ?? "No summary provided.";

    return defineKnowledgeEvent({
      id: `markdown:${file.relativePath}`,
      kind: "discussion",
      title,
      summary,
      occurredAt: metadata.mtime.toISOString(),
      tags: ["markdown", "context", `file:${file.relativePath}`],
      evidence: [
        {
          label: file.relativePath,
          uri: pathToFileURL(file.absolutePath).href,
        },
      ],
    });
  }
}

async function listMarkdownFiles(
  rootPath: string,
  sourceRoot: string,
): Promise<readonly MarkdownFile[]> {
  if (!(await pathExists(sourceRoot))) {
    return [];
  }

  const files = await walkMarkdownFiles(rootPath, sourceRoot);

  return [...files].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
}

async function walkMarkdownFiles(
  rootPath: string,
  directoryPath: string,
): Promise<readonly MarkdownFile[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const files: MarkdownFile[] = [];

  for (const entry of entries) {
    const absolutePath = resolve(directoryPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await walkMarkdownFiles(rootPath, absolutePath)));
      continue;
    }

    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) {
      continue;
    }

    files.push({
      absolutePath,
      relativePath: normalizePath(relative(rootPath, absolutePath)),
    });
  }

  return files;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function readMarkdownTitle(contents: string): string | undefined {
  for (const line of contents.split(/\r?\n/u)) {
    const match = /^#\s+(?<title>.+)$/u.exec(line.trim());

    if (match?.groups?.title) {
      return match.groups.title.trim();
    }
  }

  return undefined;
}

function readMarkdownSummary(contents: string, title: string): string | undefined {
  for (const line of contents.split(/\r?\n/u)) {
    const trimmedLine = line.trim();

    if (
      trimmedLine.length === 0 ||
      trimmedLine.startsWith("#") ||
      trimmedLine === title
    ) {
      continue;
    }

    return trimmedLine.replace(/^[-*]\s+/u, "");
  }

  return undefined;
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}
