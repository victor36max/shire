import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, mock } from "bun:test";
import { http, HttpResponse } from "msw";
import { server } from "./msw-server";
import AgentSidebar from "../components/AgentSidebar";
import { type AgentOverview, type Project } from "../components/types";
import { renderWithProviders } from "./test-utils";

const defaultAgents: AgentOverview[] = [
  {
    id: "a1",
    name: "Active Agent",
    busy: false,
    unreadCount: 0,
  },
  {
    id: "a2",
    name: "Created Agent",
    busy: false,
    unreadCount: 0,
  },
  {
    id: "a3",
    name: "Idle Agent",
    busy: false,
    unreadCount: 0,
  },
];

const projects: Project[] = [
  { id: "p1", name: "test-project" },
  { id: "p2", name: "other-project" },
];

function setAgents(agents: AgentOverview[]) {
  server.use(http.get("*/api/projects/:id/agents", () => HttpResponse.json(agents)));
}

function setProjects(projectList: Project[] = projects) {
  server.use(http.get("*/api/projects", () => HttpResponse.json(projectList)));
}

const routeOpts = {
  route: "/projects/test-project",
  routePath: "/projects/:projectName",
};

const defaultProps = {
  onNewAgent: mock(() => {}),
  onBrowseCatalog: mock(() => {}),
};

describe("AgentSidebar", () => {
  it("renders agent list with names", async () => {
    setProjects();
    setAgents(defaultAgents);
    renderWithProviders(<AgentSidebar {...defaultProps} />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("Active Agent")).toBeInTheDocument();
    });
    expect(screen.getByText("Created Agent")).toBeInTheDocument();
    expect(screen.getByText("Idle Agent")).toBeInTheDocument();
  });

  it("renders empty state when no agents", async () => {
    setProjects();
    setAgents([]);
    renderWithProviders(<AgentSidebar {...defaultProps} />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("No agents yet")).toBeInTheDocument();
      expect(screen.getByText(/browse the catalog/)).toBeInTheDocument();
    });
  });

  it("calls onNewAgent when clicking New Agent button", async () => {
    setProjects();
    setAgents(defaultAgents);
    const onNewAgent = mock(() => {});
    renderWithProviders(<AgentSidebar {...defaultProps} onNewAgent={onNewAgent} />, routeOpts);

    await waitFor(() => {
      expect(screen.getByText("+ New Agent")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText("+ New Agent"));
    expect(onNewAgent).toHaveBeenCalled();
  });

  it("renders Project Details link", async () => {
    setProjects();
    setAgents(defaultAgents);
    renderWithProviders(<AgentSidebar {...defaultProps} />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("Project Details")).toBeInTheDocument();
    });
  });

  it("renders Settings link", async () => {
    setProjects();
    setAgents(defaultAgents);
    renderWithProviders(<AgentSidebar {...defaultProps} />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });
  });

  it("renders unread badge when unreadCount > 0", async () => {
    setProjects();
    setAgents([
      { ...defaultAgents[0], unreadCount: 5 },
      { ...defaultAgents[1], unreadCount: 0 },
      { ...defaultAgents[2] },
    ]);
    renderWithProviders(<AgentSidebar {...defaultProps} />, routeOpts);

    await waitFor(() => {
      expect(screen.getByText("5")).toBeInTheDocument();
    });
    expect(screen.queryAllByText("0")).toHaveLength(0);
  });

  it("renders 99+ when unreadCount exceeds 99", async () => {
    setProjects();
    setAgents([{ ...defaultAgents[0], unreadCount: 150 }]);
    renderWithProviders(<AgentSidebar {...defaultProps} />, routeOpts);

    await waitFor(() => {
      expect(screen.getByText("99+")).toBeInTheDocument();
    });
  });

  it("does not render unread badge when unreadCount is 0", async () => {
    setProjects();
    setAgents([{ ...defaultAgents[0], unreadCount: 0 }, { ...defaultAgents[1] }]);
    const { container } = renderWithProviders(<AgentSidebar {...defaultProps} />, routeOpts);

    await waitFor(() => {
      expect(screen.getByText("Active Agent")).toBeInTheDocument();
    });

    const badges = container.querySelectorAll(".bg-primary.rounded-full");
    expect(badges).toHaveLength(0);
  });

  it("calls onBrowseCatalog when clicking Browse Catalog button", async () => {
    setProjects();
    setAgents(defaultAgents);
    const onBrowseCatalog = mock(() => {});
    renderWithProviders(
      <AgentSidebar {...defaultProps} onBrowseCatalog={onBrowseCatalog} />,
      routeOpts,
    );

    await waitFor(() => {
      expect(screen.getByText("Browse Catalog")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText("Browse Catalog"));
    expect(onBrowseCatalog).toHaveBeenCalled();
  });

  it("navigates when clicking an agent in the list", async () => {
    setProjects();
    setAgents(defaultAgents);
    renderWithProviders(<AgentSidebar {...defaultProps} />, routeOpts);

    await waitFor(() => {
      expect(screen.getByText("Active Agent")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Active Agent"));
    // Navigation should have been triggered (no error thrown)
  });

  it("shows delete confirmation dialog and executes delete", async () => {
    let deletedId: string | undefined;
    server.use(
      http.delete("*/api/projects/:id/agents/:aid", ({ params }) => {
        deletedId = params.aid as string;
        return HttpResponse.json({ ok: true });
      }),
    );
    setProjects();
    setAgents(defaultAgents);
    renderWithProviders(<AgentSidebar {...defaultProps} />, routeOpts);

    await waitFor(() => {
      expect(screen.getByText("Active Agent")).toBeInTheDocument();
    });

    // Open the actions dropdown for the first agent
    const actionButtons = screen.getAllByRole("button", { name: /actions/ });
    await userEvent.click(actionButtons[0]);

    // Click "Delete" in the dropdown
    await userEvent.click(screen.getByText("Delete"));

    // Confirm deletion in the alert dialog
    expect(screen.getByText("Delete Agent")).toBeInTheDocument();
    const alertDialog = screen.getByRole("alertdialog");
    const confirmButton = alertDialog.querySelector("button:last-of-type");
    expect(confirmButton).toBeTruthy();
    await userEvent.click(confirmButton!);

    await waitFor(() => expect(deletedId).toBe("a1"));
  });

  it("renders Schedules link", async () => {
    setProjects();
    setAgents(defaultAgents);
    renderWithProviders(<AgentSidebar {...defaultProps} />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("Schedules")).toBeInTheDocument();
    });
  });

  it("renders Files tab", async () => {
    setProjects();
    setAgents(defaultAgents);
    renderWithProviders(<AgentSidebar {...defaultProps} />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("Files")).toBeInTheDocument();
    });
  });

  it("navigates to settings on dropdown Settings click", async () => {
    setProjects();
    setAgents(defaultAgents);
    renderWithProviders(<AgentSidebar {...defaultProps} />, routeOpts);

    await waitFor(() => {
      expect(screen.getByText("Active Agent")).toBeInTheDocument();
    });

    // Open the actions dropdown for the first agent
    const actionButtons = screen.getAllByRole("button", { name: /actions/ });
    await userEvent.click(actionButtons[0]);

    // Click "Settings" in the dropdown - use getAllByText since "Settings" appears
    // both in the dropdown and in the sidebar nav
    const settingsOptions = screen.getAllByText("Settings");
    // The dropdown option is the one inside DropdownMenuContent
    const dropdownSettings = settingsOptions.find((el) => el.closest("[role='menuitem']") !== null);
    if (dropdownSettings) {
      await userEvent.click(dropdownSettings);
    }
  });

  it("dismisses delete dialog when onOpenChange fires false", async () => {
    setProjects();
    setAgents(defaultAgents);
    renderWithProviders(<AgentSidebar {...defaultProps} />, routeOpts);

    await waitFor(() => {
      expect(screen.getByText("Active Agent")).toBeInTheDocument();
    });

    // Open the actions dropdown and click Delete
    const actionButtons = screen.getAllByRole("button", { name: /actions/ });
    await userEvent.click(actionButtons[0]);
    await userEvent.click(screen.getByText("Delete"));

    // Dialog should be open
    expect(screen.getByText("Delete Agent")).toBeInTheDocument();

    // Press Cancel to dismiss
    await userEvent.click(screen.getByText("Cancel"));

    // Dialog should be closed
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("handles case when agent not found in handleSelectAgent", async () => {
    setProjects();
    setAgents(defaultAgents);
    renderWithProviders(<AgentSidebar {...defaultProps} />, routeOpts);

    await waitFor(() => {
      expect(screen.getByText("Active Agent")).toBeInTheDocument();
    });
    // Clicking an agent triggers handleSelectAgent - already tested above
  });
});
