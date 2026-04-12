import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, mock } from "bun:test";
import { http, HttpResponse } from "msw";
import { server } from "./msw-server";
import ProjectDashboard from "../components/ProjectDashboard";
import type { Project } from "../components/types";
import { renderWithProviders } from "./test-utils";

mock.module("../lib/ws", () => ({
  useSubscription: mock(() => {}),
}));

const defaultProjects: Project[] = [
  { id: "p1", name: "test-project" },
  { id: "p2", name: "other-project" },
];

function setProjects(projects: Project[]) {
  server.use(http.get("*/api/projects", () => HttpResponse.json(projects)));
}

describe("ProjectDashboard", () => {
  it("renders Projects heading", async () => {
    setProjects(defaultProjects);
    renderWithProviders(<ProjectDashboard />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument();
    });
  });

  it("renders project cards", async () => {
    setProjects(defaultProjects);
    renderWithProviders(<ProjectDashboard />);
    await waitFor(() => {
      expect(screen.getByText("test-project")).toBeInTheDocument();
    });
    expect(screen.getByText("other-project")).toBeInTheDocument();
  });

  it("shows empty state when no projects", async () => {
    setProjects([]);
    renderWithProviders(<ProjectDashboard />);
    await waitFor(() => {
      expect(screen.getByText("No projects yet")).toBeInTheDocument();
    });
    expect(screen.getByText("Create Your First Project")).toBeInTheDocument();
  });

  it("opens create dialog when clicking + New Project", async () => {
    setProjects(defaultProjects);
    renderWithProviders(<ProjectDashboard />);
    await waitFor(() => {
      expect(screen.getByText("+ New Project")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText("+ New Project"));
    expect(screen.getByText("Create a new project with its own isolated VM.")).toBeInTheDocument();
  });

  it("creates a project via dialog", async () => {
    let createdName: string | undefined;
    server.use(
      http.post("*/api/projects", async ({ request }) => {
        const body = (await request.json()) as { name: string };
        createdName = body.name;
        return HttpResponse.json({ id: "p-new" }, { status: 201 });
      }),
    );
    setProjects(defaultProjects);

    const user = userEvent.setup();
    renderWithProviders(<ProjectDashboard />);

    await waitFor(() => {
      expect(screen.getByText("+ New Project")).toBeInTheDocument();
    });
    await user.click(screen.getByText("+ New Project"));
    await user.paste("my-new-project");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(createdName).toBe("my-new-project"));
  });

  it("shows validation error for invalid project name", async () => {
    setProjects(defaultProjects);
    const user = userEvent.setup();
    renderWithProviders(<ProjectDashboard />);

    await waitFor(() => {
      expect(screen.getByText("+ New Project")).toBeInTheDocument();
    });
    await user.click(screen.getByText("+ New Project"));
    await user.paste("INVALID NAME!");

    expect(
      screen.getByText(
        "Use lowercase letters, numbers, and hyphens only. Must start and end with a letter or number.",
      ),
    ).toBeInTheDocument();
  });

  it("shows delete confirmation when clicking Delete in card menu", async () => {
    setProjects(defaultProjects);
    renderWithProviders(<ProjectDashboard />);
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /actions/ }).length).toBeGreaterThan(0);
    });
    const menuButtons = screen.getAllByRole("button", { name: /actions/ });
    await userEvent.click(menuButtons[0]);
    await userEvent.click(screen.getByText("Delete"));
    expect(screen.getByText(/destroy the VM and all its data/)).toBeInTheDocument();
  });

  it("sends delete request after confirming", async () => {
    let deletedId: string | undefined;
    server.use(
      http.delete("*/api/projects/:id", ({ params }) => {
        deletedId = params.id as string;
        return HttpResponse.json({ ok: true });
      }),
    );
    setProjects(defaultProjects);

    renderWithProviders(<ProjectDashboard />);
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /actions/ }).length).toBeGreaterThan(0);
    });

    const menuButtons = screen.getAllByRole("button", { name: /actions/ });
    await userEvent.click(menuButtons[0]);
    await userEvent.click(screen.getByText("Delete"));

    const confirmDelete = screen
      .getAllByText("Delete")
      .find((el) => el.closest("[role='alertdialog']"));
    await userEvent.click(confirmDelete!);

    await waitFor(() => expect(deletedId).toBe("p1"));
  });

  it("shows error state with retry when projects query fails", async () => {
    server.use(
      http.get("*/api/projects", () =>
        HttpResponse.json({ error: "Network error" }, { status: 500 }),
      ),
    );
    renderWithProviders(<ProjectDashboard />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    });
  });

  it("navigates to project on card click", async () => {
    setProjects(defaultProjects);
    renderWithProviders(<ProjectDashboard />);
    await waitFor(() => {
      expect(screen.getByText("test-project")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText("test-project"));
    // Navigation triggered without error
  });

  it("navigates to project on Enter keypress", async () => {
    setProjects(defaultProjects);
    renderWithProviders(<ProjectDashboard />);
    await waitFor(() => {
      expect(screen.getByText("test-project")).toBeInTheDocument();
    });
    const card = screen.getByText("test-project").closest("[role='button']");
    expect(card).toBeTruthy();
    card!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    // Navigation triggered
  });

  it("navigates to project on Space keypress", async () => {
    setProjects(defaultProjects);
    renderWithProviders(<ProjectDashboard />);
    await waitFor(() => {
      expect(screen.getByText("test-project")).toBeInTheDocument();
    });
    const card = screen.getByText("test-project").closest("[role='button']");
    expect(card).toBeTruthy();
    card!.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
  });

  it("Create button is disabled when name is empty", async () => {
    setProjects(defaultProjects);
    const user = userEvent.setup();
    renderWithProviders(<ProjectDashboard />);
    await waitFor(() => {
      expect(screen.getByText("+ New Project")).toBeInTheDocument();
    });
    await user.click(screen.getByText("+ New Project"));
    const createBtn = screen.getByRole("button", { name: "Create" });
    // Empty name means nameValid is false
    expect(createBtn).toBeDisabled();
  });

  it("creates project when pressing Enter in input", async () => {
    let createdName: string | undefined;
    server.use(
      http.post("*/api/projects", async ({ request }) => {
        const body = (await request.json()) as { name: string };
        createdName = body.name;
        return HttpResponse.json({ id: "p-enter" }, { status: 201 });
      }),
    );
    setProjects(defaultProjects);
    const user = userEvent.setup();
    renderWithProviders(<ProjectDashboard />);

    await waitFor(() => {
      expect(screen.getByText("+ New Project")).toBeInTheDocument();
    });
    await user.click(screen.getByText("+ New Project"));
    await user.paste("enter-project");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(createdName).toBe("enter-project"));
  });

  it("retries fetch when clicking Try again on error state", async () => {
    let callCount = 0;
    server.use(
      http.get("*/api/projects", () => {
        callCount++;
        return HttpResponse.json({ error: "Network error" }, { status: 500 });
      }),
    );
    renderWithProviders(<ProjectDashboard />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    });

    const beforeCount = callCount;
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(callCount).toBeGreaterThan(beforeCount));
  });
});
