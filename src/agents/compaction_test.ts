import { assert, assertEquals } from "@std/assert";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { Agent } from "@earendil-works/pi-agent-core";
import { installGuideCompactionContinuity } from "./compaction.ts";
import { harnessSettings } from "./runtime.ts";

Deno.test("automatic compaction defaults on and preserves explicit user settings", () => {
  const defaults = SettingsManager.inMemory(harnessSettings({}));
  assert(defaults.getCompactionEnabled());
  assertEquals(defaults.getCompactionSettings().keepRecentTokens, 20000);
  const disabled = SettingsManager.inMemory(harnessSettings({ compaction: { enabled: false } }));
  assertEquals(disabled.getCompactionEnabled(), false);
});

Deno.test("Guide compaction uses continuity instructions and reload reminder without changing durable messages", async () => {
  const agent = new Agent();
  let emit: (event: AgentSessionEvent) => void = () => {};
  let sentPrompt = "";
  agent.streamFn = (_model, context) => {
    sentPrompt = context.systemPrompt ?? "";
    return {} as any;
  };
  let transforms = 0;
  agent.transformContext = async (messages) => {
    transforms++;
    return messages;
  };
  installGuideCompactionContinuity({
    agent,
    subscribe: (listener) => {
      emit = listener;
      return () => {};
    },
  });
  const messages = [{ role: "user" as const, content: "Look around", timestamp: 1 }];
  const context = { systemPrompt: "Summarize", messages };
  for (const reason of ["manual", "threshold", "overflow"] as const) {
    emit({ type: "compaction_start", reason });
    await agent.streamFn({} as any, context);
    assert(sentPrompt.includes("Adventure Guide continuity checkpoint"));
    assert(sentPrompt.includes("NPC claims, PC beliefs"));
    assertEquals(context.systemPrompt, "Summarize");
    emit({
      type: "compaction_end",
      reason,
      result: { summary: "Checkpoint" } as any,
      aborted: false,
      willRetry: reason === "overflow",
    });
    const recovered = await agent.transformContext!(messages);
    assertEquals(recovered.length, 2);
    assert(JSON.stringify(recovered).includes("reload game_state_read"));
    assertEquals(messages.length, 1);
    assertEquals(await agent.transformContext!(messages), messages);
    await agent.streamFn({} as any, context);
    assertEquals(sentPrompt, "Summarize");
  }
  emit({ type: "compaction_end", reason: "manual", result: undefined, aborted: true, willRetry: false });
  assertEquals(await agent.transformContext!(messages), messages);
  assertEquals(transforms, 7);
});
