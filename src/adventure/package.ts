import { basename, join, relative, resolve } from "node:path";
import type {
  AdventureAssets,
  AdventureManifest,
  CanonAsset,
  EntitiesAsset,
  PdfSourceRecord,
  RuntimeProfile,
  ScenesAsset,
  SetupAsset,
  SourcePage,
  SourceRecord,
} from "./types.ts";
import { MANIFEST_FILE, manifestPath, pathExists, readJson, safeId, writeJsonAtomic } from "./io.ts";

const SOURCE_INDEX = "sources/index.json";

export interface AdventurePackage {
  root: string;
  manifest: AdventureManifest;
  sources: SourceRecord[];
  assets: AdventureAssets;
}

function now(): string {
  return new Date().toISOString();
}

function titleFromPath(path: string): string {
  return basename(path)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export async function createAdventurePackage(
  rootInput: string,
  options: { id?: string; title?: string } = {},
): Promise<AdventurePackage> {
  const root = resolve(rootInput);
  if (await pathExists(manifestPath(root))) return loadAdventurePackage(root);

  await Deno.mkdir(root, { recursive: true });
  const timestamp = now();
  const manifest: AdventureManifest = {
    schemaVersion: 1,
    id: safeId(options.id ?? basename(root)),
    title: options.title?.trim() || titleFromPath(root),
    status: "draft",
    createdAt: timestamp,
    updatedAt: timestamp,
    sourceIds: [],
    assetFiles: {
      setup: "assets/setup.json",
      canon: "assets/canon.json",
      entities: "assets/entities.json",
      scenes: "assets/scenes.json",
      runtime: "assets/runtime.json",
    },
    distributionNote:
      "Source PDFs and full extractions are local reference material. Verify the source license before sharing them.",
  };
  const assets: AdventureAssets = {
    setup: { schemaVersion: 1, decisions: [] },
    canon: { schemaVersion: 1, facts: [] },
    entities: { schemaVersion: 1, entities: [] },
    scenes: { schemaVersion: 1, scenes: [] },
    runtime: { schemaVersion: 1, clocks: [] },
  };

  await Promise.all([
    writeJsonAtomic(manifestPath(root), manifest),
    writeJsonAtomic(join(root, SOURCE_INDEX), []),
    ...Object.entries(manifest.assetFiles).map(([key, file]) =>
      writeJsonAtomic(join(root, file), assets[key as keyof AdventureAssets])
    ),
  ]);
  await Deno.mkdir(join(root, ".adventure", "agents"), { recursive: true });
  await Deno.writeTextFile(
    join(root, "sources", "README.md"),
    "# Local source material\n\nPDFs and page-marked extractions live here so citations remain stable. " +
      "They may be copyrighted; do not publish them unless the license permits it.\n",
  );
  return { root, manifest, sources: [], assets };
}

export async function loadAdventurePackage(rootInput: string): Promise<AdventurePackage> {
  const root = resolve(rootInput);
  if (!(await pathExists(manifestPath(root)))) {
    throw new Error(`${root} is not an adventure package (missing ${MANIFEST_FILE})`);
  }
  const manifest = await readJson<AdventureManifest>(manifestPath(root));
  if (manifest.schemaVersion !== 1) throw new Error(`Unsupported adventure schema ${manifest.schemaVersion}`);
  if (
    typeof manifest.id !== "string" || safeId(manifest.id) !== manifest.id ||
    typeof manifest.title !== "string" || !["draft", "ready"].includes(manifest.status)
  ) {
    throw new Error("Invalid adventure manifest: check its ID, title, and draft/ready status.");
  }
  for (const key of ["setup", "canon", "entities", "scenes", "runtime"] as const) {
    if (manifest.assetFiles?.[key] !== `assets/${key}.json`) {
      throw new Error(`Invalid adventure asset path for ${key}; expected assets/${key}.json.`);
    }
  }
  const [sources, setup, canon, entities, scenes, runtime] = await Promise.all([
    readJson<SourceRecord[]>(join(root, SOURCE_INDEX)),
    readJson<SetupAsset>(join(root, manifest.assetFiles.setup)),
    readJson<CanonAsset>(join(root, manifest.assetFiles.canon)),
    readJson<EntitiesAsset>(join(root, manifest.assetFiles.entities)),
    readJson<ScenesAsset>(join(root, manifest.assetFiles.scenes)),
    readJson<RuntimeProfile>(join(root, manifest.assetFiles.runtime)),
  ]);
  for (
    const [key, asset, records] of [
      ["setup", setup, setup.decisions],
      ["canon", canon, canon.facts],
      ["entities", entities, entities.entities],
      ["scenes", scenes, scenes.scenes],
      ["runtime", runtime, runtime.clocks],
    ] as const
  ) {
    if (asset.schemaVersion !== 1 || !Array.isArray(records)) {
      throw new Error(`Invalid ${key} asset: expected schemaVersion 1 and a records array.`);
    }
  }
  if (!Array.isArray(sources)) throw new Error("Invalid source index: expected an array.");
  for (const source of sources) {
    if (
      typeof source.id !== "string" || safeId(source.id) !== source.id ||
      (source.kind === "image"
        ? source.pageCount !== 1 ||
          !["image/png", "image/jpeg", "image/webp"].includes(source.mimeType) ||
          source.imagePath !==
            `sources/files/${source.id}.${
              source.mimeType === "image/jpeg" ? "jpg" : source.mimeType.slice(6)
            }`
        : (source.kind !== undefined && source.kind !== "pdf") ||
          source.pdfPath !== `sources/files/${source.id}.pdf` ||
          source.extractedPath !== `sources/extracted/${source.id}.md`) ||
      !Number.isSafeInteger(source.pageCount) || source.pageCount < 1
    ) {
      throw new Error(`Invalid source record ${source.id}: check its paths and page count.`);
    }
  }
  return { root, manifest, sources, assets: { setup, canon, entities, scenes, runtime } };
}

export async function saveManifest(pkg: AdventurePackage): Promise<void> {
  pkg.manifest.updatedAt = now();
  await writeJsonAtomic(manifestPath(pkg.root), pkg.manifest);
}

export async function saveSources(pkg: AdventurePackage): Promise<void> {
  pkg.manifest.sourceIds = pkg.sources.map((source) => source.id);
  pkg.manifest.status = "draft";
  await saveManifest(pkg);
  await writeJsonAtomic(join(pkg.root, SOURCE_INDEX), pkg.sources);
}

export async function saveAsset<K extends keyof AdventureAssets>(
  pkg: AdventurePackage,
  key: K,
  value: AdventureAssets[K],
): Promise<void> {
  // Invalidate readiness before publishing changed content, including if the write later fails.
  pkg.manifest.status = "draft";
  await saveManifest(pkg);
  await writeJsonAtomic(join(pkg.root, pkg.manifest.assetFiles[key]), value);
  pkg.assets[key] = value;
}

export function splitExtractedPages(sourceId: string, markdown: string): SourcePage[] {
  const marker = /<!--\s*page\s+(\d+)\s*-->/gi;
  const matches = [...markdown.matchAll(marker)];
  if (matches.length === 0) return [{ sourceId, page: 1, markdown: markdown.trim() }];
  return matches.map((match, index) => ({
    sourceId,
    page: Number(match[1]),
    markdown: markdown.slice((match.index ?? 0) + match[0].length, matches[index + 1]?.index).trim(),
  }));
}

export async function readSourcePages(pkg: AdventurePackage, sourceId?: string): Promise<SourcePage[]> {
  const selected = sourceId ? pkg.sources.filter((source) => source.id === sourceId) : pkg.sources;
  if (sourceId && selected.length === 0) throw new Error(`Unknown source ${sourceId}`);
  if (sourceId && selected[0].kind === "image") {
    throw new Error(
      "This source is an image, not a text extraction. The Author can use source_view_page with page 1; the Guide should use its cited authored assets.",
    );
  }
  const sources = selected.filter((source): source is PdfSourceRecord => source.kind !== "image");
  const pageSets = await Promise.all(
    sources.map(async (source) =>
      splitExtractedPages(source.id, await Deno.readTextFile(join(pkg.root, source.extractedPath)))
    ),
  );
  return pageSets.flat();
}

async function sha256(path: string): Promise<string> {
  const bytes = await Deno.readFile(path);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function extractedTitle(path: string, markdown: string): string {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || basename(path).replace(/\.pdf$/i, "");
}

export async function importPdf(
  pkg: AdventurePackage,
  pdfInput: string,
  signal?: AbortSignal,
): Promise<PdfSourceRecord> {
  signal?.throwIfAborted();
  const absolutePdf = await Deno.realPath(pdfInput);
  const digest = await sha256(absolutePdf);
  const duplicate = pkg.sources.find((source): source is PdfSourceRecord =>
    source.kind !== "image" && source.sha256 === digest
  );
  if (duplicate) return duplicate;

  const command = new Deno.Command("unpdf", {
    args: ["markdown", absolutePdf, "--page-markers", "--cleanup", "standard"],
    stdout: "piped",
    stderr: "piped",
    signal,
  });
  let output: Deno.CommandOutput;
  try {
    output = await command.output();
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error("PDF import needs unpdf installed and available on PATH.");
    }
    throw error;
  }
  signal?.throwIfAborted();
  if (!output.success) {
    throw new Error(
      `unpdf could not extract ${absolutePdf}: ${new TextDecoder().decode(output.stderr).trim()}`,
    );
  }
  const markdown = new TextDecoder().decode(output.stdout);
  const id = `source-${digest.slice(0, 12)}`;
  const pages = splitExtractedPages(id, markdown);
  if (!pages.some((page) => page.markdown.trim())) {
    throw new Error(
      "This PDF produced no readable text. It may be scanned; use a text-searchable/OCR copy before importing.",
    );
  }
  if (pages.some((page, index) => page.page !== index + 1)) {
    throw new Error(
      "PDF extraction has missing or out-of-order page markers; import stopped to keep citations reliable.",
    );
  }
  if (!/<!--\s*page\s+1\s*-->/i.test(markdown)) {
    throw new Error(
      "PDF extraction did not include page markers; import stopped to avoid inventing page citations.",
    );
  }
  if (await sha256(absolutePdf) !== digest) {
    throw new Error("The PDF changed during extraction. Wait for it to finish saving and import it again.");
  }
  const pdfPath = join("sources", "files", `${id}.pdf`);
  const extractedPath = join("sources", "extracted", `${id}.md`);
  await Deno.mkdir(join(pkg.root, "sources", "files"), { recursive: true });
  await Deno.mkdir(join(pkg.root, "sources", "extracted"), { recursive: true });
  await Promise.all([
    Deno.copyFile(absolutePdf, join(pkg.root, pdfPath)),
    Deno.writeTextFile(join(pkg.root, extractedPath), markdown),
  ]);
  const record: PdfSourceRecord = {
    id,
    title: extractedTitle(absolutePdf, markdown),
    sha256: digest,
    originalFilename: basename(absolutePdf),
    importedFrom: absolutePdf,
    pdfPath: relative(pkg.root, join(pkg.root, pdfPath)),
    extractedPath: relative(pkg.root, join(pkg.root, extractedPath)),
    pageCount: pages.length,
    importedAt: now(),
  };
  pkg.sources.push(record);
  await saveSources(pkg);
  return record;
}

export function packageSummary(pkg: AdventurePackage): Record<string, unknown> {
  return {
    root: pkg.root,
    id: pkg.manifest.id,
    title: pkg.manifest.title,
    status: pkg.manifest.status,
    sources: pkg.sources.map((source) => ({
      id: source.id,
      title: source.title,
      kind: source.kind ?? "pdf",
      pages: source.pageCount,
      ...(source.kind === "image"
        ? { image: join(pkg.root, source.imagePath), mimeType: source.mimeType }
        : { pdf: join(pkg.root, source.pdfPath), extraction: join(pkg.root, source.extractedPath) }),
    })),
    assets: {
      setupDecisions: pkg.assets.setup.decisions.length,
      canonFacts: pkg.assets.canon.facts.length,
      entities: pkg.assets.entities.entities.length,
      scenes: pkg.assets.scenes.scenes.length,
      clocks: pkg.assets.runtime.clocks.length,
    },
  };
}
