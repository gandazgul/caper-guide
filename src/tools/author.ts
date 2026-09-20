import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  markAdventureReady,
  recordSetupDecision,
  setRuntimeProfile,
  upsertCanonFact,
  upsertEntity,
  upsertScene,
} from "../adventure/authoring.ts";
import type { AdventurePackage } from "../adventure/package.ts";
import { SETUP_TOPICS } from "../adventure/types.ts";
import { validateAdventure } from "../adventure/validation.ts";
import { evidenceSchema, toolResult } from "./common.ts";

const textList = Type.Array(Type.String({ minLength: 1 }), { maxItems: 30 });

export function createAuthorTools(pkg: AdventurePackage): ToolDefinition[] {
  const recordSetup: ToolDefinition<any> = {
    name: "author_record_setup",
    label: "Record Setup Decision",
    description:
      "Persist an author's answer from ask_author. This is durable setup, not a chat summary. Reusing an ID replaces the earlier decision.",
    promptSnippet: "Save an approved author setup decision with source evidence",
    parameters: Type.Object({
      id: Type.Union(SETUP_TOPICS.map((topic) => Type.Literal(topic))),
      question: Type.String({ minLength: 8 }),
      selections: Type.Array(Type.String(), { maxItems: 4 }),
      customAnswers: Type.Array(Type.String(), { maxItems: 4 }),
      rationale: Type.String({ minLength: 8 }),
      citations: evidenceSchema,
    }),
    executionMode: "sequential",
    async execute(_id, params: any) {
      return toolResult(await recordSetupDecision(pkg, params));
    },
  };

  const canon: ToolDefinition<any> = {
    name: "author_upsert_canon",
    label: "Upsert Canon Fact",
    description:
      "Create or replace one source-backed fact the Adventure Guide must preserve. Guide-only facts remain secret until state records their reveal.",
    promptSnippet: "Write a cited canon fact into the durable adventure package",
    parameters: Type.Object({
      id: Type.String({ minLength: 1 }),
      statement: Type.String({ minLength: 4 }),
      visibility: Type.Union([Type.Literal("player"), Type.Literal("guide")]),
      category: Type.Union([
        Type.Literal("premise"),
        Type.Literal("world"),
        Type.Literal("secret"),
        Type.Literal("ending"),
        Type.Literal("constraint"),
      ]),
      citations: evidenceSchema,
    }),
    executionMode: "sequential",
    async execute(_id, params: any) {
      return toolResult(await upsertCanonFact(pkg, params));
    },
  };

  const entity: ToolDefinition<any> = {
    name: "author_upsert_entity",
    label: "Upsert Adventure Entity",
    description:
      "Create or replace a structured location, character, creature, faction, item, or hazard with knowledge and behavior boundaries.",
    promptSnippet: "Write a cited adventure entity with guide constraints",
    parameters: Type.Object({
      id: Type.String({ minLength: 1 }),
      kind: Type.Union([
        Type.Literal("character"),
        Type.Literal("creature"),
        Type.Literal("faction"),
        Type.Literal("location"),
        Type.Literal("item"),
        Type.Literal("hazard"),
      ]),
      name: Type.String({ minLength: 1 }),
      playerSummary: Type.String(),
      guideNotes: Type.String({ minLength: 4 }),
      knowledge: textList,
      constraints: textList,
      citations: evidenceSchema,
    }),
    executionMode: "sequential",
    async execute(_id, params: any) {
      return toolResult(await upsertEntity(pkg, params));
    },
  };

  const scene: ToolDefinition<any> = {
    name: "author_upsert_scene",
    label: "Upsert Scene",
    description:
      "Create or replace a playable scene: what it covers, supported actions, fallbacks, secrets, and transitions.",
    promptSnippet: "Write a cited playable scene into the durable adventure package",
    parameters: Type.Object({
      id: Type.String({ minLength: 1 }),
      name: Type.String({ minLength: 1 }),
      summary: Type.String({ minLength: 4 }),
      locationIds: textList,
      entryConditions: textList,
      supportedActions: textList,
      fallbackActions: textList,
      secretIds: textList,
      transitions: Type.Array(
        Type.Object({ when: Type.String({ minLength: 2 }), targetSceneId: Type.String({ minLength: 1 }) }),
        { maxItems: 20 },
      ),
      citations: evidenceSchema,
    }),
    executionMode: "sequential",
    async execute(_id, params: any) {
      return toolResult(await upsertScene(pkg, params));
    },
  };

  const runtime: ToolDefinition<any> = {
    name: "author_set_runtime",
    label: "Set Runtime Policy",
    description:
      "Persist the complete rules, tone/comfort boundaries, adaptation boundaries, out-of-bounds behavior, and clocks used during play.",
    promptSnippet: "Set the mechanical and facilitation policies for Adventure Guide",
    parameters: Type.Object({
      rules: Type.Object({
        systemName: Type.String({ minLength: 1 }),
        resolution: Type.String({ minLength: 8 }),
        whoRolls: Type.String({ minLength: 4 }),
        citations: evidenceSchema,
      }),
      toneAndSafety: Type.Object({
        tone: Type.String({ minLength: 2 }),
        lines: textList,
        veils: textList,
        contentNotes: textList,
        explanation: Type.String({ minLength: 8 }),
        citations: evidenceSchema,
      }),
      adaptationPolicy: Type.Object({
        preserve: textList,
        mayAdapt: textList,
        explanation: Type.String({ minLength: 8 }),
        citations: evidenceSchema,
      }),
      outOfBoundsPolicy: Type.Object({
        response: Type.String({ minLength: 8 }),
        offerClosestSupportedActions: Type.Boolean(),
        citations: evidenceSchema,
      }),
      clocks: Type.Array(
        Type.Object({
          id: Type.String({ minLength: 1 }),
          name: Type.String({ minLength: 1 }),
          segments: Type.Integer({ minimum: 2, maximum: 24 }),
          advanceWhen: Type.String({ minLength: 4 }),
          effects: textList,
          citations: evidenceSchema,
        }),
        { maxItems: 30 },
      ),
    }),
    executionMode: "sequential",
    async execute(_id, params: any) {
      return toolResult(await setRuntimeProfile(pkg, { schemaVersion: 1, ...params }));
    },
  };

  const validate: ToolDefinition<any> = {
    name: "adventure_validate",
    label: "Validate Adventure",
    description:
      "Mechanically validate citations, required setup, runtime policies, entities, scenes, and transitions.",
    promptSnippet: "Validate the adventure package before declaring it playable",
    parameters: Type.Object({}),
    executionMode: "sequential",
    async execute() {
      const issues = validateAdventure(pkg);
      return toolResult({ valid: !issues.some((issue) => issue.severity === "blocker"), issues });
    },
  };

  const ready: ToolDefinition<any> = {
    name: "adventure_mark_ready",
    label: "Mark Adventure Ready",
    description: "Mark the package playable only when mechanical validation has no blockers.",
    promptSnippet: "Mark a mechanically valid adventure package ready for play",
    parameters: Type.Object({}),
    executionMode: "sequential",
    async execute() {
      await markAdventureReady(pkg);
      return toolResult({ status: pkg.manifest.status });
    },
  };

  return [recordSetup, canon, entity, scene, runtime, validate, ready];
}
