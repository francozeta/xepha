import * as z from "zod";
import type { KnowledgeEvent } from "@xepha/core";

export const CONTEXT_PACK_VERSION = "xepha.context.v0" as const;
const DEFAULT_EVENT_LIMIT = 8;
const isoDateTimeSchema = z.iso.datetime();

export const contextPackSourceSchema = z.strictObject({
  id: z.string().min(1),
  eventId: z.string().min(1).optional(),
  label: z.string().min(1),
  uri: z.string().min(1),
});

export const contextPackEventSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  occurredAt: isoDateTimeSchema,
  tags: z.array(z.string().min(1)),
  sourceIds: z.array(z.string().min(1)),
});

export const contextPackKnowledgeSchema = z.strictObject({
  goal: z.string().min(1),
  summary: z.string().min(1),
  relevantKnowledge: z.array(z.string().min(1)),
  recommendedNextSteps: z.array(z.string().min(1)),
});

export const contextPackV0Schema = z.strictObject({
  version: z.literal(CONTEXT_PACK_VERSION),
  task: z.string().min(1),
  generatedAt: isoDateTimeSchema,
  context: z.string().min(1),
  knowledge: contextPackKnowledgeSchema,
  events: z.array(contextPackEventSchema),
  sources: z.array(contextPackSourceSchema),
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string()),
});

export const contextPackV0JsonSchema = z.toJSONSchema(contextPackV0Schema);

export type ContextPackSource = z.infer<typeof contextPackSourceSchema>;
export type ContextPackEvent = z.infer<typeof contextPackEventSchema>;
export type ContextPackKnowledge = z.infer<typeof contextPackKnowledgeSchema>;
export type ContextPackV0 = z.infer<typeof contextPackV0Schema>;

export interface CreateContextPackV0Input {
  readonly task: string;
  readonly events: readonly KnowledgeEvent[];
  readonly generatedAt?: string;
  readonly context?: string;
  readonly knowledge?: ContextPackKnowledge;
  readonly confidence?: number;
  readonly warnings?: readonly string[];
  readonly limit?: number;
}

export function createContextPackV0(input: CreateContextPackV0Input): ContextPackV0 {
  const limit = getEventLimit(input.limit);
  const selectedEvents = input.events.slice(0, limit);
  const sources: ContextPackSource[] = [];
  const events: ContextPackEvent[] = selectedEvents.map((event) => {
    const sourceIds = event.evidence.map((evidence, index) => {
      const id = `${event.id}:evidence:${index}`;

      sources.push({
        id,
        eventId: event.id,
        label: evidence.label,
        uri: evidence.uri,
      });

      return id;
    });

    return {
      id: event.id,
      kind: event.kind,
      title: event.title,
      summary: event.summary,
      occurredAt: event.occurredAt,
      tags: [...event.tags],
      sourceIds,
    };
  });
  const pack = {
    version: CONTEXT_PACK_VERSION,
    task: input.task,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    context:
      input.context ??
      `Selected ${events.length} knowledge event(s) for the requested task: ${input.task}.`,
    knowledge: input.knowledge ?? buildContextKnowledge(input.task, events),
    events,
    sources,
    confidence: input.confidence ?? 1,
    warnings: [...(input.warnings ?? [])],
  };

  return contextPackV0Schema.parse(pack);
}

function buildContextKnowledge(
  task: string,
  events: readonly ContextPackEvent[],
): ContextPackKnowledge {
  const relevantKnowledge = events.map(formatRelevantKnowledge);
  const itemLabel = events.length === 1 ? "item" : "items";
  const mostRelevant = events[0] ? formatKnowledgeHeadline(events[0]) : undefined;

  return {
    goal: task,
    summary:
      events.length === 0
        ? `No evidence-backed knowledge was selected for ${task}.`
        : `Selected ${events.length} evidence-backed ${itemLabel} for ${task}. Most relevant: ${mostRelevant}.`,
    relevantKnowledge,
    recommendedNextSteps: [
      "Review the selected evidence before changing shared packages.",
      "Update docs and tests alongside behavior changes.",
    ],
  };
}

function formatRelevantKnowledge(event: ContextPackEvent): string {
  if (event.kind === "commit") {
    return toSentence(formatKnowledgeHeadline(event));
  }

  return `${event.title}: ${event.summary}`;
}

function formatKnowledgeHeadline(event: ContextPackEvent): string {
  const parsedTitle = parseConventionalTitle(event.title);

  if (!parsedTitle) {
    return stripPullRequestSuffix(event.title);
  }

  if (!parsedTitle.scope) {
    return parsedTitle.subject;
  }

  return `${parsedTitle.scope.toUpperCase()}: ${parsedTitle.subject}`;
}

function parseConventionalTitle(
  title: string,
): { readonly scope?: string; readonly subject: string } | undefined {
  const match = /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?: (?<subject>.+)$/u.exec(
    stripPullRequestSuffix(title),
  );

  if (!match?.groups?.subject) {
    return undefined;
  }

  return {
    scope: match.groups.scope,
    subject: match.groups.subject,
  };
}

function stripPullRequestSuffix(title: string): string {
  return title.replace(/\s+\(#\d+\)$/u, "");
}

function toSentence(value: string): string {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return trimmed;
  }

  const capitalized = `${trimmed[0]?.toUpperCase()}${trimmed.slice(1)}`;

  return /[.!?]$/u.test(capitalized) ? capitalized : `${capitalized}.`;
}

function getEventLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_EVENT_LIMIT;
  }

  if (!Number.isInteger(limit) || limit < 0) {
    throw new TypeError("Context pack limit must be a non-negative integer.");
  }

  return limit;
}
