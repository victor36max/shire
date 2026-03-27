import { describe, it, expect } from "bun:test";
import { valid, slugify } from "./slug";

describe("valid", () => {
  it("accepts simple lowercase name", () => {
    expect(valid("hello")).toBe(true);
  });

  it("accepts name with numbers", () => {
    expect(valid("agent1")).toBe(true);
  });

  it("accepts name with dashes", () => {
    expect(valid("my-agent")).toBe(true);
  });

  it("accepts single character", () => {
    expect(valid("a")).toBe(true);
  });

  it("accepts single digit", () => {
    expect(valid("1")).toBe(true);
  });

  it("accepts name with multiple dashes", () => {
    expect(valid("my-cool-agent")).toBe(true);
  });

  it("rejects uppercase letters", () => {
    expect(valid("MyAgent")).toBe(false);
  });

  it("rejects spaces", () => {
    expect(valid("my agent")).toBe(false);
  });

  it("rejects special characters", () => {
    expect(valid("my_agent")).toBe(false);
    expect(valid("my.agent")).toBe(false);
    expect(valid("my@agent")).toBe(false);
  });

  it("rejects leading dash", () => {
    expect(valid("-agent")).toBe(false);
  });

  it("rejects trailing dash", () => {
    expect(valid("agent-")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(valid("")).toBe(false);
  });

  it("rejects nil/undefined", () => {
    expect(valid(null)).toBe(false);
    expect(valid(undefined)).toBe(false);
  });

  it("rejects name longer than 63 characters", () => {
    expect(valid("a".repeat(64))).toBe(false);
  });

  it("accepts name with exactly 63 characters", () => {
    expect(valid("a".repeat(63))).toBe(true);
  });
});

describe("slugify", () => {
  it("lowercases the string", () => {
    expect(slugify("MyAgent")).toBe("myagent");
  });

  it("replaces spaces with dashes", () => {
    expect(slugify("my agent")).toBe("my-agent");
  });

  it("replaces underscores with dashes", () => {
    expect(slugify("my_agent")).toBe("my-agent");
  });

  it("replaces special characters with dashes", () => {
    expect(slugify("my@agent")).toBe("my-agent");
  });

  it("collapses consecutive dashes", () => {
    expect(slugify("my--agent")).toBe("my-agent");
  });

  it("strips leading and trailing dashes", () => {
    expect(slugify("-my-agent-")).toBe("my-agent");
  });

  it("handles complex case", () => {
    expect(slugify("  My Cool Agent! ")).toBe("my-cool-agent");
  });

  it("result is a valid slug", () => {
    expect(valid(slugify("Hello World 123"))).toBe(true);
  });
});
