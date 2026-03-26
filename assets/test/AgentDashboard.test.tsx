import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import AgentDashboard from "../react-components/AgentDashboard";
import { navigate } from "../react-components/lib/navigate";

vi.mock("../react-components/lib/navigate", () => ({
  navigate: vi.fn(),
}));
import { type Agent, type CatalogAgentSummary, type CatalogCategory, type Project } from "../react-components/types";

const agents: Agent[] = [
  {
    id: "a1",
    name: "Agent One",
    status: "active",
    model: "claude-sonnet-4-6",
    harness: "claude_code",
  },
  {
    id: "a2",
    name: "Agent Two",
    status: "created",
    harness: "claude_code",
  },
];

const projects: Project[] = [
  { id: "p1", name: "test-project", status: "running" },
  { id: "p2", name: "other-project", status: "running" },
];

const defaultProps = {
  project: { id: "p1", name: "test-project" },
  projects,
  editAgent: null,
  pushEvent: vi.fn(),
};

describe("AgentDashboard", () => {
  it("renders sidebar with agents and welcome panel when none selected", () => {
    render(<AgentDashboard {...defaultProps} agents={agents} selectedAgent={null} />);
    // Sidebar shows agents
    expect(screen.getByText("Agent One")).toBeInTheDocument();
    expect(screen.getByText("Agent Two")).toBeInTheDocument();
    // Welcome panel shows
    expect(screen.getByText("Shire")).toBeInTheDocument();
    // Welcome panel shows — with agents, it shows the selection prompt
    expect(screen.getByText("Select an agent from the sidebar to start chatting.")).toBeInTheDocument();
  });

  it("renders chat panel when agent is selected", () => {
    render(
      <AgentDashboard
        {...defaultProps}
        agents={agents}
        selectedAgent={agents[0]}
        messages={[{ id: 1, role: "user", text: "Hello", ts: "2026-03-17T00:00:00Z" }]}
      />,
    );
    // Chat header shows
    expect(screen.getAllByText("Agent One").length).toBeGreaterThanOrEqual(1);
    // Message shows
    expect(screen.getByText("Hello")).toBeInTheDocument();
    // Welcome panel should not show
    expect(screen.queryByText("Shire")).not.toBeInTheDocument();
  });

  it("navigates to agent URL when clicking sidebar agent", async () => {
    render(<AgentDashboard {...defaultProps} agents={agents} selectedAgent={null} />);

    await userEvent.click(screen.getByText("Agent One"));
    expect(navigate).toHaveBeenCalledWith("/projects/test-project/agents/Agent One");
  });

  it("opens new agent dialog from sidebar", async () => {
    render(<AgentDashboard {...defaultProps} agents={agents} selectedAgent={null} />);

    // Click the sidebar "+ New Agent" button
    await userEvent.click(screen.getAllByText("+ New Agent")[0]);
    expect(screen.getByText("Create a new agent to get started.")).toBeInTheDocument();
  });

  it("shows onboarding content in welcome panel when no agents", () => {
    render(<AgentDashboard {...defaultProps} agents={[]} selectedAgent={null} />);
    expect(screen.getByText(/agents that work together/)).toBeInTheDocument();
    expect(screen.getAllByText("Browse Catalog")).toHaveLength(2);
  });

  it("opens new agent dialog from welcome panel", async () => {
    render(<AgentDashboard {...defaultProps} agents={[]} selectedAgent={null} />);

    // Both sidebar and welcome panel have "+ New Agent" — click the welcome panel one
    const buttons = screen.getAllByText("+ New Agent");
    await userEvent.click(buttons[buttons.length - 1]);
    expect(screen.getByText("Create a new agent to get started.")).toBeInTheDocument();
  });

  it("fires load-catalog event when opening catalog with no agents loaded", async () => {
    const pushEvent = vi.fn();
    render(<AgentDashboard {...defaultProps} agents={agents} selectedAgent={null} pushEvent={pushEvent} />);

    await userEvent.click(screen.getByText("Browse Catalog"));
    expect(pushEvent).toHaveBeenCalledWith("load-catalog", {});
  });

  it("does not fire load-catalog when catalog agents already loaded", async () => {
    const pushEvent = vi.fn();
    const catalogAgents: CatalogAgentSummary[] = [
      {
        name: "test-agent",
        display_name: "Test Agent",
        description: "A test",
        category: "engineering",
        emoji: "🤖",
        tags: [],
        harness: "claude_code",
        model: "claude-sonnet-4-6",
      },
    ];
    const catalogCategories: CatalogCategory[] = [{ id: "engineering", name: "Engineering", description: "" }];

    render(
      <AgentDashboard
        {...defaultProps}
        agents={agents}
        selectedAgent={null}
        pushEvent={pushEvent}
        catalogAgents={catalogAgents}
        catalogCategories={catalogCategories}
      />,
    );

    await userEvent.click(screen.getByText("Browse Catalog"));
    expect(pushEvent).not.toHaveBeenCalledWith("load-catalog", {});
  });

  it("opens catalog browser and calls pushEvent on add", async () => {
    const pushEvent = vi.fn();
    const catalogAgents: CatalogAgentSummary[] = [
      {
        name: "frontend-developer",
        display_name: "Frontend Developer",
        description: "React specialist",
        category: "engineering",
        emoji: "⚛️",
        tags: ["react"],
        harness: "claude_code",
        model: "claude-sonnet-4-6",
      },
    ];
    const catalogCategories: CatalogCategory[] = [{ id: "engineering", name: "Engineering", description: "" }];

    render(
      <AgentDashboard
        {...defaultProps}
        agents={agents}
        selectedAgent={null}
        pushEvent={pushEvent}
        catalogAgents={catalogAgents}
        catalogCategories={catalogCategories}
      />,
    );

    // Open catalog browser
    await userEvent.click(screen.getByText("Browse Catalog"));
    expect(screen.getByText("Agent Catalog")).toBeInTheDocument();
    expect(screen.getByText("Frontend Developer")).toBeInTheDocument();

    // Click Add button
    await userEvent.click(screen.getByText("Add"));
    expect(pushEvent).toHaveBeenCalledWith("get-catalog-agent", { name: "frontend-developer" });
  });

  it("renders menu toggle button in chat header", () => {
    render(<AgentDashboard {...defaultProps} agents={agents} selectedAgent={agents[0]} />);
    expect(screen.getByRole("button", { name: "Open menu" })).toBeInTheDocument();
  });

  it("renders menu toggle button in welcome panel", () => {
    render(<AgentDashboard {...defaultProps} agents={agents} selectedAgent={null} />);
    expect(screen.getByRole("button", { name: "Open menu" })).toBeInTheDocument();
  });

  it("shows backdrop when menu toggle is clicked", async () => {
    const { container } = render(<AgentDashboard {...defaultProps} agents={agents} selectedAgent={null} />);
    await userEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(container.querySelector(".fixed.inset-0.z-40")).toBeInTheDocument();
  });

  it("closes sidebar backdrop when clicked", async () => {
    const { container } = render(<AgentDashboard {...defaultProps} agents={agents} selectedAgent={null} />);
    await userEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const backdrop = container.querySelector(".fixed.inset-0.z-40");
    expect(backdrop).toBeInTheDocument();
    await userEvent.click(backdrop!);
    expect(container.querySelector(".fixed.inset-0.z-40")).not.toBeInTheDocument();
  });

  it("applies safe area insets to root container", () => {
    const { container } = render(<AgentDashboard {...defaultProps} agents={agents} selectedAgent={null} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("safe-area-inset-top");
    expect(root.className).toContain("safe-area-inset-bottom");
  });

  it("uses dvh for viewport height", () => {
    const { container } = render(<AgentDashboard {...defaultProps} agents={agents} selectedAgent={null} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("h-dvh");
    expect(root.className).not.toContain("h-screen");
  });

  it("pre-fills agent form when catalogSelectedAgent is provided", () => {
    render(
      <AgentDashboard
        {...defaultProps}
        agents={agents}
        selectedAgent={null}
        catalogSelectedAgent={{
          name: "frontend-developer",
          display_name: "Frontend Developer",
          description: "React specialist",
          category: "engineering",
          emoji: "⚛️",
          tags: ["react"],
          harness: "claude_code",
          model: "claude-sonnet-4-6",
          system_prompt: "You are a frontend developer.",
        }}
      />,
    );

    // Form should open with catalog agent title
    expect(screen.getByText("New Agent from Catalog")).toBeInTheDocument();
  });
});
