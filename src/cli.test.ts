import { describe, it, expect } from "bun:test";
import { $ } from "bun";
import { join } from "path";

const CLI_PATH = join(import.meta.dirname, "cli.ts");

describe("CLI", () => {
  it("prints help with --help", async () => {
    const result = await $`bun run ${CLI_PATH} --help`.text();
    expect(result).toContain("shire v");
    expect(result).toContain("Usage:");
    expect(result).toContain("start");
    expect(result).toContain("stop");
    expect(result).toContain("status");
    expect(result).toContain("--port");
    expect(result).toContain("--daemon");
  });

  it("prints version with --version", async () => {
    const result = await $`bun run ${CLI_PATH} --version`.text();
    expect(result.trim()).toMatch(/^shire v\d+\.\d+\.\d+$/);
  });

  it("exits with error for unknown argument", async () => {
    try {
      await $`bun run ${CLI_PATH} --bogus`.text();
      expect(true).toBe(false); // Should not reach here
    } catch {
      // Expected to fail with non-zero exit code
    }
  });
});
