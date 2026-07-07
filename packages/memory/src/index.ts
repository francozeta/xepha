import type { KnowledgeEvent } from "@xepha/core";
export { SQLiteKnowledgeStore } from "./sqlite-store.js";
export type { SQLiteKnowledgeStoreOptions } from "./sqlite-store.js";

export type KnowledgeRelationKind = "supports" | "supersedes" | "relates_to";

export interface KnowledgeRelation {
  readonly from: string;
  readonly to: string;
  readonly kind: KnowledgeRelationKind;
  readonly reason: string;
}

export interface KnowledgeStore {
  append(event: KnowledgeEvent): Promise<void>;
  list(): Promise<readonly KnowledgeEvent[]>;
  addRelation(relation: KnowledgeRelation): Promise<void>;
  listRelations(eventId?: string): Promise<readonly KnowledgeRelation[]>;
}

export class InMemoryKnowledgeStore implements KnowledgeStore {
  readonly #events = new Map<string, KnowledgeEvent>();
  readonly #relations: KnowledgeRelation[] = [];

  async append(event: KnowledgeEvent): Promise<void> {
    this.#events.set(event.id, event);
  }

  async list(): Promise<readonly KnowledgeEvent[]> {
    return Array.from(this.#events.values());
  }

  async addRelation(relation: KnowledgeRelation): Promise<void> {
    const index = this.#relations.findIndex(
      (storedRelation) =>
        storedRelation.from === relation.from &&
        storedRelation.to === relation.to &&
        storedRelation.kind === relation.kind,
    );

    if (index === -1) {
      this.#relations.push(relation);
      return;
    }

    this.#relations[index] = relation;
  }

  async listRelations(eventId?: string): Promise<readonly KnowledgeRelation[]> {
    if (eventId === undefined) {
      return [...this.#relations];
    }

    return this.#relations.filter(
      (relation) => relation.from === eventId || relation.to === eventId,
    );
  }
}
