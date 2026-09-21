# Caper Guide Domain Language

Caper Guide is a local tabletop adventure harness. It turns prewritten adventure sources into a cited adventure package, then helps players run that package with bounded, verified play state.

## Language

### Product Roles

**Adventure Author**: The authoring agent that helps turn adventure sources and author choices into an adventure package. It asks source-cited setup questions and saves reviewed material. _Avoid_: GM, DM, worldbuilder.

**Adventure Guide**: The play agent that facilitates a ready adventure package for players. It interprets authored material, keeps secrets, helps with rules, and records mechanical changes before treating them as final. _Avoid_: AI GM, dungeon master, world simulator.

**Author**: The human who prepares an adventure package and approves setup choices, interpretations, and readiness.

**Player**: A person who plays a ready adventure through an Adventure Guide.

### Adventure Content

**Adventure Package**: The durable unit of authored adventure content. It contains source records, reviewed assets, readiness status, and one or more plays.

**Adventure Source**: Imported reference material for an adventure package. A source can be a PDF source or an image source.

**PDF Source**: An adventure source copied from a PDF and paired with page-marked extracted text.

**Image Source**: An adventure source copied from a PNG, JPEG, or WebP image. It is cited as page 1 and supplements the PDF source.

**Citation**: A source ID and page number that link an authored record to an adventure source page. _Avoid_: proof.

**Setup Decision**: An author-approved answer for one setup topic, with citations and rationale.

**Canon Fact**: A cited fact that the Adventure Guide must preserve. A canon fact can be player-visible or guide-only.

**Secret**: A guide-only canon fact that players must not learn until play state records its reveal.

**Adventure Entity**: A cited location, character, creature, faction, item, or hazard with player-facing summary, guide notes, knowledge, and constraints.

**Scene**: A cited playable situation in an adventure package. A scene names relevant locations, supported actions, fallbacks, secrets, and transitions.

**Transition**: A scene relationship that says when play can move to another scene.

### Runtime Policy

**Runtime Policy**: The authored rules and facilitation boundaries used during play.

**Rules**: The selected game system, resolution method, and who rolls dice for uncertain actions.

**Tone and Safety**: The desired emotional feel plus table comfort boundaries. A line is excluded content. A veil is content handled briefly or off-screen.

**Adaptation Policy**: The boundary between what the Adventure Guide must preserve and what it may adjust for the table.

**Out-of-Bounds Policy**: The response pattern for player actions that the package does not support.

**Clock**: A tracked countdown or progress track with segments, advance conditions, and effects.

### Play State

**Play**: One run of a ready adventure package. Each play has its own mechanical state and event history.

**Game State**: The current mechanical truth for a play, including scene, turns, flags, clocks, revealed secrets, actor locations, resources, inventory, and character setup.

**State Revision**: The version number of a play's game state. Changes must use the latest revision.

**State Transaction**: A set of mechanical changes applied together to a play, with a player-auditable reason.

**Event Log**: The audit history of state transactions for a play.

**Player Character**: The character selected for a play.

**Character Profile**: Reusable narrative character identity, such as name, concept, pronouns, background, appearance, personality, and goals. It is not mechanical state.

**Character Sheet**: Rules-specific mechanics for the selected player character in one play.

**Character Memory**: Approved, player-known experiences for one character across adventures. It is not world canon and not mechanical state.

### Dice

**Roll Dice**: The required roll path used by the Adventure Guide for generated dice rolls.

**PC Check**: A player-character pass/fail check tracked for dice history and bad-luck protection.

**Roll Outcome**: The Guide's rules-based classification of a PC check as failure, success, or super success.

**Bad-Luck Protection**: A house rule where two consecutive failed PC checks can make the next PC check an ordinary success without dice numbers.

## Open Language Questions

- **Product name**: The repository is named Caper Guide, while the visible CLI and TUI still use Adventure Runner. Use Caper Guide for the project and Adventure Runner only for current visible product text.
