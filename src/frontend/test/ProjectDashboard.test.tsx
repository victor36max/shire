import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, mock } from "bun:test";
import ProjectDashboard from "../components/ProjectDashboard";
import type { Project } from "../components/types";
import { renderWithProviders } from "./test-utils";
import * as actualHooks from "../hooks";

const createMutate = mock(() => {});
const deleteMutate = mock(() => {});
const restartMutate = mock(() => {});

let mockProjects: Project[] = [];
let mockProjectsError: {
  isError: boolean;
  error: Error | null;
  refetch: ReturnType<typeof mock>;
} = { isError: false, error: null, refetch: mock(() => {}) };

mock.module("../hooks", () => ({
  ...actualHooks,
  useProjects: () => ({
    data: mockProjects,
    isLoading: false,
    ...mockProjectsError,
  }),
  useCreateProject: () => ({ mutate: createMutate, isPending: false }),
  useDeleteProject: () => ({ mutate: deleteMutate, isPending: false }),
  useRestartProject: () => ({ mutate: restartMutate, isPending: false }),
}));

mock.module("../lib/ws", () => ({
  useSubscription: mock(() => {}),
}));

const defaultProjects: Project[] = [
  { id: "p1", name: "test-project", status: "running" },
  { id: "p2", name: "other-project", status: "running" },
];

beforeEach(() => {
  mockProjects = defaultProjects;
  mockProjectsError = { isError: false, error: null, refetch: mock(() => {}) };
  createMutate.mockClear();
  deleteMutate.mockClear();
  restartMutate.mockClear();
});

describe("ProjectDashboard", () => {
  it("renders Projects heading", () => {
    renderWithProviders(<ProjectDashboard />);
    expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument();
  });

  it("renders project cards", () => {
    renderWithProviders(<ProjectDashboard />);
    expect(screen.getByText("test-project")).toBeInTheDocument();
    expect(screen.getByText("other-project")).toBeInTheDocument();
  });

  it("shows empty state when no projects", () => {
    mockProjects = [];
    renderWithProviders(<ProjectDashboard />);
    expect(screen.getByText("No projects yet")).toBeInTheDocument();
    expect(screen.getByText("Create Your First Project")).toBeInTheDocument();
  });

  it("shows status badges on project cards", () => {
    mockProjects = [
      { id: "p3", name: "running-project", status: "running" },
      { id: "p4", name: "error-project", status: "error" },
    ];
    renderWithProviders(<ProjectDashboard />);
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("shows starting status badge", () => {
    mockProjects = [{ id: "p9", name: "starting-project", status: "starting" }];
    renderWithProviders(<ProjectDashboard />);
    expect(screen.getByText("starting")).toBeInTheDocument();
  });

  it("does not show Restart option for starting projects", async () => {
    mockProjects = [{ id: "p10", name: "starting-proj", status: "starting" }];
    renderWithProviders(<ProjectDashboard />);
    await userEvent.click(screen.getByRole("button", { name: /actions/ }));
    expect(screen.queryByText("Restart")).not.toBeInTheDocument();
  });

  it("does not show Restart option for running projects (explicit)", async () => {
    mockProjects = [{ id: "p12", name: "running-proj", status: "running" }];
    renderWithProviders(<ProjectDashboard />);
    await userEvent.click(screen.getByRole("button", { name: /actions/ }));
    expect(screen.queryByText("Restart")).not.toBeInTheDocument();
  });

  it("opens create dialog when clicking + New Project", async () => {
    renderWithProviders(<ProjectDashboard />);
    await userEvent.click(screen.getByText("+ New Project"));
    expect(screen.getByText("Create a new project with its own isolated VM.")).toBeInTheDocument();
  });

  it("creates a project via dialog", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProjectDashboard />);

    await user.click(screen.getByText("+ New Project"));
    await user.paste("my-new-project");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(createMutate).toHaveBeenCalledWith("my-new-project");
  });

  it("shows validation error for invalid project name", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProjectDashboard />);

    await user.click(screen.getByText("+ New Project"));
    await user.paste("INVALID NAME!");

    expect(
      screen.getByText(
        "Use lowercase letters, numbers, and hyphens only. Must start and end with a letter or number.",
      ),
    ).toBeInTheDocument();
  });

  it("shows delete confirmation when clicking Delete in card menu", async () => {
    renderWithProviders(<ProjectDashboard />);
    const menuButtons = screen.getAllByRole("button", { name: /actions/ });
    await userEvent.click(menuButtons[0]);
    await userEvent.click(screen.getByText("Delete"));
    expect(screen.getByText(/destroy the VM and all its data/)).toBeInTheDocument();
  });

  it("calls deleteProject.mutate after confirming", async () => {
    renderWithProviders(<ProjectDashboard />);

    const menuButtons = screen.getAllByRole("button", { name: /actions/ });
    await userEvent.click(menuButtons[0]);
    await userEvent.click(screen.getByText("Delete"));

    const confirmDelete = screen
      .getAllByText("Delete")
      .find((el) => el.closest("[role='alertdialog']"));
    await userEvent.click(confirmDelete!);

    expect(deleteMutate).toHaveBeenCalledWith("p1");
  });

  it("shows Restart option in menu for error projects", async () => {
    mockProjects = [{ id: "p5", name: "errored-proj", status: "error" }];
    renderWithProviders(<ProjectDashboard />);
    await userEvent.click(screen.getByRole("button", { name: /actions/ }));
    expect(screen.getByText("Restart")).toBeInTheDocument();
  });

  it("does not show Restart option for running projects", async () => {
    renderWithProviders(<ProjectDashboard />);
    const menuButtons = screen.getAllByRole("button", { name: /actions/ });
    await userEvent.click(menuButtons[0]);
    expect(screen.queryByText("Restart")).not.toBeInTheDocument();
  });

  it("calls restartProject.mutate when clicking Restart in menu", async () => {
    mockProjects = [{ id: "p7", name: "restart-me", status: "error" }];
    renderWithProviders(<ProjectDashboard />);

    await userEvent.click(screen.getByRole("button", { name: /actions/ }));
    await userEvent.click(screen.getByText("Restart"));
    expect(restartMutate).toHaveBeenCalledWith("p7");
  });

  it("shows Restarting... text while restart is in progress", async () => {
    mockProjects = [{ id: "p8", name: "restarting-proj", status: "error" }];
    renderWithProviders(<ProjectDashboard />);

    await userEvent.click(screen.getByRole("button", { name: /actions/ }));
    await userEvent.click(screen.getByText("Restart"));
    await userEvent.click(screen.getByRole("button", { name: /actions/ }));
    expect(screen.getByText("Restarting...")).toBeInTheDocument();
  });

  it("shows error state with retry when projects query fails", () => {
    mockProjects = [];
    mockProjectsError = {
      isError: true,
      error: new Error("Network error"),
      refetch: mock(() => {}),
    };
    renderWithProviders(<ProjectDashboard />);
    expect(screen.getByText("Network error")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("calls refetch when clicking Try again on error state", async () => {
    const refetchFn = mock(() => {});
    mockProjects = [];
    mockProjectsError = { isError: true, error: new Error("Network error"), refetch: refetchFn };
    renderWithProviders(<ProjectDashboard />);
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(refetchFn).toHaveBeenCalled();
  });
});
