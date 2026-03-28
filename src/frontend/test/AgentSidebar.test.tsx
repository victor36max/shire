import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, mock, beforeEach } from "bun:test";
import AgentSidebar from "../components/AgentSidebar";
import { type AgentOverview, type Project } from "../components/types";
import { renderWithProviders } from "./test-utils";
import * as reactRouterDom from "react-router-dom";
import * as hooksModule from "../lib/hooks";

const defaultAgents: AgentOverview[] = [
  {
    id: "a1",
    name: "Active Agent",
    status: "active",
    busy: false,
    unreadCount: 0,
  },
  {
    id: "a2",
    name: "Created Agent",
    status: "created",
    busy: false,
    unreadCount: 0,
  },
  {
    id: "a3",
    name: "Idle Agent",
    status: "idle",
    busy: false,
    unreadCount: 0,
  },
];

const projects: Project[] = [
  { id: "p1", name: "test-project", status: "running" },
  { id: "p2", name: "other-project", status: "running" },
];

const deleteMutate = mock(() => {});
let mockAgents: AgentOverview[] = defaultAgents;
let mockAgentName: string | undefined = undefined;

mock.module("react-router-dom", () => ({
  ...reactRouterDom,
  useParams: () => ({ agentName: mockAgentName }),
}));

mock.module("../lib/hooks", () => ({
  ...hooksModule,
  useProjectId: () => ({ projectId: "p1", projectName: "test-project" }),
  useProjects: () => ({ data: projects, isLoading: false }),
  useAgents: () => ({ data: mockAgents, isLoading: false }),
  useDeleteAgent: () => ({ mutate: deleteMutate, isPending: false }),
}));

beforeEach(() => {
  mockAgents = defaultAgents;
  mockAgentName = undefined;
  deleteMutate.mockClear();
});

const defaultProps = {
  onNewAgent: mock(() => {}),
  onBrowseCatalog: mock(() => {}),
};

describe("AgentSidebar", () => {
  it("renders agent list with names", () => {
    renderWithProviders(<AgentSidebar {...defaultProps} />);
    expect(screen.getByText("Active Agent")).toBeInTheDocument();
    expect(screen.getByText("Created Agent")).toBeInTheDocument();
    expect(screen.getByText("Idle Agent")).toBeInTheDocument();
  });

  it("renders empty state when no agents", () => {
    mockAgents = [];
    renderWithProviders(<AgentSidebar {...defaultProps} />);
    expect(screen.getByText("No agents yet")).toBeInTheDocument();
    expect(screen.getByText(/browse the catalog/)).toBeInTheDocument();
  });

  it("calls onNewAgent when clicking New Agent button", async () => {
    const onNewAgent = mock(() => {});
    renderWithProviders(<AgentSidebar {...defaultProps} onNewAgent={onNewAgent} />);

    await userEvent.click(screen.getByText("+ New Agent"));
    expect(onNewAgent).toHaveBeenCalled();
  });

  it("renders Project Details link", () => {
    renderWithProviders(<AgentSidebar {...defaultProps} />);
    expect(screen.getByText("Project Details")).toBeInTheDocument();
  });

  it("renders Settings link", () => {
    renderWithProviders(<AgentSidebar {...defaultProps} />);
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("shows status dots with correct colors", () => {
    const { container } = renderWithProviders(<AgentSidebar {...defaultProps} />);

    const dots = container.querySelectorAll(".w-2.h-2.rounded-full");
    expect(dots[0]).toHaveClass("bg-status-active"); // active
    expect(dots[1]).toHaveClass("bg-status-idle"); // created
    expect(dots[2]).toHaveClass("bg-status-idle"); // idle
  });

  it("pulses the status dot when agent is active and busy", () => {
    mockAgents = [
      { ...defaultAgents[0], busy: true },
      { ...defaultAgents[1], busy: false },
    ];
    const { container } = renderWithProviders(<AgentSidebar {...defaultProps} />);

    const dots = container.querySelectorAll(".w-2.h-2.rounded-full");
    expect(dots[0]).toHaveClass("animate-pulse"); // active + busy
    expect(dots[1]).not.toHaveClass("animate-pulse"); // created + not busy
  });

  it("renders unread badge when unreadCount > 0", () => {
    mockAgents = [
      { ...defaultAgents[0], unreadCount: 5 },
      { ...defaultAgents[1], unreadCount: 0 },
      { ...defaultAgents[2] },
    ];
    renderWithProviders(<AgentSidebar {...defaultProps} />);

    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.queryAllByText("0")).toHaveLength(0);
  });

  it("renders 99+ when unreadCount exceeds 99", () => {
    mockAgents = [{ ...defaultAgents[0], unreadCount: 150 }];
    renderWithProviders(<AgentSidebar {...defaultProps} />);

    expect(screen.getByText("99+")).toBeInTheDocument();
  });

  it("does not render unread badge when unreadCount is 0", () => {
    mockAgents = [{ ...defaultAgents[0], unreadCount: 0 }, { ...defaultAgents[1] }];
    const { container } = renderWithProviders(<AgentSidebar {...defaultProps} />);

    const badges = container.querySelectorAll(".bg-primary.rounded-full");
    expect(badges).toHaveLength(0);
  });

  it("calls onBrowseCatalog when clicking Browse Catalog button", async () => {
    const onBrowseCatalog = mock(() => {});
    renderWithProviders(<AgentSidebar {...defaultProps} onBrowseCatalog={onBrowseCatalog} />);

    await userEvent.click(screen.getByText("Browse Catalog"));
    expect(onBrowseCatalog).toHaveBeenCalled();
  });
});
