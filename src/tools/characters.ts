import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  characterDirectory,
  createCharacter,
  listCharacters,
  PROFILE_FIELDS,
  readCharacter,
  updateCharacter,
} from "../adventure/characters.ts";
import { applyStateTransaction, loadOrCreateGameState } from "../adventure/state.ts";
import type { AdventurePackage } from "../adventure/package.ts";
import { toolResult } from "./common.ts";

const fields = Object.fromEntries(
  PROFILE_FIELDS.map((field) => [field, Type.Optional(Type.String({ maxLength: 2000 }))]),
);

export function createCharacterTools(
  pkg: AdventurePackage,
  playId: string,
  directory = characterDirectory(),
): ToolDefinition[] {
  return [
    {
      name: "character_list",
      label: "Saved Characters",
      description:
        "List reusable character identities. Offer beginner-friendly creation if empty; do not assume the player already has a character.",
      parameters: Type.Object({}),
      executionMode: "parallel",
      async execute() {
        return toolResult(
          (await listCharacters(directory)).map(({ id, name, concept, revision }) => ({
            id,
            name,
            concept,
            revision,
          })),
        );
      },
    },
    {
      name: "character_read",
      label: "Read Character",
      description:
        "Read saved identity and backstory. Omit characterId for this play's selected character. Current mechanics are in game_state_read.",
      parameters: Type.Object({ characterId: Type.Optional(Type.String()) }),
      executionMode: "sequential",
      async execute(_id, params: any) {
        const id = params.characterId ?? (await loadOrCreateGameState(pkg, playId)).playerCharacterId;
        return toolResult(
          id ? await readCharacter(id, directory) : {
            character: null,
            next: "Offer beginner-friendly character creation or list existing characters.",
          },
        );
      },
    },
    {
      name: "character_create",
      label: "Create Character",
      description:
        "Save the player's agreed name and known narrative details. Blank fields are allowed; learn gradually. Does not select the character or invent stats.",
      parameters: Type.Object({
        ...fields,
        name: Type.String({ minLength: 1, maxLength: 2000 }),
        playerApproved: Type.Literal(true),
      }),
      executionMode: "sequential",
      async execute(_id, params: any) {
        if (params.playerApproved !== true) {
          throw new Error("Ask the player before creating their character.");
        }
        const { playerApproved: _, ...profile } = params;
        return toolResult(await createCharacter(profile, directory));
      },
    },
    {
      name: "character_select",
      label: "Select Character",
      description:
        "Attach a saved character to this play with a revision-checked transaction. Does not import HP, equipment, stats, or world facts from another play.",
      parameters: Type.Object({
        characterId: Type.String(),
        expectedRevision: Type.Integer({ minimum: 0 }),
        playerApproved: Type.Literal(true),
      }),
      executionMode: "sequential",
      async execute(_id, params: any) {
        if (params.playerApproved !== true) throw new Error("Ask the player which character to use.");
        const character = await readCharacter(params.characterId, directory);
        return toolResult(
          await applyStateTransaction(
            pkg,
            playId,
            params.expectedRevision,
            `Selected character ${character.name}`,
            [{ kind: "select_character", characterId: character.id }],
          ),
        );
      },
    },
    {
      name: "character_update",
      label: "Update Character",
      description:
        "Persist player-stated or approved narrative details for the active character. Omitted fields stay unchanged. Use the profile revision, not game revision. Never store mechanics here.",
      parameters: Type.Object({
        expectedRevision: Type.Integer({ minimum: 0 }),
        changes: Type.Object(fields, { additionalProperties: false }),
        playerProvidedOrApproved: Type.Literal(true),
      }),
      executionMode: "sequential",
      async execute(_id, params: any) {
        if (params.playerProvidedOrApproved !== true) {
          throw new Error("Only save character facts the player stated or approved.");
        }
        const state = await loadOrCreateGameState(pkg, playId);
        if (!state.playerCharacterId) throw new Error("Select a character first.");
        return toolResult(
          await updateCharacter(state.playerCharacterId, params.expectedRevision, params.changes, directory),
        );
      },
    },
    {
      name: "character_finish_setup",
      label: "Finish Character Setup",
      description:
        "Record that the player reviewed their character and is ready. First save applicable stats, abilities, HP and equipment with game_state_update; never assume a ruleset or invent mechanics.",
      parameters: Type.Object({
        expectedRevision: Type.Integer({ minimum: 0 }),
        playerReady: Type.Literal(true),
      }),
      executionMode: "sequential",
      async execute(_id, params: any) {
        if (params.playerReady !== true) throw new Error("Check that the player is ready to begin.");
        const state = await loadOrCreateGameState(pkg, playId);
        if (!state.playerCharacterId) throw new Error("Select a character first.");
        await readCharacter(state.playerCharacterId, directory);
        return toolResult(
          await applyStateTransaction(
            pkg,
            playId,
            params.expectedRevision,
            "Player confirmed character setup",
            [{ kind: "complete_character_setup" }],
          ),
        );
      },
    },
  ] satisfies ToolDefinition<any>[];
}
