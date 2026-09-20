import type { AdventurePackage } from "./package.ts";
import type { EvidenceRef, ValidationIssue } from "./types.ts";
import { SETUP_TOPICS } from "./types.ts";

function recordIssue(
  issues: ValidationIssue[],
  severity: ValidationIssue["severity"],
  code: string,
  message: string,
  asset?: string,
  recordId?: string,
): void {
  issues.push({ severity, code, message, asset, recordId });
}

export function validateEvidence(pkg: AdventurePackage, citations: EvidenceRef[]): string[] {
  if (citations.length === 0) return ["At least one PDF page citation is required."];
  const errors: string[] = [];
  for (const citation of citations) {
    const source = pkg.sources.find((candidate) => candidate.id === citation.sourceId);
    if (!source) errors.push(`Unknown source ${citation.sourceId}.`);
    else if (!Number.isInteger(citation.page) || citation.page < 1 || citation.page > source.pageCount) {
      errors.push(`${citation.sourceId} has no page ${citation.page} (valid pages: 1-${source.pageCount}).`);
    }
  }
  return errors;
}

export function assertEvidence(pkg: AdventurePackage, citations: EvidenceRef[]): void {
  const errors = validateEvidence(pkg, citations);
  if (errors.length > 0) throw new Error(errors.join(" "));
}

export function validateAdventure(pkg: AdventurePackage): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (pkg.sources.length === 0) {
    recordIssue(issues, "blocker", "source.missing", "Import at least one adventure PDF.");
  }

  for (const topic of SETUP_TOPICS) {
    if (!pkg.assets.setup.decisions.some((decision) => decision.id === topic)) {
      recordIssue(issues, "blocker", "setup.missing", `The author has not decided ${topic}.`, "setup", topic);
    }
  }

  const citedRecords: Array<{ asset: string; id: string; citations: EvidenceRef[] }> = [
    ...(["rules", "toneAndSafety", "adaptationPolicy", "outOfBoundsPolicy"] as const)
      .flatMap((key) =>
        pkg.assets.runtime[key]
          ? [{ asset: "runtime", id: key, citations: pkg.assets.runtime[key]!.citations }]
          : []
      ),
    ...pkg.assets.setup.decisions.map((record) => ({
      asset: "setup",
      id: record.id,
      citations: record.citations,
    })),
    ...pkg.assets.canon.facts.map((record) => ({
      asset: "canon",
      id: record.id,
      citations: record.citations,
    })),
    ...pkg.assets.entities.entities.map((record) => ({
      asset: "entities",
      id: record.id,
      citations: record.citations,
    })),
    ...pkg.assets.scenes.scenes.map((record) => ({
      asset: "scenes",
      id: record.id,
      citations: record.citations,
    })),
    ...pkg.assets.runtime.clocks.map((record) => ({
      asset: "runtime",
      id: record.id,
      citations: record.citations,
    })),
  ];
  for (const record of citedRecords) {
    for (const error of validateEvidence(pkg, record.citations)) {
      recordIssue(issues, "blocker", "evidence.invalid", error, record.asset, record.id);
    }
  }
  for (
    const [asset, records] of [
      ["setup", pkg.assets.setup.decisions],
      ["canon", pkg.assets.canon.facts],
      ["entities", pkg.assets.entities.entities],
      ["scenes", pkg.assets.scenes.scenes],
      ["runtime", pkg.assets.runtime.clocks],
    ] as const
  ) {
    const ids = new Set<string>();
    for (const record of records) {
      if (ids.has(record.id)) {
        recordIssue(issues, "blocker", "record.duplicate", `Duplicate ID ${record.id}.`, asset, record.id);
      }
      ids.add(record.id);
    }
  }
  for (const clock of pkg.assets.runtime.clocks) {
    if (!Number.isSafeInteger(clock.segments) || clock.segments < 2 || clock.segments > 24) {
      recordIssue(
        issues,
        "blocker",
        "clock.segments_invalid",
        `${clock.name} needs 2–24 segments.`,
        "runtime",
        clock.id,
      );
    }
  }

  if (pkg.assets.canon.facts.length === 0) {
    recordIssue(
      issues,
      "blocker",
      "canon.empty",
      "Add source-backed facts that the guide must not contradict.",
    );
  }
  if (pkg.assets.entities.entities.length === 0) {
    recordIssue(
      issues,
      "blocker",
      "entities.empty",
      "Add at least one location, character, creature, item, or hazard.",
    );
  }
  if (pkg.assets.scenes.scenes.length === 0) {
    recordIssue(issues, "blocker", "scenes.empty", "Add at least one playable scene.");
  }
  if (!pkg.assets.runtime.rules) {
    recordIssue(
      issues,
      "blocker",
      "runtime.rules_missing",
      "Define how uncertain actions and dice are resolved.",
    );
  }
  if (!pkg.assets.runtime.toneAndSafety) {
    recordIssue(issues, "blocker", "runtime.safety_missing", "Define tone and table comfort boundaries.");
  }
  if (!pkg.assets.runtime.adaptationPolicy) {
    recordIssue(
      issues,
      "blocker",
      "runtime.adaptation_missing",
      "Define which details the guide may adjust and which canon it must preserve.",
    );
  }
  if (!pkg.assets.runtime.outOfBoundsPolicy) {
    recordIssue(
      issues,
      "blocker",
      "runtime.bounds_missing",
      "Define how unsupported player actions are handled.",
    );
  }

  const sceneIds = new Set(pkg.assets.scenes.scenes.map((scene) => scene.id));
  for (const scene of pkg.assets.scenes.scenes) {
    for (const id of scene.locationIds) {
      if (!pkg.assets.entities.entities.some((entity) => entity.id === id && entity.kind === "location")) {
        recordIssue(
          issues,
          "blocker",
          "scene.location_missing",
          `${scene.id} references unknown location ${id}.`,
          "scenes",
          scene.id,
        );
      }
    }
    for (const id of scene.secretIds) {
      if (!pkg.assets.canon.facts.some((fact) => fact.id === id && fact.category === "secret")) {
        recordIssue(
          issues,
          "blocker",
          "scene.secret_missing",
          `${scene.id} references unknown secret ${id}.`,
          "scenes",
          scene.id,
        );
      }
    }
    for (const transition of scene.transitions) {
      if (!sceneIds.has(transition.targetSceneId)) {
        recordIssue(
          issues,
          "blocker",
          "scene.transition_missing",
          `${scene.id} points to unknown scene ${transition.targetSceneId}.`,
          "scenes",
          scene.id,
        );
      }
    }
    if (scene.supportedActions.length === 0) {
      recordIssue(
        issues,
        "warning",
        "scene.actions_empty",
        `${scene.id} has no examples of supported player actions.`,
        "scenes",
        scene.id,
      );
    }
  }
  return issues;
}
