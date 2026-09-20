import { resolve } from "node:path";
import { listAgentDefinitions } from "../agents/loader.ts";
import type { CommandContext } from "./types.ts";

export async function runAgentsCommand(args: string[], context: CommandContext): Promise<void> {
  const root = args[0] ? resolve(context.cwd, args[0]) : undefined;
  const agents = await listAgentDefinitions(root);
  console.log("Available agents:\n");
  for (const agent of agents) {
    console.log(`  ${agent.id.padEnd(12)} ${agent.displayName} — ${agent.description}`);
    console.log(`               tools: ${agent.tools.join(", ")}`);
    console.log(`               skills: ${agent.skills.map((skill) => skill.name).join(", ") || "none"}`);
    console.log(`               layers: ${agent.sourcePaths.join(" -> ")}`);
  }
}
