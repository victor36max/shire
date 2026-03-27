import { describe, it, expect } from "vitest";

// Terminal tests are skipped — terminal feature was scrapped in the TS migration.
// The xterm dependency is no longer included.

describe("Terminal (skipped)", () => {
  it("terminal feature removed in migration", () => {
    expect(true).toBe(true);
  });
});
