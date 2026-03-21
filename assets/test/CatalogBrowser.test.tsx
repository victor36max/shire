import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import CatalogBrowser from "../react-components/CatalogBrowser";
import type { CatalogAgentSummary, CatalogCategory } from "../react-components/types";

const agents: CatalogAgentSummary[] = [
  {
    name: "frontend-developer",
    display_name: "Frontend Developer",
    description: "Expert React/TypeScript developer",
    category: "engineering",
    emoji: "⚛️",
    tags: ["react", "typescript"],
    harness: "claude_code",
    model: "claude-sonnet-4-6",
  },
  {
    name: "backend-architect",
    display_name: "Backend Architect",
    description: "Systems designer for scalable backends",
    category: "engineering",
    emoji: "🏗️",
    tags: ["backend", "api"],
    harness: "claude_code",
    model: "claude-sonnet-4-6",
  },
  {
    name: "ui-designer",
    display_name: "UI Designer",
    description: "Visual design specialist",
    category: "design",
    emoji: "🎨",
    tags: ["ui", "design"],
    harness: "claude_code",
    model: "claude-sonnet-4-6",
  },
  {
    name: "senior-infrastructure-platform-engineer",
    display_name: "Senior Full-Stack Infrastructure & Platform Engineer",
    description: "Expert in cloud infrastructure and platform engineering",
    category: "engineering",
    emoji: "🔧",
    tags: ["infrastructure", "platform"],
    harness: "claude_code",
    model: "claude-sonnet-4-6",
  },
];

const categories: CatalogCategory[] = [
  { id: "engineering", name: "Engineering", description: "Software development agents" },
  { id: "design", name: "Design", description: "UI/UX and visual design agents" },
];

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  agents,
  categories,
  onAdd: vi.fn(),
};

describe("CatalogBrowser", () => {
  it("renders all agents when open", () => {
    render(<CatalogBrowser {...defaultProps} />);
    expect(screen.getByText("Frontend Developer")).toBeInTheDocument();
    expect(screen.getByText("Backend Architect")).toBeInTheDocument();
    expect(screen.getByText("UI Designer")).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    render(<CatalogBrowser {...defaultProps} open={false} />);
    expect(screen.queryByText("Frontend Developer")).not.toBeInTheDocument();
  });

  it("filters agents by search query on display_name", async () => {
    render(<CatalogBrowser {...defaultProps} />);
    const search = screen.getByPlaceholderText("Search agents...");
    await userEvent.type(search, "frontend");
    expect(screen.getByText("Frontend Developer")).toBeInTheDocument();
    expect(screen.queryByText("Backend Architect")).not.toBeInTheDocument();
    expect(screen.queryByText("UI Designer")).not.toBeInTheDocument();
  });

  it("filters agents by search query on tags", async () => {
    render(<CatalogBrowser {...defaultProps} />);
    const search = screen.getByPlaceholderText("Search agents...");
    await userEvent.type(search, "react");
    expect(screen.getByText("Frontend Developer")).toBeInTheDocument();
    expect(screen.queryByText("UI Designer")).not.toBeInTheDocument();
  });

  it("filters agents by category", async () => {
    render(<CatalogBrowser {...defaultProps} />);
    await userEvent.click(screen.getByText("Design"));
    expect(screen.getByText("UI Designer")).toBeInTheDocument();
    expect(screen.queryByText("Frontend Developer")).not.toBeInTheDocument();
  });

  it("shows all agents when All category is selected", async () => {
    render(<CatalogBrowser {...defaultProps} />);
    await userEvent.click(screen.getByText("Design"));
    await userEvent.click(screen.getByText("All"));
    expect(screen.getByText("Frontend Developer")).toBeInTheDocument();
    expect(screen.getByText("UI Designer")).toBeInTheDocument();
  });

  it("calls onAdd with agent name when Add button is clicked", async () => {
    const onAdd = vi.fn();
    render(<CatalogBrowser {...defaultProps} onAdd={onAdd} />);
    const addButtons = screen.getAllByRole("button", { name: /add/i });
    await userEvent.click(addButtons[0]);
    expect(onAdd).toHaveBeenCalledWith("frontend-developer");
  });

  it("shows empty state when no agents match search", async () => {
    render(<CatalogBrowser {...defaultProps} />);
    const search = screen.getByPlaceholderText("Search agents...");
    await userEvent.type(search, "zzzznonexistent");
    expect(screen.getByText("No agents match your search.")).toBeInTheDocument();
  });

  it("shows empty catalog state when no agents provided", () => {
    render(<CatalogBrowser {...defaultProps} agents={[]} />);
    expect(screen.getByText(/no agents in catalog/i)).toBeInTheDocument();
  });

  it("displays agent descriptions", () => {
    render(<CatalogBrowser {...defaultProps} />);
    expect(screen.getByText("Expert React/TypeScript developer")).toBeInTheDocument();
  });

  it("uses line-clamp instead of truncate for agent titles", () => {
    render(<CatalogBrowser {...defaultProps} />);
    const title = screen.getByText("Senior Full-Stack Infrastructure & Platform Engineer");
    expect(title).toHaveClass("line-clamp-2");
    expect(title).not.toHaveClass("truncate");
  });
});
