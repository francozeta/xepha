import { createClient, type Client } from "@libsql/client";
import { asc, eq, or } from "drizzle-orm";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import type { EvidenceRef, KnowledgeEvent } from "@xepha/core";
import {
  knowledgeEventEvidence,
  knowledgeEventRelations,
  knowledgeEvents,
  knowledgeEventTags,
  schema,
} from "./schema.js";
import type { KnowledgeRelation, KnowledgeStore } from "./index.js";

type Database = LibSQLDatabase<typeof schema>;

export interface SQLiteKnowledgeStoreOptions {
  readonly url: string;
}

export class SQLiteKnowledgeStore implements KnowledgeStore {
  readonly #client: Client;
  readonly #db: Database;

  private constructor(client: Client, db: Database) {
    this.#client = client;
    this.#db = db;
  }

  static async open(options: SQLiteKnowledgeStoreOptions): Promise<SQLiteKnowledgeStore> {
    const client = createClient({ url: options.url });
    const db = drizzle(client, { schema });
    const store = new SQLiteKnowledgeStore(client, db);

    await store.initialize();

    return store;
  }

  async append(event: KnowledgeEvent): Promise<void> {
    await this.#db.transaction(async (tx) => {
      await tx
        .insert(knowledgeEvents)
        .values({
          id: event.id,
          kind: event.kind,
          occurredAt: event.occurredAt,
          summary: event.summary,
          title: event.title,
        })
        .onConflictDoUpdate({
          target: knowledgeEvents.id,
          set: {
            kind: event.kind,
            occurredAt: event.occurredAt,
            summary: event.summary,
            title: event.title,
          },
        })
        .run();

      await tx
        .delete(knowledgeEventTags)
        .where(eq(knowledgeEventTags.eventId, event.id))
        .run();
      await tx
        .delete(knowledgeEventEvidence)
        .where(eq(knowledgeEventEvidence.eventId, event.id))
        .run();

      if (event.tags.length > 0) {
        await tx
          .insert(knowledgeEventTags)
          .values(
            event.tags.map((tag, position) => ({
              eventId: event.id,
              position,
              value: tag,
            })),
          )
          .run();
      }

      if (event.evidence.length > 0) {
        await tx
          .insert(knowledgeEventEvidence)
          .values(
            event.evidence.map((evidence, position) => ({
              eventId: event.id,
              label: evidence.label,
              position,
              uri: evidence.uri,
            })),
          )
          .run();
      }
    });
  }

  async list(): Promise<readonly KnowledgeEvent[]> {
    const events = await this.#db
      .select()
      .from(knowledgeEvents)
      .orderBy(asc(knowledgeEvents.occurredAt), asc(knowledgeEvents.id));
    const tags = await this.#db
      .select()
      .from(knowledgeEventTags)
      .orderBy(asc(knowledgeEventTags.eventId), asc(knowledgeEventTags.position));
    const evidence = await this.#db
      .select()
      .from(knowledgeEventEvidence)
      .orderBy(asc(knowledgeEventEvidence.eventId), asc(knowledgeEventEvidence.position));

    const tagsByEvent = new Map<string, string[]>();
    const evidenceByEvent = new Map<string, EvidenceRef[]>();

    for (const tag of tags) {
      const eventTags = tagsByEvent.get(tag.eventId) ?? [];
      eventTags.push(tag.value);
      tagsByEvent.set(tag.eventId, eventTags);
    }

    for (const item of evidence) {
      const eventEvidence = evidenceByEvent.get(item.eventId) ?? [];
      eventEvidence.push({
        label: item.label,
        uri: item.uri,
      });
      evidenceByEvent.set(item.eventId, eventEvidence);
    }

    return events.map((event) => ({
      id: event.id,
      kind: event.kind as KnowledgeEvent["kind"],
      occurredAt: event.occurredAt,
      summary: event.summary,
      title: event.title,
      evidence: evidenceByEvent.get(event.id) ?? [],
      tags: tagsByEvent.get(event.id) ?? [],
    }));
  }

  async addRelation(relation: KnowledgeRelation): Promise<void> {
    await this.#db
      .insert(knowledgeEventRelations)
      .values({
        fromEventId: relation.from,
        kind: relation.kind,
        reason: relation.reason,
        toEventId: relation.to,
      })
      .onConflictDoUpdate({
        target: [
          knowledgeEventRelations.fromEventId,
          knowledgeEventRelations.toEventId,
          knowledgeEventRelations.kind,
        ],
        set: {
          reason: relation.reason,
        },
      })
      .run();
  }

  async listRelations(eventId?: string): Promise<readonly KnowledgeRelation[]> {
    const query = this.#db
      .select()
      .from(knowledgeEventRelations)
      .where(
        eventId === undefined
          ? undefined
          : or(
              eq(knowledgeEventRelations.fromEventId, eventId),
              eq(knowledgeEventRelations.toEventId, eventId),
            ),
      )
      .orderBy(
        asc(knowledgeEventRelations.fromEventId),
        asc(knowledgeEventRelations.toEventId),
        asc(knowledgeEventRelations.kind),
      );
    const relations = await query;

    return relations.map((relation) => ({
      from: relation.fromEventId,
      kind: relation.kind as KnowledgeRelation["kind"],
      reason: relation.reason,
      to: relation.toEventId,
    }));
  }

  async close(): Promise<void> {
    this.#client.close();
  }

  private async initialize(): Promise<void> {
    await this.#client.execute("PRAGMA foreign_keys = ON");
    await this.#client.execute(`
      CREATE TABLE IF NOT EXISTS knowledge_events (
        id TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      )
    `);
    await this.#client.execute(`
      CREATE TABLE IF NOT EXISTS knowledge_event_tags (
        event_id TEXT NOT NULL REFERENCES knowledge_events(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (event_id, value)
      )
    `);
    await this.#client.execute(`
      CREATE TABLE IF NOT EXISTS knowledge_event_evidence (
        event_id TEXT NOT NULL REFERENCES knowledge_events(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        label TEXT NOT NULL,
        uri TEXT NOT NULL,
        PRIMARY KEY (event_id, position)
      )
    `);
    await this.#client.execute(`
      CREATE TABLE IF NOT EXISTS knowledge_event_relations (
        from_event_id TEXT NOT NULL REFERENCES knowledge_events(id) ON DELETE CASCADE,
        to_event_id TEXT NOT NULL REFERENCES knowledge_events(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        reason TEXT NOT NULL,
        PRIMARY KEY (from_event_id, to_event_id, kind)
      )
    `);
  }
}
