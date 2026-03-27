import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, readFileSync, statSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import * as settings from "./workspace-settings";
import * as workspace from "./workspace";

const PROJECT_ID = "ws-test-project";
let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `ws_settings_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  process.env.SHIRE_PROJECTS_DIR = testDir;
  // Re-import workspace to pick up the new env var — workspace caches it at module load.
  // Since workspace reads SHIRE_PROJECTS_DIR at import time, we need to ensure
  // the ensureProjectDirs creates the right paths.
  workspace.ensureProjectDirs(PROJECT_ID);
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("workspace settings", () => {
  describe("readEnv", () => {
    it("returns content when .env exists", () => {
      writeFileSync(workspace.envPath(PROJECT_ID), "MY_VAR=hello\n");
      expect(settings.readEnv(PROJECT_ID)).toBe("MY_VAR=hello\n");
    });

    it("returns empty string when .env does not exist", () => {
      expect(settings.readEnv(PROJECT_ID)).toBe("");
    });
  });

  describe("writeEnv", () => {
    it("writes content to .env file", () => {
      settings.writeEnv(PROJECT_ID, "FOO=bar");
      expect(readFileSync(workspace.envPath(PROJECT_ID), "utf-8")).toBe("FOO=bar");
    });
  });

  describe("listScripts", () => {
    it("returns empty array when no scripts exist", () => {
      expect(settings.listScripts(PROJECT_ID)).toEqual([]);
    });

    it("returns .sh filenames", () => {
      writeFileSync(workspace.scriptPath(PROJECT_ID, "deploy.sh"), "#!/bin/bash");
      writeFileSync(workspace.scriptPath(PROJECT_ID, "setup.sh"), "#!/bin/bash");
      writeFileSync(workspace.scriptPath(PROJECT_ID, "readme.txt"), "not a script");

      const scripts = settings.listScripts(PROJECT_ID);
      expect(scripts).toContain("deploy.sh");
      expect(scripts).toContain("setup.sh");
      expect(scripts).not.toContain("readme.txt");
    });
  });

  describe("readAllScripts", () => {
    it("returns scripts with content", () => {
      writeFileSync(workspace.scriptPath(PROJECT_ID, "setup.sh"), "#!/bin/bash\necho hi");
      const result = settings.readAllScripts(PROJECT_ID);
      expect(result.length).toBe(1);
      expect(result[0].name).toBe("setup.sh");
      expect(result[0].content).toBe("#!/bin/bash\necho hi");
    });

    it("returns empty array when no scripts", () => {
      expect(settings.readAllScripts(PROJECT_ID)).toEqual([]);
    });
  });

  describe("writeScript", () => {
    it("writes script and makes it executable", () => {
      settings.writeScript(PROJECT_ID, "setup.sh", "#!/bin/bash");
      const path = workspace.scriptPath(PROJECT_ID, "setup.sh");
      expect(readFileSync(path, "utf-8")).toBe("#!/bin/bash");
      const mode = statSync(path).mode;
      expect(mode & 0o111).toBeGreaterThan(0);
    });
  });

  describe("deleteScript", () => {
    it("deletes the script file", () => {
      const path = workspace.scriptPath(PROJECT_ID, "setup.sh");
      writeFileSync(path, "#!/bin/bash");
      expect(existsSync(path)).toBe(true);
      settings.deleteScript(PROJECT_ID, "setup.sh");
      expect(existsSync(path)).toBe(false);
    });

    it("is idempotent", () => {
      expect(() => settings.deleteScript(PROJECT_ID, "nonexistent.sh")).not.toThrow();
    });
  });

  describe("readProjectDoc", () => {
    it("returns content when PROJECT.md exists", () => {
      writeFileSync(workspace.projectDocPath(PROJECT_ID), "# My Project\n");
      expect(settings.readProjectDoc(PROJECT_ID)).toBe("# My Project\n");
    });

    it("returns empty string when PROJECT.md does not exist", () => {
      expect(settings.readProjectDoc(PROJECT_ID)).toBe("");
    });
  });

  describe("writeProjectDoc", () => {
    it("writes content to PROJECT.md", () => {
      settings.writeProjectDoc(PROJECT_ID, "# Updated");
      expect(readFileSync(workspace.projectDocPath(PROJECT_ID), "utf-8")).toBe("# Updated");
    });
  });
});
