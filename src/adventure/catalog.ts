import { basename, dirname, join, resolve } from "node:path";
import { pathExists, safeId } from "./io.ts";
import { loadAdventurePackage } from "./package.ts";

export interface AdventureEntry {
  root: string;
  title: string;
  status: "draft" | "ready";
  sourceCount: number;
  decisionCount: number;
  updatedAt: string;
}

export interface AdventureCatalog {
  directory: string;
  adventures: AdventureEntry[];
  warnings: string[];
}

/** Discover only the local adventure library, not arbitrary folders on the user's machine. */
export async function discoverAdventures(cwd: string): Promise<AdventureCatalog> {
  const currentIsPackage = await pathExists(join(cwd, "adventure.json"));
  const directory = resolve(
    currentIsPackage ? dirname(cwd) : basename(cwd) === "adventures" ? cwd : join(cwd, "adventures"),
  );
  const catalog: AdventureCatalog = { directory, adventures: [], warnings: [] };
  if (!(await pathExists(directory))) return catalog;
  for await (const entry of Deno.readDir(directory)) {
    if (!entry.isDirectory) continue;
    const root = join(directory, entry.name);
    if (!(await pathExists(join(root, "adventure.json")))) continue;
    try {
      const pkg = await loadAdventurePackage(root);
      catalog.adventures.push({
        root,
        title: pkg.manifest.title,
        status: pkg.manifest.status,
        sourceCount: pkg.sources.length,
        decisionCount: pkg.assets.setup.decisions.length,
        updatedAt: pkg.manifest.updatedAt,
      });
    } catch (error) {
      catalog.warnings.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  catalog.adventures.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title));
  return catalog;
}

export async function newAdventureLocation(directory: string, title: string): Promise<string> {
  if (!title.trim()) throw new Error("Give your adventure a name first.");
  const root = join(directory, safeId(title));
  if (await pathExists(root)) {
    throw new Error(
      "That adventure folder already exists. Choose another name, or press Esc to open it from the menu.",
    );
  }
  return root;
}
