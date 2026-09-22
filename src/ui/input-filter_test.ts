import { assertEquals } from "@std/assert";
import { installTerminalMouseInputGuard } from "./input-filter.ts";

Deno.test("terminal mouse reports do not reach focused input", () => {
  let listener: ((input: string) => { consume?: boolean } | undefined) | undefined;
  let removed = false;
  const remove = installTerminalMouseInputGuard({
    addInputListener: (inputListener) => {
      listener = inputListener;
      return () => {
        removed = true;
      };
    },
  });

  assertEquals(listener!("\x1b[<65;122;29M"), { consume: true });
  assertEquals(listener!("\x1b[<64;98;34m"), { consume: true });
  assertEquals(listener!("look around"), undefined);
  assertEquals(listener!("\x03"), undefined);
  remove();
  assertEquals(removed, true);
});
