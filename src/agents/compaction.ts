import type { AgentSession } from "@earendil-works/pi-coding-agent";

export const GUIDE_COMPACTION_INSTRUCTIONS = `
This is an Adventure Guide continuity checkpoint, not a coding-task summary.
Preserve: the PC's identity and motivation; player-visible experiences and observations; important player
anecdotes and NPC conversations; relationships and promises; latest established appearance; open questions;
accepted rulings; the current player request; and unresolved tool/roll operations without replaying them.
Keep observed facts, NPC claims, PC beliefs and untested theories separate. Never turn hidden source/tool
information, accidental spoilers or GM-only reasoning into PC knowledge. Record unknowns as open questions,
not hidden answers. Note which meaningful developments have not yet been saved to memory, if evident.
Preserve the active adventure/play identity and references needed to reload its tools and records.
State snapshots in this summary are historical: game_state_read is authoritative for live mechanics and
location, character_read for the saved profile, roll_history for recorded/pending PC rolls, and both memory
recall tools for narrative continuity. Preserve memory failures as failures, not successful saves.
Do not execute gameplay, invent outcomes, change state or resolve the current action while summarizing.
`;

export const GUIDE_COMPACTION_RECOVERY = `
[Adventure Guide harness: context was compacted.]
Before resolving the player's next action, reload game_state_read and character_read, then relevant
character_memory_recall and memory_recall notes for this play (if a PC is selected). Recover unresolved dice
from roll_history instead of rolling again. Do not trust the summary's stale mechanics or other actors'
hidden locations as player knowledge. If the summary identifies unsaved, established player-visible events,
save concise notes through the correct memory tools, checking for duplicates and preserving uncertainty.
Memory failures do not authorize invented continuity. Continue the actual pending player request without
replaying actions, advancing time for maintenance, or giving an unsolicited new scene. Do not repeat a
Previously on recap merely because compaction happened during active play.
`;

/** Harness-owned public SDK hooks; not an extension and no upstream patching. */
export function installGuideCompactionContinuity(session: Pick<AgentSession, "agent" | "subscribe">): void {
  let compacting = false;
  let recoveryNeeded = false;
  session.subscribe((event) => {
    if (event.type === "compaction_start") compacting = true;
    if (event.type === "compaction_end") {
      compacting = false;
      if (event.result && !event.aborted && !event.errorMessage) recoveryNeeded = true;
    }
  });

  const originalStream = session.agent.streamFn;
  session.agent.streamFn = (model, context, options) =>
    originalStream(
      model,
      compacting
        ? { ...context, systemPrompt: `${context.systemPrompt ?? ""}\n${GUIDE_COMPACTION_INSTRUCTIONS}` }
        : context,
      options,
    );

  const originalTransform = session.agent.transformContext;
  session.agent.transformContext = async (messages, signal) => {
    const transformed = originalTransform ? await originalTransform(messages, signal) : messages;
    if (!recoveryNeeded || compacting || signal?.aborted) return transformed;
    recoveryNeeded = false;
    // An ephemeral instruction for the next request: never rewrite the saved conversation or state.
    return [...transformed, {
      role: "user",
      content: [{ type: "text", text: GUIDE_COMPACTION_RECOVERY }],
      timestamp: Date.now(),
    }];
  };
}
