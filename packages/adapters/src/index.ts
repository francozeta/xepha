import type { KnowledgeEvent } from "@xepha/core";
export { GitCommitAdapter } from "./git-commit-adapter.js";
export type { GitCommitAdapterOptions } from "./git-commit-adapter.js";

export interface SourceAdapter {
  readonly name: string;
  ingest(): Promise<readonly KnowledgeEvent[]>;
}
