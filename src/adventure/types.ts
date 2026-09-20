export const SETUP_TOPICS = [
  "rules_system",
  "party",
  "tone_and_safety",
  "character_control",
  "rules_resolution",
  "out_of_bounds_policy",
  "adaptation_policy",
] as const;

export type SetupTopic = (typeof SETUP_TOPICS)[number];
export type Visibility = "player" | "guide";
export type AdventureStatus = "draft" | "ready";

export interface EvidenceRef {
  sourceId: string;
  page: number;
}

export interface SourceRecord {
  id: string;
  title: string;
  sha256: string;
  originalFilename: string;
  importedFrom: string;
  pdfPath: string;
  extractedPath: string;
  pageCount: number;
  importedAt: string;
}

export interface AdventureManifest {
  schemaVersion: 1;
  id: string;
  title: string;
  status: AdventureStatus;
  createdAt: string;
  updatedAt: string;
  sourceIds: string[];
  assetFiles: {
    setup: "assets/setup.json";
    canon: "assets/canon.json";
    entities: "assets/entities.json";
    scenes: "assets/scenes.json";
    runtime: "assets/runtime.json";
  };
  distributionNote: string;
}

export interface SetupDecision {
  id: SetupTopic;
  question: string;
  selections: string[];
  customAnswers: string[];
  rationale: string;
  citations: EvidenceRef[];
  updatedAt: string;
}

export interface SetupAsset {
  schemaVersion: 1;
  decisions: SetupDecision[];
}

export interface CanonFact {
  id: string;
  statement: string;
  visibility: Visibility;
  category: "premise" | "world" | "secret" | "ending" | "constraint";
  citations: EvidenceRef[];
  updatedAt: string;
}

export interface CanonAsset {
  schemaVersion: 1;
  facts: CanonFact[];
}

export interface AdventureEntity {
  id: string;
  kind: "character" | "creature" | "faction" | "location" | "item" | "hazard";
  name: string;
  playerSummary: string;
  guideNotes: string;
  knowledge: string[];
  constraints: string[];
  citations: EvidenceRef[];
  updatedAt: string;
}

export interface EntitiesAsset {
  schemaVersion: 1;
  entities: AdventureEntity[];
}

export interface SceneTransition {
  when: string;
  targetSceneId: string;
}

export interface AdventureScene {
  id: string;
  name: string;
  summary: string;
  locationIds: string[];
  entryConditions: string[];
  supportedActions: string[];
  fallbackActions: string[];
  secretIds: string[];
  transitions: SceneTransition[];
  citations: EvidenceRef[];
  updatedAt: string;
}

export interface ScenesAsset {
  schemaVersion: 1;
  scenes: AdventureScene[];
}

export interface RuntimeClock {
  id: string;
  name: string;
  segments: number;
  advanceWhen: string;
  effects: string[];
  citations: EvidenceRef[];
}

export interface RuntimeProfile {
  schemaVersion: 1;
  rules?: {
    systemName: string;
    resolution: string;
    whoRolls: string;
    citations: EvidenceRef[];
  };
  toneAndSafety?: {
    tone: string;
    lines: string[];
    veils: string[];
    contentNotes: string[];
    explanation: string;
    citations: EvidenceRef[];
  };
  adaptationPolicy?: {
    preserve: string[];
    mayAdapt: string[];
    explanation: string;
    citations: EvidenceRef[];
  };
  outOfBoundsPolicy?: {
    response: string;
    offerClosestSupportedActions: boolean;
    citations: EvidenceRef[];
  };
  clocks: RuntimeClock[];
}

export interface AdventureAssets {
  setup: SetupAsset;
  canon: CanonAsset;
  entities: EntitiesAsset;
  scenes: ScenesAsset;
  runtime: RuntimeProfile;
}

export interface SourcePage {
  sourceId: string;
  page: number;
  markdown: string;
}

export interface ValidationIssue {
  severity: "blocker" | "warning";
  code: string;
  message: string;
  asset?: string;
  recordId?: string;
}

export interface GameState {
  schemaVersion: 1;
  adventureId: string;
  playId: string;
  revision: number;
  startedAt: string;
  updatedAt: string;
  currentSceneId?: string;
  elapsedTurns: number;
  flags: Record<string, boolean | string | number>;
  clocks: Record<string, number>;
  revealedSecrets: string[];
  actorLocations: Record<string, string>;
  resources: Record<string, Record<string, number>>;
  inventory: Record<string, number>;
}

export type StateChange =
  | { kind: "set_current_scene"; sceneId: string }
  | { kind: "advance_turns"; amount: number }
  | { kind: "set_flag"; key: string; value: boolean | string | number }
  | { kind: "set_clock"; clockId: string; value: number }
  | { kind: "reveal_secret"; secretId: string }
  | { kind: "set_actor_location"; actorId: string; locationId: string }
  | { kind: "adjust_resource"; ownerId: string; resource: string; delta: number }
  | { kind: "inventory_add"; itemId: string; amount: number }
  | { kind: "inventory_remove"; itemId: string; amount: number };

export interface StateEvent {
  eventId: string;
  adventureId: string;
  playId: string;
  revision: number;
  timestamp: string;
  reason: string;
  changes: StateChange[];
}
