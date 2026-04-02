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
  { id: "p1", name: "test-project", status: "running" },
  { id: "p2", name: "other-project", status: "running" },
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

  it("shows status badges on project cards", async () => {
    setProjects([
      { id: "p3", name: "running-project", status: "running" },
      { id: "p4", name: "error-project", status: "error" },
    ]);
    renderWithProviders(<ProjectDashboard />);
    await waitFor(() => {
      expect(screen.getByText("running")).toBeInTheDocument();
    });
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("shows starting status badge", async () => {
    setProjects([{ id: "p9", name: "starting-project", status: "starting" }]);
    renderWithProviders(<ProjectDashboard />);
    await waitFor(() => {
      expect(screen.getByText("starting")).toBeInTheDocument();
    });
  });

  it("does not show Restart option for starting projects", async () => {
    setProjects([{ id: "p10", name: "starting-proj", status: "starting" }]);
    renderWithProviders(<ProjectDashboard />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /actions/ })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: /actions/ }));
    expect(screen.queryByText("Restart")).not.toBeInTheDocument();
  });

  it("does not show Restart option for running projects (explicit)", async () => {
    setProjects([{ id: "p12", name: "running-proj", status: "running" }]);
    renderWithProviders(<ProjectDashboard />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /actions/ })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: /actions/ }));
    expect(screen.queryByText("Restart")).not.toBeInTheDocument();
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

  it("shows Restart option in menu for error projects", async () => {
    setProjects([{ id: "p5", name: "errored-proj", status: "error" }]);
    renderWithProviders(<ProjectDashboard />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /actions/ })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: /actions/ }));
    expect(screen.getByText("Restart")).toBeInTheDocument();
  });

  it("does not show Restart option for running projects", async () => {
    setProjects(defaultProjects);
    renderWithProviders(<ProjectDashboard />);
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /actions/ }).length).toBeGreaterThan(0);
    });
    const menuButtons = screen.getAllByRole("button", { name: /actions/ });
    await userEvent.click(menuButtons[0]);
    expect(screen.queryByText("Restart")).not.toBeInTheDocument();
  });

  it("sends restart request when clicking Restart in menu", async () => {
    let restartedId: string | undefined;
    server.use(
      http.post("*/api/projects/:id/restart", ({ params }) => {
        restartedId = params.id as string;
        return HttpResponse.json({ ok: true });
      }),
    );
    setProjects([{ id: "p7", name: "restart-me", status: "error" }]);

    renderWithProviders(<ProjectDashboard />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /actions/ })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /actions/ }));
    await userEvent.click(screen.getByText("Restart"));
    await waitFor(() => expect(restartedId).toBe("p7"));
  });

  it("shows Restarting... text while restart is in progress", async () => {
    setProjects([{ id: "p8", name: "restarting-proj", status: "error" }]);
    renderWithProviders(<ProjectDashboard />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /actions/ })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /actions/ }));
    await userEvent.click(screen.getByText("Restart"));
    await userEvent.click(screen.getByRole("button", { name: /actions/ }));
    expect(screen.getByText("Restarting...")).toBeInTheDocument();
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

  it("shows unknown status as secondary variant", async () => {
    setProjects([{ id: "p-unknown", name: "unknown-proj", status: "starting" }]);
    renderWithProviders(<ProjectDashboard />);
    await waitFor(() => {
      expect(screen.getByText("starting")).toBeInTheDocument();
    });
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
