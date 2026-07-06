import type { KnowledgeEvent } from "@xepha/core";

export type KnowledgeEdgeKind = "supports" | "supersedes" | "relates_to";

export interface KnowledgeEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: KnowledgeEdgeKind;
  readonly reason: string;
}

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
