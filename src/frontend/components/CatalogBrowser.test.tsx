import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, mock } from "bun:test";
import { http, HttpResponse } from "msw";
import { server } from "../test/msw-server";
import CatalogBrowser from "../components/CatalogBrowser";
import type { CatalogAgentSummary, CatalogCategory } from "../components/types";
import { renderWithProviders } from "../test/test-utils";

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

function setCatalog(
  catalogAgents: CatalogAgentSummary[] = agents,
  catalogCategories: CatalogCategory[] = categories,
) {
  server.use(
    http.get("*/api/catalog/agents", () => HttpResponse.json(catalogAgents)),
    http.get("*/api/catalog/categories", () => HttpResponse.json(catalogCategories)),
  );
}

const defaultProps = {
  open: true,
  onClose: mock(() => {}),
  onAdd: mock(() => {}),
};

describe("CatalogBrowser", () => {
  it("renders all agents when open", async () => {
    setCatalog();
    renderWithProviders(<CatalogBrowser {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText("Frontend Developer")).toBeInTheDocument();
    });
    expect(screen.getByText("Backend Architect")).toBeInTheDocument();
    expect(screen.getByText("UI Designer")).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    setCatalog();
    renderWithProviders(<CatalogBrowser {...defaultProps} open={false} />);
    expect(screen.queryByText("Frontend Developer")).not.toBeInTheDocument();
  });

  it("filters agents by search query on displayName", async () => {
    setCatalog();
    renderWithProviders(<CatalogBrowser {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText("Frontend Developer")).toBeInTheDocument();
    });
    const search = screen.getByPlaceholderText("Search agents...");
    await userEvent.type(search, "frontend");
    expect(screen.getByText("Frontend Developer")).toBeInTheDocument();
    expect(screen.queryByText("Backend Architect")).not.toBeInTheDocument();
    expect(screen.queryByText("UI Designer")).not.toBeInTheDocument();
  });

  it("filters agents by search query on tags", async () => {
    setCatalog();
    renderWithProviders(<CatalogBrowser {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText("Frontend Developer")).toBeInTheDocument();
    });
    const search = screen.getByPlaceholderText("Search agents...");
    await userEvent.type(search, "react");
    expect(screen.getByText("Frontend Developer")).toBeInTheDocument();
    expect(screen.queryByText("UI Designer")).not.toBeInTheDocument();
  });

  it("filters agents by category", async () => {
    setCatalog();
    renderWithProviders(<CatalogBrowser {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText("Frontend Developer")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText("Design"));
    expect(screen.getByText("UI Designer")).toBeInTheDocument();
    expect(screen.queryByText("Frontend Developer")).not.toBeInTheDocument();
  });

  it("shows all agents when All category is selected", async () => {
    setCatalog();
    renderWithProviders(<CatalogBrowser {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText("Frontend Developer")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText("Design"));
    await userEvent.click(screen.getByText("All"));
    expect(screen.getByText("Frontend Developer")).toBeInTheDocument();
    expect(screen.getByText("UI Designer")).toBeInTheDocument();
  });

  it("calls onAdd with agent name when Add button is clicked", async () => {
    setCatalog();
    const onAdd = mock(() => {});
    renderWithProviders(<CatalogBrowser {...defaultProps} onAdd={onAdd} />);
    await waitFor(() => {
      expect(screen.getByText("Frontend Developer")).toBeInTheDocument();
    });
    const addButtons = screen.getAllByRole("button", { name: /add/i });
    await userEvent.click(addButtons[0]);
    expect(onAdd).toHaveBeenCalledWith("frontend-developer");
  });

  it("shows empty state when no agents match search", async () => {
    setCatalog();
    renderWithProviders(<CatalogBrowser {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText("Frontend Developer")).toBeInTheDocument();
    });
    const search = screen.getByPlaceholderText("Search agents...");
    await userEvent.type(search, "zzzznonexistent");
    expect(screen.getByText("No agents match your search.")).toBeInTheDocument();
  });

  it("shows empty catalog state when no agents provided and not loading", async () => {
    setCatalog([], categories);
    renderWithProviders(<CatalogBrowser {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText(/no agents in catalog/i)).toBeInTheDocument();
    });
  });

  it("shows loading spinner when loading is true", () => {
    // Don't set catalog handlers — the default returns [] which arrives instantly.
    // Instead, use a handler that never responds so the query stays in loading state.
    server.use(
      http.get("*/api/catalog/agents", () => new Promise(() => {})),
      http.get("*/api/catalog/categories", () => new Promise(() => {})),
    );
    renderWithProviders(<CatalogBrowser {...defaultProps} />);
    expect(screen.getByText("Loading catalog...")).toBeInTheDocument();
    expect(screen.queryByText(/no agents in catalog/i)).not.toBeInTheDocument();
  });

  it("does not show loading spinner when agents are loaded", async () => {
    setCatalog();
    renderWithProviders(<CatalogBrowser {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText("Frontend Developer")).toBeInTheDocument();
    });
    expect(screen.queryByText("Loading catalog...")).not.toBeInTheDocument();
  });

  it("displays agent descriptions", async () => {
    setCatalog();
    renderWithProviders(<CatalogBrowser {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText("Expert React/TypeScript developer")).toBeInTheDocument();
    });
  });

  it("uses line-clamp instead of truncate for agent titles", async () => {
    setCatalog();
    renderWithProviders(<CatalogBrowser {...defaultProps} />);
    await waitFor(() => {
      expect(
        screen.getByText("Senior Full-Stack Infrastructure & Platform Engineer"),
      ).toBeInTheDocument();
    });
    const title = screen.getByText("Senior Full-Stack Infrastructure & Platform Engineer");
    expect(title).toHaveClass("line-clamp-2");
    expect(title).not.toHaveClass("truncate");
  });
});
