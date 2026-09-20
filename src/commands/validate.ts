import { resolve } from "node:path";
import process from "node:process";
import { loadAdventurePackage } from "../adventure/package.ts";
import { validateAdventure } from "../adventure/validation.ts";
import type { CommandContext } from "./types.ts";

export async function runValidateCommand(args: string[], context: CommandContext): Promise<void> {
  if (args.length !== 1) throw new Error("Usage: adventure validate <adventure-directory>");
  const pkg = await loadAdventurePackage(resolve(context.cwd, args[0]));
  const issues = validateAdventure(pkg);
  if (issues.length === 0) {
    console.log(
      pkg.manifest.status === "ready"
        ? "Adventure package is valid and ready for play."
        : "Adventure package is structurally valid. Ask the Author to mark it ready before play.",
    );
    return;
  }
  for (const issue of issues) {
    console.log(`${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`);
  }
  if (issues.some((issue) => issue.severity === "blocker")) process.exitCode = 1;
}
