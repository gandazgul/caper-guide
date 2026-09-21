import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadAgentDefinition } from "../agents/loader.ts";
import { runAgentTui } from "../agents/runtime.ts";
import { loadAdventurePackage } from "../adventure/package.ts";
import { loadOrCreateGameState } from "../adventure/state.ts";
import { validateAdventure } from "../adventure/validation.ts";
import { createGuideTools } from "../tools/guide.ts";
import { createCharacterMemoryTools, createGuideMemoryTools } from "../tools/memory.ts";
import { createCharacterTools } from "../tools/characters.ts";
import { createRecordRollOutcomeTool, createRollDiceTool, createRollHistoryTool } from "../tools/dice.ts";
import { createSourceTools } from "../tools/source.ts";
import type { CommandContext } from "./types.ts";

export async function runGuideCommand(
  args: string[],
  context: CommandContext,
  dependencies: { runTui?: typeof runAgentTui } = {},
): Promise<void> {
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
    createRollDiceTool(pkg, playId),
    createRecordRollOutcomeTool(pkg, playId),
    createRollHistoryTool(pkg, playId),
    ...createSourceTools(pkg),
    ...createGuideTools(pkg, playId),
    ...createGuideMemoryTools(pkg, playId),
    ...createCharacterTools(pkg, playId),
    ...createCharacterMemoryTools(pkg, playId),
  ];
  await (dependencies.runTui ?? runAgentTui)({
    pkg,
    agent,
    tools,
    sessionGroup: joinSession("guide", state.playId),
    resumeArgs: ["guide", pkg.root, "--play", state.playId],
    model: parsed.values.model,
    continueSession: parsed.values.continue,
    sessionId: parsed.values.session,
    resumeInstruction:
      "Resume this adventure without advancing time, replaying actions or rolling dice. Read game_state_read, character_read, relevant character_memory_recall and memory_recall notes for this play, and player-visible details of the saved location. If character setup is incomplete, help with that first. Otherwise proactively give one short, spoiler-safe 'Previously on…' paragraph: the PC's established experiences and conversations, latest known visible appearance/condition, and actual location from structured state. Distinguish beliefs from facts; do not invent missing details or repeat earlier accidental spoilers. End at the saved moment and ask what the player does next. If memory is unavailable, use visible chat history and state and acknowledge important gaps. Do not replay a pending action; recover any unresolved dice from roll_history.",
    welcomeMessage: [
      "Welcome to Adventure Guide.",
      "",
      `Adventure: ${pkg.manifest.title}`,
      `Play session: ${state.playId}`,
      state.characterSetupComplete
        ? "Your character and play state are saved. We will recap before continuing."
        : "New to tabletop games or don't have a character? I'll help you make one, or choose a saved character, before we begin.",
      "You can answer in ordinary language; you do not need rules knowledge or a prepared character sheet.",
    ].join("\n"),
    startupInstruction: `Start or resume play session ${
      JSON.stringify(state.playId)
    }. Read game_state_read and the package's setup/runtime policy first. If character setup is incomplete, do not begin the opening scene: warmly offer beginner-friendly help, use character_list, and offer to create a character or load an existing one. If a character is already selected, use character_read and finish only missing setup. Once setup is complete, read the character and both character_memory_recall and memory_recall. For a played adventure, offer a short 'Previously on…' paragraph from established events, latest known appearance and saved location without advancing time or revealing private information, then ask what the player does next. For a genuinely new adventure, begin without inventing a past recap.`,
  });
}

function joinSession(mode: string, playId: string): string {
  return `${mode}-${playId}`;
}
