import { join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const BUNDLED_SKILLS = fileURLToPath(new URL("../skills/", import.meta.url));

export interface AgentSkill {
  name: string;
  description: string;
  instructions: string;
  path: string;
}

/** Explicit, role-selected harness skills; never discover unrelated coding-agent or user skills. */
export async function loadAgentSkills(
  names: unknown,
  directory = BUNDLED_SKILLS,
): Promise<AgentSkill[]> {
  if (names === undefined) return [];
  if (!Array.isArray(names) || names.some((name) => typeof name !== "string")) {
    throw new Error("Agent skills must be an array of skill names.");
  }
  const result: AgentSkill[] = [];
  for (const name of new Set<string>(names)) {
    if (name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
      throw new Error(
        `Invalid skill name ${JSON.stringify(name)}; use lowercase words separated by hyphens.`,
      );
    }
    const path = join(directory, name, "SKILL.md");
    let raw: string;
    try {
      raw = await Deno.readTextFile(path);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) throw new Error(`Agent skill ${name} is missing: ${path}`);
      throw error;
    }
    const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
    if (!match) throw new Error(`Skill ${name} needs YAML frontmatter and an instruction body.`);
    const metadata = YAML.parse(match[1]);
    if (
      metadata?.name !== name || typeof metadata?.description !== "string" || !metadata.description.trim() ||
      !match[2].trim()
    ) {
      throw new Error(`Skill ${name} needs a matching name, nonempty description, and instructions.`);
    }
    result.push({ name, description: metadata.description.trim(), instructions: match[2].trim(), path });
  }
  return result;
}
