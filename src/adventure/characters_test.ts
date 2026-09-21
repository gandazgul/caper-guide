import { assert, assertEquals, assertNotEquals, assertRejects, assertThrows } from "@std/assert";
import { createCharacter, listCharacters, readCharacter, updateCharacter } from "./characters.ts";
import { createAdventurePackage } from "./package.ts";
import { applyStateTransaction, loadOrCreateGameState } from "./state.ts";
import { createCharacterTools } from "../tools/characters.ts";
import { createGuideTools } from "../tools/guide.ts";
import { characterMemoryCollection, createCharacterMemoryTools } from "../tools/memory.ts";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

async function call(tools: ToolDefinition[], name: string, args = {}): Promise<any> {
  const tool = tools.find((tool) => tool.name === name)!;
  return (await tool.execute("test", args, undefined, undefined, {} as any)).details;
}

Deno.test("character library persists incremental facts and rejects stale or mechanical updates", async () => {
  const root = await Deno.makeTempDir();
  try {
    assertEquals(await listCharacters(root), []);
    const first = await createCharacter({ name: "Robin", background: "A village messenger" }, root);
    const second = await createCharacter({ name: "Robin" }, root);
    assertNotEquals(first.id, second.id);
    assertNotEquals(characterMemoryCollection(first.id), characterMemoryCollection(second.id));
    const updated = await updateCharacter(first.id, 0, { goals: "Find my missing friend" }, root);
    assertEquals(updated.background, first.background);
    assertEquals(updated.revision, 1);
    assertEquals(await readCharacter(first.id, root), updated);
    assertEquals((await listCharacters(root)).length, 2);
    await assertRejects(() => updateCharacter(first.id, 0, { name: "Changed" }, root), Error, "revision");
    await assertRejects(() => updateCharacter(first.id, 1, { hp: 10 } as any, root), Error, "mechanical");
    await assertRejects(() => createCharacter({ name: "Bad", hp: 10 } as any, root), Error, "narrative");
    await assertRejects(() => readCharacter("../escape", root), Error, "Invalid character ID");
    assertThrows(() => characterMemoryCollection("../escape"), Error, "Invalid character ID");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("Guide creates and tracks a character before advancing, without carrying mechanics between plays", async () => {
  const root = await Deno.makeTempDir();
  try {
    const pkg = await createAdventurePackage(`${root}/adventure`, { title: "Character Test" });
    const library = `${root}/characters`;
    const tools = [...createCharacterTools(pkg, "solo", library), ...createGuideTools(pkg, "solo")];
    // A legacy play with no character metadata must retain its existing progress.
    await applyStateTransaction(pkg, "solo", 0, "Existing progress", [{ kind: "advance_turns", amount: 2 }]);
    assertEquals((await call(tools, "character_read")).character, null);
    await assertRejects(
      () =>
        call(tools, "game_state_update", {
          expectedRevision: 1,
          reason: "Begin playing",
          changes: [{ kind: "advance_turns", amount: 1 }],
        }),
      Error,
      "Finish character setup",
    );
    await assertRejects(() => call(tools, "character_create", { name: "Robin", playerApproved: false }));
    const character = await call(tools, "character_create", { name: "Robin", playerApproved: true });
    await call(tools, "character_select", {
      characterId: character.id,
      expectedRevision: 1,
      playerApproved: true,
    });
    await call(tools, "character_update", {
      expectedRevision: 0,
      changes: { concept: "A curious explorer" },
      playerProvidedOrApproved: true,
    });
    assertEquals((await call(tools, "character_read")).concept, "A curious explorer");
    await call(tools, "game_state_update", {
      expectedRevision: 2,
      reason: "Player approved starting sheet",
      changes: [
        {
          kind: "set_character_sheet",
          attributes: { courage: 2 },
          abilities: ["Trail finding"],
          rulesNotes: "Approved test rules",
        },
        { kind: "adjust_resource", ownerId: character.id, resource: "hp", delta: 6 },
      ],
    });
    await call(tools, "character_finish_setup", { expectedRevision: 3, playerReady: true });
    await call(tools, "game_state_update", {
      expectedRevision: 4,
      reason: "Player begins adventure",
      changes: [{ kind: "advance_turns", amount: 1 }],
    });
    const state = await loadOrCreateGameState(pkg, "solo");
    assertEquals(state.characterSetupComplete, true);
    assertEquals(state.elapsedTurns, 3);
    assertEquals(state.resources[character.id].hp, 6);
    const other = await createCharacter({ name: "Another" }, library);
    await assertRejects(
      () =>
        call(tools, "character_select", {
          characterId: other.id,
          expectedRevision: 5,
          playerApproved: true,
        }),
      Error,
      "new",
    );
    const nextTools = createCharacterTools(pkg, "next", library);
    await call(nextTools, "character_select", {
      characterId: character.id,
      expectedRevision: 0,
      playerApproved: true,
    });
    const next = await loadOrCreateGameState(pkg, "next");
    assertEquals(next.characterSheet, undefined);
    assertEquals(next.resources, {});
    assertEquals(next.characterSetupComplete, false);
    assert((await Deno.readTextFile(`${pkg.root}/plays/solo/events.jsonl`)).includes("select_character"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("character memories use selected identity, save automatically, scope recall, and tolerate offline memory", async () => {
  const root = await Deno.makeTempDir();
  try {
    const pkg = await createAdventurePackage(`${root}/adventure`, { title: "Memory Test" });
    const library = `${root}/characters`;
    const character = await createCharacter({ name: "Robin" }, library);
    const calls: string[][] = [];
    const tools = createCharacterMemoryTools(pkg, "solo", library, (_cwd, args) => {
      calls.push(args);
      return Promise.resolve("Remembered experience");
    });
    await assertRejects(
      () => call(tools, "character_memory_recall", { query: "past friendships" }),
      Error,
      "Select",
    );
    await applyStateTransaction(pkg, "solo", 0, "Choose character", [{
      kind: "select_character",
      characterId: character.id,
    }]);
    const recall = await call(tools, "character_memory_recall", { query: "past friendships" });
    assertEquals(recall.collection, characterMemoryCollection(character.id));
    assert(
      calls.every((args) => args[args.indexOf("--name") + 1] === characterMemoryCollection(character.id)),
    );
    assert(calls.at(-1)!.includes("play-solo"));
    assert(calls.at(-1)!.includes(`adventure-${pkg.manifest.id}`));
    await call(tools, "character_memory_recall", { query: "past friendships", scope: "all_adventures" });
    assert(!calls.at(-1)!.includes("--tag"));
    await assertRejects(
      () =>
        call(tools, "character_memory_store", {
          content: "My HP is six",
          kind: "continuity_note",
          userAskedToRemember: true,
        }),
      Error,
      "mechanical",
    );
    await call(tools, "character_memory_store", {
      content: "I befriended a boat keeper",
      kind: "relationship",
    });
    assert(calls.at(-1)!.includes("character-experience"));
    assert(calls.at(-1)!.at(-1)!.includes("play: solo; recorded:"));
    const offline = createCharacterMemoryTools(
      pkg,
      "solo",
      library,
      () => Promise.reject(new Error("offline")),
    );
    assertEquals(
      (await call(offline, "character_memory_recall", { query: "past friendships" })).available,
      false,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
