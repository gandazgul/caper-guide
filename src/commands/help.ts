import { commandRegistry, findCommand } from "./registry.ts";
import { VERSION } from "../version.ts";

export function printGlobalHelp(): void {
  console.log(`Adventure Runner ${VERSION}\n`);
  console.log(
    "A local, source-grounded harness for authoring and playing bounded one-shot TTRPG adventures.\n",
  );
  console.log("Commands:\n");
  for (const command of Object.values(commandRegistry)) {
    console.log(`  ${command.name.padEnd(10)} ${command.description}`);
  }
  console.log("\nRun 'adventure help <command>' for examples.");
}

export function printCommandHelp(name: string): boolean {
  const command = findCommand(name);
  if (!command) return false;
  console.log(`${command.displayName}\n\n${command.summary}\n\nUsage:\n`);
  for (const usage of command.usage) console.log(`  ${usage}`);
  if (command.notes?.length) {
    console.log("\nNotes:\n");
    for (const note of command.notes) console.log(`  - ${note}`);
  }
  return true;
}
