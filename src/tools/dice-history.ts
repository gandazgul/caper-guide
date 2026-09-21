import { join } from "node:path";
import type { AdventurePackage } from "../adventure/package.ts";
import { pathExists, playRoot, readJson, writeJsonAtomic } from "../adventure/io.ts";
import { loadOrCreateGameState } from "../adventure/state.ts";
import { type DiceRequest, rollDice } from "./dice.ts";

export type RollOutcome = "failure" | "success" | "super_success";
const OUTCOMES = ["failure", "success", "super_success"];
export const UNLUCKY_PROTECTION_PERCENT = 80;
export type PcRollResult =
  | (ReturnType<typeof rollDice> & { rollId: string; needsOutcome: true; unluckyProtection: false })
  | {
    rollId: string;
    needsOutcome: false;
    unluckyProtection: true;
    outcome: "success";
    reason: "unlucky_protection";
    instruction: string;
  };
interface HistoryEntry {
  callId: string;
  characterId: string;
  request: string;
  rolledAt: string;
  result: PcRollResult;
  outcome?: RollOutcome;
  outcomeReason?: string;
}

async function withHistory<T>(
  pkg: AdventurePackage,
  playId: string,
  action: (history: HistoryEntry[], characterId: string) => { value: T; changed: boolean },
): Promise<T> {
  const state = await loadOrCreateGameState(pkg, playId);
  if (!state.playerCharacterId) throw new Error("Select the PC before rolling a player check.");
  const root = playRoot(pkg.root, playId);
  const path = join(root, "dice-history.json");
  using lock = await Deno.open(join(root, ".dice.lock"), { create: true, write: true });
  await lock.lock(true);
  try {
    const history = await pathExists(path) ? await readJson<HistoryEntry[]>(path) : [];
    if (
      !Array.isArray(history) || history.length > 20 ||
      history.some((entry) =>
        !entry || typeof entry.callId !== "string" || typeof entry.characterId !== "string" ||
        !entry.result || entry.result.rollId !== entry.callId ||
        (entry.outcome !== undefined && !OUTCOMES.includes(entry.outcome))
      )
    ) throw new Error("Invalid dice history; refusing to reset the PC's streak.");
    const { value, changed } = action(history, state.playerCharacterId);
    if (changed) await writeJsonAtomic(path, history.slice(-20));
    return value;
  } finally {
    await lock.unlock();
  }
}

export async function executePcRoll(
  pkg: AdventurePackage,
  playId: string,
  callId: string,
  dice: DiceRequest[],
  randomUint32?: () => number,
): Promise<PcRollResult> {
  if (!callId) throw new Error("A PC roll needs a unique tool call ID.");
  // Validate even if protection returns a narrative outcome instead of numbers.
  rollDice(dice, () => 0);
  return await withHistory(pkg, playId, (history, characterId) => {
    const request = JSON.stringify(dice);
    const previous = history.find((entry) => entry.callId === callId);
    if (previous) {
      if (previous.request !== request || previous.characterId !== characterId) {
        throw new Error("A recorded roll call cannot be reused with different parameters.");
      }
      return { value: previous.result, changed: false };
    }
    const recent = history.filter((entry) => entry.characterId === characterId);
    const pending = recent.find((entry) => entry.outcome === undefined);
    if (pending) {
      throw new Error(
        `Record the outcome of PC roll ${pending.callId} with record_roll_outcome before another PC check.`,
      );
    }
    const eligible = recent.length >= 2 && recent.slice(-2).every((entry) => entry.outcome === "failure");
    const protectedSuccess = eligible &&
      rollDice([{ faces: 100, count: 1 }], randomUint32).total <= UNLUCKY_PROTECTION_PERCENT;
    const result: PcRollResult = protectedSuccess
      ? {
        rollId: callId,
        needsOutcome: false,
        unluckyProtection: true,
        outcome: "success",
        reason: "unlucky_protection",
        instruction:
          "Bad-luck protection grants an ordinary success for this PC check. Interpret it under the adventure's rules. Do not invent dice values or upgrade it to a critical/super success. Apply mechanical consequences with game_state_update.",
      }
      : { ...rollDice(dice, randomUint32), rollId: callId, needsOutcome: true, unluckyProtection: false };
    history.push({
      callId,
      characterId,
      request,
      rolledAt: new Date().toISOString(),
      result,
      ...(protectedSuccess ? { outcome: "success" as const, outcomeReason: "unlucky_protection" } : {}),
    });
    return { value: result, changed: true };
  });
}

export async function recordPcOutcome(
  pkg: AdventurePackage,
  playId: string,
  rollId: string,
  outcome: RollOutcome,
  reason: string,
): Promise<{ rollId: string; outcome: RollOutcome; reason: string }> {
  if (
    !OUTCOMES.includes(outcome) || typeof reason !== "string" || reason.trim().length < 4 ||
    reason.length > 1000
  ) {
    throw new Error("Record failure, success, or super_success with a brief rules-based explanation.");
  }
  return await withHistory(pkg, playId, (history, characterId) => {
    const entry = history.find((entry) => entry.callId === rollId && entry.characterId === characterId);
    if (!entry) throw new Error("No recent PC roll with that ID exists in this play.");
    if (entry.outcome !== undefined && entry.outcome !== outcome) {
      throw new Error(
        "A recorded outcome cannot be rewritten; protected success cannot become super_success.",
      );
    }
    const changed = entry.outcome === undefined;
    if (changed) {
      entry.outcome = outcome;
      entry.outcomeReason = reason.trim();
    }
    return { value: { rollId, outcome: entry.outcome!, reason: entry.outcomeReason! }, changed };
  });
}

export async function readPcRollHistory(pkg: AdventurePackage, playId: string) {
  return await withHistory(pkg, playId, (history, characterId) => ({
    value: history.filter((entry) => entry.characterId === characterId),
    changed: false,
  }));
}
