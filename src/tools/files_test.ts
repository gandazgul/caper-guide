import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { Buffer } from "node:buffer";
import { join } from "node:path";
import { loadAgentDefinition } from "../agents/loader.ts";
import { runAuthorCommand } from "../commands/author.ts";
import {
  createAdventurePackage,
  loadAdventurePackage,
  readSourcePages,
  saveSources,
} from "../adventure/package.ts";
import { validateAdventure, validateEvidence } from "../adventure/validation.ts";
import { createAuthorFileTools, imageMime, importImage, readBoundedFile, viewSourcePage } from "./files.ts";
import { createSourceTools } from "./source.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlWQAAAAASUVORK5CYII=",
  "base64",
);

async function fixture(
  run: (root: string, pkg: Awaited<ReturnType<typeof createAdventurePackage>>) => Promise<void>,
) {
  const root = await Deno.makeTempDir({ prefix: "caper-files-test-" });
  try {
    await run(root, await createAdventurePackage(join(root, "adventure")));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test("image sources survive reload and original removal, deduplicate, and support page-1 citations", () =>
  fixture(async (root, pkg) => {
    const path = join(root, "map.png");
    await Deno.writeFile(path, PNG);
    pkg.manifest.status = "ready";
    const source = await importImage(pkg, path, "Dungeon map");
    assertEquals(pkg.manifest.status, "draft");
    assertEquals((await importImage(pkg, path)).id, source.id);
    assertEquals(pkg.sources.length, 1);
    await Deno.remove(path);
    const loaded = await loadAdventurePackage(pkg.root);
    assertEquals(loaded.sources[0], source);
    assertEquals(validateEvidence(loaded, [{ sourceId: source.id, page: 1 }]), []);
    assertEquals(validateEvidence(loaded, [{ sourceId: source.id, page: 2 }]).length, 1);
    assert(
      validateAdventure(loaded).some((issue) => issue.code === "source.missing"),
      "A map must not replace the adventure PDF requirement",
    );
    const result = await viewSourcePage(loaded, source.id, 1);
    const image = result.content.find((item) => item.type === "image");
    assert(image?.type === "image");
    assertEquals(image.data, PNG.toString("base64"));
    assertEquals(result.details.citation, { sourceId: source.id, page: 1 });
    assertEquals(await readSourcePages(loaded), []);
    await assertRejects(() => readSourcePages(loaded, source.id), Error, "source_view_page");
    await assertRejects(() => viewSourcePage(loaded, source.id, 2), Error, "Invalid page");
    await assertRejects(() => viewSourcePage(loaded, "missing", 1), Error, "Unknown source");
  }));

Deno.test("visual reads reject changed files and source symlink escapes", () =>
  fixture(async (root, pkg) => {
    const path = join(root, "map.png");
    await Deno.writeFile(path, PNG);
    const source = await importImage(pkg, path);
    const stored = join(pkg.root, source.imagePath);
    await Deno.writeFile(stored, new Uint8Array([1, 2, 3]));
    await assertRejects(() => viewSourcePage(pkg, source.id, 1), Error, "changed since import");
    await Deno.remove(stored);
    await Deno.symlink(path, stored);
    await assertRejects(() => viewSourcePage(pkg, source.id, 1), Error, "outside the adventure package");
    source.imagePath = "../map.png";
    await saveSources(pkg);
    await assertRejects(() => loadAdventurePackage(pkg.root), Error, "Invalid source record");
  }));

Deno.test("text reading supports quoted @ paths, bounded continuation, and rejects binary and oversized files", () =>
  fixture(async (root, pkg) => {
    const path = join(root, "notes with spaces.md");
    await Deno.writeTextFile(path, "north door\nsouth stairs");
    const tool = createAuthorFileTools(pkg, root).find((tool) => tool.name === "file_read")!;
    const read = (params: any) => tool.execute("test", params, undefined, undefined, {} as any);
    const first = await read({ path: '@"notes with spaces.md"', limit: 10 });
    assertEquals((first.details as any).text, "north door");
    assertEquals((first.details as any).nextOffset, 10);
    const rest = await read({ path, offset: 10 });
    assertEquals((rest.details as any).text, "\nsouth stairs");
    assertEquals((rest.details as any).nextOffset, null);
    await assertRejects(() => read({ path, offset: 999 }), Error, "Offset exceeds");
    await Deno.writeFile(path, PNG);
    await assertRejects(() => read({ path }), Error, "binary file");
    await assertRejects(() => readBoundedFile(path, 2), Error, "byte limit");
    await assertRejects(() => readBoundedFile(root, 100), Error);
    await Deno.writeTextFile(path, "x".repeat(1024 * 1024 + 1));
    await assertRejects(() => read({ path }), Error, "byte limit");
  }));

Deno.test("image import rejects disguised content and oversized files without registering evidence", () =>
  fixture(async (root, pkg) => {
    const path = join(root, "fake.png");
    await Deno.writeTextFile(path, "not an image");
    await assertRejects(() => importImage(pkg, path), Error, "Unsupported image");
    await Deno.writeFile(path, new Uint8Array(4 * 1024 * 1024 + 1));
    await assertRejects(() => importImage(pkg, path), Error, "byte limit");
    assertEquals(pkg.sources, []);
    assertThrows(() => imageMime(new TextEncoder().encode("<svg>map</svg>")), Error, "Unsupported image");
  }));

Deno.test("image import retries after an interrupted index write without overwriting source bytes", () =>
  fixture(async (root, pkg) => {
    const path = join(root, "map.png");
    await Deno.writeFile(path, PNG);
    const source = await importImage(pkg, path);
    pkg.sources = [];
    await saveSources(pkg);
    assertEquals((await importImage(pkg, path)).id, source.id);
  }));

Deno.test("Author tools are wired, protected on resume, and unavailable to Guide; non-vision models fail clearly", () =>
  fixture(async (root, pkg) => {
    const names = ["file_read", "source_load_image", "source_view_page"];
    await runAuthorCommand([pkg.root], { cwd: root }, {
      async runTui(options) {
        for (const name of names) {
          assert(options.tools.some((tool) => tool.name === name));
          assert(options.agent.tools.includes(name));
        }
      },
    });
    await Deno.writeTextFile(
      join(pkg.root, ".adventure/agents/author.md"),
      "---\nname: Author\ntools: []\n---\nAuthor role.",
    );
    const author = await loadAgentDefinition("author", pkg.root);
    const guide = await loadAgentDefinition("guide", pkg.root);
    for (const name of names) {
      assert(author.tools.includes(name));
      assert(!guide.tools.includes(name));
      assert(!createSourceTools(pkg).some((tool) => tool.name === name));
    }
    const view = createAuthorFileTools(pkg, root).find((tool) => tool.name === "source_view_page")!;
    await assertRejects(
      () =>
        view.execute(
          "test",
          { sourceId: "missing", page: 1 },
          undefined,
          undefined,
          { model: { input: ["text"] } } as any,
        ),
      Error,
      "vision-capable model",
    );
  }));

// A tiny original, two-page vector PDF. No external copyrighted fixture or model request.
function samplePdf(): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R >>",
    "<< /Length 27 >>\nstream\n1 0 0 rg 0 0 100 100 re f\n\nendstream",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 6 0 R >>",
    "<< /Length 27 >>\nstream\n0 0 1 rg 0 0 100 100 re f\n\nendstream",
  ];
  let text = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(text.length);
    text += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = text.length;
  text += `xref\n0 7\n0000000000 65535 f \n${
    offsets.slice(1).map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")
  }trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(text);
}

let hasRenderer = false;
try {
  hasRenderer =
    (await new Deno.Command("pdftoppm", { args: ["-v"], stdout: "null", stderr: "null" }).output()).success;
} catch { /* Rendering is an optional local dependency; core tests still run. */ }

Deno.test({
  name: "original PDF pages render to distinct image tool results without changing sources",
  ignore: !hasRenderer,
  fn: () =>
    fixture(async (_root, pkg) => {
      const bytes = samplePdf();
      const sha256 = Buffer.from(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>))
        .toString("hex");
      const id = "source-pdf-test";
      const pdfPath = `sources/files/${id}.pdf`;
      await Deno.mkdir(join(pkg.root, "sources/files"), { recursive: true });
      await Deno.writeFile(join(pkg.root, pdfPath), bytes);
      pkg.sources.push({
        id,
        title: "Vector page test",
        sha256,
        originalFilename: "test.pdf",
        importedFrom: "test.pdf",
        pdfPath,
        extractedPath: `sources/extracted/${id}.md`,
        pageCount: 2,
        importedAt: new Date().toISOString(),
      });
      await saveSources(pkg);
      const loaded = await loadAdventurePackage(pkg.root); // Legacy PDF records need no migration.
      const first = await viewSourcePage(loaded, id, 1);
      const second = await viewSourcePage(loaded, id, 2);
      assertEquals(first.details.mimeType, "image/png");
      assertEquals(second.details.citation.page, 2);
      assert(first.content[1].type === "image" && second.content[1].type === "image");
      assert(first.content[1].data !== second.content[1].data);
      assertEquals(await Deno.readFile(join(pkg.root, pdfPath)), bytes);
    }),
});
