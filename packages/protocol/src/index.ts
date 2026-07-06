import type { KnowledgeEvent } from "@xepha/core";

export interface ContextRequest {
  readonly task: string;
  readonly limit?: number;
}

export interface ContextPack {
  readonly task: string;
  readonly events: readonly KnowledgeEvent[];
  readonly rationale: string;
}

export function createContextPack(
  request: ContextRequest,
  events: readonly KnowledgeEvent[],
): ContextPack {
  const limit = request.limit ?? 8;
  const selectedEvents = events.slice(0, limit);

  return {
    task: request.task,
    events: selectedEvents,
    rationale: `Selected ${selectedEvents.length} knowledge event(s) for the requested task.`,
  };
}
