import type { KnowledgeEvent } from "@xepha/core";

export interface KnowledgeStore {
  append(event: KnowledgeEvent): Promise<void>;
  list(): Promise<readonly KnowledgeEvent[]>;
}

export class InMemoryKnowledgeStore implements KnowledgeStore {
  readonly #events = new Map<string, KnowledgeEvent>();

  async append(event: KnowledgeEvent): Promise<void> {
    this.#events.set(event.id, event);
  }

  async list(): Promise<readonly KnowledgeEvent[]> {
    return Array.from(this.#events.values());
  }
}
