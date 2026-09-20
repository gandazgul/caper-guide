import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadAgentDefinition } from "../agents/loader.ts";
import { runAgentTui } from "../agents/runtime.ts";
import { loadAdventurePackage } from "../adventure/package.ts";
import { loadOrCreateGameState } from "../adventure/state.ts";
import { validateAdventure } from "../adventure/validation.ts";
import { createGuideTools } from "../tools/guide.ts";
import { createGuideMemoryTools } from "../tools/memory.ts";
import { createSourceTools } from "../tools/source.ts";
import type { CommandContext } from "./types.ts";

export async function runGuideCommand(args: string[], context: CommandContext): Promise<void> {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      play: { type: "string", short: "p", default: "default" },
      model: { type: "string", short: "m" },
      continue: { type: "boolean", short: "c", default: false },
      session: { type: "string" },
    },
  });
  if (parsed.values.continue && parsed.values.session) {
    throw new Error("Use either --continue or --session, not both.");
  }
  if (parsed.positionals.length > 1) throw new Error("Guide accepts exactly one adventure directory.");
  const root = parsed.positionals[0] ? resolve(context.cwd, parsed.positionals[0]) : "";
  if (!root) throw new Error("Usage: adventure guide <adventure-directory> [--play table-name]");
  const pkg = await loadAdventurePackage(root);
  const blockers = validateAdventure(pkg).filter((issue) => issue.severity === "blocker");
  if (pkg.manifest.status !== "ready" || blockers.length) {
    throw new Error(
      `This adventure is not ready for play. Open it with the author command to finish setup and mark it ready.${
        blockers.length ? ` ${blockers.length} validation blocker(s) remain.` : ""
      }`,
    );
  }
  const playId = String(parsed.values.play);
  const state = await loadOrCreateGameState(pkg, playId);
  const agent = await loadAgentDefinition("guide", pkg.root);
  const tools = [
    ...createSourceTools(pkg),
    ...createGuideTools(pkg, playId),
    ...createGuideMemoryTools(pkg, playId),
  ];
  await runAgentTui({
    pkg,
    agent,
    tools,
    sessionGroup: joinSession("guide", state.playId),
    resumeArgs: ["guide", pkg.root, "--play", state.playId],
    model: parsed.values.model,
    continueSession: parsed.values.continue,
    sessionId: parsed.values.session,
    welcomeMessage: [
      "Welcome to Adventure Guide.",
      "",
      `Adventure: ${pkg.manifest.title}`,
      `Play session: ${state.playId}`,
      "Tell the Guide what your character says or tries. You do not need to know tabletop terminology.",
    ].join("\n"),
    startupInstruction: `Start or resume play session ${
      JSON.stringify(state.playId)
    }. Inspect the package, runtime policy, current state, and opening/current scene. Welcome the players, explain how to participate in one short paragraph, then begin without revealing private information.`,
  });
}

function joinSession(mode: string, playId: string): string {
  return `${mode}-${playId}`;
}
