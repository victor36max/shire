import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, mock } from "bun:test";
import AgentForm from "../components/AgentForm";
import type { Agent } from "../components/types";

const onSave = mock(() => {});

function renderForm(agent: Agent | null = null) {
  return render(
    <AgentForm
      open={true}
      title="New Agent"
      agent={agent}
      onSave={onSave}
      onClose={mock(() => {})}
    />,
  );
}

describe("AgentForm", () => {
  it("shows validation error for invalid agent name", async () => {
    const user = userEvent.setup();
    renderForm();

    const nameInput = screen.getByLabelText("Name");
    await user.clear(nameInput);
    await user.paste("Invalid Name!");

    expect(
      screen.getByText(
        "Use lowercase letters, numbers, and hyphens only. Must start and end with a letter or number.",
      ),
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
    const localOnSave = mock(() => {});
    render(
      <AgentForm
        open={true}
        title="New Agent"
        agent={null}
        onSave={localOnSave}
        onClose={mock(() => {})}
      />,
    );

    const user = userEvent.setup();
    const nameInput = screen.getByLabelText("Name");
    await user.clear(nameInput);
    await user.paste("-invalid");
    await user.click(screen.getByText("Save Agent"));

    expect(localOnSave).not.toHaveBeenCalled();
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

  it("submits create-agent with structured fields when agent has empty id (catalog prefill)", async () => {
    const localOnSave = mock(() => {});
    const catalogAgent: Agent = {
      id: "",
      name: "frontend-developer",
      description: "React specialist",
      status: "idle",
      busy: false,
      unreadCount: 0,
      harness: "claude_code",
      model: "claude-sonnet-4-6",
      systemPrompt: "You are a frontend developer.",
    };

    render(
      <AgentForm
        open={true}
        title="New Agent from Catalog"
        agent={catalogAgent}
        onSave={localOnSave}
        onClose={mock(() => {})}
      />,
    );

    await userEvent.click(screen.getByText("Save Agent"));

    expect(localOnSave).toHaveBeenCalledWith(
      "create-agent",
      expect.objectContaining({
        name: "frontend-developer",
        harness: "claude_code",
        model: "claude-sonnet-4-6",
      }),
    );
    // Should NOT have id in payload
    const payload = (localOnSave.mock.calls[0] as unknown[])[1];
    expect(payload).not.toHaveProperty("id");
  });

  it("submits update-agent event with structured fields for existing agent", async () => {
    const agent: Agent = {
      id: "a-existing",
      name: "existing-agent",
      status: "active",
      busy: false,
      unreadCount: 0,
      harness: "claude_code",
      model: "claude-sonnet-4-6",
    };

    render(
      <AgentForm
        open={true}
        title="Edit Agent"
        agent={agent}
        onSave={onSave}
        onClose={mock(() => {})}
      />,
    );

    await userEvent.click(screen.getByText("Save Agent"));

    expect(onSave).toHaveBeenCalledWith(
      "update-agent",
      expect.objectContaining({
        id: "a-existing",
        name: "existing-agent",
        harness: "claude_code",
      }),
    );
  });
});
