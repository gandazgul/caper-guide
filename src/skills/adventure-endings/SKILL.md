---
name: adventure-endings
description: Prepare conditional adventure conclusions and deliver concise, outcome-grounded closure. Use when authoring resolution notes or ending a one-shot, distinguishing a completed adventure from a paused session.
---

# Adventure endings

Harness-specific guidance informed by
[jwynia's endings diagnostic](https://github.com/jwynia/agent-skills/blob/main/skills/creative/fiction/structure/endings/SKILL.md).
This original adaptation supports writing and live play; it does not import the upstream diagnostic-only role,
analysis scripts, or separate output files.

## Give the outcome room to land

Distinguish the decisive event, its immediate aftermath, and the closing moment. Make the central outcome
understandable without explaining every minor thread. Connect consequences to what was established instead of
introducing a last-minute solution. Allow a little space to respond after intense action, but avoid an
extended biography of everyone's future. A concrete closing detail can carry more weight than a speech
explaining the adventure's meaning. Unanswered questions can remain without obscuring what was resolved.

## Author: prepare conditional closure

Read the source's ending conditions and relevant scenes. Identify what establishes success, failure, or
another supported stopping point, and what consequences the source actually specifies. Do not assume all
adventures support all outcome types. Preserve the distinction between source material and proposed
adaptation; ask about missing conclusions instead of inventing canonical futures.

Save approved resolution guidance in supported scene fields through author_upsert_scene, keeping public
aftermath separate from guide-only facts. Check that any mechanical outcome can be represented with existing
state tools. Do not invent a completion field or use a memory entry as a substitute. Review conditions for
ambiguity: a dramatic-sounding paragraph is not evidence that a victory condition has been met.

## Guide: conclude the game that was played

Check the current state and authored conditions before declaring the adventure resolved. Apply required
mechanical changes through game_state_update before narrating them as final. Explain the players' actual
result, including mixed or unsuccessful outcomes, without steering them toward a preferred ending.

Do not manufacture a twist, sacrifice, rescue, or final enemy to improve the shape of the story. A legitimate
lucky roll or clean victory needs no correction. Authored outside help remains valid when its conditions are
met. Player characters need not undergo personal transformation; invite a brief reaction or epilogue if
wanted, but let players decide their own actions and feelings.

Ending play does not lift spoiler restrictions. Unrevealed secrets remain protected, and requested answers
still follow reveal policy and state updates. Do not invent future world changes or character fates merely to
tie up loose threads.

If the group stops before resolution, call it a pause rather than declaring success or advancing unresolved
events. Briefly recap known circumstances and the pending decision from saved state. Offer continuation
without using a compulsory cliffhanger or sequel hook to deny closure to a completed one-shot.
