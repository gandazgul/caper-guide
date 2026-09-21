import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { continueAdventureSession, parseModelRef } from "../agents/runtime.ts";
import { runAuthorCommand } from "../commands/author.ts";
import { runGuideCommand } from "../commands/guide.ts";
import { createQuestionnaireTool } from "../tools/questionnaire.ts";
import { createSourceTools, resolvePdfInputPath } from "../tools/source.ts";
import { createAuthorMemoryTools } from "../tools/memory.ts";
import { createAdventureReadTool } from "../tools/guide.ts";
import { pathExists, safeId, writeJsonAtomic } from "./io.ts";
import {
  createAdventurePackage,
  loadAdventurePackage,
  saveAsset,
  saveManifest,
  saveSources,
} from "./package.ts";
import type { AdventurePackage } from "./package.ts";
import { applyStateTransaction, loadOrCreateGameState } from "./state.ts";
import { validateAdventure } from "./validation.ts";
import { fileURLToPath } from "node:url";

Deno.test("launch permissions allow OS metadata used by model request headers without prompting", async () => {
  const config = JSON.parse(await Deno.readTextFile(new URL("../../deno.json", import.meta.url)));
  const allowedCommands = config.tasks.adventure.split(" ").find((arg: string) =>
    arg.startsWith("--allow-run=")
  );
  assert(allowedCommands.split("=")[1].split(",").includes("mnemoteca"));
  const permission = config.tasks.adventure.split(" ").find((arg: string) => arg.startsWith("--allow-sys="));
  assert(permission);
  const probe =
    'import { homedir, release } from "node:os"; if (!homedir() || !release()) throw new Error("Missing OS metadata");';
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["run", "--no-prompt", permission, `data:application/javascript,${encodeURIComponent(probe)}`],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
});

async function withPackage(run: (pkg: AdventurePackage) => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "adventure-polish-test-" });
  try {
    const pkg = await createAdventurePackage(`${root}/adventure`, { id: "test", title: "Test" });
    pkg.sources.push({
      id: "source-test",
      title: "Source",
      sha256: "a".repeat(64),
      originalFilename: "test.pdf",
      importedFrom: "/test.pdf",
      pdfPath: "sources/files/source-test.pdf",
      extractedPath: "sources/extracted/source-test.md",
      pageCount: 1,
      importedAt: new Date().toISOString(),
    });
    await saveSources(pkg);
    await run(pkg);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test("model references preserve slashes within a colon-separated model ID", () => {
  assertEquals(parseModelRef("openrouter:openai/gpt-5"), { provider: "openrouter", id: "openai/gpt-5" });
  assertEquals(parseModelRef("openai/gpt-5"), { provider: "openai", id: "gpt-5" });
  assertThrows(() => parseModelRef("gpt-5"), Error, "Model must be");
});

Deno.test("quoted @ completion paths are accepted", () => {
  assertEquals(resolvePdfInputPath('@"My Sources/adventure.pdf"', "/tmp"), "/tmp/My Sources/adventure.pdf");
  assertEquals(resolvePdfInputPath('"@My Sources/adventure.pdf"', "/tmp"), "/tmp/My Sources/adventure.pdf");
});

Deno.test("invalid author arguments do not leave an adventure directory", async () => {
  const root = await Deno.makeTempDir();
  try {
    await assertRejects(
      () => runAuthorCommand(["missing.pdf", "--prepare-only"], { cwd: root }),
      Error,
      "PDF not found",
    );
    await assertRejects(
      () => runAuthorCommand(["--continue", "--session", "abc"], { cwd: root }),
      Error,
      "not both",
    );
    assertEquals(await pathExists(`${root}/adventures`), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("CLI failures and validation blockers return a nonzero shell exit status", async () => {
  await withPackage(async (pkg) => {
    const cli = fileURLToPath(new URL("../cli.ts", import.meta.url));
    for (const args of [["unknown-command"], ["validate", pkg.root]]) {
      const output = await new Deno.Command(Deno.execPath(), {
        args: ["run", "--allow-read", "--allow-env", "--allow-sys=homedir", cli, ...args],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(output.code, 1);
    }
  });
});

Deno.test("guide rejects drafts before creating mechanical state", async () => {
  await withPackage(async (pkg) => {
    await assertRejects(() => runGuideCommand([pkg.root], { cwd: pkg.root }), Error, "not ready for play");
    assertEquals(await pathExists(`${pkg.root}/plays`), false);
  });
});

Deno.test("editing published assets invalidates ready status on disk", async () => {
  await withPackage(async (pkg) => {
    pkg.manifest.status = "ready";
    await saveManifest(pkg);
    await saveAsset(pkg, "canon", pkg.assets.canon);
    assertEquals((await loadAdventurePackage(pkg.root)).manifest.status, "draft");
  });
});

Deno.test("package loading rejects asset paths outside its fixed layout", async () => {
  await withPackage(async (pkg) => {
    await writeJsonAtomic(`${pkg.root}/adventure.json`, {
      ...pkg.manifest,
      assetFiles: { ...pkg.manifest.assetFiles, canon: "../private.json" },
    });
    await assertRejects(() => loadAdventurePackage(pkg.root), Error, "Invalid adventure asset path");
  });
});

Deno.test("validation checks runtime evidence, duplicate IDs, scene locations and secrets", async () => {
  await withPackage(async (pkg) => {
    pkg.assets.runtime.rules = {
      systemName: "Custom",
      resolution: "Roll a die",
      whoRolls: "Players",
      citations: [],
    };
    const scene = {
      id: "opening",
      name: "Opening",
      summary: "A room",
      locationIds: ["missing"],
      secretIds: ["missing"],
      entryConditions: [],
      supportedActions: [],
      fallbackActions: [],
      transitions: [],
      citations: [{ sourceId: "source-test", page: 1 }],
      updatedAt: new Date().toISOString(),
    };
    pkg.assets.scenes.scenes = [scene, scene];
    const issues = validateAdventure(pkg);
    assert(issues.some((issue) => issue.code === "evidence.invalid" && issue.recordId === "rules"));
    for (const code of ["record.duplicate", "scene.location_missing", "scene.secret_missing"]) {
      assert(issues.some((issue) => issue.code === code));
    }
  });
});

Deno.test("source search finds short RPG terms such as HP and d6", async () => {
  await withPackage(async (pkg) => {
    await Deno.mkdir(`${pkg.root}/sources/extracted`);
    await Deno.writeTextFile(
      `${pkg.root}/sources/extracted/source-test.md`,
      "<!-- page 1 -->\nHP 4. Roll d6.",
    );
    const search = createSourceTools(pkg).find((tool) => tool.name === "source_search")!;
    for (const query of ["HP", "d6"]) {
      const result = await search.execute("test", { query }, undefined, undefined, {} as never);
      assertEquals((result.details as { results: unknown[] }).results.length, 1);
    }
  });
});

Deno.test("author can read durable asset contents without relying on conversation", async () => {
  await withPackage(async (pkg) => {
    const result = await createAdventureReadTool(pkg).execute(
      "test",
      { section: "setup" },
      undefined,
      undefined,
      {} as never,
    );
    assertEquals(result.details, pkg.assets.setup);
  });
});

Deno.test("memory writes enforce explicit consent before invoking storage", async () => {
  await withPackage(async (pkg) => {
    const store = createAuthorMemoryTools(pkg).find((tool) => tool.name === "memory_store")!;
    await assertRejects(
      () =>
        store.execute(
          "test",
          { content: "Prefers mysteries", kind: "preference" },
          undefined,
          undefined,
          {} as never,
        ),
      Error,
      "explicit request",
    );
  });
});

Deno.test("competing state updates cannot both commit the same revision", async () => {
  await withPackage(async (pkg) => {
    await loadOrCreateGameState(pkg, "solo");
    const results = await Promise.allSettled(
      [1, 2].map((amount) =>
        applyStateTransaction(pkg, "solo", 0, "Advance time", [{ kind: "advance_turns", amount }])
      ),
    );
    assertEquals(results.filter((result) => result.status === "fulfilled").length, 1);
    assertEquals(results.filter((result) => result.status === "rejected").length, 1);
    assertEquals((await loadOrCreateGameState(pkg, "solo")).revision, 1);
    const events = (await Deno.readTextFile(`${pkg.root}/plays/solo/events.jsonl`)).trim().split("\n");
    assertEquals(events.length, 1);
  });
});

Deno.test("invalid changes roll back the whole state transaction", async () => {
  await withPackage(async (pkg) => {
    const before = await loadOrCreateGameState(pkg, "solo");
    await assertRejects(
      () =>
        applyStateTransaction(pkg, "solo", 0, "Invalid batch", [
          { kind: "advance_turns", amount: 2 },
          { kind: "inventory_remove", itemId: "key", amount: 1 },
        ]),
      Error,
      "only 0 recorded",
    );
    assertEquals(await loadOrCreateGameState(pkg, "solo"), before);
    assertEquals(await pathExists(`${pkg.root}/plays/solo/events.jsonl`), false);
    await assertRejects(
      () =>
        applyStateTransaction(pkg, "solo", 0, "Unknown location", [
          { kind: "set_actor_location", actorId: "hero", locationId: "nowhere" },
        ]),
      Error,
      "Unknown location",
    );
    assertThrows(() => safeId("__proto__"), Error, "Reserved ID");
  });
});

Deno.test("interrupted state commit recovers exactly once from its journal", async () => {
  await withPackage(async (pkg) => {
    const state = await loadOrCreateGameState(pkg, "solo");
    state.revision = 1;
    state.elapsedTurns = 2;
    const event = {
      eventId: "event-test",
      adventureId: pkg.manifest.id,
      playId: "solo",
      revision: 1,
      timestamp: state.updatedAt,
      reason: "Advance time",
      changes: [{ kind: "advance_turns", amount: 2 }],
    };
    const pending = `${pkg.root}/plays/solo/.pending-transaction.json`;
    await writeJsonAtomic(pending, { state, event });
    assertEquals(await loadOrCreateGameState(pkg, "solo"), state);
    // Simulate a crash after the log and state were written but before removing the journal.
    await writeJsonAtomic(pending, { state, event });
    assertEquals(await loadOrCreateGameState(pkg, "solo"), state);
    const log = (await Deno.readTextFile(`${pkg.root}/plays/solo/events.jsonl`)).trim().split("\n");
    assertEquals(log.length, 1);
    assertEquals(await pathExists(pending), false);
  });
});

Deno.test("continue follows the adventure, not the directory it was launched from", async () => {
  const root = await Deno.makeTempDir();
  try {
    const manager = SessionManager.create("/old-launch-directory", root);
    manager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Welcome" }],
      api: "openai-responses",
      provider: "openai",
      model: "test",
      stopReason: "stop",
      timestamp: Date.now(),
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    });
    const resumed = await continueAdventureSession(root, "/new-launch-directory");
    assertEquals(resumed.getSessionId(), manager.getSessionId());
    assertEquals(resumed.getCwd(), "/new-launch-directory");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

const question = {
  id: "tone",
  label: "Mood",
  prompt: "What mood do you want?",
  whyItMatters: "This shapes how scenes feel.",
  multiple: false,
  options: [
    { value: "mystery", label: "Mysterious", description: "Explore quietly and follow clues." },
    { value: "action", label: "Action", description: "Move quickly between dramatic moments." },
  ],
  recommendedOptionId: "mystery",
  recommendationReason: "The source centers on a mystery.",
  recommendationCitations: [{ sourceId: "source-test", page: 1 }],
};

interface QuestionUi {
  render(width: number): string[];
  handleInput(input: string): void;
}
async function answerQuestion(pkg: AdventurePackage, multiple: boolean, act: (ui: QuestionUi) => void) {
  const ctx = {
    mode: "tui",
    ui: {
      custom: (factory: (...args: any[]) => QuestionUi) =>
        new Promise((resolve) => {
          const ui = factory(
            { requestRender() {} },
            { fg: (_: string, text: string) => text, bold: (text: string) => text },
            {},
            resolve,
          );
          act(ui);
        }),
    },
  };
  return await createQuestionnaireTool(pkg).execute(
    "test",
    { questions: [{ ...question, multiple }] },
    undefined,
    undefined,
    ctx as never,
  );
}

Deno.test("questionnaire supports recommended multi-choice and reports an empty selection", async () => {
  await withPackage(async (pkg) => {
    const result = await answerQuestion(pkg, true, (ui) => {
      assert(ui.render(90).join("\n").includes("[✓] Mysterious"));
      ui.handleInput(" ");
      ui.handleInput("\r");
      assert(ui.render(90).join("\n").includes("Choose at least one"));
      ui.handleInput("\x1b[B");
      ui.handleInput(" ");
      ui.handleInput("\r");
    });
    assertEquals((result.details as any).answers[0].values, ["action"]);
  });
});

Deno.test("questionnaire resizes and accepts a free-text Other answer", async () => {
  await withPackage(async (pkg) => {
    const result = await answerQuestion(pkg, false, (ui) => {
      ui.render(90);
      assert(ui.render(32).every((line) => visibleWidth(line) <= 32));
      ui.handleInput("\x1b[B");
      ui.handleInput("\x1b[B");
      ui.handleInput("\r");
      ui.handleInput("Lighthearted mystery");
      ui.handleInput("\r");
    });
    assertEquals((result.details as any).answers[0].customAnswers, ["Lighthearted mystery"]);
    assertEquals((result.details as any).answers[0].values, []);
  });
});

Deno.test("questionnaire rejects duplicate choices before showing the UI", async () => {
  await withPackage(async (pkg) => {
    await assertRejects(
      () =>
        createQuestionnaireTool(pkg).execute(
          "test",
          {
            questions: [{ ...question, options: [question.options[0], question.options[0]] }],
          },
          undefined,
          undefined,
          {} as never,
        ),
      Error,
      "unique values",
    );
  });
});
