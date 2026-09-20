# TTRPG Campaign Harness Prototype Handoff

This is a handoff document for starting a new prototype project/conversation.

## Starting Point

Prototype a TTRPG campaign-running harness using **Trilemma Adventures: At the Hour of Death** as the first
example adventure.

Important source links:

- Trilemma Adventures home: <https://trilemma.com/>
- Free adventures blog label: <http://blog.trilemma.com/search/label/adventure>
- At the Hour of Death post: <http://blog.trilemma.com/2022/07/at-hour-of-death.html>
- At the Hour of Death PDF: <https://trilemma.com/blog/adventures/55%20Hour%20of%20Death.pdf>

Do not copy the full adventure text into a public repo. Use the source PDF as prototype input and preserve
attribution. Verify license terms before publishing anything. Trilemma free adventure posts are intended for
free personal use, and at least some posts explicitly mention CC-BY-NC 4.0 for non-commercial use, but do not
assume commercial rights without checking the selected adventure's terms.

## Product Frame

This is not an "AI replaces the GM" project.

The useful frame is:

> A bounded adventure runtime and authoring harness that helps run prewritten, structured adventures
> faithfully.

The harness should help with:

- keeping secrets
- tracking game state
- retrieving relevant adventure context
- playing NPCs within scripted constraints
- resolving boring rules/state bits
- keeping players inside the prepared adventure
- warning when the AI would drift, reveal too much, or invent unsupported canon

The promise should be honest:

- Not infinite openness.
- Not a human-equivalent improvising GM.
- Not a world simulator.
- A faithful, bounded, module-aware adventure facilitator.

## Why At the Hour of Death

At the Hour of Death is a strong first candidate because it has structure that is interesting for a runtime:

- compact adventure
- pocket dungeon
- map/location structure
- scheduled patrols / moving guards
- hidden information
- dangerous environmental or actor state
- NPC/creature behavior
- enough machinery to test state tracking without starting with a huge campaign

This is better for a prototype than a broad sandbox campaign. The harness can prove it can run a constrained
adventure before attempting anything more open-ended.

## Core Hypothesis

Given good enough structured context, an AI can run small bounded adventures without a human GM in the seat.

The hard part is probably not the runtime loop. The hard part is the **authoring tool**: transforming a prose
adventure or module into a structured package with scenes, state, secrets, triggers, NPC knowledge, allowed
actions, and fallback behavior.

This is closer to building a text adventure, point-and-click adventure, visual novel, or adventure-game
runtime than to building a freeform AI dungeon master.

## Desired Prototype Shape

Build two related pieces:

1. **Adventure authoring/structuring tool**
2. **Bounded runtime harness**

The authoring tool can be manual at first. The first milestone can simply be a hand-authored adventure package
derived from At the Hour of Death.

The runtime should then execute that structured package.

## Runtime Loop

The runtime loop should be explicit:

```text
player input
-> classify intent
-> locate current scene / location / actor / rule
-> retrieve relevant adventure context
-> check current state and secret boundaries
-> choose an allowed response pattern
-> produce player-facing narration or dialogue
-> update private state
-> expose next choices or ask for clarification
```

Keep private and public channels separate:

- **Player-facing narration:** what players can see/hear/know.
- **Private state:** flags, clocks, HP, positions, revealed clues, NPC attitudes.
- **Secret notes:** unrevealed information and GM-only context.
- **Rules resolution:** checks, DCs, rolls, consequences.
- **Out-of-bounds handling:** redirect, clarify, or offer closest supported actions.

## Adventure Package Model

A harness-native adventure package should probably include:

- adventure metadata
- source attribution and license notes
- player-facing premise
- GM-only premise
- scene graph
- location graph
- map references
- state variables
- clocks / timers / schedules
- actors and NPCs
- monsters / hazards
- secrets
- reveal conditions
- allowed actions
- fallback actions
- rule hooks
- random tables, if any
- encounter definitions
- treasure / rewards
- ending conditions
- safety / content notes
- module-fidelity constraints

Example conceptual structure:

```yaml
adventure:
  id: at-hour-of-death-prototype
  title: At the Hour of Death
  sourceUrl: https://trilemma.com/blog/adventures/55%20Hour%20of%20Death.pdf
  licenseNote: Verify Trilemma license and attribution before distribution.

runtime:
  style: bounded_module_facilitator
  improvisationBudget: low
  defaultOutOfBoundsPolicy: clarify_or_redirect

state:
  currentLocation: null
  elapsedTurns: 0
  revealedSecrets: []
  partyInventory: []
  actorPositions: {}
  clocks: {}

locations: []
actors: []
secrets: []
triggers: []
rules: []
```

Use JSON or YAML for prototype data. Markdown is fine for authored text snippets and notes.

## Authoring Tool Questions

The authoring side should help convert prose adventures into runnable structure.

Questions to answer:

- What are the locations?
- What can players do in each location?
- What transitions are possible?
- What state changes when players act?
- What secrets exist?
- When are secrets revealed?
- Who knows what?
- Which NPCs can say what?
- What facts must never be contradicted?
- What actions are unsupported?
- How should unsupported actions be redirected?
- What clocks or schedules advance over time?
- What are the fail states, success states, and partial-success states?
- What rules checks are needed?
- What should the AI ask the players to clarify?

## Runtime Guardrails

The runtime should prefer faithfulness over creativity.

Guardrails:

- Do not invent new major locations unless explicitly allowed.
- Do not reveal secrets before reveal conditions are satisfied.
- Do not let NPCs know things outside their knowledge boundary.
- Do not contradict module facts.
- Do not promise unrestricted player freedom.
- If player intent is unsupported, ask a clarifying question or offer closest supported actions.
- Use short, concrete narration.
- Distinguish rules calls from narration.
- Log every state update.

## First Prototype Milestones

### Milestone 1: Manual Adventure Package

Manually read At the Hour of Death and create a structured data package:

- locations
- actors
- moving patrol/schedule model
- secrets
- triggers
- allowed actions
- fallback rules
- initial state

Do not overbuild UI yet.

### Milestone 2: CLI Runtime

Create a simple terminal loop:

```text
Players: "We listen at the door."
Harness:
  - classifies intent
  - retrieves relevant location/hazard/secret context
  - produces player-facing response
  - suggests or applies state update
```

The runtime can show a private debug panel in development:

- current scene
- retrieved context IDs
- secret checks
- proposed state updates
- out-of-bounds warnings

### Milestone 3: State and Secret Tests

Create tests for the important harness behavior:

- secret is not revealed early
- NPC does not answer outside knowledge boundary
- moving schedule advances correctly
- unsupported player action triggers redirect/clarification
- state updates are logged
- player-facing response does not include private notes

### Milestone 4: Authoring Assistant

Add an authoring command that helps extract a draft adventure package from source notes/PDF text:

- propose locations
- propose actors
- propose secrets
- propose clocks/schedules
- propose action handlers
- flag missing transitions or ambiguous rules

Human review is required. The authoring assistant should not be trusted to produce a correct runnable package
without inspection.

## Evaluation Criteria

The prototype is successful if:

- it can run a short scene without leaking secrets
- it tracks current location and meaningful state
- it can respond from module-supported context
- it can redirect unsupported actions gracefully
- it can advance a schedule or clock
- it can produce a useful GM/private debug trace
- it can generate a session log or recap

It does not need to:

- support all of D&D
- support long campaigns
- improvise large new story branches
- handle tactical combat perfectly
- replace a skilled GM

## Useful Mental Model

Treat the harness like an adventure-game runtime:

- authored content
- state machine
- secret boundaries
- action parser
- constrained narrator
- rules helper
- session logger

The LLM is not the source of the world. The adventure package is the source of the world. The LLM is the
interpreter, adapter, narrator, and rules/context assistant operating inside that package.

## Open Design Questions

- Should the first runtime be GM-facing, player-facing, or both?
- Should state updates be automatic or proposed for approval?
- Should rolls be performed by the runtime or entered by players?
- How constrained should player input be in the first prototype?
- Should combat be abstracted for the first version?
- What is the smallest structured adventure format that works?
- Can a useful authoring assistant be built before a runtime UI?
- Should the package format be generic TTRPG JSON/YAML, or specific to this harness?

## Suggested First Build Direction

Start with a local prototype outside RunWield:

1. Create `adventures/at-hour-of-death/`.
2. Add a hand-authored `adventure.yaml`.
3. Add Markdown snippets for player-facing and private text.
4. Build a simple CLI loop.
5. Add a state store as JSON.
6. Add tests around secrets, schedules, and state updates.
7. Only then consider UI.

Keep the first system deliberately small. The point is to prove the adventure-runtime loop, not to build a
full VTT.
