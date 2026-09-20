import { Type } from "typebox";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { EvidenceRef } from "../adventure/types.ts";

export const evidenceSchema = Type.Array(
  Type.Object({
    sourceId: Type.String({ minLength: 1 }),
    page: Type.Integer({ minimum: 1 }),
  }),
  { minItems: 1, maxItems: 12 },
);

export function toolResult(details: unknown, text?: string): AgentToolResult<unknown> {
  return {
    content: [{ type: "text", text: text ?? JSON.stringify(details, null, 2) }],
    details,
  };
}

export function formatEvidence(citations: EvidenceRef[]): string {
  return citations.map((citation) => `${citation.sourceId} p.${citation.page}`).join(", ");
}
