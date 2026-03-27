import { describe, it, expect } from "bun:test";
import yaml from "js-yaml";

// We test the pure functions from catalog-sync.
// Since catalog-sync.ts is a script with top-level main() call,
// we extract the testable functions here.

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const trimmed = content.trimStart();
  const parts = trimmed.split("---");
  if (parts.length >= 3 && parts[0] === "") {
    try {
      const frontmatter = yaml.load(parts[1]) as Record<string, unknown>;
      const body = parts.slice(2).join("---").trim();
      return { frontmatter: frontmatter ?? {}, body };
    } catch {
      return { frontmatter: {}, body: trimmed };
    }
  }
  return { frontmatter: {}, body: trimmed };
}

function buildAgentYaml(
  frontmatter: Record<string, unknown>,
  body: string,
  category: string,
): Record<string, unknown> {
  const displayName = String(frontmatter.name ?? "");
  return {
    name: slugify(displayName),
    display_name: displayName,
    description: String(frontmatter.description ?? ""),
    category,
    emoji: String(frontmatter.emoji ?? ""),
    tags: [],
    harness: "claude_code",
    model: "claude-sonnet-4-6",
    system_prompt: body,
  };
}

describe("parseFrontmatter", () => {
  it("extracts frontmatter and body from markdown", () => {
    const content =
      '---\nname: Test Agent\ndescription: A test agent\nemoji: "🤖"\n---\n\nYou are a test agent with special abilities.';
    const { frontmatter, body } = parseFrontmatter(content);
    expect(frontmatter.name).toBe("Test Agent");
    expect(frontmatter.description).toBe("A test agent");
    expect(frontmatter.emoji).toBe("🤖");
    expect(body).toContain("test agent with special abilities");
  });

  it("returns empty map and full content when no frontmatter", () => {
    const { frontmatter, body } = parseFrontmatter("Just some text");
    expect(frontmatter).toEqual({});
    expect(body).toBe("Just some text");
  });
});

describe("slugify", () => {
  it("converts name to slug", () => {
    expect(slugify("Frontend Developer")).toBe("frontend-developer");
    expect(slugify("UI/UX Designer")).toBe("ui-ux-designer");
    expect(slugify("Senior Dev (React)")).toBe("senior-dev-react");
  });

  it("handles already-slugified names", () => {
    expect(slugify("frontend-developer")).toBe("frontend-developer");
  });
});

describe("buildAgentYaml", () => {
  it("produces valid YAML map", () => {
    const frontmatter = {
      name: "Test Agent",
      description: "A test",
      emoji: "🤖",
    };
    const body = "You are a test agent.";
    const category = "engineering";

    const result = buildAgentYaml(frontmatter, body, category);
    expect(result.name).toBe("test-agent");
    expect(result.display_name).toBe("Test Agent");
    expect(result.description).toBe("A test");
    expect(result.emoji).toBe("🤖");
    expect(result.category).toBe("engineering");
    expect(result.system_prompt).toBe("You are a test agent.");
    expect(result.harness).toBe("claude_code");
    expect(result.model).toBe("claude-sonnet-4-6");
    expect(result.tags).toEqual([]);
  });
});
