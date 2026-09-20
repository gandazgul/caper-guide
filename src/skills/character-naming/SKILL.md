---
name: character-naming
description: Review cast-name clarity and propose setting-consistent names for approved additions during authoring. Preserve source names and entity identities; this is not a random-name generator.
---

# Character naming

Harness-specific guidance informed by
[jwynia's character-naming skill](https://github.com/jwynia/agent-skills/blob/main/skills/creative/fiction/character/character-naming/SKILL.md).
This is an original editorial adaptation. The upstream random generators, cultural datasets, and cast-tracker
files are not installed; do not claim random sampling or tool-verified pronunciation.

## Make names usable at the table

Review the existing cast before proposing names. Consider the setting, established naming conventions, and how
names sound aloud. For new suggestions, vary easily confused initial sounds and rhythms where useful. Prefer
names players can recognize and say over decorative complexity. Related names can express a family or shared
tradition; similarity is not automatically a defect. A familiar or common name is not inherently bad writing.

## Preserve the adventure's identities

Source names stay intact unless the author explicitly approves a change under the adaptation policy. When
published names are easy to confuse, offer a clear role label or an approved pronunciation note rather than
silently renaming someone. Check whether apparent variants are extraction errors, aliases, or different people
before changing anything. Never merge entities merely because their names resemble one another.

Only propose a name when the author requests one or an approved addition needs it. Use existing source context
rather than reopening settled setup questions. Present a small shortlist with a recommendation and a short
reason, leaving room for the author's own name. Label proposals as invented, not PDF facts. Do not claim
historical authenticity, a real-language meaning, or cultural provenance without evidence. A name alone does
not establish ancestry, personality, morality, or social status.

If the user specifically wants random generation, explain that this skill does not supply a randomness tool;
do not present model suggestions as random draws. Do not create a parallel cast database to compensate.

Read the current entity and references before saving an approved name with author_upsert_entity. Preserve its
stable ID and unrelated fields. Keep source citations as context for the adaptation, not evidence that the PDF
contains the new name. If the current asset model cannot distinguish a source name from an approved
alternative, flag that limitation instead of overwriting the source's identity ambiguously. Validate affected
assets after a change.
