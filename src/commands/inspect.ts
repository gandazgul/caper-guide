import { resolve } from "node:path";
import { loadAdventurePackage, packageSummary } from "../adventure/package.ts";
import { validateAdventure } from "../adventure/validation.ts";
import type { CommandContext } from "./types.ts";

export async function runInspectCommand(args: string[], context: CommandContext): Promise<void> {
  if (args.length !== 1) throw new Error("Usage: adventure inspect <adventure-directory>");
  const pkg = await loadAdventurePackage(resolve(context.cwd, args[0]));
  console.log(JSON.stringify({ ...packageSummary(pkg), validation: validateAdventure(pkg) }, null, 2));
}
