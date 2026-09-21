import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  type AdventurePackage,
  importPdf,
  packageSummary,
  readSourcePages,
  saveManifest,
} from "../adventure/package.ts";
import { validateAdventure } from "../adventure/validation.ts";
import { toolResult } from "./common.ts";

function terms(value: string): string[] {
  return [...new Set(value.toLowerCase().match(/[\p{L}\p{N}]+(?:&[\p{L}\p{N}]+)*/gu) ?? [])];
}

function excerpt(markdown: string, queryTerms: string[], length = 900): string {
  const lower = markdown.toLowerCase();
  const first =
    queryTerms.map((term) => lower.indexOf(term)).filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, first - 180);
  return markdown.slice(start, start + length).replace(/\s+/g, " ").trim();
}

export function resolvePdfInputPath(input: string, baseDirectory: string): string {
  let path = input.trim();
  if (path.startsWith("@")) path = path.slice(1);
  if (
    path.length >= 2 &&
    ((path.startsWith('"') && path.endsWith('"')) || (path.startsWith("'") && path.endsWith("'")))
  ) {
    path = path.slice(1, -1).trim();
  }
  if (path.startsWith("@")) path = path.slice(1);
  if (path === "~") path = homedir();
  else if (path.startsWith("~/")) path = resolve(homedir(), path.slice(2));
  if (!path) throw new Error("A file path is required.");
  return isAbsolute(path) ? resolve(path) : resolve(baseDirectory, path);
}

export function createPdfImportTool(pkg: AdventurePackage, baseDirectory: string): ToolDefinition {
  return {
    name: "source_load_pdf",
    label: "Load Adventure PDF",
    description:
      "Import a local PDF into the active adventure package, copy it into durable source storage, and extract page-marked Markdown with unpdf. Accepts absolute, relative, @-prefixed, and ~/ paths.",
    promptSnippet: "Load and extract a local adventure PDF",
    parameters: Type.Object({
      path: Type.String({ minLength: 1, description: "The local path supplied by the author." }),
    }),
    executionMode: "sequential",
    async execute(_id, params: any, signal) {
      const pdfPath = resolvePdfInputPath(params.path, baseDirectory);
      if (!pdfPath.toLowerCase().endsWith(".pdf")) {
        throw new Error(`Only PDF sources can be loaded: ${pdfPath}`);
      }
      let fileInfo: Deno.FileInfo;
      try {
        fileInfo = await Deno.stat(pdfPath);
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) throw new Error(`PDF not found: ${pdfPath}`);
        throw error;
      }
      if (!fileInfo.isFile) throw new Error(`PDF path is not a file: ${pdfPath}`);

      const sourceCount = pkg.sources.length;
      const shouldAdoptTitle = sourceCount === 0 &&
        pkg.manifest.title === "New Adventure";
      const source = await importPdf(pkg, pdfPath, signal);
      const alreadyImported = pkg.sources.length === sourceCount;
      if (!alreadyImported && shouldAdoptTitle) {
        pkg.manifest.title = source.title;
        await saveManifest(pkg);
      }
      return toolResult({
        imported: !alreadyImported,
        alreadyImported,
        source: {
          id: source.id,
          title: source.title,
          pages: source.pageCount,
          original: source.importedFrom,
          storedPdf: resolve(pkg.root, source.pdfPath),
          extraction: resolve(pkg.root, source.extractedPath),
        },
        next: "Inspect or search this source before making source-backed recommendations.",
      });
    },
  } satisfies ToolDefinition<any>;
}

export function createSourceTools(pkg: AdventurePackage): ToolDefinition[] {
  const packageInspect: ToolDefinition<any> = {
    name: "adventure_inspect",
    label: "Adventure Inspect",
    description:
      "Inspect package status, durable asset counts, PDF and image source locations, and validation issues.",
    promptSnippet: "Inspect the adventure package and its readiness",
    parameters: Type.Object({}),
    executionMode: "sequential",
    async execute() {
      const details = { summary: packageSummary(pkg), validation: validateAdventure(pkg) };
      return toolResult(details);
    },
  };

  const sourceSearch: ToolDefinition<any> = {
    name: "source_search",
    label: "Source Search",
    description:
      "Search page-marked PDF extractions. Results are source evidence, not authored canon until saved in an asset.",
    promptSnippet: "Search the imported adventure PDFs by page",
    parameters: Type.Object({
      query: Type.String({ minLength: 2 }),
      sourceId: Type.Optional(Type.String()),
      maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 12 })),
    }),
    executionMode: "parallel",
    async execute(_id, params: any) {
      const queryTerms = terms(params.query);
      if (queryTerms.length === 0) throw new Error("Search query needs at least one word or number.");
      const pages = await readSourcePages(pkg, params.sourceId);
      const results = pages
        .map((page) => {
          const lower = page.markdown.toLowerCase();
          const score = queryTerms.reduce((total, term) => total + (lower.split(term).length - 1), 0);
          return { ...page, score };
        })
        .filter((page) => page.score > 0)
        .sort((left, right) => right.score - left.score || left.page - right.page)
        .slice(0, params.maxResults ?? 6)
        .map((page) => ({
          citation: { sourceId: page.sourceId, page: page.page },
          score: page.score,
          excerpt: excerpt(page.markdown, queryTerms),
        }));
      return toolResult(
        { query: params.query, results },
        results.length ? undefined : "No matching PDF pages found.",
      );
    },
  };

  const sourceRead: ToolDefinition<any> = {
    name: "source_read_pages",
    label: "Source Read Pages",
    description:
      "Read exact PDF extraction pages so claims and recommendations can be checked against their context.",
    promptSnippet: "Read exact pages from an imported adventure PDF",
    parameters: Type.Object({
      sourceId: Type.String({ minLength: 1 }),
      pages: Type.Array(Type.Integer({ minimum: 1 }), { minItems: 1, maxItems: 6 }),
    }),
    executionMode: "parallel",
    async execute(_id, params: any) {
      const available = await readSourcePages(pkg, params.sourceId);
      const wanted = new Set(params.pages);
      const selected = available.filter((page) => wanted.has(page.page));
      const missing = params.pages.filter((page: number) =>
        !selected.some((candidate) => candidate.page === page)
      );
      if (missing.length) throw new Error(`Missing ${params.sourceId} page(s): ${missing.join(", ")}`);
      return toolResult(
        selected.map((page) => ({
          citation: { sourceId: page.sourceId, page: page.page },
          text: page.markdown,
        })),
      );
    },
  };

  return [packageInspect, sourceSearch, sourceRead];
}
