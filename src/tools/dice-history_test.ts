import { assert, assertEquals, assertRejects } from "@std/assert";
import { createAdventurePackage, loadAdventurePackage } from "../adventure/package.ts";
import { applyStateTransaction } from "../adventure/state.ts";
import { executePcRoll, readPcRollHistory, recordPcOutcome } from "./dice-history.ts";
import { createRollDiceTool } from "./dice.ts";

const dice = [{ faces: 6, count: 2 }];
async function fixture() {
  const root = await Deno.makeTempDir();
  const pkg = await createAdventurePackage(root, { title: "Dice test" });
  await applyStateTransaction(pkg, "solo", 0, "Select test character", [{
    kind: "select_character",
    characterId: crypto.randomUUID(),
  }]);
  return { root, pkg };
}

Deno.test("two failed PC checks enable protected ordinary success without fabricated numbers", async () => {
  const { root, pkg } = await fixture();
  try {
    for (const id of ["one", "two"]) {
      const result = await executePcRoll(pkg, "solo", id, dice, () => 0);
      assert(!result.unluckyProtection);
      await recordPcOutcome(pkg, "solo", id, "failure", "Two does not beat the opponent's six.");
    }
    const tool = createRollDiceTool(pkg, "solo");
    await tool.execute("npc", { dice }, undefined, undefined, {} as any);
    assertEquals((await readPcRollHistory(pkg, "solo")).length, 2);
    // The boundary value 79 gives d100=80, so it still activates protection.
    const result = await executePcRoll(await loadAdventurePackage(root), "solo", "three", dice, () => 79);
    assert(result.unluckyProtection);
    assertEquals(result.outcome, "success");
    assertEquals(result.reason, "unlucky_protection");
    assert(!("rolls" in result));
    assert(!("total" in result));
    await assertRejects(
      () => recordPcOutcome(pkg, "solo", "three", "super_success", "Make it critical"),
      Error,
      "cannot",
    );
    const next = await executePcRoll(pkg, "solo", "four", dice, () => 0);
    assert(!next.unluckyProtection);
    assertEquals((await readPcRollHistory(pkg, "solo")).map((entry) => entry.outcome), [
      "failure",
      "failure",
      "success",
      undefined,
    ]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("protection can miss; pending rolls block new PC checks, and replay never draws again", async () => {
  const { root, pkg } = await fixture();
  try {
    for (const id of ["one", "two"]) {
      await executePcRoll(pkg, "solo", id, dice, () => 0);
      await recordPcOutcome(pkg, "solo", id, "failure", "The stated target was not met.");
    }
    const result = await executePcRoll(pkg, "solo", "three", dice, () => 80);
    assert(!result.unluckyProtection);
    assertEquals(result.rolls, { "2d6": [3, 3] });
    const noDraw = () => {
      throw new Error("Must not redraw");
    };
    assertEquals(await executePcRoll(pkg, "solo", "three", dice, noDraw), result);
    await assertRejects(() => executePcRoll(pkg, "solo", "four", dice, noDraw), Error, "Record the outcome");
    await assertRejects(
      () => executePcRoll(pkg, "solo", "three", [{ faces: 20, count: 1 }], noDraw),
      Error,
      "different parameters",
    );
    await recordPcOutcome(pkg, "solo", "three", "failure", "The stated target was not met.");
    const protectedRoll = await executePcRoll(pkg, "solo", "four", dice, () => 0);
    assert(protectedRoll.unluckyProtection);
    await assertRejects(
      () => recordPcOutcome(pkg, "solo", "missing", "failure", "No matching roll"),
      Error,
      "No recent",
    );
    await assertRejects(
      () => recordPcOutcome(pkg, "solo", "one", "success", "Rewrite failure"),
      Error,
      "cannot",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("natural successes reset protection; histories remain play-local, bounded and concurrency-safe", async () => {
  const { root, pkg } = await fixture();
  try {
    const competing = await Promise.allSettled([
      executePcRoll(pkg, "solo", "one", dice, () => 0),
      executePcRoll(pkg, "solo", "two", dice, () => 0),
    ]);
    assertEquals(competing.filter((result) => result.status === "fulfilled").length, 1);
    const first = (await readPcRollHistory(pkg, "solo"))[0];
    await recordPcOutcome(pkg, "solo", first.callId, "failure", "Below target.");
    await executePcRoll(pkg, "solo", "success", dice, () => 5);
    await recordPcOutcome(
      pkg,
      "solo",
      "success",
      "super_success",
      "Two sixes is exceptional in this test rule.",
    );
    const next = await executePcRoll(pkg, "solo", "next", dice, () => 0);
    assert(!next.unluckyProtection);
    await recordPcOutcome(pkg, "solo", "next", "success", "Target was met.");
    for (let i = 0; i < 22; i++) {
      await executePcRoll(pkg, "solo", `extra-${i}`, dice, () => 0);
      await recordPcOutcome(pkg, "solo", `extra-${i}`, "success", "Target was met.");
    }
    assertEquals((await readPcRollHistory(pkg, "solo")).length, 20);
    await applyStateTransaction(pkg, "other", 0, "Choose character", [{
      kind: "select_character",
      characterId: first.characterId,
    }]);
    assertEquals(await readPcRollHistory(pkg, "other"), []);
    assert(!(await executePcRoll(pkg, "other", "one", dice, () => 0)).unluckyProtection);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
