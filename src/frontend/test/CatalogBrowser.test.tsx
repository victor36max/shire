import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, mock, beforeEach } from "bun:test";
import CatalogBrowser from "../components/CatalogBrowser";
import type { CatalogAgentSummary, CatalogCategory } from "../components/types";
import { renderWithProviders } from "./test-utils";
import * as hooksModule from "../hooks";

const agents: CatalogAgentSummary[] = [
  {
    name: "frontend-developer",
    displayName: "Frontend Developer",
    description: "Expert React/TypeScript developer",
    category: "engineering",
    emoji: "\u269B\uFE0F",
    tags: ["react", "typescript"],
    harness: "claude_code",
    model: "claude-sonnet-4-6",
  },
  {
    name: "backend-architect",
    displayName: "Backend Architect",
    description: "Systems designer for scalable backends",
    category: "engineering",
    emoji: "\uD83C\uDFD7\uFE0F",
    tags: ["backend", "api"],
    harness: "claude_code",
    model: "claude-sonnet-4-6",
  },
  {
    name: "ui-designer",
    displayName: "UI Designer",
    description: "Visual design specialist",
    category: "design",
    emoji: "\uD83C\uDFA8",
    tags: ["ui", "design"],
    harness: "claude_code",
    model: "claude-sonnet-4-6",
  },
  {
    name: "senior-infrastructure-platform-engineer",
    displayName: "Senior Full-Stack Infrastructure & Platform Engineer",
    description: "Expert in cloud infrastructure and platform engineering",
    category: "engineering",
    emoji: "\uD83D\uDD27",
    tags: ["infrastructure", "platform"],
    harness: "claude_code",
    model: "claude-sonnet-4-6",
  },
];

const categories: CatalogCategory[] = [
  { id: "engineering", name: "Engineering", description: "Software development agents" },
  { id: "design", name: "Design", description: "UI/UX and visual design agents" },
];

let mockCatalogAgents: CatalogAgentSummary[] = agents;
let mockCatalogAgentsLoading = false;
let mockCatalogCategoriesLoading = false;

mock.module("../hooks", () => ({
  ...hooksModule,
  useCatalogAgents: () => ({ data: mockCatalogAgents, isLoading: mockCatalogAgentsLoading }),
  useCatalogCategories: () => ({ data: categories, isLoading: mockCatalogCategoriesLoading }),
}));

const defaultProps = {
  open: true,
  onClose: mock(() => {}),
  onAdd: mock(() => {}),
};

beforeEach(() => {
  mockCatalogAgents = agents;
  mockCatalogAgentsLoading = false;
  mockCatalogCategoriesLoading = false;
});

describe("CatalogBrowser", () => {
  it("renders all agents when open", () => {
    renderWithProviders(<CatalogBrowser {...defaultProps} />);
    expect(screen.getByText("Frontend Developer")).toBeInTheDocument();
    expect(screen.getByText("Backend Architect")).toBeInTheDocument();
    expect(screen.getByText("UI Designer")).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    renderWithProviders(<CatalogBrowser {...defaultProps} open={false} />);
    expect(screen.queryByText("Frontend Developer")).not.toBeInTheDocument();
  });

  it("filters agents by search query on displayName", async () => {
    renderWithProviders(<CatalogBrowser {...defaultProps} />);
    const search = screen.getByPlaceholderText("Search agents...");
    await userEvent.type(search, "frontend");
    expect(screen.getByText("Frontend Developer")).toBeInTheDocument();
    expect(screen.queryByText("Backend Architect")).not.toBeInTheDocument();
    expect(screen.queryByText("UI Designer")).not.toBeInTheDocument();
  });

  it("filters agents by search query on tags", async () => {
    renderWithProviders(<CatalogBrowser {...defaultProps} />);
    const search = screen.getByPlaceholderText("Search agents...");
    await userEvent.type(search, "react");
    expect(screen.getByText("Frontend Developer")).toBeInTheDocument();
    expect(screen.queryByText("UI Designer")).not.toBeInTheDocument();
  });

  it("filters agents by category", async () => {
    renderWithProviders(<CatalogBrowser {...defaultProps} />);
    await userEvent.click(screen.getByText("Design"));
    expect(screen.getByText("UI Designer")).toBeInTheDocument();
    expect(screen.queryByText("Frontend Developer")).not.toBeInTheDocument();
  });

  it("shows all agents when All category is selected", async () => {
    renderWithProviders(<CatalogBrowser {...defaultProps} />);
    await userEvent.click(screen.getByText("Design"));
    await userEvent.click(screen.getByText("All"));
    expect(screen.getByText("Frontend Developer")).toBeInTheDocument();
    expect(screen.getByText("UI Designer")).toBeInTheDocument();
  });

  it("calls onAdd with agent name when Add button is clicked", async () => {
    const onAdd = mock(() => {});
    renderWithProviders(<CatalogBrowser {...defaultProps} onAdd={onAdd} />);
    const addButtons = screen.getAllByRole("button", { name: /add/i });
    await userEvent.click(addButtons[0]);
    expect(onAdd).toHaveBeenCalledWith("frontend-developer");
  });

  it("shows empty state when no agents match search", async () => {
    renderWithProviders(<CatalogBrowser {...defaultProps} />);
    const search = screen.getByPlaceholderText("Search agents...");
    await userEvent.type(search, "zzzznonexistent");
    expect(screen.getByText("No agents match your search.")).toBeInTheDocument();
  });

  it("shows empty catalog state when no agents provided and not loading", () => {
    mockCatalogAgents = [];
    mockCatalogAgentsLoading = false;
    renderWithProviders(<CatalogBrowser {...defaultProps} />);
    expect(screen.getByText(/no agents in catalog/i)).toBeInTheDocument();
  });

  it("shows loading spinner when loading is true", () => {
    mockCatalogAgents = [];
    mockCatalogAgentsLoading = true;
    mockCatalogCategoriesLoading = true;
    renderWithProviders(<CatalogBrowser {...defaultProps} />);
    expect(screen.getByText("Loading catalog...")).toBeInTheDocument();
    expect(screen.queryByText(/no agents in catalog/i)).not.toBeInTheDocument();
  });

  it("does not show loading spinner when agents are loaded", () => {
    renderWithProviders(<CatalogBrowser {...defaultProps} />);
    expect(screen.queryByText("Loading catalog...")).not.toBeInTheDocument();
    expect(screen.getByText("Frontend Developer")).toBeInTheDocument();
  });

  it("displays agent descriptions", () => {
    renderWithProviders(<CatalogBrowser {...defaultProps} />);
    expect(screen.getByText("Expert React/TypeScript developer")).toBeInTheDocument();
  });

  it("uses line-clamp instead of truncate for agent titles", () => {
    renderWithProviders(<CatalogBrowser {...defaultProps} />);
    const title = screen.getByText("Senior Full-Stack Infrastructure & Platform Engineer");
    expect(title).toHaveClass("line-clamp-2");
    expect(title).not.toHaveClass("truncate");
  });
});
