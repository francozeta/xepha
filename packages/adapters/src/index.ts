import type { KnowledgeEvent } from "@xepha/core";

export interface SourceAdapter {
  readonly name: string;
  ingest(): Promise<readonly KnowledgeEvent[]>;
}
