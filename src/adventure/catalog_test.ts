import { assert, assertEquals, assertRejects } from "@std/assert";
import { visibleWidth } from "@earendil-works/pi-tui";
import { discoverAdventures, newAdventureLocation } from "./catalog.ts";
import { createAdventurePackage, loadAdventurePackage } from "./package.ts";
import { pathExists } from "./io.ts";
import { runAuthorCommand } from "../commands/author.ts";
import { AdventurePicker, type AdventureSelection } from "../ui/adventure-picker.ts";

async function inTemp(run: (root: string) => Promise<void>) {
  const root = await Deno.makeTempDir({ prefix: "adventure-menu-test-" });
  try {
    await run(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test("adventure discovery lists packages and reports broken ones without creating files", async () => {
  await inTemp(async (root) => {
    assertEquals((await discoverAdventures(root)).adventures, []);
    assertEquals(await pathExists(`${root}/adventures`), false);
    const pkg = await createAdventurePackage(`${root}/adventures/mystery`, { title: "A Mystery" });
    await Deno.mkdir(`${root}/adventures/not-a-package`);
    await Deno.mkdir(`${root}/adventures/broken`);
    await Deno.writeTextFile(`${root}/adventures/broken/adventure.json`, "invalid");
    const catalog = await discoverAdventures(root);
    assertEquals(catalog.adventures.map((entry) => entry.title), ["A Mystery"]);
    assertEquals(catalog.warnings.length, 1);
    assertEquals((await discoverAdventures(`${root}/adventures`)).adventures, catalog.adventures);
    assertEquals((await discoverAdventures(pkg.root)).adventures, catalog.adventures);
  });
});

Deno.test("new adventure names cannot reuse or overwrite an existing directory", async () => {
  await inTemp(async (root) => {
    assertEquals(await newAdventureLocation(root, "Lantern House"), `${root}/lantern-house`);
    await Deno.mkdir(`${root}/lantern-house`);
    await assertRejects(() => newAdventureLocation(root, "Lantern House"), Error, "already exists");
    await assertRejects(() => newAdventureLocation(root, "  "), Error, "name first");
  });
});

Deno.test("author menu cancellation leaves no default package", async () => {
  await inTemp(async (root) => {
    await runAuthorCommand([], { cwd: root }, {
      pickAdventure: async () => null,
      runTui: () => {
        throw new Error("Must not start an agent after cancel");
      },
    });
    assertEquals(await pathExists(`${root}/adventures`), false);
    await assertRejects(() => runAuthorCommand(["--prepare-only"], { cwd: root }), Error, "--output");
    assertEquals(await pathExists(`${root}/adventures`), false);
  });
});

Deno.test("choosing an existing adventure preserves it and continues its latest chat", async () => {
  await inTemp(async (root) => {
    const pkg = await createAdventurePackage(`${root}/adventures/mystery`, { title: "A Mystery" });
    const before = await Deno.readTextFile(`${pkg.root}/adventure.json`);
    let opened = false;
    await runAuthorCommand([], { cwd: root }, {
      pickAdventure: async () => ({ root: pkg.root, title: pkg.manifest.title, isNew: false }),
      runTui: async (options) => {
        opened = true;
        assertEquals(options.pkg.root, pkg.root);
        assertEquals(options.continueSession, true);
      },
    });
    assert(opened);
    assertEquals(await Deno.readTextFile(`${pkg.root}/adventure.json`), before);
    assertEquals(await pathExists(`${root}/adventures/new-adventure`), false);
  });
});

Deno.test("choosing new creates the named package and a fresh author conversation", async () => {
  await inTemp(async (root) => {
    const output = `${root}/adventures/lantern-house`;
    await runAuthorCommand([], { cwd: root }, {
      pickAdventure: async () => ({ root: output, title: "Lantern House", isNew: true }),
      runTui: async (options) => {
        assertEquals(options.continueSession, false);
        assertEquals(options.startupInstruction, undefined);
      },
    });
    assertEquals((await loadAdventurePackage(output)).manifest.title, "Lantern House");
  });
});

Deno.test("explicit package paths bypass the menu and preserve explicit session choice", async () => {
  await inTemp(async (root) => {
    const pkg = await createAdventurePackage(`${root}/adventures/mystery`);
    await runAuthorCommand([pkg.root, "--session", "session-id"], { cwd: root }, {
      pickAdventure: () => {
        throw new Error("Explicit paths must bypass menu");
      },
      runTui: async (options) => {
        assertEquals(options.sessionId, "session-id");
        assertEquals(options.continueSession, false);
      },
    });
  });
});

Deno.test("picker displays existing adventures, supports keyboard selection and fits narrow terminals", async () => {
  await inTemp(async (root) => {
    await createAdventurePackage(`${root}/adventures/mystery`, { title: "A Mystery" });
    const catalog = await discoverAdventures(root);
    let result: AdventureSelection | null | undefined;
    const picker = new AdventurePicker(catalog, (choice) => {
      result = choice;
    }, () => {});
    const output = picker.render(80).join("\n");
    assert(output.includes("A Mystery"));
    assert(output.includes("Create new adventure"));
    assert(picker.render(30).every((line) => visibleWidth(line) <= 30));
    picker.handleInput("\r");
    assertEquals(result?.root, catalog.adventures[0].root);
    assertEquals(result?.isNew, false);
  });
});

Deno.test("picker can name a new adventure or return to the menu without creating anything", async () => {
  await inTemp(async (root) => {
    const catalog = await discoverAdventures(root);
    let done!: (choice: AdventureSelection | null) => void;
    const result = new Promise<AdventureSelection | null>((resolve) => {
      done = resolve;
    });
    const picker = new AdventurePicker(catalog, done, () => {});
    picker.handleInput("\r");
    assert(picker.render(80).join("\n").includes("What would you like to call"));
    picker.handleInput("\x1b");
    assert(picker.render(80).join("\n").includes("Welcome."));
    picker.handleInput("\r");
    picker.handleInput("Lantern House");
    picker.handleInput("\r");
    assertEquals(await result, {
      root: `${root}/adventures/lantern-house`,
      title: "Lantern House",
      isNew: true,
    });
    assertEquals(await pathExists(`${root}/adventures`), false);
  });
});
