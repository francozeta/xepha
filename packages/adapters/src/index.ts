import type { KnowledgeEvent } from "@xepha/core";
export { GitCommitAdapter } from "./git-commit-adapter.js";
export type { GitCommitAdapterOptions } from "./git-commit-adapter.js";
export { MarkdownContextAdapter } from "./markdown-context-adapter.js";
export type { MarkdownContextAdapterOptions } from "./markdown-context-adapter.js";

export interface SourceAdapter {
  readonly name: string;
  ingest(): Promise<readonly KnowledgeEvent[]>;
}
