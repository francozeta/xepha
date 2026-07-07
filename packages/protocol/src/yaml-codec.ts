import { parseDocument, stringify } from "yaml";
import { contextPackV0Schema, type ContextPackV0 } from "./context-pack.js";

export interface ProtocolIssue {
  readonly code: "yaml_parse_error" | "validation_error";
  readonly message: string;
  readonly path?: string;
}

export type ParseContextPackYamlResult =
  | {
      readonly ok: true;
      readonly data: ContextPackV0;
    }
  | {
      readonly ok: false;
      readonly issues: readonly ProtocolIssue[];
    };

export function stringifyContextPackYaml(pack: ContextPackV0): string {
  return stringify(pack, {
    blockQuote: "literal",
    lineWidth: 0,
    schema: "core",
    version: "1.2",
  });
}

export function parseContextPackYaml(source: string): ParseContextPackYamlResult {
  const document = parseDocument(source, {
    logLevel: "error",
    prettyErrors: true,
    schema: "core",
    strict: true,
    stringKeys: true,
    uniqueKeys: true,
    version: "1.2",
  });

  if (document.errors.length > 0) {
    return {
      ok: false,
      issues: document.errors.map((error) => ({
        code: "yaml_parse_error",
        message: `YAML parse error: bad indentation or syntax. ${error.message}`,
      })),
    };
  }

  const validation = contextPackV0Schema.safeParse(
    document.toJS({
      maxAliasCount: 20,
    }),
  );

  if (!validation.success) {
    return {
      ok: false,
      issues: validation.error.issues.map((issue) => ({
        code: "validation_error",
        message: issue.message,
        path: issue.path.length === 0 ? undefined : issue.path.join("."),
      })),
    };
  }

  return {
    ok: true,
    data: validation.data,
  };
}
