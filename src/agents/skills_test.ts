import { assert, assertEquals, assertRejects } from "@std/assert";
import { loadAgentDefinition } from "./loader.ts";
import { loadAgentSkills } from "./skills.ts";
import { selectStartupInstruction } from "./runtime.ts";

Deno.test("Guide prompt requires automatic continuity and a grounded resume recap", async () => {
  const { systemPrompt } = await loadAgentDefinition("guide");
  const prompt = systemPrompt.replace(/\s+/g, " ");
  for (
    const instruction of [
      "Gameplay continuity is automatic",
      "Previously on…",
      "the player's own anecdotes",
      "An NPC's explanation is not automatically true",
      "Missing memory is not proof",
      "do not advance time, repeat actions, reroll dice",
      "If a memory write fails, do not claim it was saved",
    ]
  ) assert(prompt.includes(instruction), `Missing memory policy: ${instruction}`);
  assert(!prompt.includes("With the player's request or confirmation, store"));
});

Deno.test("resume prompts run for continued Guide sessions without retriggering Author startup", () => {
  const guide = { startupInstruction: "Setup", resumeInstruction: "Previously on…" };
  assertEquals(selectStartupInstruction(guide, false), "Setup");
  assertEquals(selectStartupInstruction(guide, true), "Previously on…");
  assertEquals(selectStartupInstruction({ startupInstruction: "Author setup" }, true), undefined);
  assertEquals(selectStartupInstruction({}, false), undefined);
});

Deno.test("Guide's loaded prompt includes observation boundaries and graduated, non-answer hints", async () => {
  const { systemPrompt } = await loadAgentDefinition("guide");
  for (
    const instruction of [
      "## Spoiler-safe narration and hints",
      "do not describe a tested property when the player has only looked",
      '"not yet"',
      "Offer a hint only when the player directly asks for one or you judge they are genuinely stuck",
      "Hints clarify next steps, never reveal answers",
      "Never invent a sensory clue to justify a hint",
      "Never auto-perform the action, bypass a required check",
    ]
  ) {
    assert(systemPrompt.replace(/\s+/g, " ").includes(instruction), `Missing Guide policy: ${instruction}`);
  }
});

Deno.test("each role receives its complete writing skills in the effective system prompt", async () => {
  const author = await loadAgentDefinition("author");
  const guide = await loadAgentDefinition("guide");
  assertEquals(author.skills.map((skill) => skill.name), [
    "clear-prose",
    "adventure-authoring",
    "npc-dialogue",
    "interactive-choices",
    "key-moments",
    "character-naming",
    "adventure-endings",
  ]);
  assertEquals(guide.skills.map((skill) => skill.name), [
    "clear-prose",
    "table-narration",
    "npc-dialogue",
    "interactive-choices",
    "key-moments",
    "game-facilitation",
    "adventure-endings",
  ]);
  for (const agent of [author, guide]) {
    for (const skill of agent.skills) assert(agent.systemPrompt.includes(skill.instructions));
  }
  for (const [agent, other] of [[author, guide], [guide, author]]) {
    const otherNames = new Set(other.skills.map((skill) => skill.name));
    for (const skill of agent.skills.filter((skill) => !otherNames.has(skill.name))) {
      assert(!other.systemPrompt.includes(skill.instructions));
    }
  }
});

Deno.test("skill selection deduplicates names and rejects invalid or missing skills", async () => {
  assertEquals((await loadAgentSkills(["clear-prose", "clear-prose"])).length, 1);
  assertEquals(await loadAgentSkills(undefined), []);
  assertEquals(await loadAgentSkills([]), []);
  await assertRejects(() => loadAgentSkills("clear-prose"), Error, "array of skill names");
  await assertRejects(() => loadAgentSkills(["../../private"]), Error, "Invalid skill name");
  await assertRejects(() => loadAgentSkills(["not-a-bundled-skill"]), Error, "is missing");
});

Deno.test("invalid skill metadata fails before an agent can start", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${root}/test-skill`);
    for (
      const text of [
        "No frontmatter",
        "---\nname: wrong-name\ndescription: A test skill\n---\nDo useful work.",
        "---\nname: test-skill\ndescription: A test skill\n---\n",
      ]
    ) {
      await Deno.writeTextFile(`${root}/test-skill/SKILL.md`, text);
      await assertRejects(() => loadAgentSkills(["test-skill"], root), Error);
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("agent prompt overrides retain writing skills unless the layer explicitly replaces their list", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${root}/.adventure/agents`, { recursive: true });
    const path = `${root}/.adventure/agents/author.md`;
    await Deno.writeTextFile(
      path,
      "---\nname: Custom Author\npromptOverride: true\n---\nUse the approved custom voice.\n",
    );
    const author = await loadAgentDefinition("author", root);
    assert(author.systemPrompt.startsWith("Use the approved custom voice."));
    assertEquals(
      author.skills.map((skill) => skill.name),
      (await loadAgentDefinition("author")).skills.map((skill) => skill.name),
    );
    await Deno.writeTextFile(path, "---\nname: Custom Author\nskills: []\n---\nCustom writing guidance.\n");
    const withoutSkills = await loadAgentDefinition("author", root);
    assertEquals(withoutSkills.skills, []);
    assert(withoutSkills.tools.includes("adventure_validate"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
