import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import AgentForm from "../react-components/AgentForm";
import type { Agent } from "../react-components/types";

const pushEvent = vi.fn();

function renderForm(agent: Agent | null = null) {
  return render(<AgentForm open={true} title="New Agent" agent={agent} pushEvent={pushEvent} onClose={vi.fn()} />);
}

describe("AgentForm", () => {
  it("renders skills section with empty state", () => {
    renderForm();
    expect(
      screen.getByText("No skills defined. Add skills to give the agent specialized knowledge."),
    ).toBeInTheDocument();
    expect(screen.getByText("Add Skill")).toBeInTheDocument();
  });

  it("adds a skill when clicking Add Skill", async () => {
    renderForm();
    await userEvent.click(screen.getByText("Add Skill"));
    expect(screen.getByPlaceholderText("e.g. web-scraping")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("When to use this skill...")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Markdown instructions...")).toBeInTheDocument();
  });

  it("removes a skill when clicking Remove", async () => {
    renderForm();
    await userEvent.click(screen.getByText("Add Skill"));
    expect(screen.getByPlaceholderText("e.g. web-scraping")).toBeInTheDocument();

    const removeButtons = screen.getAllByText("Remove");
    await userEvent.click(removeButtons[0]);
    expect(screen.queryByPlaceholderText("e.g. web-scraping")).not.toBeInTheDocument();
  });

  it("includes skills in recipe_yaml payload", async () => {
    const user = userEvent.setup();
    renderForm();

    // Fill required name field
    const nameInput = screen.getByLabelText("Name");
    await user.clear(nameInput);
    await user.paste("test-agent");

    // Add and fill a skill
    await user.click(screen.getByText("Add Skill"));

    const skillName = screen.getByPlaceholderText("e.g. web-scraping");
    await user.clear(skillName);
    await user.paste("my-skill");

    const skillDesc = screen.getByPlaceholderText("When to use this skill...");
    await user.clear(skillDesc);
    await user.paste("Use for testing");

    const skillContent = screen.getByPlaceholderText("Markdown instructions...");
    await user.clear(skillContent);
    await user.paste("# Test Skill");

    await user.click(screen.getByText("Save Agent"));

    expect(pushEvent).toHaveBeenCalledWith("create-agent", expect.objectContaining({ name: "test-agent" }));

    const payload = pushEvent.mock.calls[pushEvent.mock.calls.length - 1][1];
    expect(payload.recipe_yaml).toBeDefined();
    expect(payload.recipe_yaml).toContain("my-skill");
    expect(payload.recipe_yaml).toContain("Use for testing");
    expect(payload.recipe_yaml).toContain("# Test Skill");
  });

  it("loads skills from existing agent", () => {
    const agent: Agent = {
      id: "a-test",
      name: "test",
      status: "created",
      harness: "claude_code",
      skills: [{ name: "existing-skill", description: "An existing skill", content: "Some instructions" }],
    };

    renderForm(agent);
    expect(screen.getByDisplayValue("existing-skill")).toBeInTheDocument();
    expect(screen.getByDisplayValue("An existing skill")).toBeInTheDocument();
  });

  it("adds a reference to a skill", async () => {
    renderForm();
    await userEvent.click(screen.getByText("Add Skill"));
    await userEvent.click(screen.getByText("Add Reference"));
    expect(screen.getByPlaceholderText("e.g. api-patterns.md")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Reference content...")).toBeInTheDocument();
  });

  it("shows validation error for invalid agent name", async () => {
    const user = userEvent.setup();
    renderForm();

    const nameInput = screen.getByLabelText("Name");
    await user.clear(nameInput);
    await user.paste("Invalid Name!");

    expect(
      screen.getByText("Use lowercase letters, numbers, and hyphens only. Must start and end with a letter or number."),
    ).toBeInTheDocument();
  });

  it("auto-lowercases the name input", async () => {
    const user = userEvent.setup();
    renderForm();

    const nameInput = screen.getByLabelText("Name");
    await user.clear(nameInput);
    await user.type(nameInput, "MyAgent");

    expect(nameInput).toHaveValue("myagent");
  });

  it("does not submit when name is invalid", async () => {
    const localPushEvent = vi.fn();
    render(<AgentForm open={true} title="New Agent" agent={null} pushEvent={localPushEvent} onClose={vi.fn()} />);

    const user = userEvent.setup();
    const nameInput = screen.getByLabelText("Name");
    await user.clear(nameInput);
    await user.paste("-invalid");
    await user.click(screen.getByText("Save Agent"));

    expect(localPushEvent).not.toHaveBeenCalled();
  });

  it("accepts valid slug names", async () => {
    const user = userEvent.setup();
    renderForm();

    const nameInput = screen.getByLabelText("Name");
    await user.clear(nameInput);
    await user.paste("my-valid-agent");

    expect(
      screen.queryByText(
        "Use lowercase letters, numbers, and hyphens only. Must start and end with a letter or number.",
      ),
    ).not.toBeInTheDocument();
  });

  it("submits update-agent event with recipe_yaml for existing agent", async () => {
    const agent: Agent = {
      id: "a-existing",
      name: "existing-agent",
      status: "active",
      harness: "claude_code",
      model: "claude-sonnet-4-6",
    };

    render(<AgentForm open={true} title="Edit Agent" agent={agent} pushEvent={pushEvent} onClose={vi.fn()} />);

    await userEvent.click(screen.getByText("Save Agent"));

    expect(pushEvent).toHaveBeenCalledWith(
      "update-agent",
      expect.objectContaining({
        id: "a-existing",
        recipe_yaml: expect.any(String),
      }),
    );
  });
});
