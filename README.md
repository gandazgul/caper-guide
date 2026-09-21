# Caper Guide

Caper Guide is a local Deno/TypeScript harness for turning one or more adventure PDFs into a durable package,
then running that package for players with an AI Adventure Guide.

This is a working name for a companion to Caper. The CLI currently displays **Adventure Runner**; existing
commands, configuration paths, and session storage remain unchanged while the product takes shape.

It is designed for bounded, prewritten one-shot adventures. The model is not the source of the world: the PDF
evidence, authored assets, and verified play state are.

## What works now

- Imports one or more PDFs with `unpdf`.
- Keeps a local copy of each PDF and a page-marked Markdown extraction.
- Lets the Author read local text files, import standalone map images, and visually inspect original PDF
  pages.
- Starts an Adventure Runner-branded TUI using models and credentials from `~/.wld/models.json` and
  `~/.wld/auth.json`.
- Uses the loaded Adventure Author or Adventure Guide definition as the model's system prompt; the upstream
  coding-agent identity and prompt are not used.
- Uses an Author agent with source search, cited multiple-choice questions, typed asset-writing tools, and
  validation.
- Uses a multi-choice interaction in which arrow keys move, Space toggles when multiple answers are allowed,
  and the **Other** row opens a free-text editor. The source-recommended choice is visibly marked and
  initially highlighted (preselected for multi-choice questions). Left arrow returns to the previous question.
- Lets the Author load a PDF from ordinary language. Type `@` to autocomplete files, then say something like
  `Load @path/to/adventure.pdf`; the model must call the verified import tool before using the source.
- Uses an Adventure Guide agent with read-only adventure tools and revision-checked mechanical state
  transactions.
- Keeps an append-only play event log.
- Uses Mnemoteca for optional soft memory while keeping mechanical state out of memory.
- Loads layered Markdown agent definitions in the same style as RunWield.

## Prerequisites

- Deno
- `unpdf` on `PATH`
- Optional: Poppler's `pdftoppm` on `PATH` for visual PDF-page inspection (`brew install poppler` on macOS).
- `mnemoteca` on `PATH` for memory features
- Compatible model configuration in `~/.wld/models.json`
- Model credentials in `~/.wld/auth.json`

The harness uses the published `@earendil-works/pi-*` npm libraries at version `0.80.6`; `../pi-mono` is only
a source reference. Adventure Runner is its own executable and domain harness, not an extension.

## First run

Open the adventure menu:

```sh
deno task adventure author
```

Choose an existing adventure to reopen its assets and latest author conversation, or choose **Create new
adventure** and give it a name. Arrow keys move, Enter selects, and Esc cancels. Nothing is created just by
opening the menu. New names cannot overwrite existing folders.

The menu lists packages in `adventures/` under the launch directory. If launched inside an adventure package
or the `adventures/` folder, it lists that local library instead. Packages elsewhere can still be opened by
passing their path directly:

```sh
deno task adventure author /path/to/existing-adventure --continue
```

After choosing or creating an adventure, type `@` to find a PDF, then ask the Author to load it. `~/...` and
absolute paths work too. Loading a PDF adds it to the selected adventure; it does not switch packages. To
switch, quit and run `deno task adventure author` again. An empty adventure shows a welcome and waits for you;
opening it does not itself send a model request.

Or import a PDF first and then enter the same Author TUI:

```sh
deno task adventure author /path/to/adventure.pdf
```

The PDF filename determines the default package directory. Choose it explicitly when preferred:

```sh
deno task adventure author /path/to/adventure.pdf --output adventures/my-adventure
```

Add another PDF later:

```sh
deno task adventure author /path/to/appendix.pdf --output adventures/my-adventure --continue
```

Inspect or validate without calling a model:

```sh
deno task adventure inspect adventures/my-adventure
deno task adventure validate adventures/my-adventure
```

Play after authoring:

```sh
deno task adventure guide adventures/my-adventure --play solo
```

The Guide starts with character setup, not the opening scene. You do not need a character sheet or previous
tabletop experience: choose a saved character or ask to make one together. It asks small questions, offers
suggestions, and saves details as you provide them. It checks that you are ready before beginning the story.
Character choices follow the authored rules; an underspecified ruleset may need clarification from the Author.

Reusable names, backgrounds, personality and goals live in `~/.adventure-guide/characters/<id>.json`.
Attributes, abilities, HP and equipment belong to the specific play's verified state. Loading a character into
another adventure does not copy those mechanics. Currently each play has one selected player character; use a
different `--play` name for a different character or a fresh run. Existing plays keep their progress and
receive a one-time character setup if they do not yet have a saved character.

Tool calls appear as one-line summaries showing only the tool name, status and timing, with consecutive calls
grouped in one block. Parameters are hidden by default to avoid spoilers from internal IDs. Press **Ctrl+O**
to reveal parameters and results for troubleshooting, or collapse them again. Expanded views can contain
spoilers. Expanded output is limited to 500 display lines per call (including its summary), keeping the
beginning and end of long results. Full results remain available to the model and in the conversation record.
Image results show a short indicator rather than raw image data in these blocks.

Use `--continue` to reopen the most recent model conversation for that author or play session. The durable
assets and game state persist whether or not chat history is continued.

When you quit the TUI, Adventure Runner prints a complete command for reopening that exact conversation:

```sh
deno task --config /absolute/path/to/adventure-runner/deno.json adventure author /absolute/path/to/adventure --session <session-id>
```

The session directory is built into the harness and never needs to be supplied on the command line.
Conversations currently live under `~/.adventure-guide/sessions/`. Existing package-local `.sessions/` files
are copied there automatically when that adventure is next opened. The printed command includes the
application config path so it works outside the repository too. It follows the active conversation after
`/new`, `/fork`, or `/resume`. No resume command is printed for an empty, unsaved conversation.

Choose a model explicitly when needed:

```sh
deno task adventure author adventures/my-adventure --model opencode:big-pickle
```

Adventure Runner reads model definitions and authentication directly from `~/.wld/models.json` and
`~/.wld/auth.json`. It uses an in-memory harness settings layer so the visible interface remains Adventure
Runner-owned. On Deno it selects SSE transport to avoid an incompatibility between Deno's native `Event` and
`undici` WebSocket events; this does not modify your `~/.wld/settings.json`.

Run `deno task adventure help` or `deno task adventure help author` for the command catalog.

## Where is the PDF?

An imported PDF is copied into the adventure package:

```text
adventures/my-adventure/sources/files/source-<hash>.pdf
```

Its extracted, page-marked text is next to it under `sources/extracted/`. `adventure inspect` prints both
absolute paths. These directories are ignored by this repository's `.gitignore` because source adventures may
be copyrighted. They are durable local inputs, not automatically redistributable project files.

## Reading files and seeing maps

In Author mode, you can say:

```text
Read @notes.md to understand my preferences.
Load @map.png and inspect the room connections.
Look at page 2 of the imported adventure PDF; the columns seem out of order.
```

The Author has three additional tools:

- `file_read`: read-only UTF-8 text access, up to 1 MiB per file, with bounded `offset`/`limit` continuation.
  Reading a file does not import it as citable evidence.
- `source_load_image`: copy a PNG, JPEG, or WebP up to 4 MiB into `sources/files/`, with a content hash and
  stable source ID. Cite a standalone image as `{ sourceId, page: 1 }`. Importing invalidates readiness just
  like adding a PDF. A map supplements, rather than replaces, the adventure PDF.
- `source_view_page`: return actual image content to a vision-capable model, either from an imported image or
  one rendered page of the stored original PDF. It verifies the stored file's hash before viewing it. PDFs are
  limited to 64 MiB and rendered with `pdftoppm` at a 2400-pixel maximum edge, with a 30-second timeout and
  temporary-file cleanup. Rendered images must fit the same 4 MiB image limit.

Paths use the same `@`, quotes, `~/`, and launch-directory-relative conventions as PDF loading. Referenced
file contents are sent to your configured model provider; only ask the Author to read material you intend to
share. File contents are reference data, not instructions to access other files or change harness policy.

Visual viewing requires a model that advertises image input in its model definition. If PDF rendering is
unavailable, install [Poppler](https://poppler.freedesktop.org/) (`brew install poppler` on macOS), ensure
`pdftoppm` is on `PATH`, and restart using `deno task adventure author`. Text extraction still uses `unpdf`.
No additional npm dependency or FFI permission is required.

Raw visual and local-file tools are Author-only: annotated maps can contain spoilers visible in TUI tool
results. The Author saves reviewed visual observations into cited entities, scenes, and canon for the Guide.
The Guide does not receive arbitrary filesystem access or display raw source maps. Images have no generated
text extraction; text search skips them, and reading their pages as text explains how the Author can view
them. Existing PDF-only packages load without migration. Restart an existing Author session to load the new
tools.

## What gets authored?

```text
my-adventure/
├── adventure.json              package identity, source IDs, and draft/ready status
├── sources/
│   ├── index.json              hashes, stable source IDs, page counts, and paths
│   ├── files/                  copied PDFs and standalone images
│   └── extracted/              page-marked Markdown from unpdf
├── assets/
│   ├── setup.json              choices made with the author
│   ├── canon.json              facts, secrets, endings, and hard constraints
│   ├── entities.json           locations, people, creatures, factions, items, hazards
│   ├── scenes.json             playable situations, supported actions, fallbacks, transitions
│   └── runtime.json            rules, tone/safety, adaptation, bounds, clocks
├── .adventure/agents/          optional package-local agent overrides
└── plays/<name>/
    ├── state.json              current mechanical truth with a revision number
    └── events.jsonl            append-only state change audit log
```

Model conversation history is stored separately under `~/.adventure-guide/sessions/`; it is not part of the
adventure package or its mechanical state.

Every authored record that interprets the module carries one or more `{ sourceId, page }` citations. The
package cannot be marked `ready` while required setup, canon, entities, scenes, runtime policy, or citations
are missing. Changing assets or importing another source returns the package to `draft`; the Author must
validate and mark it ready again. The Guide refuses drafts or packages with validation blockers before
creating play state.

Extraction preserves page references, but it is not an exact reconstruction of a PDF's layout. Multi-column
text can arrive out of order. The Author can now inspect rendered PDF pages and imported images, but visual
interpretation is not verified map data: uncertain labels or connections still require review. Empty or
unmarked PDF extractions are rejected; scanned PDFs still need OCR before PDF import.

## Two beginner terms the Author asks about

**Tone and safety** means deciding what emotional feel the group wants and what content would make play
unpleasant. A _line_ is content excluded entirely. A _veil_ is content that may exist but is handled briefly
or off-screen. This is a normal pre-game comfort check, not a test with right answers. The PDF informs likely
content and tone; the people at the table make the final choice.

**Adaptation policy** means deciding how much the Guide may adjust the written adventure for this group. For
example, minor sensory details or encounter difficulty might be flexible, while the map, central mystery, and
NPC knowledge stay fixed. Writing this boundary down keeps helpful improvisation from turning into accidental
canon drift.

## Dice and bad-luck protection

The Guide uses `roll_dice` for NPC rolls and rolls made on your behalf, rather than inventing numbers. For
example, `{ "dice": [{ "faces": 6, "count": 2 }] }` returns individual values under `rolls["2d6"]`, their
computed total under `totals["2d6"]`, and an overall raw `total`. Repeated face types merge. Requests are
limited to 1,000 dice and 1,000,000 faces per die. Modifiers and game consequences are separate.

Randomness comes from Deno's built-in Web Crypto `crypto.getRandomValues`, with rejection sampling to avoid
modulo bias. The runtime supplies the secure seed; there is no predictable timestamp seed or `Math.random`.
See [Deno's secure randomness documentation](https://docs.deno.com/examples/secure_random_values/).

For player-character pass/fail checks, the Guide adds `pcCheck: true` and records the rules-based outcome with
`record_roll_outcome`: `failure`, `success`, or `super_success`. This is the Guide's interpretation of the
adventure's rules, not a hard-coded rules engine. The last 20 PC checks are saved atomically under
`plays/<name>/dice-history.json`, separately from optional memory. `roll_history` retrieves them on resume. An
unresolved PC check blocks another until its outcome is recorded; recorded outcomes cannot be rewritten.

After two consecutive failures, the next PC check has an **80% chance of bad-luck protection**. If triggered,
the tool returns `outcome: "success"`, `reason: "unlucky_protection"`, and no dice numbers. This grants an
ordinary success, not a critical/super success; the Guide interprets the effect in the current ruleset. If
protection does not trigger, the tool rolls normally, so that check can still succeed naturally. Any success
resets the failure streak. NPCs, damage rolls and random tables neither receive protection nor alter the PC
streak. Physical player rolls are not currently included. Existing chat-only rolls are not retroactively
classified. Mechanical consequences still require `game_state_update`.

## Memory versus game state

Mnemoteca has deliberately narrow jobs:

- Author memory stores reusable campaign preferences only when the author explicitly asks to remember them.
- Guide memory automatically stores established non-mechanical game continuity, NPC exchanges and rulings.
- Character memory automatically stores player-known experiences, observations, beliefs, open questions,
  conversations and appearance changes in a separate `caper-character-<id>` collection for each character. The
  Guide can recall these across adventures without treating them as facts about the new world or granting old
  powers and equipment.

No repeated "remember this" request is needed during play. Memories distinguish observations from NPC claims
and PC beliefs; hidden answers are never recorded as things the PC "doesn't know". Recall defaults to the
current play, preventing events from another run from leaking in. Character recall can explicitly search
across adventures for relevant personal history. Existing untagged notes are not included in play-scoped
recall.

Reopening a Guide conversation with `--continue` or `--session` now triggers a brief **Previously on…** recap
using memory, the character profile and authoritative state. It includes established events, the latest known
appearance and the saved location without advancing time or replaying actions. This recap invokes the model.
If memory is unavailable, the Guide uses the conversation and state and acknowledges significant gaps.

You can also start a fresh chat for the same adventure and `--play` name without `--continue`; the saved
character, state and memories still load and the Guide gives a recap. A different `--play` name is a separate
run, not just a fresh chat.

Automatic compaction is enabled by default (respecting `compaction` settings in `~/.wld/settings.json`). It
summarizes older conversation while keeping recent context; `/compact` does the same manually. Neither
operation deletes the full session log, character files, game state, dice history or Mnemoteca notes. Guide
summaries receive domain-specific continuity instructions, and the next model request gets a reminder to
reload state, character and memories before proceeding. This does not advance gameplay or trigger a new recap
in the middle of a scene. Important experiences must still be saved as they happen: a summary is lossy, and
these safeguards do not guarantee preservation of every unsaved detail.

The executable is now `mnemoteca`; the CLI arguments are unchanged. Existing author and adventure collection
names are preserved. Character profiles and play state work without Mnemoteca; if optional recall is
unavailable, the Guide continues without it. No memory database is automatically moved or migrated.

It is not authoritative game state. Current scene, turns, HP/resources, inventory, flags, clocks, actor
positions, and revealed secrets can only change through `game_state_update`. That tool checks the last-read
revision, validates the change, writes `state.json`, and appends an audit event. An operating-system lock
serializes updates across processes. A small recovery journal lets the next read finish an interrupted commit
without duplicating the audit event. Keep packages on a local filesystem that supports file locking and atomic
rename. Author a package in one process at a time; concurrent authoring is not yet supported.

## Agent definition layers

Definitions are loaded from low to high priority:

1. `src/agent-definitions/<agent>.md`
2. `~/.wld/adventure-runner/agents/<agent>.md`
3. `<adventure>/.adventure/agents/<agent>.md`

Higher layers override frontmatter. Prompt bodies append unless `promptOverride: true` is set. Tool lists can
be narrowed, but the bundled Author and Guide domain tools are protected so an override cannot silently remove
citation, validation, or mechanical-state controls.

## Writing skills

The agents automatically receive short, harness-owned writing skills from `src/skills/`:

- **clear-prose** — both agents: concrete language, purposeful detail, readable explanations, and revision.
- **adventure-authoring** — Author: runnable situations, meaningful choices, useful NPC notes, and a clear
  separation between public information, private facts, and mechanics.
- **table-narration** — Guide: concise descriptions, dialogue, pacing, player agency, spoiler boundaries, and
  narration that accurately reflects verified outcomes.
- **npc-dialogue** — both agents: voice notes, responsive conversations, and subtext grounded in NPC
  knowledge.
- **interactive-choices** — both agents: distinct approaches, honest consequences, manageable scene structure,
  and player freedom within the authored adventure.
- **key-moments** — both agents: memorable opportunities and emotional contrast without forcing scenes or
  player reactions.
- **character-naming** — Author: cast clarity and setting-consistent proposals, preserving source names and
  stable entity identities. This is editorial guidance, not a random-name generator.
- **game-facilitation** — Guide: beginner-friendly rules help, shared spotlight, useful recaps, pauses, and
  fair outcomes without invented complications.
- **adventure-endings** — both agents: conditional resolution notes and concise closure based on actual
  outcomes, distinguishing a finished one-shot from a paused session.

### Skill credits and original sources

Thank you to **[jwynia](https://github.com/jwynia)**, author of the
[agent-skills collection](https://github.com/jwynia/agent-skills), for the original writing and storytelling
skills that informed these adaptations. The links below point directly to the original source files:

| Adventure Runner skill | Original skill by jwynia                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `npc-dialogue`         | [dialogue](https://github.com/jwynia/agent-skills/blob/main/skills/creative/fiction/character/dialogue/SKILL.md)                         |
| `interactive-choices`  | [interactive-fiction](https://github.com/jwynia/agent-skills/blob/main/skills/creative/fiction/application/interactive-fiction/SKILL.md) |
| `key-moments`          | [key-moments](https://github.com/jwynia/agent-skills/blob/main/skills/creative/fiction/structure/key-moments/SKILL.md)                   |
| `character-naming`     | [character-naming](https://github.com/jwynia/agent-skills/blob/main/skills/creative/fiction/character/character-naming/SKILL.md)         |
| `game-facilitation`    | [game-facilitator](https://github.com/jwynia/agent-skills/blob/main/skills/creative/fiction/application/game-facilitator/SKILL.md)       |
| `adventure-endings`    | [endings](https://github.com/jwynia/agent-skills/blob/main/skills/creative/fiction/structure/endings/SKILL.md)                           |

These are harness-specific adaptations, not verbatim installations. We keep useful editorial guidance without
upstream role restrictions, external scripts, random-name datasets, or separate persistence workflows. Changes
for Adventure Runner are our responsibility, not the original author's. No skill may override canon, state
tools, or player agency. Pacing does not authorize a forced emotional arc, altered dice outcomes, or extra
costs for a legitimate success.

### Loading and configuration

Skills are selected by the `skills` list in each agent definition. They are loaded into its system prompt,
including on resumed conversations; no manual invocation is needed. They do not enable upstream skill
discovery or change tool permissions. User/adventure agent layers can replace the skill list (use `[]` to
disable writing guidance); names currently resolve to bundled `src/skills/<name>/SKILL.md` files. Use
`deno task adventure agents` to see each agent's active skills.

These are editorial instructions, not an automatic prose-quality score. Source fidelity and player privacy
still require review, and structural tests do not prove the model will always write well.

## Development

```sh
deno task check
deno task test
deno task fmt:check
deno task verify
```

## License

Project code and documentation are licensed under the [MIT License](LICENSE). Imported adventure PDFs and
their content remain subject to their own licenses; the project license does not grant rights to those works.
Local adventure packages are excluded from Git by default. See the skill credits above for original sources
that informed the harness's writing guidance.

The current build is a robust vertical slice, not a complete campaign engine. Tactical combat automation,
interactive player maps, multi-user networking, and automated semantic review are later work. Structural
validation checks references and required fields; it does not prove that every claim matches the source or
prevent every model spoiler. Review authored content before playing.
