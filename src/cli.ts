import { findCommand } from "./commands/registry.ts";
import { printCommandHelp, printGlobalHelp } from "./commands/help.ts";
import { VERSION } from "./version.ts";
import process from "node:process";

export async function main(args = Deno.args): Promise<void> {
  const [name, ...rest] = args;
  if (!name || name === "help" || name === "--help" || name === "-h") {
    if (name === "help" && rest[0]) {
      if (!printCommandHelp(rest[0])) throw new Error(`Unknown command ${rest[0]}.`);
    } else printGlobalHelp();
    return;
  }
  if (name === "--version" || name === "-v" || name === "version") {
    console.log(VERSION);
    return;
  }
  const command = findCommand(name);
  if (!command) throw new Error(`Unknown command ${name}. Run 'adventure help'.`);
  if (rest.includes("--help") || rest.includes("-h")) {
    printCommandHelp(command.name);
    return;
  }
  await command.execute(rest, { cwd: Deno.cwd() });
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(`Adventure Runner: ${error instanceof Error ? error.message : String(error)}`);
    // The Node-compatible SDK owns process exit hooks; use the same exit-code channel.
    process.exitCode = 1;
  }
}
