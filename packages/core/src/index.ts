export const XEPHA_PROJECT = {
  name: "Xepha",
  summary:
    "A local-first intelligence layer for software project continuity and AI-native development.",
  version: "0.3.0", // x-release-please-version
} as const;

export type KnowledgeEventKind =
  | "decision"
  | "commit"
  | "discussion"
  | "issue"
  | "pull_request"
  | "deployment"
  | "test"
  | "architecture"
  | "benchmark";

export interface EvidenceRef {
  readonly label: string;
  readonly uri: string;
}

export interface KnowledgeEvent {
  readonly id: string;
  readonly kind: KnowledgeEventKind;
  readonly title: string;
  readonly summary: string;
  readonly occurredAt: string;
  readonly tags: readonly string[];
  readonly evidence: readonly EvidenceRef[];
}

export function defineKnowledgeEvent(
  event: Omit<KnowledgeEvent, "tags" | "evidence"> &
    Partial<Pick<KnowledgeEvent, "tags" | "evidence">>,
): KnowledgeEvent {
  return {
    ...event,
    tags: event.tags ?? [],
    evidence: event.evidence ?? [],
  };
}
