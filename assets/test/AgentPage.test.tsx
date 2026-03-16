import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import AgentPage from "../react-components/AgentPage";
import { type Agent } from "../react-components/types";

const agents: Agent[] = [
  {
    id: 1,
    name: "Agent One",
    status: "active",
    model: "claude-sonnet-4-6",
    system_prompt: null,
    harness: "pi",
    recipe: "version: 1\nname: Agent One\nharness: pi\nmodel: claude-sonnet-4-6",
    is_base: false,
  },
  {
    id: 2,
    name: "Agent Two",
    status: "created",
    model: null,
    system_prompt: "Be helpful",
    harness: "claude_code",
    recipe: "version: 1\nname: Agent Two\nharness: claude_code\nsystem_prompt: Be helpful",
    is_base: false,
  },
];

describe("AgentPage", () => {
  it("renders empty state when no agents", () => {
    render(<AgentPage agents={[]} editAgent={null} pushEvent={vi.fn()} />);
    expect(screen.getByText("No agents yet")).toBeInTheDocument();
  });

  it("renders agent cards", () => {
    render(<AgentPage agents={agents} editAgent={null} pushEvent={vi.fn()} />);
    expect(screen.getByText("Agent One")).toBeInTheDocument();
    expect(screen.getByText("Agent Two")).toBeInTheDocument();
  });

  it("opens new agent dialog when clicking New Agent", async () => {
    render(<AgentPage agents={[]} editAgent={null} pushEvent={vi.fn()} />);
    await userEvent.click(screen.getByText("New Agent"));
    expect(screen.getByText("Create a new agent to get started.")).toBeInTheDocument();
  });

  it("calls pushEvent with create-agent containing recipe on save", async () => {
    const pushEvent = vi.fn();
    render(<AgentPage agents={[]} editAgent={null} pushEvent={pushEvent} />);

    await userEvent.click(screen.getByText("New Agent"));
    await userEvent.type(screen.getByLabelText("Name"), "My Agent");
    await userEvent.type(screen.getByLabelText("Model"), "claude-sonnet-4-6");
    await userEvent.click(screen.getByText("Save Agent"));

    expect(pushEvent).toHaveBeenCalledWith(
      "create-agent",
      expect.objectContaining({ recipe: expect.stringContaining("My Agent") }),
    );
  });

  it("shows delete confirmation dialog", async () => {
    const pushEvent = vi.fn();
    render(<AgentPage agents={agents} editAgent={null} pushEvent={pushEvent} />);

    const deleteButtons = screen.getAllByText("Delete");
    await userEvent.click(deleteButtons[0]);

    expect(screen.getByText(/Are you sure you want to delete/)).toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("calls pushEvent with delete-agent on confirm", async () => {
    const pushEvent = vi.fn();
    render(<AgentPage agents={agents} editAgent={null} pushEvent={pushEvent} />);

    const deleteButtons = screen.getAllByText("Delete");
    await userEvent.click(deleteButtons[0]);

    // Click the Delete button in the confirmation dialog
    const confirmDelete = screen.getAllByText("Delete").find((el) => el.closest("[role='alertdialog']"));
    await userEvent.click(confirmDelete!);

    expect(pushEvent).toHaveBeenCalledWith("delete-agent", { id: 1 });
  });
});
