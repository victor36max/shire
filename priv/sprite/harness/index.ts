// priv/sprite/harness/index.ts
import type { Harness } from "./types";
import { PiHarness } from "./pi-harness";
import { ClaudeCodeHarness } from "./claude-code-harness";

export { type Harness, type HarnessConfig, type AgentEvent, type EventCallback } from "./types";

export function createHarness(type: string): Harness {
  switch (type) {
    case "pi":
      return new PiHarness();
    case "claude_code":
      return new ClaudeCodeHarness();
    default:
      throw new Error(`Unknown harness type: ${type}`);
  }
}
