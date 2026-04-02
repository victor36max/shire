import { describe, it, expect } from "bun:test";
import { createHarness } from "./index";

describe("createHarness", () => {
  it("creates a PiHarness for 'pi'", () => {
    const h = createHarness("pi");
    expect(h).toBeDefined();
  });

  it("creates a ClaudeCodeHarness for 'claude_code'", () => {
    const h = createHarness("claude_code");
    expect(h).toBeDefined();
  });

  it("creates an OpenCodeHarness for 'opencode'", () => {
    const h = createHarness("opencode");
    expect(h).toBeDefined();
  });

  it("throws for unknown harness type", () => {
    expect(() => createHarness("unknown" as never)).toThrow("Unknown harness type");
  });
});
