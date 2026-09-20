import type { AgentSkill } from "./skills.ts";

export interface AgentDefinition {
  id: string;
  displayName: string;
  description: string;
  model?: string;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  temperature?: number;
  tools: string[];
  skills: AgentSkill[];
  systemPrompt: string;
  sourcePaths: string[];
}
