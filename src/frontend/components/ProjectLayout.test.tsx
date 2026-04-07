// Primary test coverage is in src/frontend/test/ProjectDashboard.test.tsx
// This file verifies the key-prop fix for AgentForm remounting.

import { describe, it, expect } from "bun:test";
import * as fs from "fs";
import * as path from "path";

describe("ProjectLayout: AgentForm key prop", () => {
  it("passes key={currentAgent?.id} to AgentForm to reset state on agent change", () => {
    const source = fs.readFileSync(path.join(import.meta.dir, "ProjectLayout.tsx"), "utf-8");
    // Verify the key prop is set on AgentForm
    expect(source).toContain('key={currentAgent?.id ?? "new"}');
  });
});
