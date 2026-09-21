import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { AdventurePackage } from "../adventure/package.ts";
import { safeId } from "../adventure/io.ts";
import { toolResult } from "./common.ts";
import { loadOrCreateGameState } from "../adventure/state.ts";
import { assertCharacterId, characterDirectory, readCharacter } from "../adventure/characters.ts";

const MISSING = "Mnemoteca is not installed or could not be started.";

export async function runMnemoteca(cwd: string, args: string[]): Promise<string> {
  try {
    const output = await new Deno.Command("mnemoteca", {
      cwd,
      args,
      stdout: "piped",
      stderr: "piped",
      signal: AbortSignal.timeout(30_000),
    })
      .output();
    const stdout = new TextDecoder().decode(output.stdout).trim();
    const stderr = new TextDecoder().decode(output.stderr).trim();
    if (!output.success) throw new Error(stderr || `mnemoteca exited ${output.code}`);
    return stdout || stderr;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) throw new Error(MISSING);
    throw error;
  }
}

export type MemoryRunner = typeof runMnemoteca;

function createMemoryTools(
  pkg: AdventurePackage,
  options: {
    collection: string;
    storeDescription: string;
    tags: string[];
    guideMode: boolean;
    recallTags?: string[];
    allowCrossAdventureRecall?: boolean;
    playId?: string;
  },
  run: MemoryRunner = runMnemoteca,
): ToolDefinition[] {
  const recall: ToolDefinition<any> = {
    name: "memory_recall",
    label: "Memory Recall",
    description: options.guideMode
      ? "Recall established non-mechanical events, conversations, observations, rulings and continuity. Use on resume and before revisiting relevant situations. State remains authoritative."
      : "Recall the author's reusable campaign preferences from earlier authoring sessions.",
    promptSnippet: "Recall relevant non-mechanical preferences and soft notes",
    parameters: Type.Object({
      query: Type.String({ minLength: 2 }),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
      ...(options.allowCrossAdventureRecall
        ? {
          scope: Type.Optional(Type.Union([Type.Literal("current_play"), Type.Literal("all_adventures")])),
        }
        : {}),
    }),
    executionMode: "parallel",
    async execute(_id, params: any) {
      try {
        await run(pkg.root, ["init", "--name", options.collection]);
        const args = [
          "search",
          "--name",
          options.collection,
          "--format",
          "plain",
          "--limit",
          String(params.limit ?? 5),
        ];
        const tags = options.allowCrossAdventureRecall && params.scope === "all_adventures"
          ? []
          : options.recallTags ?? [];
        for (const tag of tags) args.push("--tag", tag);
        args.push(params.query);
        const output = await run(pkg.root, args);
        return toolResult(
          { collection: options.collection, query: params.query, output },
          output || "No memories found.",
        );
      } catch (error) {
        return toolResult(
          { available: false, error: error instanceof Error ? error.message : String(error) },
          "Optional memory is unavailable. Continue using the adventure assets and current answers; do not repeatedly retry memory.",
        );
      }
    },
  };

  const store: ToolDefinition<any> = {
    name: "memory_store",
    label: "Memory Store",
    description: options.storeDescription,
    promptSnippet: options.guideMode
      ? "Automatically remember established non-mechanical continuity and player-known experiences; no per-note permission needed"
      : "Store a reusable author preference only after the author explicitly asks",
    promptGuidelines: options.guideMode
      ? [
        "Save meaningful established developments automatically, without asking the player to say remember this.",
        "Separate witnessed facts, NPC claims, PC beliefs and unanswered questions. Never import hidden source knowledge.",
        "State changes and reveal permissions require game_state_update; memory only describes the experience.",
      ]
      : [
        "Only store a preference when the author explicitly asks to remember it or confirms your suggestion.",
      ],
    parameters: Type.Object({
      content: Type.String({ minLength: 4, maxLength: 2000 }),
      // Accept the old field for resumed sessions, but do not require it for gameplay memory.
      userAskedToRemember: options.guideMode ? Type.Optional(Type.Boolean()) : Type.Literal(true),
      kind: Type.Union([
        Type.Literal("preference"),
        Type.Literal("style"),
        Type.Literal("interpretation"),
        Type.Literal("continuity_note"),
        ...(options.guideMode
          ? [
            Type.Literal("experience"),
            Type.Literal("observation"),
            Type.Literal("belief"),
            Type.Literal("unresolved_question"),
            Type.Literal("conversation"),
            Type.Literal("relationship"),
            Type.Literal("appearance"),
            Type.Literal("recap"),
          ]
          : []),
      ]),
    }),
    executionMode: "sequential",
    async execute(_id, params: any) {
      if (!options.guideMode && params.userAskedToRemember !== true) {
        throw new Error("Memory requires the user's explicit request or confirmation.");
      }
      if (
        options.guideMode &&
        /\b(hp|hit points?|inventory|clock value|clock segments?|elapsed turns?|current scene|current location|revealed secret|state flag)\b/i
          .test(params.content)
      ) {
        throw new Error("This looks like mechanical state. Use game_state_update instead of memory_store.");
      }
      await run(pkg.root, ["init", "--name", options.collection]);
      const args = ["add", "--name", options.collection];
      for (const tag of [...options.tags, params.kind]) args.push("--tag", tag);
      const content = options.guideMode
        ? `[Adventure: ${pkg.manifest.id}; play: ${options.playId}; recorded: ${
          new Date().toISOString()
        }; kind: ${params.kind}]\n${params.content}`
        : params.content;
      args.push(content);
      const output = await run(pkg.root, args);
      return toolResult({ collection: options.collection, stored: params.content, output }, output);
    },
  };

  return [recall, store];
}

export function createAuthorMemoryTools(pkg: AdventurePackage): ToolDefinition[] {
  return createMemoryTools(pkg, {
    collection: "adventure-runner-author",
    storeDescription:
      "Store a reusable campaign-authoring preference only when the author explicitly asks you to remember it. Do not store ordinary answers automatically.",
    tags: ["author-preference"],
    guideMode: false,
  });
}

export function createGuideMemoryTools(
  pkg: AdventurePackage,
  playId: string,
  run: MemoryRunner = runMnemoteca,
): ToolDefinition[] {
  return createMemoryTools(pkg, {
    collection: safeId(`adventure-${pkg.manifest.id}`),
    storeDescription:
      "Automatically save established game continuity, NPC interactions, table rulings and facilitation details after meaningful developments. No separate permission needed. Not new canon, hidden answers, or mechanical state.",
    tags: ["guide-note", `play-${safeId(playId)}`],
    guideMode: true,
    playId: safeId(playId),
    recallTags: [`play-${safeId(playId)}`],
  }, run);
}

export function characterMemoryCollection(id: string): string {
  assertCharacterId(id);
  return `caper-character-${id}`;
}

export function createCharacterMemoryTools(
  pkg: AdventurePackage,
  playId: string,
  directory = characterDirectory(),
  run: MemoryRunner = runMnemoteca,
): ToolDefinition[] {
  const options = {
    collection: "unselected-character",
    tags: ["character-experience", `adventure-${safeId(pkg.manifest.id)}`, `play-${safeId(playId)}`],
    guideMode: true,
    playId: safeId(playId),
    recallTags: [`adventure-${safeId(pkg.manifest.id)}`, `play-${safeId(playId)}`],
    allowCrossAdventureRecall: true,
    storeDescription:
      "Automatically remember what the selected PC experienced, observed, learned, said, promised, believes or still wonders about, including visible appearance changes. No separate request needed. Distinguish facts from claims and beliefs; never save hidden GM answers or mechanical totals.",
  };
  return createMemoryTools(pkg, options, run).map((tool, index) => ({
    ...tool,
    name: index === 0 ? "character_memory_recall" : "character_memory_store",
    label: index === 0 ? "Recall Character Experiences" : "Remember Character Experience",
    description: index === 0
      ? "Recall the selected PC's experiences, knowledge, conversations, appearance and open questions. Defaults to current_play; use all_adventures only for relevant prior personal history, never as knowledge of this world's secrets."
      : options.storeDescription,
    async execute(id, params, signal, update, ctx) {
      const state = await loadOrCreateGameState(pkg, playId);
      if (!state.playerCharacterId) {
        throw new Error("Select a character before accessing character memories.");
      }
      await readCharacter(state.playerCharacterId, directory);
      const scoped = createMemoryTools(
        pkg,
        { ...options, collection: characterMemoryCollection(state.playerCharacterId) },
        run,
      )[index];
      return await scoped.execute(id, params, signal, update, ctx);
    },
  }));
}
