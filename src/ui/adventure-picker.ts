import {
  type Component,
  Input,
  Key,
  matchesKey,
  ProcessTerminal,
  SelectList,
  Text,
  TUI,
} from "@earendil-works/pi-tui";
import { type AdventureCatalog, discoverAdventures, newAdventureLocation } from "../adventure/catalog.ts";

export interface AdventureSelection {
  root: string;
  title: string;
  isNew: boolean;
}

const accent = (text: string) => `\x1b[36m${text}\x1b[39m`;
const muted = (text: string) => `\x1b[90m${text}\x1b[39m`;
const NEW = "__new_adventure__";

export class AdventurePicker implements Component {
  focused = false;
  private list: SelectList;
  private input = new Input();
  private naming = false;
  private busy = false;
  private error = "";
  private selectedRoot: string;

  constructor(
    private catalog: AdventureCatalog,
    private done: (selection: AdventureSelection | null) => void,
    private requestRender: () => void,
    initialTitle?: string,
  ) {
    this.selectedRoot = catalog.adventures[0]?.root ?? NEW;
    if (initialTitle) this.input.setValue(initialTitle);
    this.list = new SelectList(
      [
        ...catalog.adventures.map((adventure) => ({
          value: adventure.root,
          label: adventure.title,
          description:
            `${adventure.status} · ${adventure.sourceCount} source(s) · ${adventure.decisionCount}/7 setup choices`,
        })),
        {
          value: NEW,
          label: "+ Create new adventure",
          description: "Name a new adventure, then add PDFs in the Author",
        },
      ],
      8,
      {
        selectedPrefix: accent,
        selectedText: accent,
        description: muted,
        scrollInfo: muted,
        noMatch: muted,
      },
      { maxPrimaryColumnWidth: 32 },
    );
    this.list.onSelectionChange = (item) => {
      this.selectedRoot = item.value;
    };
    this.list.onCancel = () => this.done(null);
    this.list.onSelect = (item) => {
      if (item.value === NEW) {
        this.naming = true;
        this.error = "";
      } else {
        const adventure = this.catalog.adventures.find((entry) => entry.root === item.value)!;
        this.done({ root: adventure.root, title: adventure.title, isNew: false });
      }
    };
    this.input.onSubmit = (value) => {
      void this.submitName(value);
    };
  }

  private async submitName(title: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    try {
      const root = await newAdventureLocation(this.catalog.directory, title);
      this.done({ root, title: title.trim(), isNew: true });
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      this.requestRender();
    }
  }

  handleInput(data: string): void {
    if (this.busy) return;
    if (matchesKey(data, Key.ctrl("c")) || matchesKey(data, Key.ctrl("d"))) {
      this.done(null);
      return;
    }
    if (this.naming && matchesKey(data, Key.escape)) {
      this.naming = false;
      this.error = "";
    } else if (this.naming) this.input.handleInput(data);
    else this.list.handleInput(data);
    this.requestRender();
  }

  invalidate(): void {
    this.list.invalidate();
    this.input.invalidate();
  }

  render(width: number): string[] {
    const lines: string[] = [];
    const add = (text: string) => text ? lines.push(...new Text(text, 0, 0).render(width)) : lines.push("");
    add(accent("Adventure Runner · Adventure Author"));
    add("");
    if (this.naming) {
      add("What would you like to call your new adventure?");
      add(muted("For example: The Lantern House"));
      add(muted("This creates a separate package. You can add one or more PDFs after opening it."));
      add("");
      this.input.focused = this.focused;
      lines.push(...this.input.render(width));
      if (this.error) add(this.error);
      add("");
      add(muted(this.busy ? "Checking adventure name…" : "Enter create · Esc back · Ctrl+C quit"));
    } else {
      add("Welcome. Open an existing adventure or create a new one.");
      add(muted("Opening an adventure keeps its assets and continues its latest author conversation."));
      add("");
      if (!this.catalog.adventures.length) add("No adventures here yet. Create your first one below.");
      lines.push(...this.list.render(width));
      add("");
      add(
        muted(
          this.selectedRoot === NEW
            ? `New adventures are saved in: ${this.catalog.directory}`
            : `Package: ${this.selectedRoot}`,
        ),
      );
      if (this.catalog.warnings.length) {
        add(`Could not load ${this.catalog.warnings.length} package(s):`);
        for (const warning of this.catalog.warnings.slice(0, 3)) add(muted(warning));
      }
      add(muted("↑↓ choose · Enter open · Esc / Ctrl+C quit"));
    }
    return lines;
  }
}

export async function pickAdventure(cwd: string, initialTitle?: string): Promise<AdventureSelection | null> {
  if (!Deno.stdin.isTerminal() || !Deno.stdout.isTerminal()) {
    throw new Error(
      "The adventure menu needs an interactive terminal. Supply an adventure directory, PDF path, or --output directory instead.",
    );
  }
  const catalog = await discoverAdventures(cwd);
  const terminal = new ProcessTerminal();
  const ui = new TUI(terminal);
  return await new Promise((resolve, reject) => {
    let finished = false;
    const done = (selection: AdventureSelection | null) => {
      if (finished) return;
      finished = true;
      ui.stop();
      resolve(selection);
    };
    const picker = new AdventurePicker(catalog, done, () => {
      if (!finished) ui.requestRender();
    }, initialTitle);
    ui.addChild(picker);
    ui.setFocus(picker);
    try {
      ui.start();
      terminal.setTitle("Adventure Author — Choose an adventure");
    } catch (error) {
      ui.stop();
      reject(error);
    }
  });
}
