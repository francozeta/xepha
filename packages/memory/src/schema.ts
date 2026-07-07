import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const knowledgeEvents = sqliteTable("knowledge_events", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  occurredAt: text("occurred_at").notNull(),
});

export const knowledgeEventTags = sqliteTable(
  "knowledge_event_tags",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => knowledgeEvents.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    value: text("value").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.eventId, table.value],
    }),
  ],
);

export const knowledgeEventEvidence = sqliteTable(
  "knowledge_event_evidence",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => knowledgeEvents.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    label: text("label").notNull(),
    uri: text("uri").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.eventId, table.position],
    }),
  ],
);

export const knowledgeEventRelations = sqliteTable(
  "knowledge_event_relations",
  {
    fromEventId: text("from_event_id")
      .notNull()
      .references(() => knowledgeEvents.id, { onDelete: "cascade" }),
    toEventId: text("to_event_id")
      .notNull()
      .references(() => knowledgeEvents.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    reason: text("reason").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.fromEventId, table.toEventId, table.kind],
    }),
  ],
);

export const schema = {
  knowledgeEventEvidence,
  knowledgeEventRelations,
  knowledgeEventTags,
  knowledgeEvents,
};
