import type { KnowledgeEvent } from "@xepha/core";

export type KnowledgeEdgeKind = "supports" | "supersedes" | "relates_to";

export interface KnowledgeEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: KnowledgeEdgeKind;
  readonly reason: string;
}

export interface RankEventsForTaskInput {
  readonly task: string;
  readonly events: readonly KnowledgeEvent[];
  readonly relations?: readonly KnowledgeEdge[];
}

interface EventScore {
  readonly event: KnowledgeEvent;
  readonly matched: boolean;
  readonly relationBoost: number;
  readonly textScore: number;
}

const TOKEN_MIN_LENGTH = 2;
const TAG_MATCH_WEIGHT = 6;
const TITLE_MATCH_WEIGHT = 4;
const SUMMARY_MATCH_WEIGHT = 2;
const RELATION_BOOST_WEIGHT = 3;

export function linkEventsBySharedTags(
  events: readonly KnowledgeEvent[],
): readonly KnowledgeEdge[] {
  const edges: KnowledgeEdge[] = [];

  for (const source of events) {
    for (const target of events) {
      if (source.id >= target.id) {
        continue;
      }

      const sharedTags = source.tags.filter((tag) => target.tags.includes(tag));
      if (sharedTags.length === 0) {
        continue;
      }

      edges.push({
        from: source.id,
        to: target.id,
        kind: "relates_to",
        reason: `Shared tags: ${sharedTags.join(", ")}`,
      });
    }
  }

  return edges;
}

export function rankEventsForTask(
  input: RankEventsForTaskInput,
): readonly KnowledgeEvent[] {
  const taskTokens = tokenize(input.task);
  const baseScores = input.events.map((event) => scoreEvent(event, taskTokens));
  const directlyMatchedIds = new Set(
    baseScores.filter((score) => score.matched).map((score) => score.event.id),
  );
  const relationBoosts = getRelationBoosts(input.relations ?? [], directlyMatchedIds);
  const scoredEvents = baseScores.map((score) => ({
    ...score,
    relationBoost: relationBoosts.get(score.event.id) ?? 0,
  }));

  return [...scoredEvents]
    .sort((left, right) => compareScores(left, right))
    .map((score) => score.event);
}

function scoreEvent(event: KnowledgeEvent, taskTokens: readonly string[]): EventScore {
  const textScore =
    scoreTags(event.tags, taskTokens) +
    scoreText(event.title, taskTokens, TITLE_MATCH_WEIGHT) +
    scoreText(event.summary, taskTokens, SUMMARY_MATCH_WEIGHT);

  return {
    event,
    matched: textScore > 0,
    relationBoost: 0,
    textScore,
  };
}

function compareScores(left: EventScore, right: EventScore): number {
  const leftScore = left.textScore + left.relationBoost;
  const rightScore = right.textScore + right.relationBoost;

  if (leftScore !== rightScore) {
    return rightScore - leftScore;
  }

  const leftTime = Date.parse(left.event.occurredAt);
  const rightTime = Date.parse(right.event.occurredAt);

  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }

  return left.event.id.localeCompare(right.event.id);
}

function getRelationBoosts(
  relations: readonly KnowledgeEdge[],
  directlyMatchedIds: ReadonlySet<string>,
): Map<string, number> {
  const boosts = new Map<string, number>();

  for (const relation of relations) {
    if (directlyMatchedIds.has(relation.from) && !directlyMatchedIds.has(relation.to)) {
      boosts.set(
        relation.to,
        Math.max(boosts.get(relation.to) ?? 0, RELATION_BOOST_WEIGHT),
      );
    }

    if (directlyMatchedIds.has(relation.to) && !directlyMatchedIds.has(relation.from)) {
      boosts.set(
        relation.from,
        Math.max(boosts.get(relation.from) ?? 0, RELATION_BOOST_WEIGHT),
      );
    }
  }

  return boosts;
}

function scoreTags(tags: readonly string[], taskTokens: readonly string[]): number {
  const normalizedTags = tags.flatMap((tag) => tokenize(tag));
  const tagSet = new Set(normalizedTags);

  return taskTokens.reduce(
    (score, token) => score + (tagSet.has(token) ? TAG_MATCH_WEIGHT : 0),
    0,
  );
}

function scoreText(text: string, taskTokens: readonly string[], weight: number): number {
  const textTokens = new Set(tokenize(text));

  return taskTokens.reduce(
    (score, token) => score + (textTokens.has(token) ? weight : 0),
    0,
  );
}

function tokenize(value: string): readonly string[] {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/u)
        .filter((token) => token.length >= TOKEN_MIN_LENGTH),
    ),
  );
}
