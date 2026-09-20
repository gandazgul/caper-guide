import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadAgentDefinition } from "../agents/loader.ts";
import { runAgentTui } from "../agents/runtime.ts";
import { pathExists } from "../adventure/io.ts";
import { createAdventurePackage, importPdf, packageSummary, saveManifest } from "../adventure/package.ts";
import { createAuthorTools } from "../tools/author.ts";
import { createAdventureReadTool } from "../tools/guide.ts";
import { createAuthorMemoryTools } from "../tools/memory.ts";
import { createQuestionnaireTool } from "../tools/questionnaire.ts";
import { createPdfImportTool, createSourceTools, resolvePdfInputPath } from "../tools/source.ts";
import type { CommandContext } from "./types.ts";
import { type AdventureSelection, pickAdventure } from "../ui/adventure-picker.ts";

function defaultOutput(cwd: string, pdf: string): string {
  const name = basename(pdf).replace(/\.pdf$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(
    /^-|-$/g,
    "",
  );
  return join(cwd, "adventures", name || "new-adventure");
}

export async function runAuthorCommand(
  args: string[],
  context: CommandContext,
  dependencies: { pickAdventure?: typeof pickAdventure; runTui?: typeof runAgentTui } = {},
): Promise<void> {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      output: { type: "string", short: "o" },
      id: { type: "string" },
      title: { type: "string" },
      model: { type: "string", short: "m" },
      continue: { type: "boolean", short: "c", default: false },
      session: { type: "string" },
      "prepare-only": { type: "boolean", default: false },
    },
  });
  if (parsed.values.continue && parsed.values.session) {
    throw new Error("Use either --continue or --session, not both.");
  }
  const positionals = parsed.positionals.map(String);
  let selected: AdventureSelection | undefined;
  if (positionals.length === 0 && !parsed.values.output) {
    if (parsed.values["prepare-only"]) {
      throw new Error("Use --output <directory> or supply a PDF/adventure path with --prepare-only.");
    }
    const choice = await (dependencies.pickAdventure ?? pickAdventure)(context.cwd, parsed.values.title);
    if (!choice) return;
    if (choice.isNew && parsed.values.session) {
      throw new Error(
        "A new adventure has no conversation to resume. Omit --session or select an existing adventure.",
      );
    }
    selected = choice;
    if (!choice.isNew) positionals.push(choice.root);
  }
  const first = positionals[0] ? resolvePdfInputPath(positionals[0], context.cwd) : undefined;
  const firstIsPackage = first ? await pathExists(join(first, "adventure.json")) : false;
  if (firstIsPackage && parsed.values.output) {
    throw new Error("Choose an adventure directory or --output, not both.");
  }
  const pdfs = (firstIsPackage ? positionals.slice(1) : positionals)
    .map((path) => resolvePdfInputPath(path, context.cwd));
  const outputInput = selected?.root ?? parsed.values.output ??
    (firstIsPackage ? first! : pdfs[0] ? defaultOutput(context.cwd, pdfs[0]) : undefined);
  if (!outputInput) throw new Error("Choose an adventure from the menu or supply an output directory.");
  const output = resolve(context.cwd, outputInput);
  for (const pdf of pdfs) {
    if (!pdf.toLowerCase().endsWith(".pdf")) throw new Error(`Author input must be a PDF: ${pdf}`);
    if (!(await pathExists(pdf))) throw new Error(`PDF not found: ${pdf}`);
    if (!(await Deno.stat(pdf)).isFile) throw new Error(`PDF path is not a file: ${pdf}`);
  }

  const wasExisting = await pathExists(join(output, "adventure.json"));
  if (selected?.isNew && await pathExists(output)) {
    throw new Error("That adventure folder now exists. Reopen the menu and choose a different name.");
  }
  const requestedTitle = selected?.isNew ? selected.title : parsed.values.title;
  const pkg = await createAdventurePackage(output, { id: parsed.values.id, title: requestedTitle });
  for (const pdf of pdfs) {
    const source = await importPdf(pkg, resolve(context.cwd, pdf));
    console.log(`Imported ${source.title}: ${source.pageCount} page(s) as ${source.id}`);
  }
  const title = requestedTitle?.trim() || (!wasExisting ? pkg.sources[0]?.title : undefined);
  if (title && title !== pkg.manifest.title) {
    pkg.manifest.title = title;
    await saveManifest(pkg);
  }

  if (parsed.values["prepare-only"]) {
    console.log(JSON.stringify(packageSummary(pkg), null, 2));
    return;
  }

  const agent = await loadAgentDefinition("author", pkg.root);
  const tools = [
    createAdventureReadTool(pkg),
    createPdfImportTool(pkg, context.cwd),
    ...createSourceTools(pkg),
    createQuestionnaireTool(pkg),
    ...createAuthorTools(pkg),
    ...createAuthorMemoryTools(pkg),
  ];
  await (dependencies.runTui ?? runAgentTui)({
    pkg,
    agent,
    tools,
    sessionGroup: "author",
    resumeArgs: ["author", pkg.root],
    model: parsed.values.model,
    continueSession: !parsed.values.session && (selected ? !selected.isNew : parsed.values.continue),
    sessionId: parsed.values.session,
    workingDirectory: context.cwd,
    welcomeMessage: [
      "Welcome to Adventure Author.",
      "",
      `Active adventure: ${pkg.manifest.title}`,
      `Durable package: ${pkg.root}`,
      "",
      "Describe what you want in ordinary language. To add a PDF to this adventure, say Load and give its path. " +
      "Type @ to find files; ~/ and absolute paths also work.",
      "To switch adventures, use /quit and run deno task adventure author to return to the menu.",
    ].join("\n"),
    startupInstruction: pkg.sources.length
      ? "Begin or continue authoring this adventure. Inspect its current assets and validation issues, recall relevant saved author preferences, then explain the next useful step in beginner-friendly language. Use the source-backed questionnaire for setup decisions."
      : undefined,
  });
}
