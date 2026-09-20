import { runAgentsCommand } from "./agents.ts";
import { runAuthorCommand } from "./author.ts";
import { runGuideCommand } from "./guide.ts";
import { runInspectCommand } from "./inspect.ts";
import type { CommandDefinition } from "./types.ts";
import { runValidateCommand } from "./validate.ts";

export const COMMAND_NAMES = Object.freeze({
  AUTHOR: "author",
  GUIDE: "guide",
  INSPECT: "inspect",
  VALIDATE: "validate",
  AGENTS: "agents",
  HELP: "help",
});

export const commandRegistry: Record<string, CommandDefinition> = {
  author: {
    name: "author",
    displayName: "Adventure Author",
    description: "Import PDFs and author a durable adventure package in the Adventure Runner TUI",
    summary: "Create or continue a source-cited adventure package.",
    usage: [
      "adventure author",
      "adventure author module.pdf",
      "adventure author module.pdf --output adventures/my-module",
      "adventure author adventures/my-module --continue",
      "adventure author adventures/my-module --session <session-id>",
      "adventure author extra-source.pdf --output adventures/my-module",
    ],
    notes: [
      "With no path, shows an existing-adventure / Create new adventure menu; nothing is created until you choose.",
      "The menu lists local adventures and resumes the selected adventure's latest author conversation.",
      "Inside the TUI, type @ to find a PDF and ask the Author to load it.",
      "Use --prepare-only with a PDF, package path, or --output to work without the TUI.",
      "Conversation sessions are stored under ~/.adventure-guide/; quit prints a ready-to-run resume command.",
      "Use --model provider/model to override ~/.wld defaults.",
    ],
    execute: runAuthorCommand,
  },
  guide: {
    name: "guide",
    displayName: "Adventure Guide",
    description: "Play an authored adventure with verified mechanical state",
    summary: "Run a prepared package for players in the Adventure Runner TUI.",
    usage: [
      "adventure guide adventures/my-module",
      "adventure guide adventures/my-module --play friday --continue",
      "adventure guide adventures/my-module --play friday --session <session-id>",
    ],
    notes: [
      "Each --play name has separate mechanical state and an audit log.",
      "The package must pass validation and be marked ready by the Author before play.",
      "Conversation sessions are stored under ~/.adventure-guide/; quit prints a ready-to-run resume command.",
    ],
    execute: runGuideCommand,
  },
  inspect: {
    name: "inspect",
    displayName: "Inspect",
    description: "Show PDFs, assets, status, and validation issues",
    summary: "Inspect a package without starting a model.",
    usage: ["adventure inspect adventures/my-module"],
    execute: runInspectCommand,
  },
  validate: {
    name: "validate",
    displayName: "Validate",
    description: "Mechanically validate a package",
    summary: "Check citations, required records, runtime policy, and scene links.",
    usage: ["adventure validate adventures/my-module"],
    execute: runValidateCommand,
  },
  agents: {
    name: "agents",
    aliases: ["agent"],
    displayName: "Agents",
    description: "List layered agent definitions and their tool policies",
    summary: "Inspect bundled, user, and adventure-local agent layers.",
    usage: ["adventure agents", "adventure agents adventures/my-module"],
    execute: runAgentsCommand,
  },
};

export function findCommand(name: string): CommandDefinition | undefined {
  return Object.values(commandRegistry).find((command) =>
    command.name === name || command.aliases?.includes(name)
  );
}
