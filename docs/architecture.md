# Adventure Runner architecture

This implementation follows the domain-harness loop from `docs/vision/domain-harness-blueprint.md` and the
bounded facilitator model from `docs/ttrpg-campaign-harness-handoff.md`.

## Command surface

`src/cli.ts` performs RunWield-style explicit command dispatch through `src/commands/registry.ts`. Each
registry entry owns its description, usage, aliases, and handler. Model interaction is limited to `author` and
`guide`; `inspect` and `validate` are deterministic commands.

Bare `author` starts a harness-owned adventure picker before creating any package or model session. It lists
the local adventure library; existing selections continue their latest author conversation. The new-adventure
flow asks for a name and refuses existing directories. Explicit package/PDF paths and `--output` bypass the
picker. Headless `--prepare-only` requires one of those explicit targets.

## Agent definitions

`src/agents/loader.ts` mirrors RunWield's layered Markdown definitions:

- bundled definitions provide the protected domain contract;
- a user layer can preserve personal defaults across adventures;
- an adventure-local layer can refine behavior for one module.

The executable is a standalone harness. It uses the published agent, model, coding-agent, and TUI libraries;
it is not installed or discovered as an extension. The interactive runtime starts in quiet mode with Adventure
Runner's welcome and terminal title. Its effective system prompt begins with the loaded domain-agent
definition, includes the explicitly selected harness writing skills, and appends active package and
file-selection context.

The runtime reads model definitions and credentials from `~/.wld`, but applies non-persistent harness
settings: upstream extensions, skills, prompts, themes, packages, startup copy, and telemetry are disabled.
Append-prompt discovery is explicitly disabled too, so unrelated `APPEND_SYSTEM.md` files cannot enter the
domain prompt. InteractiveMode lifecycle branding is a version-pinned compatibility seam in `runtime.ts`;
recheck it whenever upgrading the SDK, especially session replacement and quit handling. See the upstream
[SDK lifecycle documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md).
Deno sessions force SSE because `undici` 8.5 WebSocket message events are incompatible with Deno's native
`Event` implementation. This leaves the user's configuration files unchanged.

## Writing skills

Agent frontmatter selects bundled `src/skills/<name>/SKILL.md` files. The harness validates their names and
metadata and adds the complete short instructions to the effective domain prompt. Both roles get
`clear-prose`, `npc-dialogue`, `interactive-choices`, `key-moments`, and `adventure-endings`; the Author also
gets `adventure-authoring` and `character-naming`, while the Guide gets `table-narration` and
`game-facilitation`. These are short harness-specific instructions, not upstream generators or separate
persistence systems. Explicit selection keeps unrelated skills out and makes the writing guidance active even
on resumed conversations. The `agents` command exposes each role's loaded skill names. These skills are
editorial guidance, not new tools, a substitute for structural validation, or permission to alter canon and
mechanical state.

## Four kinds of persistence

| Layer                | Purpose                                     | Authority                       |
| -------------------- | ------------------------------------------- | ------------------------------- |
| `sources/`           | Copied PDFs, hashes, page-marked extraction | Evidence from the publication   |
| `assets/`            | Human-reviewed runnable interpretation      | Canon and runtime contract      |
| `plays/*/state.json` | Facts that change during play               | Current mechanical truth        |
| Mnemosyne            | Preferences and loose facilitation notes    | Helpful, non-mechanical context |

JSONL sessions are conversation history, not domain truth. Losing a chat does not lose the adventure or
current game state.

Conversation JSONL files live under
`~/.adventure-guide/sessions/<adventure-id>-<package-path-hash>/<author-or-guide-session>/`. The path hash
keeps two packages with the same adventure ID separate. The CLI accepts `--session <id>` and resolves the
storage directory internally, so the quit message can print a harness-owned command without exposing a
`--session-dir` argument. Package-local legacy sessions are copied into this store on first use.

## Authoring gates

The Author cannot make the package ready by narration. It must use domain tools:

1. `source_load_pdf` resolves an author-supplied path against the launch directory, imports with `unpdf`, and
   copies the source and extraction into durable package storage.
2. `source_search` and `source_read_pages` retrieve stable evidence.
3. `ask_author` validates 2-4 options, a recommendation, and PDF citations before opening the TUI.
4. `author_record_setup` and the upsert tools validate evidence again before atomic JSON writes.
5. `adventure_validate` checks coverage, references, and citations.
6. `adventure_mark_ready` refuses while any blocker remains.

The Author can read existing assets with `adventure_read`. Every asset/source edit invalidates ready status
before publishing new content. The Guide checks both ready status and validation at launch. Validation checks
duplicate IDs, scene locations/secrets/transitions, clock bounds, and all runtime-policy citations.

This is the harness's evaluation-and-action gate: model reasoning proposes content, but deterministic code
decides whether the package is structurally acceptable.

## Guide state transaction

The Guide reads `state.json` and receives its revision. `game_state_update` requires that revision plus a
reason and typed changes. Reads and writes acquire an OS file lock for that play. The revision check happens
inside the lock, so simultaneous writers cannot both commit from the same revision. Each transaction validates
all changes on a copy, persists a pending journal, atomically extends `events.jsonl`, then atomically writes
`state.json`. The next read/write finishes an interrupted commit idempotently. The journal is removed only
after both files are updated. This covers process interruption; it is not a power-loss durability guarantee.

Supported changes currently cover:

- scene and elapsed turns;
- flags and clocks;
- secret reveals;
- actor locations;
- numeric resources;
- inventory additions and removals.

The next hardening step is a player-output evaluator that checks every response for unrevealed secret text and
unsupported canon before it is shown.
