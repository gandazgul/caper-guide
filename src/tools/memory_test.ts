import { assert, assertEquals, assertRejects } from "@std/assert";
import { createAdventurePackage } from "../adventure/package.ts";
import { createAuthorMemoryTools, createGuideMemoryTools } from "./memory.ts";

Deno.test("game continuity writes are automatic while author preferences remain opt-in; recall is play-scoped", async () => {
  const root = await Deno.makeTempDir();
  try {
    const pkg = await createAdventurePackage(root, { title: "Memory scopes" });
    const calls: string[][] = [];
    const tools = createGuideMemoryTools(pkg, "first", (_cwd, args) => {
      calls.push(args);
      return Promise.resolve("ok");
    });
    const ctx = {} as any;
    const saved = await tools[1].execute(
      "save",
      {
        content: "The goblins call the scholar Pink Scholar after his potion story.",
        kind: "conversation",
      },
      undefined,
      undefined,
      ctx,
    );
    assertEquals(
      (saved.details as any).stored,
      "The goblins call the scholar Pink Scholar after his potion story.",
    );
    assert(calls.at(-1)!.includes("play-first"));
    await tools[0].execute("recall", { query: "goblin nickname" }, undefined, undefined, ctx);
    assert(calls.at(-1)!.includes("--tag"));
    assert(calls.at(-1)!.includes("play-first"));
    await assertRejects(
      () => tools[1].execute("bad", { content: "HP: 4", kind: "continuity_note" }, undefined, undefined, ctx),
      Error,
      "mechanical",
    );
    await assertRejects(
      () =>
        createAuthorMemoryTools(pkg)[1].execute(
          "author",
          {
            content: "Prefers mysteries",
            kind: "preference",
          },
          undefined,
          undefined,
          ctx,
        ),
      Error,
      "explicit",
    );
    const offline = createGuideMemoryTools(pkg, "first", () => Promise.reject(new Error("offline")));
    await assertRejects(
      () =>
        offline[1].execute(
          "save",
          {
            content: "An established event",
            kind: "experience",
          },
          undefined,
          undefined,
          ctx,
        ),
      Error,
      "offline",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
