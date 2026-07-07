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

export interface RankedKnowledgeEvent {
  readonly event: KnowledgeEvent;
  readonly reasons: readonly string[];
  readonly score: number;
}

interface EventScore {
  readonly event: KnowledgeEvent;
  readonly matched: boolean;
  readonly reasons: readonly string[];
  readonly relationBoost: number;
  readonly textScore: number;
}

interface RelationBoost {
  readonly reasons: readonly string[];
  readonly score: number;
}

interface ScoreBreakdown {
  readonly reasons: readonly string[];
  readonly score: number;
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
  return explainRankedEventsForTask(input).map((score) => score.event);
}

export function explainRankedEventsForTask(
  input: RankEventsForTaskInput,
): readonly RankedKnowledgeEvent[] {
  const taskTokens = tokenize(input.task);
  const baseScores = input.events.map((event) => scoreEvent(event, taskTokens));
  const directlyMatchedIds = new Set(
    baseScores.filter((score) => score.matched).map((score) => score.event.id),
  );
  const relationBoosts = getRelationBoosts(input.relations ?? [], directlyMatchedIds);
  const scoredEvents = baseScores.map((score) => {
    const relationBoost = relationBoosts.get(score.event.id);
    const reasons = [...score.reasons, ...(relationBoost?.reasons ?? [])];

    return {
      ...score,
      reasons: reasons.length > 0 ? reasons : ["recency fallback"],
      relationBoost: relationBoost?.score ?? 0,
    };
  });

  return [...scoredEvents]
    .sort((left, right) => compareScores(left, right))
    .map((score) => ({
      event: score.event,
      reasons: score.reasons,
      score: score.textScore + score.relationBoost,
    }));
}

function scoreEvent(event: KnowledgeEvent, taskTokens: readonly string[]): EventScore {
  const tagScore = scoreTags(event.tags, taskTokens);
  const titleScore = scoreText("title", event.title, taskTokens, TITLE_MATCH_WEIGHT);
  const summaryScore = scoreText(
    "summary",
    event.summary,
    taskTokens,
    SUMMARY_MATCH_WEIGHT,
  );
  const textScore = tagScore.score + titleScore.score + summaryScore.score;

  return {
    event,
    matched: textScore > 0,
    reasons: [...tagScore.reasons, ...titleScore.reasons, ...summaryScore.reasons],
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
): Map<string, RelationBoost> {
  const boosts = new Map<string, RelationBoost>();

  for (const relation of relations) {
    if (directlyMatchedIds.has(relation.from) && !directlyMatchedIds.has(relation.to)) {
      addRelationBoost(boosts, relation.to, relation.from, relation);
    }

    if (directlyMatchedIds.has(relation.to) && !directlyMatchedIds.has(relation.from)) {
      addRelationBoost(boosts, relation.from, relation.to, relation);
    }
  }

  return boosts;
}

function addRelationBoost(
  boosts: Map<string, RelationBoost>,
  targetEventId: string,
  matchedEventId: string,
  relation: KnowledgeEdge,
): void {
  const reason = `related to matched event ${matchedEventId}: ${relation.reason}`;
  const existing = boosts.get(targetEventId);

  boosts.set(targetEventId, {
    reasons: existing ? [...existing.reasons, reason] : [reason],
    score: Math.max(existing?.score ?? 0, RELATION_BOOST_WEIGHT),
  });
}

function scoreTags(
  tags: readonly string[],
  taskTokens: readonly string[],
): ScoreBreakdown {
  const normalizedTags = tags.flatMap((tag) => tokenize(tag));
  const tagSet = new Set(normalizedTags);

  return scoreTokenMatches("tag", tagSet, taskTokens, TAG_MATCH_WEIGHT);
}

function scoreText(
  label: "summary" | "title",
  text: string,
  taskTokens: readonly string[],
  weight: number,
): ScoreBreakdown {
  const textTokens = new Set(tokenize(text));

  return scoreTokenMatches(label, textTokens, taskTokens, weight);
}

function scoreTokenMatches(
  label: "summary" | "tag" | "title",
  sourceTokens: ReadonlySet<string>,
  taskTokens: readonly string[],
  weight: number,
): ScoreBreakdown {
  let score = 0;
  const reasons: string[] = [];

  for (const token of taskTokens) {
    if (!sourceTokens.has(token)) {
      continue;
    }

    score += weight;
    reasons.push(`matched ${label}: ${token}`);
  }

  return { reasons, score };
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
