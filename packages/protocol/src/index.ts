import type { KnowledgeEvent } from "@xepha/core";
export {
  CONTEXT_PACK_VERSION,
  contextPackEventSchema,
  contextPackSourceSchema,
  contextPackV0JsonSchema,
  contextPackV0Schema,
  createContextPackV0,
} from "./context-pack.js";
export type {
  ContextPackEvent,
  ContextPackSource,
  ContextPackV0,
  CreateContextPackV0Input,
} from "./context-pack.js";
export { parseContextPackYaml, stringifyContextPackYaml } from "./yaml-codec.js";
export type { ParseContextPackYamlResult, ProtocolIssue } from "./yaml-codec.js";

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
