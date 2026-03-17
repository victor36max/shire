import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import AgentForm from "../react-components/AgentForm";
import type { Agent } from "../react-components/types";

const pushEvent = vi.fn();

function renderForm(agent: Agent | null = null) {
  return render(
    <AgentForm open={true} title="New Agent" agent={agent} pushEvent={pushEvent} onClose={vi.fn()} />,
  );
}

describe("AgentForm skills", () => {
  it("renders skills section with empty state", () => {
    renderForm();
    expect(screen.getByText("No skills defined. Add skills to give the agent specialized knowledge.")).toBeInTheDocument();
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

    // The Remove buttons — find the one in the skill card (not script card)
    const removeButtons = screen.getAllByText("Remove");
    await userEvent.click(removeButtons[0]);
    expect(screen.queryByPlaceholderText("e.g. web-scraping")).not.toBeInTheDocument();
  });

  it("includes skills in the submitted recipe YAML", async () => {
    renderForm();

    // Fill required name field
    await userEvent.type(screen.getByLabelText("Name"), "test-agent");

    // Add and fill a skill
    await userEvent.click(screen.getByText("Add Skill"));
    await userEvent.type(screen.getByPlaceholderText("e.g. web-scraping"), "my-skill");
    await userEvent.type(screen.getByPlaceholderText("When to use this skill..."), "Use for testing");
    await userEvent.type(screen.getByPlaceholderText("Markdown instructions..."), "# Test Skill");

    await userEvent.click(screen.getByText("Save Agent"));

    expect(pushEvent).toHaveBeenCalledWith(
      "create-agent",
      expect.objectContaining({
        recipe: expect.stringContaining("my-skill"),
      }),
    );

    const recipe = pushEvent.mock.calls[0][1].recipe as string;
    expect(recipe).toContain("skills:");
    expect(recipe).toContain("my-skill");
    expect(recipe).toContain("Use for testing");
    expect(recipe).toContain("# Test Skill");
  });

  it("loads skills from existing agent recipe", () => {
    const agent: Agent = {
      id: 1,
      name: "test",
      status: "created",
      model: null,
      system_prompt: null,
      harness: "pi",
      is_base: false,
      recipe: `version: 1
name: test
skills:
  - name: existing-skill
    description: An existing skill
    content: Some instructions`,
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
});
