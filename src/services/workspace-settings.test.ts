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
});
