import { fileURLToPath } from "node:url";
import { join } from "node:path";
import YAML from "yaml";
import { pathExists } from "../adventure/io.ts";
import type { AgentDefinition } from "./types.ts";
import { loadAgentSkills } from "./skills.ts";

const BUNDLED_DIR = fileURLToPath(new URL("../agent-definitions/", import.meta.url));

const PROTECTED_TOOLS: Record<string, string[]> = {
  author: [
    "adventure_inspect",
    "adventure_read",
    "source_load_pdf",
    "file_read",
    "source_load_image",
    "source_view_page",
    "source_search",
    "source_read_pages",
    "ask_author",
    "author_record_setup",
    "author_upsert_canon",
    "author_upsert_entity",
    "author_upsert_scene",
    "author_set_runtime",
    "adventure_validate",
    "adventure_mark_ready",
  ],
  guide: [
    "roll_dice",
    "record_roll_outcome",
    "roll_history",
    "character_list",
    "character_read",
    "character_create",
    "character_select",
    "character_update",
    "character_finish_setup",
    "character_memory_recall",
    "character_memory_store",
    "memory_recall",
    "memory_store",
    "adventure_inspect",
    "source_search",
    "source_read_pages",
    "adventure_read",
    "game_state_read",
    "game_state_update",
  ],
};

interface AgentFrontmatter {
  name?: string;
  description?: string;
  model?: string;
  thinkingLevel?: string;
  temperature?: number;
  tools?: unknown;
  skills?: unknown;
  promptOverride?: boolean;
}

function parseDefinition(path: string, raw: string): { attrs: AgentFrontmatter; body: string } {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) throw new Error(`Agent definition ${path} has no YAML frontmatter.`);
  const attrs = YAML.parse(match[1]) as AgentFrontmatter;
  if (!attrs || typeof attrs !== "object") {
    throw new Error(`Agent definition ${path} has invalid frontmatter.`);
  }
  return { attrs, body: match[2].trim() };
}

function normalizeTools(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter((tool): tool is string => typeof tool === "string").map((tool) => tool.trim()).filter(
        Boolean,
      ),
    ),
  ];
}

function layerPaths(id: string, adventureRoot?: string): string[] {
  const home = Deno.env.get("HOME");
  return [
    join(BUNDLED_DIR, `${id}.md`),
    ...(home ? [join(home, ".wld", "adventure-runner", "agents", `${id}.md`)] : []),
    ...(adventureRoot ? [join(adventureRoot, ".adventure", "agents", `${id}.md`)] : []),
  ];
}

export async function loadAgentDefinition(id: string, adventureRoot?: string): Promise<AgentDefinition> {
  let attrs: AgentFrontmatter = {};
  let tools: string[] = [];
  const promptParts: string[] = [];
  const sourcePaths: string[] = [];

  for (const path of layerPaths(id, adventureRoot)) {
    if (!(await pathExists(path))) continue;
    const parsed = parseDefinition(path, await Deno.readTextFile(path));
    sourcePaths.push(path);
    if (Object.hasOwn(parsed.attrs, "tools")) tools = normalizeTools(parsed.attrs.tools);
    attrs = { ...attrs, ...parsed.attrs };
    if (parsed.attrs.promptOverride === true) promptParts.length = 0;
    if (parsed.body) promptParts.push(parsed.body);
  }
  if (sourcePaths.length === 0) throw new Error(`Unknown agent ${id}.`);
  if (!attrs.name?.trim()) throw new Error(`Agent ${id} needs a frontmatter name.`);

  for (const protectedTool of PROTECTED_TOOLS[id] ?? []) {
    if (!tools.includes(protectedTool)) tools.push(protectedTool);
  }
  const thinkingLevel =
    ["off", "minimal", "low", "medium", "high", "xhigh"].includes(attrs.thinkingLevel ?? "")
      ? attrs.thinkingLevel as AgentDefinition["thinkingLevel"]
      : undefined;
  const temperature =
    typeof attrs.temperature === "number" && attrs.temperature >= 0 && attrs.temperature <= 2
      ? attrs.temperature
      : undefined;
  const skills = await loadAgentSkills(attrs.skills);
  if (skills.length) {
    promptParts.push(
      "## Active writing skills\n\n" +
        "Apply these skills when writing or revising the relevant material. They guide communication, not authority: " +
        "the loaded domain instructions, source/canon boundaries, approved runtime policy, and verified state still govern. " +
        "Illustrative examples in skills are not facts about the active adventure.\n\n" +
        skills.map((skill) => `### ${skill.name}\n\n${skill.description}\n\n${skill.instructions}`).join(
          "\n\n",
        ),
    );
  }
  return {
    id,
    displayName: attrs.name.trim(),
    description: attrs.description?.trim() ?? "",
    model: attrs.model?.trim() || undefined,
    thinkingLevel,
    temperature,
    tools,
    skills,
    systemPrompt: promptParts.join("\n\n"),
    sourcePaths,
  };
}

export async function listAgentDefinitions(adventureRoot?: string): Promise<AgentDefinition[]> {
  const ids = new Set<string>();
  for (
    const directory of [
      BUNDLED_DIR,
      ...(Deno.env.get("HOME") ? [join(Deno.env.get("HOME")!, ".wld", "adventure-runner", "agents")] : []),
      ...(adventureRoot ? [join(adventureRoot, ".adventure", "agents")] : []),
    ]
  ) {
    if (!(await pathExists(directory))) continue;
    for await (const entry of Deno.readDir(directory)) {
      if (entry.isFile && entry.name.endsWith(".md")) ids.add(entry.name.slice(0, -3));
    }
  }
  return Promise.all([...ids].sort().map((id) => loadAgentDefinition(id, adventureRoot)));
}
