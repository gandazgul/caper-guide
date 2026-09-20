import { safeId } from "./io.ts";
import { type AdventurePackage, saveAsset, saveManifest } from "./package.ts";
import type { AdventureEntity, AdventureScene, CanonFact, RuntimeProfile, SetupDecision } from "./types.ts";
import { assertEvidence, validateAdventure } from "./validation.ts";

function timestamp(): string {
  return new Date().toISOString();
}

function upsert<T extends { id: string }>(records: T[], record: T): T[] {
  const index = records.findIndex((candidate) => candidate.id === record.id);
  if (index < 0) return [...records, record];
  return records.map((candidate, candidateIndex) => candidateIndex === index ? record : candidate);
}

export async function recordSetupDecision(
  pkg: AdventurePackage,
  decision: Omit<SetupDecision, "updatedAt">,
): Promise<SetupDecision> {
  assertEvidence(pkg, decision.citations);
  if (decision.selections.length === 0 && decision.customAnswers.length === 0) {
    throw new Error("A setup decision needs at least one selected or custom answer.");
  }
  const saved = { ...decision, updatedAt: timestamp() };
  await saveAsset(pkg, "setup", {
    ...pkg.assets.setup,
    decisions: upsert(pkg.assets.setup.decisions, saved),
  });
  return saved;
}

export async function upsertCanonFact(
  pkg: AdventurePackage,
  fact: Omit<CanonFact, "id" | "updatedAt"> & { id: string },
): Promise<CanonFact> {
  assertEvidence(pkg, fact.citations);
  const saved: CanonFact = { ...fact, id: safeId(fact.id), updatedAt: timestamp() };
  await saveAsset(pkg, "canon", { ...pkg.assets.canon, facts: upsert(pkg.assets.canon.facts, saved) });
  return saved;
}

export async function upsertEntity(
  pkg: AdventurePackage,
  entity: Omit<AdventureEntity, "id" | "updatedAt"> & { id: string },
): Promise<AdventureEntity> {
  assertEvidence(pkg, entity.citations);
  const saved: AdventureEntity = { ...entity, id: safeId(entity.id), updatedAt: timestamp() };
  await saveAsset(pkg, "entities", {
    ...pkg.assets.entities,
    entities: upsert(pkg.assets.entities.entities, saved),
  });
  return saved;
}

export async function upsertScene(
  pkg: AdventurePackage,
  scene: Omit<AdventureScene, "id" | "updatedAt"> & { id: string },
): Promise<AdventureScene> {
  assertEvidence(pkg, scene.citations);
  const saved: AdventureScene = {
    ...scene,
    id: safeId(scene.id),
    transitions: scene.transitions.map((transition) => ({
      ...transition,
      targetSceneId: safeId(transition.targetSceneId),
    })),
    updatedAt: timestamp(),
  };
  await saveAsset(pkg, "scenes", { ...pkg.assets.scenes, scenes: upsert(pkg.assets.scenes.scenes, saved) });
  return saved;
}

export async function setRuntimeProfile(
  pkg: AdventurePackage,
  profile: RuntimeProfile,
): Promise<RuntimeProfile> {
  const citations = [
    ...(profile.rules?.citations ?? []),
    ...(profile.toneAndSafety?.citations ?? []),
    ...(profile.adaptationPolicy?.citations ?? []),
    ...(profile.outOfBoundsPolicy?.citations ?? []),
    ...profile.clocks.flatMap((clock) => clock.citations),
  ];
  for (const citation of citations) assertEvidence(pkg, [citation]);
  await saveAsset(pkg, "runtime", profile);
  return profile;
}

export async function markAdventureReady(pkg: AdventurePackage): Promise<void> {
  const blockers = validateAdventure(pkg).filter((issue) => issue.severity === "blocker");
  if (blockers.length > 0) {
    throw new Error(`Adventure is not ready: ${blockers.map((issue) => issue.message).join(" ")}`);
  }
  pkg.manifest.status = "ready";
  await saveManifest(pkg);
}
