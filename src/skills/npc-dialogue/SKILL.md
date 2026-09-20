---
name: npc-dialogue
description: Prepare NPC voice notes and write live NPC conversations with distinct voices, purposeful exchanges, and appropriate subtext. Use for character dialogue, not player speech or rules explanations.
---

# NPC dialogue

Harness-specific guidance informed by
[jwynia's dialogue diagnostic](https://github.com/jwynia/agent-skills/blob/main/skills/creative/fiction/character/dialogue/SKILL.md).
This is not a verbatim installation: the upstream skill leaves writing to the human, while here the Author
prepares NPC notes and the Guide performs NPC dialogue. Do not invoke upstream scripts or create its
diagnostic-output files.

## Review the exchange

Consider the spoken words, the speaker's unspoken purpose, and the relationship shaping the conversation. Make
voices distinguishable through phrasing, brevity, formality, and what a speaker attends to—not just different
names or an accent. Use incomplete sentences, pauses, or contractions when they suit the person and moment,
rather than sprinkling them everywhere.

When a conversation feels like an information delivery service, consider what it also shows about the speaker
or relationship. Avoid having people explain shared knowledge solely for the audience. Let established
interests affect what they volunteer, evade, or challenge. Adjust exchange length to the situation. Keep
attribution clear with unobtrusive tags or observable actions, not a decorative synonym for every instance of
“said.”

## Boundaries for live play

Read the NPC's entity record and relevant state before speaking. Their knowledge, relationships, motives, and
available actions come from the package. Subtext does not authorize a new conspiracy, withheld clue, grudge,
or lie. An honest answer can be good dialogue; a routine exchange need not contain conflict or transform a
relationship. Do not make every character evasive to meet a literary checklist.

Keep private motives out of player-facing explanations of what the NPC “really means.” Do not add an
unmistakable behavioral tell that gives away a protected secret. The player may interpret what was
legitimately observed; do not resolve that interpretation for them without the rules.

Answer the player's contribution, then leave room for a reply. Never script the player character's half of a
conversation, invent their agreement, or let an NPC monologue advance past their opportunity to act. Dialogue
does not bypass rolls, comfort boundaries, or state updates for bargains, item transfers, revealed clues, or
other mechanical changes.

## Author versus Guide

The Author can propose a compact voice note: how this NPC speaks, what they already know, what they want in
the situation, and a brief example. Distinguish source facts from proposed stylistic choices; save approved
notes with author_upsert_entity. Avoid fixed exchanges that assume player replies.

The Guide uses those notes flexibly. Aim for a recognizable person responding to this player, not repetition
of an example line. If a voice note is absent, follow established characterization and the adaptation policy;
do not invent a biography to justify a speech pattern.
