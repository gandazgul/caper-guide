import { assert, assertEquals } from "@std/assert";
import { initTheme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { type Component, Container, Spacer, Text, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { EXPANDED_TOOL_LINE_LIMIT, type ToolDisplayState, ToolGroupDisplay } from "./tool-groups.ts";

Deno.test("tool parameters are hidden by default and available only in expanded troubleshooting view", () => {
  const display = new ToolGroupDisplay();
  const args = { section: "entities", id: "creature_secret_guardian" };
  for (const expanded of [false, true]) {
    for (const isPartial of [false, true]) {
      for (const isError of [false, true]) {
        const state: ToolDisplayState = {
          toolName: "adventure_read",
          toolCallId: "spoiler",
          args,
          expanded,
          isPartial,
          result: isPartial ? undefined : { isError, content: [{ type: "text", text: "Result body" }] },
        };
        const rendered = display.renderTool(state, 200).join("\n");
        assert(rendered.includes("adventure_read"));
        assertEquals(rendered.includes("creature_secret_guardian"), expanded);
        assertEquals(rendered.includes("entities"), expanded);
        state.expanded = false;
        assert(!display.renderTool(state, 200).join("\n").includes("creature_secret_guardian"));
        assertEquals(state.args, args);
      }
    }
  }
});

Deno.test("collapsed tools are one bounded row; expansion retains head and tail within 500 lines", () => {
  const display = new ToolGroupDisplay();
  const state: ToolDisplayState = {
    toolName: "source_read",
    toolCallId: "one",
    args: { sourceId: "example" },
    expanded: false,
    isPartial: false,
    result: {
      isError: false,
      content: [{ type: "text", text: Array.from({ length: 1000 }, (_, i) => `Line ${i}`).join("\n") }],
    },
  };
  assertEquals(display.renderTool(state, 80).length, 1);
  state.expanded = true;
  const expanded = display.renderTool(state, 80);
  assertEquals(expanded.length, EXPANDED_TOOL_LINE_LIMIT);
  assert(expanded.some((line) => line.includes("Line 0")));
  assert(expanded.some((line) => line.includes("Line 999")));
  assert(expanded.some((line) => line.includes("omitted")));
  for (const width of [1, 2, 10, 80]) {
    assert(display.renderTool(state, width).every((line) => visibleWidth(line) <= width));
  }
  assertEquals(state.result!.content[0].text!.split("\n").length, 1000);
  state.expanded = false;
  assertEquals(display.renderTool(state, 80).length, 1);
});

Deno.test("long chat transcripts render only recent output", () => {
  const display = new ToolGroupDisplay();
  const container = new Container();
  let renders = 0;
  const message = (index: number): Component => ({
    render: () => {
      renders++;
      return [`entry:${index}`];
    },
    invalidate() {},
  });
  for (let index = 0; index <= 120; index++) container.addChild(message(index));

  display.install({ chatContainer: container });
  const rendered = container.render(80);

  assert(rendered.some((line) => line.includes("older chat output hidden")));
  assert(!rendered.some((line) => line.includes("entry:0")));
  assert(rendered.some((line) => line.includes("entry:120")));
  assertEquals(renders, 120);
});

Deno.test("chat views bound large current output", () => {
  const display = new ToolGroupDisplay();
  const container = new Container();
  const lines = Array.from({ length: 2_001 }, (_, index) => `entry:${index}`);
  container.addChild({ render: () => lines, invalidate() {} });

  display.install({ chatContainer: container });
  const rendered = container.render(80);

  assertEquals(rendered.length, 2_000);
  assert(rendered.some((line) => line.includes("older chat output hidden")));
  assert(rendered.some((line) => line.includes("entry:2000")));
});

Deno.test("real TUI tool components group together and preserve expansion, narration, and original results", async () => {
  initTheme("dark", false);
  const display = new ToolGroupDisplay();
  const result = { content: [{ type: "text" as const, text: "Saved details" }], details: { saved: true } };
  const [definition] = display.decorate([{
    name: "character_read",
    label: "Read character",
    description: "Test",
    parameters: Type.Object({}),
    execute: () => Promise.resolve(result),
  }]);
  const make = (id: string) =>
    new ToolExecutionComponent(
      "character_read",
      id,
      {},
      { showImages: false },
      definition,
      { requestRender() {} } as unknown as TUI,
      Deno.cwd(),
    );
  const first = make("one");
  const second = make("two");
  assertEquals(await definition.execute("one", {}, undefined, undefined, {} as any), result);
  first.updateResult({ ...result, isError: false });
  second.updateResult({ ...result, isError: false });
  const container = new Container();
  container.addChild(first);
  container.addChild(new Spacer(1));
  container.addChild(second);
  display.install({ chatContainer: container });
  const collapsed = container.render(100);
  assertEquals(collapsed.length, 5); // one group: gap, padding, two rows, padding
  assert(collapsed.some((line) => line.includes("Took ")));
  first.setExpanded(true);
  second.setExpanded(true);
  assertEquals(container.render(100).length, 7);
  first.setExpanded(false);
  second.setExpanded(false);
  assertEquals(container.render(100).length, 5);
  container.addChild(new Text("What would you like to do?", 0, 0));
  container.addChild(make("three"));
  assertEquals(container.render(100).filter((line) => line.includes("character_read")).length, 3);
  assert(container.render(100).some((line) => line.includes("What would you like")));
});
