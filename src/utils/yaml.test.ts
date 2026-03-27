import { describe, expect, test } from "bun:test";
import { sanitizeYaml, safeYamlLoad } from "./yaml";

describe("sanitizeYaml", () => {
  test("strips C0 control characters except tab, newline, carriage return", () => {
    const input = "hello\x00\x04\x07\x08\x0B\x0C\x0E\x1Fworld";
    expect(sanitizeYaml(input)).toBe("helloworld");
  });

  test("strips DEL character", () => {
    expect(sanitizeYaml("a\x7Fb")).toBe("ab");
  });

  test("preserves tab, newline, carriage return", () => {
    const input = "line1\n\tindented\r\nline2";
    expect(sanitizeYaml(input)).toBe(input);
  });

  test("preserves valid UTF-8 including emoji and accented chars", () => {
    const input = "name: 📱 café résumé";
    expect(sanitizeYaml(input)).toBe(input);
  });

  test("strips C1 control characters (x80-x9F, except NEL x85)", () => {
    expect(sanitizeYaml("a\x80b")).toBe("ab");
    expect(sanitizeYaml("a\x84b")).toBe("ab");
    expect(sanitizeYaml("a\x86b")).toBe("ab");
    expect(sanitizeYaml("a\x9Fb")).toBe("ab");
    expect(sanitizeYaml("a\x85b")).toBe("a\x85b");
  });

  test("strips Unicode non-characters uFFFE and uFFFF", () => {
    expect(sanitizeYaml("a\uFFFEb")).toBe("ab");
    expect(sanitizeYaml("a\uFFFFb")).toBe("ab");
  });

  test("returns empty string for empty input", () => {
    expect(sanitizeYaml("")).toBe("");
  });
});

describe("safeYamlLoad", () => {
  test("parses valid YAML", () => {
    const result = safeYamlLoad<{ name: string }>("name: test");
    expect(result).toEqual({ name: "test" });
  });

  test("parses YAML containing non-printable characters without throwing", () => {
    const yaml = "name: test\ndescription: |\n  ## =\x04 Workflow\n  Some content";
    const result = safeYamlLoad<{ name: string; description: string }>(yaml);
    expect(result.name).toBe("test");
    expect(result.description).toContain("## = Workflow");
  });

  test("handles multiline block scalars with embedded control chars", () => {
    const yaml = [
      "system_prompt: |",
      "  Hello\x00 world",
      "  ## =\x04 Section",
      "  Normal text",
    ].join("\n");
    const result = safeYamlLoad<{ system_prompt: string }>(yaml);
    expect(result.system_prompt).toContain("Hello world");
    expect(result.system_prompt).toContain("## = Section");
  });
});
