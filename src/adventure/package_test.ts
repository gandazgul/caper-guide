import { assert, assertEquals, assertRejects } from "@std/assert";
import { resolve } from "node:path";
import { loadAgentDefinition } from "../agents/loader.ts";
import {
  buildAgentSystemPrompt,
  buildResumeCommand,
  getHarnessSessionDir,
  harnessSettings,
} from "../agents/runtime.ts";
import { runAuthorCommand } from "../commands/author.ts";
import { runGuideCommand } from "../commands/guide.ts";
import { resolvePdfInputPath } from "../tools/source.ts";
import {
  markAdventureReady,
  recordSetupDecision,
  setRuntimeProfile,
  upsertCanonFact,
  upsertEntity,
  upsertScene,
} from "./authoring.ts";
import { createAdventurePackage, loadAdventurePackage, saveSources, splitExtractedPages } from "./package.ts";
import { applyStateTransaction, loadOrCreateGameState } from "./state.ts";
import { type EvidenceRef, SETUP_TOPICS } from "./types.ts";
import { validateAdventure } from "./validation.ts";

async function fixture() {
  const root = await Deno.makeTempDir({ prefix: "adventure-runner-test-" });
  const pkg = await createAdventurePackage(root, { id: "test-adventure", title: "Test Adventure" });
  pkg.sources.push({
    id: "source-test",
    title: "Test Source",
    sha256: "a".repeat(64),
    originalFilename: "test.pdf",
    importedFrom: "/tmp/test.pdf",
    pdfPath: "sources/files/source-test.pdf",
    extractedPath: "sources/extracted/source-test.md",
    pageCount: 3,
    importedAt: new Date().toISOString(),
  });
  await saveSources(pkg);
  return { root, pkg, citation: [{ sourceId: "source-test", page: 1 }] satisfies EvidenceRef[] };
}

Deno.test("page-marked extraction keeps stable page numbers", () => {
  const pages = splitExtractedPages(
    "source-a",
    "<!-- page 2 -->\nSecond\n<!-- PAGE 4 -->\nFourth",
  );
  assertEquals(pages, [
    { sourceId: "source-a", page: 2, markdown: "Second" },
    { sourceId: "source-a", page: 4, markdown: "Fourth" },
  ]);
});

Deno.test("author with an explicit output creates a durable empty package without the TUI", async () => {
  const root = await Deno.makeTempDir({ prefix: "adventure-runner-empty-author-" });
  try {
    await runAuthorCommand(["--prepare-only", "--output", "adventures/new-adventure"], { cwd: root });
    const pkg = await loadAdventurePackage(`${root}/adventures/new-adventure`);
    assertEquals(pkg.manifest.id, "new-adventure");
    assertEquals(pkg.manifest.title, "New Adventure");
    assertEquals(pkg.sources, []);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("author file selection paths resolve from the launch directory", () => {
  const base = resolve("/tmp", "adventure-runner-path-test");
  assertEquals(resolvePdfInputPath("@sources/module.pdf", base), resolve(base, "sources/module.pdf"));
  assertEquals(
    resolvePdfInputPath("'sources/module with spaces.pdf'", base),
    resolve(base, "sources/module with spaces.pdf"),
  );
});

Deno.test("harness prompt and runtime settings stay adventure-owned", async () => {
  const root = await Deno.makeTempDir({ prefix: "adventure-runner-prompt-" });
  try {
    const pkg = await createAdventurePackage(root, { title: "Prompt Test" });
    const agent = await loadAgentDefinition("author", root);
    const prompt = buildAgentSystemPrompt(agent, pkg, "/launch/directory");
    assert(prompt.startsWith(agent.systemPrompt));
    assert(!prompt.includes("You are an expert coding assistant operating inside pi"));
    assert(prompt.includes("File selection root: /launch/directory"));

    const settings = harnessSettings({ transport: "websocket", quietStartup: false, theme: "custom" });
    assertEquals(settings?.transport, "sse");
    assertEquals(settings?.quietStartup, true);
    assertEquals(settings?.theme, undefined);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("session storage and resume commands are harness-owned", async () => {
  const root = await Deno.makeTempDir({ prefix: "adventure-runner-session-" });
  try {
    const pkg = await createAdventurePackage(root, { id: "session-test", title: "Session Test" });
    const sessionDir = getHarnessSessionDir(pkg, "guide-solo", "/home/player");
    assert(sessionDir.startsWith("/home/player/.adventure-guide/sessions/session-test-"));
    assert(sessionDir.endsWith("/guide-solo"));

    const command = buildResumeCommand(
      ["author", "/home/player/My Adventures/session-test"],
      "019f5c12-c491-74f5-a519-44ae3b6236aa",
    );
    assert(command.startsWith("deno task --config "));
    assert(
      command.includes(
        "deno.json adventure author '/home/player/My Adventures/session-test' --session 019f5c12-c491-74f5-a519-44ae3b6236aa",
      ),
    );
    assert(!command.includes("--session-dir"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("a complete cited adventure can become ready", async () => {
  const { root, pkg, citation } = await fixture();
  try {
    for (const topic of SETUP_TOPICS) {
      await recordSetupDecision(pkg, {
        id: topic,
        question: `What should we do for ${topic}?`,
        selections: ["recommended"],
        customAnswers: [],
        rationale: "The source supports this setup for the test.",
        citations: citation,
      });
    }
    await upsertCanonFact(pkg, {
      id: "hidden-door",
      statement: "A hidden door exists.",
      visibility: "guide",
      category: "secret",
      citations: citation,
    });
    await upsertEntity(pkg, {
      id: "entry-hall",
      kind: "location",
      name: "Entry Hall",
      playerSummary: "A cold stone hall.",
      guideNotes: "The hidden door is in the east wall.",
      knowledge: [],
      constraints: ["Do not reveal the hidden door without a search."],
      citations: citation,
    });
    await upsertScene(pkg, {
      id: "arrival",
      name: "Arrival",
      summary: "The party enters the hall.",
      locationIds: ["entry-hall"],
      entryConditions: [],
      supportedActions: ["Look around"],
      fallbackActions: ["Ask what the player hopes to accomplish"],
      secretIds: ["hidden-door"],
      transitions: [],
      citations: citation,
    });
    await setRuntimeProfile(pkg, {
      schemaVersion: 1,
      rules: {
        systemName: "Test Dice",
        resolution: "Roll one die and follow the result.",
        whoRolls: "Players roll.",
        citations: citation,
      },
      toneAndSafety: {
        tone: "Mysterious",
        lines: [],
        veils: [],
        contentNotes: [],
        explanation: "Pause if anyone is uncomfortable.",
        citations: citation,
      },
      adaptationPolicy: {
        preserve: ["The hidden door"],
        mayAdapt: ["Minor sensory details"],
        explanation: "Small details can fit the group without changing the puzzle.",
        citations: citation,
      },
      outOfBoundsPolicy: {
        response: "Clarify the intent and offer the closest supported action.",
        offerClosestSupportedActions: true,
        citations: citation,
      },
      clocks: [{
        id: "danger",
        name: "Danger",
        segments: 4,
        advanceWhen: "The party waits.",
        effects: ["Noise increases."],
        citations: citation,
      }],
    });
    assertEquals(validateAdventure(pkg).filter((issue) => issue.severity === "blocker"), []);
    await markAdventureReady(pkg);
    assertEquals(pkg.manifest.status, "ready");
    let guideStarted = false;
    await runGuideCommand([root, "--play", "beginner"], { cwd: root }, {
      runTui: (options) => {
        guideStarted = true;
        assert(options.welcomeMessage.includes("don't have a character"));
        assert(options.startupInstruction?.includes("do not begin the opening scene"));
        assert(options.resumeInstruction?.includes("Previously on…"));
        assert(options.resumeInstruction?.includes("without advancing time"));
        for (
          const name of [
            "character_create",
            "character_select",
            "character_update",
            "character_memory_recall",
            "roll_dice",
            "record_roll_outcome",
            "roll_history",
          ]
        ) {
          assert(options.tools.some((tool) => tool.name === name));
          assert(options.agent.tools.includes(name));
        }
        return Promise.resolve();
      },
    });
    assert(guideStarted);
    const beginnerState = await loadOrCreateGameState(pkg, "beginner");
    assertEquals(beginnerState.elapsedTurns, 0);
    assertEquals(beginnerState.characterSetupComplete, false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("mechanical state updates are revision checked and audited", async () => {
  const { root, pkg, citation } = await fixture();
  try {
    await upsertCanonFact(pkg, {
      id: "secret-one",
      statement: "A secret.",
      visibility: "guide",
      category: "secret",
      citations: citation,
    });
    await upsertScene(pkg, {
      id: "scene-one",
      name: "Scene One",
      summary: "Opening scene.",
      locationIds: [],
      entryConditions: [],
      supportedActions: ["Act"],
      fallbackActions: [],
      secretIds: ["secret-one"],
      transitions: [],
      citations: citation,
    });
    const initial = await loadOrCreateGameState(pkg, "table");
    const { state } = await applyStateTransaction(pkg, "table", initial.revision, "Players enter", [
      { kind: "set_current_scene", sceneId: "scene-one" },
      { kind: "advance_turns", amount: 1 },
      { kind: "reveal_secret", secretId: "secret-one" },
    ]);
    assertEquals(state.revision, 1);
    assertEquals(state.currentSceneId, "scene-one");
    assertEquals(state.revealedSecrets, ["secret-one"]);
    await assertRejects(
      () => applyStateTransaction(pkg, "table", 0, "Stale update", [{ kind: "advance_turns", amount: 1 }]),
      Error,
      "expected revision 0",
    );
    const events = await Deno.readTextFile(`${root}/plays/table/events.jsonl`);
    assert(events.includes('"revision":1'));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("adventure-local agent layers append prompts but cannot remove protected guide state tools", async () => {
  const { root } = await fixture();
  try {
    await Deno.writeTextFile(
      `${root}/.adventure/agents/guide.md`,
      "---\nname: Local Guide\ntools:\n  - memory_recall\n---\nUse a nautical voice when the table asks for it.\n",
    );
    const guide = await loadAgentDefinition("guide", root);
    assertEquals(guide.displayName, "Local Guide");
    assert(guide.systemPrompt.includes("nautical voice"));
    assert(guide.tools.includes("game_state_read"));
    assert(guide.tools.includes("game_state_update"));
    assert(guide.tools.includes("roll_dice"));
    assert(guide.tools.includes("record_roll_outcome"));
    assert(guide.tools.includes("roll_history"));
    assert(guide.tools.includes("memory_recall"));
    assert(guide.tools.includes("memory_store"));
    const author = await loadAgentDefinition("author", root);
    assert(author.tools.includes("source_load_pdf"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
