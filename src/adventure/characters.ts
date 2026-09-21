import { homedir } from "node:os";
import { join } from "node:path";
import { pathExists, readJson, writeJsonAtomic } from "./io.ts";

export interface CharacterProfile {
  name: string;
  concept: string;
  pronouns: string;
  background: string;
  appearance: string;
  personality: string;
  goals: string;
}
export interface SavedCharacter extends CharacterProfile {
  schemaVersion: 1;
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export const PROFILE_FIELDS = [
  "name",
  "concept",
  "pronouns",
  "background",
  "appearance",
  "personality",
  "goals",
] as const;
export function characterDirectory(): string {
  return join(homedir(), ".adventure-guide", "characters");
}
export function assertCharacterId(id: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
    throw new Error("Invalid character ID; use a character_list result.");
  }
}
function validateProfile(profile: CharacterProfile): void {
  for (const field of PROFILE_FIELDS) {
    if (typeof profile[field] !== "string" || profile[field].length > 2000) {
      throw new Error(`Invalid character ${field}.`);
    }
  }
  if (!profile.name.trim()) throw new Error("A character needs a name (a temporary name is fine).");
}
export async function readCharacter(id: string, directory = characterDirectory()): Promise<SavedCharacter> {
  assertCharacterId(id);
  const character = await readJson<SavedCharacter>(join(directory, `${id}.json`));
  if (
    character.schemaVersion !== 1 || character.id !== id || !Number.isSafeInteger(character.revision) ||
    character.revision < 0
  ) throw new Error("Invalid saved character record.");
  validateProfile(character);
  return character;
}
export async function listCharacters(directory = characterDirectory()): Promise<SavedCharacter[]> {
  if (!(await pathExists(directory))) return [];
  const result: SavedCharacter[] = [];
  for await (const entry of Deno.readDir(directory)) {
    if (!entry.isFile || !entry.name.endsWith(".json")) continue;
    result.push(await readCharacter(entry.name.slice(0, -5), directory));
  }
  return result.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
export async function createCharacter(
  profile: Partial<CharacterProfile> & { name: string },
  directory = characterDirectory(),
): Promise<SavedCharacter> {
  if (Object.keys(profile).some((key) => !PROFILE_FIELDS.includes(key as any))) {
    throw new Error("Only narrative profile fields belong in a saved character.");
  }
  const timestamp = new Date().toISOString();
  const character: SavedCharacter = {
    concept: "",
    pronouns: "",
    background: "",
    appearance: "",
    personality: "",
    goals: "",
    ...profile,
    schemaVersion: 1,
    id: crypto.randomUUID(),
    revision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  validateProfile(character);
  await writeJsonAtomic(join(directory, `${character.id}.json`), character);
  return character;
}
export async function updateCharacter(
  id: string,
  expectedRevision: number,
  changes: Partial<CharacterProfile>,
  directory = characterDirectory(),
): Promise<SavedCharacter> {
  assertCharacterId(id);
  if (
    Object.keys(changes).length === 0 ||
    Object.keys(changes).some((key) => !PROFILE_FIELDS.includes(key as any))
  ) throw new Error("Update only character profile fields; mechanical state belongs in game_state_update.");
  await Deno.mkdir(directory, { recursive: true });
  using lock = await Deno.open(join(directory, `${id}.lock`), { create: true, write: true });
  await lock.lock(true);
  try {
    const current = await readCharacter(id, directory);
    if (current.revision !== expectedRevision) {
      throw new Error(
        `Character changed: expected revision ${expectedRevision}, current revision ${current.revision}. Read again.`,
      );
    }
    const next = {
      ...current,
      ...changes,
      revision: current.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    validateProfile(next);
    await writeJsonAtomic(join(directory, `${id}.json`), next);
    return next;
  } finally {
    await lock.unlock();
  }
}
