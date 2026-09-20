import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { applyStateTransaction, loadOrCreateGameState } from "../adventure/state.ts";
import type { AdventurePackage } from "../adventure/package.ts";
import { toolResult } from "./common.ts";

const stateChangeSchema = Type.Union([
  Type.Object({ kind: Type.Literal("set_current_scene"), sceneId: Type.String() }),
  Type.Object({ kind: Type.Literal("advance_turns"), amount: Type.Integer({ minimum: 1 }) }),
  Type.Object({
    kind: Type.Literal("set_flag"),
    key: Type.String(),
    value: Type.Union([Type.Boolean(), Type.String(), Type.Number()]),
  }),
  Type.Object({
    kind: Type.Literal("set_clock"),
    clockId: Type.String(),
    value: Type.Integer({ minimum: 0 }),
  }),
  Type.Object({ kind: Type.Literal("reveal_secret"), secretId: Type.String() }),
  Type.Object({
    kind: Type.Literal("set_actor_location"),
    actorId: Type.String(),
    locationId: Type.String(),
  }),
  Type.Object({
    kind: Type.Literal("adjust_resource"),
    ownerId: Type.String(),
    resource: Type.String(),
    delta: Type.Integer(),
  }),
  Type.Object({
    kind: Type.Literal("inventory_add"),
    itemId: Type.String(),
    amount: Type.Integer({ minimum: 1 }),
  }),
  Type.Object({
    kind: Type.Literal("inventory_remove"),
    itemId: Type.String(),
    amount: Type.Integer({ minimum: 1 }),
  }),
]);

export function createGuideTools(pkg: AdventurePackage, playId: string): ToolDefinition[] {
  const readAdventure = createAdventureReadTool(pkg);

  const stateRead: ToolDefinition<any> = {
    name: "game_state_read",
    label: "Game State Read",
    description:
      "Read the authoritative mechanical state and its current revision before narrating consequences.",
    promptSnippet: "Read current scene, turns, clocks, secrets, actor locations, resources, and inventory",
    parameters: Type.Object({}),
    executionMode: "sequential",
    async execute() {
      return toolResult(await loadOrCreateGameState(pkg, playId));
    },
  };

  const stateUpdate: ToolDefinition<any> = {
    name: "game_state_update",
    label: "Game State Update",
    description:
      "Atomically update mechanical play state. Requires the last-read revision, validates domain constraints, and appends an audit event.",
    promptSnippet: "Transactionally update mechanical state with revision checking and an audit log",
    promptGuidelines: [
      "Use game_state_update for every change to scenes, turns, flags, clocks, revealed secrets, actor positions, resources, or inventory.",
      "Never use memory_store for mechanical state.",
    ],
    parameters: Type.Object({
      expectedRevision: Type.Integer({ minimum: 0 }),
      reason: Type.String({ minLength: 4 }),
      changes: Type.Array(stateChangeSchema, { minItems: 1, maxItems: 20 }),
    }),
    executionMode: "sequential",
    async execute(_id, params: any) {
      return toolResult(
        await applyStateTransaction(pkg, playId, params.expectedRevision, params.reason, params.changes),
      );
    },
  };

  return [readAdventure, stateRead, stateUpdate];
}

export function createAdventureReadTool(pkg: AdventurePackage): ToolDefinition<any> {
  return {
    name: "adventure_read",
    label: "Adventure Read",
    description:
      "Read authored assets. Player-facing narration must respect visibility, secret reveal state, and entity knowledge boundaries.",
    promptSnippet: "Read structured canon, entities, scenes, setup, or runtime policy",
    parameters: Type.Object({
      section: Type.Union([
        Type.Literal("setup"),
        Type.Literal("canon"),
        Type.Literal("entities"),
        Type.Literal("scenes"),
        Type.Literal("runtime"),
      ]),
      id: Type.Optional(Type.String()),
    }),
    executionMode: "parallel",
    async execute(_id, params: any) {
      const section = pkg.assets[params.section as keyof typeof pkg.assets] as any;
      if (!params.id) return toolResult(section);
      const records = section.decisions ?? section.facts ?? section.entities ?? section.scenes ??
        section.clocks ?? [];
      const record = records.find((candidate: { id: string }) => candidate.id === params.id);
      if (!record) throw new Error(`No ${params.section} record ${params.id}.`);
      return toolResult(record);
    },
  };
}
