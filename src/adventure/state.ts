import { join } from "node:path";
import { pathExists, playRoot, readJson, safeId, writeJsonAtomic, writeTextAtomic } from "./io.ts";
import type { AdventurePackage } from "./package.ts";
import type { GameState, StateChange, StateEvent } from "./types.ts";

function now(): string {
  return new Date().toISOString();
}

function statePath(pkg: AdventurePackage, playId: string): string {
  return join(playRoot(pkg.root, playId), "state.json");
}

function eventsPath(pkg: AdventurePackage, playId: string): string {
  return join(playRoot(pkg.root, playId), "events.jsonl");
}

export async function loadOrCreateGameState(pkg: AdventurePackage, playInput: string): Promise<GameState> {
  return await withPlayLock(pkg, playInput, async () => {
    await recoverTransaction(pkg, safeId(playInput));
    return await loadState(pkg, playInput);
  });
}

async function withPlayLock<T>(
  pkg: AdventurePackage,
  playInput: string,
  action: () => Promise<T>,
): Promise<T> {
  const root = playRoot(pkg.root, playInput);
  await Deno.mkdir(root, { recursive: true });
  using lock = await Deno.open(join(root, ".state.lock"), { create: true, write: true });
  // An OS lock is released if the process exits; there is no stale lock directory to delete.
  await lock.lock(true);
  try {
    return await action();
  } finally {
    await lock.unlock();
  }
}

interface PendingTransaction {
  state: GameState;
  event: StateEvent;
}

async function recoverTransaction(pkg: AdventurePackage, playId: string): Promise<void> {
  const pendingPath = join(playRoot(pkg.root, playId), ".pending-transaction.json");
  if (!(await pathExists(pendingPath))) return;
  const { state, event } = await readJson<PendingTransaction>(pendingPath);
  if (
    state.adventureId !== pkg.manifest.id || state.playId !== playId ||
    event.adventureId !== pkg.manifest.id || event.playId !== playId || event.revision !== state.revision ||
    !Number.isSafeInteger(state.revision) || state.revision < 1
  ) {
    throw new Error(`Invalid pending transaction for play ${playId}; refusing to overwrite state.`);
  }
  if (await pathExists(statePath(pkg, playId))) {
    const current = await readJson<GameState>(statePath(pkg, playId));
    if (current.revision !== state.revision - 1 && current.revision !== state.revision) {
      throw new Error("Pending transaction does not follow the current revision; recovery stopped.");
    }
  }
  const logPath = eventsPath(pkg, playId);
  const log = await pathExists(logPath) ? await Deno.readTextFile(logPath) : "";
  const events: StateEvent[] = log.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
  const recorded = events.find((item) => item.revision === event.revision);
  if (recorded && recorded.eventId !== event.eventId) {
    throw new Error("Conflicting state audit event; recovery stopped.");
  }
  if (!recorded) {
    const previousRevision = events.at(-1)?.revision ?? 0;
    if (previousRevision !== event.revision - 1) {
      throw new Error("State audit history has a revision gap; recovery stopped.");
    }
    // Replace the log atomically so a killed process cannot leave half a JSON line.
    await writeTextAtomic(logPath, `${log.trimEnd()}${log.trim() ? "\n" : ""}${JSON.stringify(event)}\n`);
  }
  await writeJsonAtomic(statePath(pkg, playId), state);
  await Deno.remove(pendingPath);
}

async function loadState(pkg: AdventurePackage, playInput: string): Promise<GameState> {
  const playId = safeId(playInput);
  const path = statePath(pkg, playId);
  if (await pathExists(path)) {
    const state = await readJson<GameState>(path);
    if (state.adventureId !== pkg.manifest.id || state.playId !== playId || state.schemaVersion !== 1) {
      throw new Error(`Play ${playId} belongs to ${state.adventureId}, not ${pkg.manifest.id}.`);
    }
    return state;
  }
  const timestamp = now();
  const state: GameState = {
    schemaVersion: 1,
    adventureId: pkg.manifest.id,
    playId,
    revision: 0,
    startedAt: timestamp,
    updatedAt: timestamp,
    elapsedTurns: 0,
    flags: {},
    clocks: Object.fromEntries(pkg.assets.runtime.clocks.map((clock) => [clock.id, 0])),
    revealedSecrets: [],
    actorLocations: {},
    resources: {},
    inventory: {},
  };
  await writeJsonAtomic(path, state);
  return state;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive safe integer.`);
}

function applyChange(pkg: AdventurePackage, state: GameState, change: StateChange): void {
  switch (change.kind) {
    case "set_current_scene": {
      if (!pkg.assets.scenes.scenes.some((scene) => scene.id === change.sceneId)) {
        throw new Error(`Unknown scene ${change.sceneId}.`);
      }
      state.currentSceneId = change.sceneId;
      return;
    }
    case "advance_turns":
      assertPositiveInteger(change.amount, "Turn amount");
      state.elapsedTurns += change.amount;
      assertPositiveInteger(state.elapsedTurns, "Total turns");
      return;
    case "set_flag":
      state.flags[safeId(change.key)] = change.value;
      return;
    case "set_clock": {
      const clock = pkg.assets.runtime.clocks.find((candidate) => candidate.id === change.clockId);
      if (!clock) throw new Error(`Unknown clock ${change.clockId}.`);
      if (!Number.isInteger(change.value) || change.value < 0 || change.value > clock.segments) {
        throw new Error(`${clock.name} must be between 0 and ${clock.segments}.`);
      }
      state.clocks[clock.id] = change.value;
      return;
    }
    case "reveal_secret": {
      const secret = pkg.assets.canon.facts.find((fact) =>
        fact.id === change.secretId && fact.category === "secret"
      );
      if (!secret) throw new Error(`Unknown secret ${change.secretId}.`);
      if (!state.revealedSecrets.includes(change.secretId)) state.revealedSecrets.push(change.secretId);
      return;
    }
    case "set_actor_location":
      if (
        !pkg.assets.entities.entities.some((entity) =>
          entity.id === change.locationId && entity.kind === "location"
        )
      ) {
        throw new Error(`Unknown location ${change.locationId}.`);
      }
      state.actorLocations[safeId(change.actorId)] = safeId(change.locationId);
      return;
    case "adjust_resource": {
      if (!Number.isSafeInteger(change.delta) || change.delta === 0) {
        throw new Error("Resource delta must be a non-zero integer.");
      }
      const ownerId = safeId(change.ownerId);
      const resource = safeId(change.resource);
      state.resources[ownerId] ??= {};
      state.resources[ownerId][resource] = (state.resources[ownerId][resource] ?? 0) + change.delta;
      if (!Number.isSafeInteger(state.resources[ownerId][resource])) {
        throw new Error("Resource total is outside the safe integer range.");
      }
      return;
    }
    case "inventory_add": {
      assertPositiveInteger(change.amount, "Inventory amount");
      const itemId = safeId(change.itemId);
      state.inventory[itemId] = (state.inventory[itemId] ?? 0) + change.amount;
      assertPositiveInteger(state.inventory[itemId], "Inventory total");
      return;
    }
    default:
      throw new Error(`Unknown state change kind: ${(change as { kind: string }).kind}`);
    case "inventory_remove": {
      assertPositiveInteger(change.amount, "Inventory amount");
      const itemId = safeId(change.itemId);
      const current = state.inventory[itemId] ?? 0;
      if (current < change.amount) {
        throw new Error(`Cannot remove ${change.amount} ${itemId}; only ${current} recorded.`);
      }
      const next = current - change.amount;
      if (next === 0) delete state.inventory[itemId];
      else state.inventory[itemId] = next;
      return;
    }
  }
}

export async function applyStateTransaction(
  pkg: AdventurePackage,
  playInput: string,
  expectedRevision: number,
  reason: string,
  changes: StateChange[],
): Promise<{ state: GameState; event: StateEvent }> {
  if (changes.length === 0) throw new Error("A state transaction needs at least one change.");
  if (!reason.trim()) throw new Error("A state transaction needs a reason players can audit later.");
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error("Expected revision must be a non-negative safe integer.");
  }
  return await withPlayLock(pkg, playInput, async () => {
    await recoverTransaction(pkg, safeId(playInput));
    const current = await loadState(pkg, playInput);
    if (current.revision !== expectedRevision) {
      throw new Error(
        `State changed: expected revision ${expectedRevision}, current revision is ${current.revision}. Read it again.`,
      );
    }
    const next = structuredClone(current);
    for (const change of changes) applyChange(pkg, next, change);
    next.revision += 1;
    next.updatedAt = now();
    const event: StateEvent = {
      eventId: crypto.randomUUID(),
      adventureId: pkg.manifest.id,
      playId: next.playId,
      revision: next.revision,
      timestamp: next.updatedAt,
      reason: reason.trim(),
      changes,
    };
    await writeJsonAtomic(join(playRoot(pkg.root, next.playId), ".pending-transaction.json"), {
      state: next,
      event,
    });
    await recoverTransaction(pkg, next.playId);
    return { state: next, event };
  });
}
