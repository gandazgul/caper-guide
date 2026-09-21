import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { toolResult } from "./common.ts";
import type { AdventurePackage } from "../adventure/package.ts";
import { executePcRoll, readPcRollHistory, recordPcOutcome, type RollOutcome } from "./dice-history.ts";

const UINT32_RANGE = 2 ** 32;
const MAX_DICE = 1000;
const MAX_FACES = 1_000_000;

export interface DiceRequest {
  faces: number;
  count: number;
}

function secureUint32(): number {
  // Web Crypto is seeded by the runtime, not with a predictable application timestamp.
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

export function rollDice(dice: unknown, randomUint32: () => number = secureUint32) {
  if (!Array.isArray(dice) || dice.length < 1 || dice.length > 100) {
    throw new Error("Supply between 1 and 100 dice groups with faces and count.");
  }
  const counts = new Map<number, number>();
  let count = 0;
  // Validate the entire request before consuming any randomness.
  for (const group of dice) {
    if (
      !group || typeof group !== "object" || Array.isArray(group) ||
      Object.keys(group).some((key) => key !== "faces" && key !== "count") ||
      !Number.isSafeInteger(group.faces) || group.faces < 1 || group.faces > MAX_FACES ||
      !Number.isSafeInteger(group.count) || group.count < 1 || group.count > MAX_DICE
    ) {
      throw new Error(`Each group needs integer faces (1–${MAX_FACES}) and count (1–${MAX_DICE}).`);
    }
    count += group.count;
    if (count > MAX_DICE) throw new Error(`Roll at most ${MAX_DICE} dice per call.`);
    counts.set(group.faces, (counts.get(group.faces) ?? 0) + group.count);
  }
  const rolls: Record<string, number[]> = {};
  const totals: Record<string, number> = {};
  let total = 0;
  for (const [faces, count] of counts) {
    const notation = `${count}d${faces}`;
    const values: number[] = [];
    // Reject the incomplete upper bucket before taking modulo, avoiding modulo bias.
    const limit = UINT32_RANGE - (UINT32_RANGE % faces);
    for (let i = 0; i < count; i++) {
      let word: number;
      do {
        word = randomUint32();
        if (!Number.isInteger(word) || word < 0 || word >= UINT32_RANGE) {
          throw new Error("Random source did not return an unsigned 32-bit integer.");
        }
      } while (word >= limit);
      values.push((word % faces) + 1);
    }
    rolls[notation] = values;
    totals[notation] = values.reduce((sum, value) => sum + value, 0);
    total += totals[notation];
  }
  return { rolls, totals, total };
}

export function createRollDiceTool(pkg?: AdventurePackage, playId?: string): ToolDefinition {
  return {
    name: "roll_dice",
    label: "Roll Dice",
    description:
      "Roll dice using cryptographic randomness. Supply dice: [{faces: 6, count: 2}]. Returns rolls by notation, totals per type and raw total; duplicate face types merge. Set pcCheck:true ONLY for PC pass/fail checks, not damage/NPCs/tables. PC checks persist history: after two failures an 80% protection chance returns ordinary success with no dice numbers. Normal PC results require record_roll_outcome using the adventure rules. Consequences still need game_state_update.",
    promptSnippet: "Use for every Guide-generated player or NPC dice roll; never invent random outcomes",
    promptGuidelines: [
      "Choose the dice from the authored rules before calling; respect who rolls and the player's choice to roll physically.",
      "Report the returned values and raw totals faithfully; never silently reroll an unfavorable result.",
      "Apply resulting mechanical consequences separately with game_state_update.",
    ],
    parameters: Type.Object({
      dice: Type.Array(
        Type.Object({
          faces: Type.Integer({ minimum: 1, maximum: MAX_FACES }),
          count: Type.Integer({ minimum: 1, maximum: MAX_DICE }),
        }, { additionalProperties: false }),
        { minItems: 1, maxItems: 100 },
      ),
      pcCheck: Type.Optional(Type.Boolean()),
    }, { additionalProperties: false }),
    executionMode: "sequential",
    async execute(id, params: { dice: DiceRequest[]; pcCheck?: boolean }) {
      if (params.pcCheck !== undefined && typeof params.pcCheck !== "boolean") {
        throw new Error("pcCheck must be a boolean.");
      }
      if (params.pcCheck === true) {
        if (!pkg || !playId) throw new Error("PC checks require an active adventure play session.");
        return toolResult(await executePcRoll(pkg, playId, id, params.dice));
      }
      return toolResult(rollDice(params.dice));
    },
  };
}

export function createRecordRollOutcomeTool(pkg: AdventurePackage, playId: string): ToolDefinition {
  return {
    name: "record_roll_outcome",
    label: "Record PC Roll Outcome",
    description:
      "Record the rules-based outcome of a pending PC roll: failure, success, or super_success. Use the rollId from roll_dice and explain the relevant rule/target. Required before the next PC check; never relabel outcomes to manipulate protection. Protected success is already recorded and cannot be upgraded. This records streak history, not HP or other consequences.",
    parameters: Type.Object({
      rollId: Type.String({ minLength: 1 }),
      outcome: Type.Union([Type.Literal("failure"), Type.Literal("success"), Type.Literal("super_success")]),
      reason: Type.String({ minLength: 4, maxLength: 1000 }),
    }, { additionalProperties: false }),
    executionMode: "sequential",
    async execute(_id, params: { rollId: string; outcome: RollOutcome; reason: string }) {
      return toolResult(await recordPcOutcome(pkg, playId, params.rollId, params.outcome, params.reason));
    },
  };
}

export function createRollHistoryTool(pkg: AdventurePackage, playId: string): ToolDefinition {
  return {
    name: "roll_history",
    label: "PC Roll History",
    description:
      "Read the selected PC's last 20 tool-rolled checks in this play, including any pending outcome. Use on resume; resolve pending rolls from their saved values instead of rolling again.",
    parameters: Type.Object({}),
    executionMode: "sequential",
    async execute() {
      return toolResult(await readPcRollHistory(pkg, playId));
    },
  };
}
