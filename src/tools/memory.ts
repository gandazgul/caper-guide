import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { AdventurePackage } from "../adventure/package.ts";
import { safeId } from "../adventure/io.ts";
import { toolResult } from "./common.ts";

const MISSING = "Mnemosyne is not installed or could not be started.";

async function runMnemosyne(cwd: string, args: string[]): Promise<string> {
  try {
    const output = await new Deno.Command("mnemosyne", { cwd, args, stdout: "piped", stderr: "piped" })
      .output();
    const stdout = new TextDecoder().decode(output.stdout).trim();
    const stderr = new TextDecoder().decode(output.stderr).trim();
    if (!output.success) throw new Error(stderr || `mnemosyne exited ${output.code}`);
    return stdout || stderr;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) throw new Error(MISSING);
    throw error;
  }
}

async function ensureCollection(cwd: string, collection: string): Promise<void> {
  await runMnemosyne(cwd, ["init", "--name", collection]);
}

function createMemoryTools(
  pkg: AdventurePackage,
  options: { collection: string; storeDescription: string; tags: string[]; guideMode: boolean },
): ToolDefinition[] {
  const recall: ToolDefinition<any> = {
    name: "memory_recall",
    label: "Memory Recall",
    description: options.guideMode
      ? "Recall soft notes about facilitation style, prior interpretations, and player preferences. Mechanical state is not stored here."
      : "Recall the author's reusable campaign preferences from earlier authoring sessions.",
    promptSnippet: "Recall relevant non-mechanical preferences and soft notes",
    parameters: Type.Object({
      query: Type.String({ minLength: 2 }),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
    }),
    executionMode: "parallel",
    async execute(_id, params: any) {
      try {
        await ensureCollection(pkg.root, options.collection);
        const output = await runMnemosyne(pkg.root, [
          "search",
          "--name",
          options.collection,
          "--format",
          "plain",
          "--limit",
          String(params.limit ?? 5),
          params.query,
        ]);
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
      ? "Store a non-mechanical facilitation note; never HP, inventory, clocks, flags, positions, or revealed clues"
      : "Store a reusable author preference only after the author explicitly asks",
    promptGuidelines: options.guideMode
      ? ["Mechanical facts must go through game_state_update, never memory_store."]
      : [
        "Only store a preference when the author explicitly asks to remember it or confirms your suggestion.",
      ],
    parameters: Type.Object({
      content: Type.String({ minLength: 4, maxLength: 2000 }),
      userAskedToRemember: Type.Literal(true),
      kind: Type.Union([
        Type.Literal("preference"),
        Type.Literal("style"),
        Type.Literal("interpretation"),
        Type.Literal("continuity_note"),
      ]),
    }),
    executionMode: "sequential",
    async execute(_id, params: any) {
      if (params.userAskedToRemember !== true) {
        throw new Error("Memory requires the user's explicit request or confirmation.");
      }
      if (
        options.guideMode &&
        /\b(hp|hit points?|inventory|clock|elapsed turns?|current scene|current location|revealed secret|state flag)\b/i
          .test(params.content)
      ) {
        throw new Error("This looks like mechanical state. Use game_state_update instead of memory_store.");
      }
      await ensureCollection(pkg.root, options.collection);
      const args = ["add", "--name", options.collection];
      for (const tag of [...options.tags, params.kind]) args.push("--tag", tag);
      args.push(params.content);
      const output = await runMnemosyne(pkg.root, args);
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

export function createGuideMemoryTools(pkg: AdventurePackage, playId: string): ToolDefinition[] {
  return createMemoryTools(pkg, {
    collection: safeId(`adventure-${pkg.manifest.id}`),
    storeDescription:
      "Store a soft, non-mechanical note about how to facilitate this adventure. Mechanical state must use game_state_update.",
    tags: ["guide-note", `play-${safeId(playId)}`],
    guideMode: true,
  });
}
