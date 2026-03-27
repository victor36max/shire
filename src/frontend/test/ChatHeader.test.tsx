import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import ChatHeader from "../components/ChatHeader";
import { type AgentOverview } from "../components/types";
import { renderWithProviders } from "./test-utils";

const clearMutate = vi.fn();

vi.mock("../lib/hooks", async () => {
  const actual = await vi.importActual("../lib/hooks");
  return {
    ...actual,
    useProjectId: () => ({ projectId: "p1", projectName: "test-project" }),
    useClearSession: () => ({ mutate: clearMutate, isPending: false }),
  };
});

const agent: AgentOverview = {
  id: "a1",
  name: "test-agent",
  status: "active",
};

describe("ChatHeader", () => {
  it("renders agent name and status", () => {
    renderWithProviders(<ChatHeader agent={agent} />);
    expect(screen.getByText("test-agent")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
  });

  it("calls clearSession.mutate when Clear Session is clicked", async () => {
    clearMutate.mockClear();
    const user = userEvent.setup();
    renderWithProviders(<ChatHeader agent={agent} />);

    await user.click(screen.getByRole("button", { name: "Agent options" }));
    await user.click(screen.getByText("Clear Session"));

    expect(clearMutate).toHaveBeenCalledWith("a1");
  });

  it("renders mobile menu toggle when onMenuToggle is provided", () => {
    renderWithProviders(<ChatHeader agent={agent} onMenuToggle={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Open menu" })).toBeInTheDocument();
  });
});
