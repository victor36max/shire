import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import * as skills from "./skills";
import * as workspace from "./workspace";

const tmpBase = join(tmpdir(), `shire-skills-test-${Date.now()}`);
const PROJECT_ID = "test-project";
const AGENT_ID = "test-agent";

beforeEach(() => {
  rmSync(tmpBase, { recursive: true, force: true });
  process.env.SHIRE_PROJECTS_DIR = tmpBase;
});

afterAll(() => {
  rmSync(tmpBase, { recursive: true, force: true });
  delete process.env.SHIRE_PROJECTS_DIR;
});

describe("parseSkillMd / composeSkillMd", () => {
  it("round-trips a skill", () => {
    const skill: skills.Skill = {
      name: "my-skill",
      description: "A test skill",
      content: "# Instructions\n\nDo the thing.",
    };
    const md = skills.composeSkillMd(skill);
    const parsed = skills.parseSkillMd(md);
    expect(parsed.name).toBe("my-skill");
    expect(parsed.description).toBe("A test skill");
    expect(parsed.content).toBe("# Instructions\n\nDo the thing.");
  });

  it("handles missing frontmatter", () => {
    const parsed = skills.parseSkillMd("Just some content");
    expect(parsed.name).toBe("");
    expect(parsed.description).toBe("");
    expect(parsed.content).toBe("Just some content");
  });

  it("round-trips a skill with YAML-special characters in description", () => {
    const skill: skills.Skill = {
      name: "tricky-skill",
      description: "Use for: APIs, testing & more",
      content: "Some content",
    };
    const md = skills.composeSkillMd(skill);
    const parsed = skills.parseSkillMd(md);
    expect(parsed.description).toBe("Use for: APIs, testing & more");
  });

  it("handles empty content", () => {
    const md = "---\nname: empty\ndescription: nothing\n---\n";
    const parsed = skills.parseSkillMd(md);
    expect(parsed.name).toBe("empty");
    expect(parsed.content).toBe("");
  });
});

describe("readSkills / writeSkills", () => {
  it("returns empty array when skills dir does not exist", async () => {
    const result = await skills.readSkills(PROJECT_ID, AGENT_ID);
    expect(result).toEqual([]);
  });

  it("writes and reads skills", async () => {
    const input: skills.Skill[] = [
      {
        name: "web-scraping",
        description: "Scrape websites",
        content: "# Web Scraping\n\nUse fetch.",
      },
      { name: "data-analysis", description: "Analyze data", content: "# Data Analysis" },
    ];

    await skills.writeSkills(PROJECT_ID, AGENT_ID, input);
    const result = await skills.readSkills(PROJECT_ID, AGENT_ID);

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("data-analysis");
    expect(result[1].name).toBe("web-scraping");
    expect(result[1].content).toBe("# Web Scraping\n\nUse fetch.");
  });

  it("writes and reads skills with references", async () => {
    const input: skills.Skill[] = [
      {
        name: "api-skill",
        description: "Use APIs",
        content: "# API Skill",
        references: [
          { name: "patterns.md", content: "# Patterns\n\nUse REST." },
          { name: "examples.json", content: '{"key": "value"}' },
        ],
      },
    ];

    await skills.writeSkills(PROJECT_ID, AGENT_ID, input);
    const result = await skills.readSkills(PROJECT_ID, AGENT_ID);

    expect(result).toHaveLength(1);
    expect(result[0].references).toHaveLength(2);
    const refNames = result[0].references!.map((r) => r.name).sort();
    expect(refNames).toEqual(["examples.json", "patterns.md"]);
    expect(result[0].references!.find((r) => r.name === "patterns.md")!.content).toBe(
      "# Patterns\n\nUse REST.",
    );
  });

  it("reconciles: removes deleted skills and stale references", async () => {
    // Write initial set
    await skills.writeSkills(PROJECT_ID, AGENT_ID, [
      {
        name: "keep-me",
        description: "Kept",
        content: "kept",
        references: [{ name: "old-ref.md", content: "old" }],
      },
      { name: "remove-me", description: "Removed", content: "removed" },
    ]);

    // Write updated set (remove-me gone, old-ref.md replaced)
    await skills.writeSkills(PROJECT_ID, AGENT_ID, [
      {
        name: "keep-me",
        description: "Kept",
        content: "kept",
        references: [{ name: "new-ref.md", content: "new" }],
      },
    ]);

    const result = await skills.readSkills(PROJECT_ID, AGENT_ID);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("keep-me");
    expect(result[0].references).toHaveLength(1);
    expect(result[0].references![0].name).toBe("new-ref.md");

    // Verify remove-me dir is gone
    const dir = workspace.skillDir(PROJECT_ID, AGENT_ID, "remove-me");
    expect(existsSync(dir)).toBe(false);
  });

  it("deletes a single skill", async () => {
    await skills.writeSkills(PROJECT_ID, AGENT_ID, [
      { name: "to-delete", description: "test", content: "test" },
    ]);

    await skills.deleteSkill(PROJECT_ID, AGENT_ID, "to-delete");
    const result = await skills.readSkills(PROJECT_ID, AGENT_ID);
    expect(result).toHaveLength(0);
  });
});

describe("path traversal protection", () => {
  it("rejects skill name with path traversal", async () => {
    await expect(
      skills.writeSkill(PROJECT_ID, AGENT_ID, {
        name: "../evil",
        description: "bad",
        content: "bad",
      }),
    ).rejects.toThrow("Invalid skill name");
  });

  it("rejects skill name with slashes", async () => {
    await expect(
      skills.writeSkill(PROJECT_ID, AGENT_ID, {
        name: "foo/bar",
        description: "bad",
        content: "bad",
      }),
    ).rejects.toThrow("Invalid skill name");
  });

  it("rejects empty skill name", async () => {
    await expect(
      skills.writeSkill(PROJECT_ID, AGENT_ID, { name: "", description: "bad", content: "bad" }),
    ).rejects.toThrow("Invalid skill name");
  });

  it("rejects reference name with path traversal", async () => {
    await expect(
      skills.writeSkill(PROJECT_ID, AGENT_ID, {
        name: "valid-skill",
        description: "test",
        content: "test",
        references: [{ name: "../../.env", content: "SECRET=bad" }],
      }),
    ).rejects.toThrow("Invalid reference name");
  });

  it("rejects reference named SKILL.md", async () => {
    await expect(
      skills.writeSkill(PROJECT_ID, AGENT_ID, {
        name: "valid-skill",
        description: "test",
        content: "test",
        references: [{ name: "SKILL.md", content: "overwrite" }],
      }),
    ).rejects.toThrow("Invalid reference name");
  });
});

describe("harness-specific paths", () => {
  it("writes skills to .claude/skills for claude_code", async () => {
    await skills.writeSkills(
      PROJECT_ID,
      AGENT_ID,
      [{ name: "test-skill", description: "test", content: "test" }],
      "claude_code",
    );

    const skillMd = join(
      workspace.agentDir(PROJECT_ID, AGENT_ID),
      ".claude",
      "skills",
      "test-skill",
      "SKILL.md",
    );
    expect(existsSync(skillMd)).toBe(true);
  });

  it("writes skills to .agents/skills for pi", async () => {
    await skills.writeSkills(
      PROJECT_ID,
      AGENT_ID,
      [{ name: "test-skill", description: "test", content: "test" }],
      "pi",
    );

    const skillMd = join(
      workspace.agentDir(PROJECT_ID, AGENT_ID),
      ".agents",
      "skills",
      "test-skill",
      "SKILL.md",
    );
    expect(existsSync(skillMd)).toBe(true);
  });

  it("defaults to .agents/skills when no harness specified", async () => {
    await skills.writeSkills(PROJECT_ID, AGENT_ID, [
      { name: "test-skill", description: "test", content: "test" },
    ]);

    const skillMd = join(
      workspace.agentDir(PROJECT_ID, AGENT_ID),
      ".agents",
      "skills",
      "test-skill",
      "SKILL.md",
    );
    expect(existsSync(skillMd)).toBe(true);
  });
});

describe("copySkillsSync / removeSkillsDirSync", () => {
  it("copies skills from one harness path to another", async () => {
    await skills.writeSkills(
      PROJECT_ID,
      AGENT_ID,
      [
        {
          name: "my-skill",
          description: "test",
          content: "hello",
          references: [{ name: "ref.md", content: "ref content" }],
        },
      ],
      "claude_code",
    );

    skills.copySkillsSync(PROJECT_ID, AGENT_ID, "claude_code", "pi");

    const piSkillMd = join(
      workspace.agentDir(PROJECT_ID, AGENT_ID),
      ".agents",
      "skills",
      "my-skill",
      "SKILL.md",
    );
    expect(existsSync(piSkillMd)).toBe(true);
    expect(readFileSync(piSkillMd, "utf-8")).toContain("hello");

    // Reference file also copied
    const piRef = join(
      workspace.agentDir(PROJECT_ID, AGENT_ID),
      ".agents",
      "skills",
      "my-skill",
      "ref.md",
    );
    expect(existsSync(piRef)).toBe(true);
  });

  it("removes skills dir", async () => {
    await skills.writeSkills(
      PROJECT_ID,
      AGENT_ID,
      [{ name: "temp-skill", description: "test", content: "test" }],
      "claude_code",
    );

    const dir = workspace.skillsDir(PROJECT_ID, AGENT_ID, "claude_code");
    expect(existsSync(dir)).toBe(true);

    skills.removeSkillsDirSync(PROJECT_ID, AGENT_ID, "claude_code");
    expect(existsSync(dir)).toBe(false);
  });

  it("no-ops when source does not exist", () => {
    // Should not throw
    skills.copySkillsSync(PROJECT_ID, AGENT_ID, "claude_code", "pi");
  });
});
