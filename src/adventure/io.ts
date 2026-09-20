import { dirname, join, resolve } from "node:path";

export const MANIFEST_FILE = "adventure.json";

export async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound || error instanceof Deno.errors.NotADirectory) return false;
    throw error;
  }
}

export async function readJson<T>(path: string): Promise<T> {
  try {
    return JSON.parse(await Deno.readTextFile(path)) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read JSON ${path}: ${message}`);
  }
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeTextAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeTextAtomic(path: string, value: string): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${crypto.randomUUID()}`;
  try {
    await Deno.writeTextFile(temporary, value);
    await Deno.rename(temporary, path);
  } finally {
    try {
      await Deno.remove(temporary);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
}

export async function appendJsonLine(path: string, value: unknown): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(path, `${JSON.stringify(value)}\n`, { append: true, create: true });
}

export function adventureRoot(path: string): string {
  return resolve(path);
}

export function manifestPath(root: string): string {
  return join(root, MANIFEST_FILE);
}

export function playRoot(root: string, playId: string): string {
  return join(root, "plays", safeId(playId));
}

export function safeId(value: string): string {
  const normalized = value.toLowerCase().trim().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized) throw new Error(`Cannot turn ${JSON.stringify(value)} into an ID`);
  if (["__proto__", "constructor", "prototype"].includes(normalized)) {
    throw new Error(`Reserved ID: ${normalized}`);
  }
  return normalized.slice(0, 80);
}
