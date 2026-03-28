import { describe, it, expect } from "bun:test";
import * as workspace from "./workspace";

const PROJECT_ID = "test-project-id";

describe("workspace paths", () => {
  it("root returns project directory", () => {
    const r = workspace.root(PROJECT_ID);
    expect(r).toContain(PROJECT_ID);
    expect(r.endsWith(PROJECT_ID)).toBe(true);
  });

  it("agentsDir is under root", () => {
    expect(workspace.agentsDir(PROJECT_ID)).toBe(workspace.root(PROJECT_ID) + "/agents");
  });

  it("agentDir includes agent id", () => {
    expect(workspace.agentDir(PROJECT_ID, "agent-123")).toBe(
      workspace.root(PROJECT_ID) + "/agents/agent-123",
    );
  });

  it("sharedDir returns shared directory", () => {
    expect(workspace.sharedDir(PROJECT_ID)).toBe(workspace.root(PROJECT_ID) + "/shared");
  });

  it("peersPath returns peers.yaml path", () => {
    expect(workspace.peersPath(PROJECT_ID)).toBe(workspace.root(PROJECT_ID) + "/peers.yaml");
  });

  it("projectDocPath returns PROJECT.md path", () => {
    expect(workspace.projectDocPath(PROJECT_ID)).toBe(workspace.root(PROJECT_ID) + "/PROJECT.md");
  });

  it("attachmentPath constructs full path", () => {
    const path = workspace.attachmentPath(PROJECT_ID, "agent-1", "att-1", "file.pdf");
    expect(path).toContain("agents/agent-1/attachments/att-1/file.pdf");
  });
});
