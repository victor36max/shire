// priv/sprite/harness/index.ts
import type { Harness } from "./types";
import { PiHarness } from "./pi-harness";
import { ClaudeCodeHarness } from "./claude-code-harness";
import { OpenCodeHarness } from "./opencode-harness";
import { CodexHarness } from "./codex-harness";

export type HarnessType = "pi" | "claude_code" | "opencode" | "codex";

export { type Harness, type HarnessConfig, type AgentEvent, type EventCallback } from "./types";

export function createHarness(type: HarnessType): Harness {
  switch (type) {
    case "pi":
      return new PiHarness();
    case "claude_code":
      return new ClaudeCodeHarness();
    case "opencode":
      return new OpenCodeHarness();
    case "codex":
      return new CodexHarness();
    default:
      throw new Error(`Unknown harness type: ${type}`);
  }
}
