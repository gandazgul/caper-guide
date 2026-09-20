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
- Uses Mnemosyne for optional soft memory while keeping mechanical state out of memory.
- Loads layered Markdown agent definitions in the same style as RunWield.

## Prerequisites

- Deno
- `unpdf` on `PATH`
- `mnemosyne` on `PATH` for memory features
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

## What gets authored?

```text
my-adventure/
├── adventure.json              package identity, source IDs, and draft/ready status
├── sources/
│   ├── index.json              hashes, stable source IDs, page counts, and paths
│   ├── files/                  copied PDFs
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
text can arrive out of order, and maps are not converted into verified map data. The Author must flag unclear
passages for review against the original PDF. Empty or unmarked extractions are rejected.

## Two beginner terms the Author asks about

**Tone and safety** means deciding what emotional feel the group wants and what content would make play
unpleasant. A _line_ is content excluded entirely. A _veil_ is content that may exist but is handled briefly
or off-screen. This is a normal pre-game comfort check, not a test with right answers. The PDF informs likely
content and tone; the people at the table make the final choice.

**Adaptation policy** means deciding how much the Guide may adjust the written adventure for this group. For
example, minor sensory details or encounter difficulty might be flexible, while the map, central mystery, and
NPC knowledge stay fixed. Writing this boundary down keeps helpful improvisation from turning into accidental
canon drift.

## Memory versus game state

Mnemosyne has deliberately narrow jobs:

- Author memory stores reusable campaign preferences only when the author explicitly asks to remember them.
- Guide memory stores soft facilitation notes, style preferences, or non-mechanical interpretations.

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

The current build is a robust vertical slice, not a complete campaign engine. Tactical combat automation, map
rendering, multi-user networking, and automated semantic review are later work. Structural validation checks
references and required fields; it does not prove that every claim matches the source or prevent every model
spoiler. Review authored content before playing.
