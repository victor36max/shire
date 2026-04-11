import { describe, it, expect } from "bun:test";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import remarkSharedLinks from "../lib/remark-shared-links";

function process(markdown: string): string {
  return String(
    unified().use(remarkParse).use(remarkSharedLinks).use(remarkStringify).processSync(markdown),
  );
}

describe("remarkSharedLinks", () => {
  it("converts /shared/ paths to links", () => {
    const result = process("See /shared/docs/report.md for details.");
    expect(result).toContain("[/shared/docs/report.md](/shared/docs/report.md)");
  });

  it("strips trailing punctuation from paths", () => {
    const result = process("Check /shared/file.txt.");
    expect(result).toContain("[/shared/file.txt](/shared/file.txt)");
    expect(result).not.toContain("file.txt.");
  });

  it("handles paths with nested directories", () => {
    const result = process("Saved to /shared/a/b/c/file.json");
    expect(result).toContain("[/shared/a/b/c/file.json](/shared/a/b/c/file.json)");
  });

  it("does not match paths without /shared/ prefix", () => {
    const result = process("See /other/path/file.txt for details.");
    expect(result).not.toContain("[");
  });

  it("handles multiple paths in the same text", () => {
    const result = process("See /shared/a.md and /shared/b.md");
    expect(result).toContain("[/shared/a.md](/shared/a.md)");
    expect(result).toContain("[/shared/b.md](/shared/b.md)");
  });

  it("does not match inside inline code", () => {
    const result = process("Run `cat /shared/file.txt` to see it.");
    expect(result).toContain("`cat /shared/file.txt`");
    // The path inside inline code should NOT be a link
    expect(result).not.toContain("[/shared/file.txt]");
  });

  it("does not match inside fenced code blocks", () => {
    const result = process("```\n/shared/file.txt\n```");
    expect(result).not.toContain("[/shared/file.txt]");
  });
});
