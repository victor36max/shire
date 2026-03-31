import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import * as settings from "./workspace-settings";
import * as workspace from "./workspace";

const PROJECT_ID = "ws-test-project";
let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `ws_settings_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  process.env.SHIRE_PROJECTS_DIR = testDir;
  await workspace.ensureProjectDirs(PROJECT_ID);
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("workspace settings", () => {
  describe("readProjectDoc", () => {
    it("returns content when PROJECT.md exists", async () => {
      writeFileSync(workspace.projectDocPath(PROJECT_ID), "# My Project\n");
      expect(await settings.readProjectDoc(PROJECT_ID)).toBe("# My Project\n");
    });

    it("returns empty string when PROJECT.md does not exist", async () => {
      expect(await settings.readProjectDoc(PROJECT_ID)).toBe("");
    });
  });

  describe("writeProjectDoc", () => {
    it("writes content to PROJECT.md", async () => {
      await settings.writeProjectDoc(PROJECT_ID, "# Updated");
      expect(readFileSync(workspace.projectDocPath(PROJECT_ID), "utf-8")).toBe("# Updated");
    });
  });

  describe("agent claude settings", () => {
    const AGENT_ID = "claude-settings-test";

    it("ensureAgentDirs creates .claude/settings.json with permissions", async () => {
      await workspace.ensureAgentDirs(PROJECT_ID, AGENT_ID);
      const content = JSON.parse(
        readFileSync(workspace.claudeSettingsPath(PROJECT_ID, AGENT_ID), "utf-8"),
      );
      expect(content.permissions.allow).toContain("Edit(.claude/**)");
      expect(content.permissions.allow).toContain("Write(.claude/**)");
    });

    it("ensureAgentDirsSync creates .claude/settings.json with permissions", () => {
      workspace.ensureAgentDirsSync(PROJECT_ID, AGENT_ID);
      const content = JSON.parse(
        readFileSync(workspace.claudeSettingsPath(PROJECT_ID, AGENT_ID), "utf-8"),
      );
      expect(content.permissions.allow).toContain("Edit(.claude/**)");
    });

    it("does not overwrite existing settings.json", async () => {
      await workspace.ensureAgentDirs(PROJECT_ID, AGENT_ID);
      const customSettings = JSON.stringify({
        permissions: { allow: ["Edit(.claude/**)", "Write(.claude/**)", "Bash(custom:*)"] },
      });
      writeFileSync(workspace.claudeSettingsPath(PROJECT_ID, AGENT_ID), customSettings);
      await workspace.ensureAgentDirs(PROJECT_ID, AGENT_ID);
      const content = readFileSync(workspace.claudeSettingsPath(PROJECT_ID, AGENT_ID), "utf-8");
      expect(content).toBe(customSettings);
    });

    it("does not overwrite existing settings.json (sync)", () => {
      workspace.ensureAgentDirsSync(PROJECT_ID, AGENT_ID);
      const customSettings = JSON.stringify({ permissions: { allow: ["custom"] } });
      writeFileSync(workspace.claudeSettingsPath(PROJECT_ID, AGENT_ID), customSettings);
      workspace.ensureAgentDirsSync(PROJECT_ID, AGENT_ID);
      const content = readFileSync(workspace.claudeSettingsPath(PROJECT_ID, AGENT_ID), "utf-8");
      expect(content).toBe(customSettings);
    });
  });
});
