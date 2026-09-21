import { assert, assertEquals, assertThrows } from "@std/assert";
import { createRollDiceTool, rollDice } from "./dice.ts";
import { loadAgentDefinition } from "../agents/loader.ts";

Deno.test("dice return individual values by notation and computed totals, merging repeated face types", () => {
  const words = [3, 0, 19, 0];
  const result = rollDice(
    [{ faces: 6, count: 1 }, { faces: 20, count: 2 }, { faces: 6, count: 1 }],
    () => words.shift()!,
  );
  assertEquals(result, {
    rolls: { "2d6": [4, 1], "2d20": [20, 1] },
    totals: { "2d6": 5, "2d20": 21 },
    total: 26,
  });
});

Deno.test("rejection sampling discards the incomplete upper bucket without discarding valid boundaries", () => {
  // 2^32 mod 6 = 4: the top four words must never map to a die face.
  const words = [4294967292, 4294967295, 0, 4294967291];
  const result = rollDice([{ faces: 6, count: 2 }], () => words.shift()!);
  assertEquals(result.rolls, { "2d6": [1, 6] });
  assertEquals(words, []);
  assertEquals(rollDice([{ faces: 1, count: 1 }], () => 4294967295).rolls, { "1d1": [1] });
  assertEquals(rollDice([{ faces: 8, count: 1 }], () => 4294967295).rolls, { "1d8": [8] });
});

Deno.test("dice reject invalid or excessive requests before drawing any random values", () => {
  let draws = 0;
  const invalid: unknown[] = [
    null,
    {},
    [],
    Array(101).fill({ faces: 6, count: 1 }),
    [{ faces: 0, count: 1 }],
    [{ faces: -6, count: 1 }],
    [{ faces: 6.5, count: 1 }],
    [{ faces: 1_000_001, count: 1 }],
    [{ faces: Infinity, count: 1 }],
    [{ faces: 6, count: 0 }],
    [{ faces: 6, count: 1.5 }],
    [{ faces: 6, count: 1001 }],
    [{ faces: 6, count: 501 }, { faces: 20, count: 500 }],
    [{ faces: "6", count: 1 }],
    [{ faces: 6, count: 1, seed: 123 }],
    [{ faces: 6, count: 1 }, null],
  ];
  for (const request of invalid) assertThrows(() => rollDice(request, () => ++draws));
  assertEquals(draws, 0);
  for (const word of [-1, 2 ** 32, NaN, 0.5]) {
    assertThrows(() => rollDice([{ faces: 6, count: 1 }], () => word), Error, "unsigned 32-bit");
  }
});

Deno.test("Guide dice tool uses the real crypto RNG, returns bounded results, and is loaded with policy", async () => {
  const tool = createRollDiceTool();
  const result = await tool.execute(
    "test",
    { dice: [{ faces: 6, count: 1000 }] },
    undefined,
    undefined,
    {} as any,
  );
  const details = result.details as ReturnType<typeof rollDice>;
  assertEquals(details.rolls["1000d6"].length, 1000);
  assert(details.rolls["1000d6"].every((n) => Number.isInteger(n) && n >= 1 && n <= 6));
  assertEquals(details.total, details.rolls["1000d6"].reduce((sum, n) => sum + n, 0));
  assertEquals(JSON.parse((result.content[0] as { text: string }).text), details);
  const guide = await loadAgentDefinition("guide");
  assert(guide.tools.includes("roll_dice"));
  assert(guide.systemPrompt.includes("Use roll_dice for every dice roll you make"));
  assert(!(await loadAgentDefinition("author")).tools.includes("roll_dice"));
});
