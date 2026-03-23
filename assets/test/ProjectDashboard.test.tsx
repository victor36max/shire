import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import ProjectDashboard from "../react-components/ProjectDashboard";
import type { Project } from "../react-components/types";

const projects: Project[] = [
  { id: "p1", name: "test-project", status: "running" },
  { id: "p2", name: "other-project", status: "running" },
];

describe("ProjectDashboard", () => {
  it("renders Projects heading", () => {
    render(<ProjectDashboard projects={projects} pushEvent={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument();
  });

  it("renders project cards", () => {
    render(<ProjectDashboard projects={projects} pushEvent={vi.fn()} />);
    expect(screen.getByText("test-project")).toBeInTheDocument();
    expect(screen.getByText("other-project")).toBeInTheDocument();
  });

  it("shows empty state when no projects", () => {
    render(<ProjectDashboard projects={[]} pushEvent={vi.fn()} />);
    expect(screen.getByText("No projects yet")).toBeInTheDocument();
    expect(screen.getByText("Create Your First Project")).toBeInTheDocument();
  });

  it("shows status badges on project cards", () => {
    const mixedProjects: Project[] = [
      { id: "p3", name: "running-project", status: "running" },
      { id: "p4", name: "error-project", status: "error" },
    ];
    render(<ProjectDashboard projects={mixedProjects} pushEvent={vi.fn()} />);
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("shows idle and unreachable status badges", () => {
    const vmProjects: Project[] = [
      { id: "p9", name: "idle-project", status: "idle" },
      { id: "p10", name: "unreachable-project", status: "unreachable" },
    ];
    render(<ProjectDashboard projects={vmProjects} pushEvent={vi.fn()} />);
    expect(screen.getByText("idle")).toBeInTheDocument();
    expect(screen.getByText("unreachable")).toBeInTheDocument();
  });

  it("shows Restart option in menu for unreachable projects", async () => {
    const unreachableProjects: Project[] = [{ id: "p11", name: "unreachable-proj", status: "unreachable" }];
    render(<ProjectDashboard projects={unreachableProjects} pushEvent={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /actions/ }));
    expect(screen.getByText("Restart")).toBeInTheDocument();
  });

  it("does not show Restart option for idle projects", async () => {
    const idleProjects: Project[] = [{ id: "p12", name: "idle-proj", status: "idle" }];
    render(<ProjectDashboard projects={idleProjects} pushEvent={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /actions/ }));
    expect(screen.queryByText("Restart")).not.toBeInTheDocument();
  });

  it("opens create dialog when clicking + New Project", async () => {
    render(<ProjectDashboard projects={projects} pushEvent={vi.fn()} />);
    await userEvent.click(screen.getByText("+ New Project"));
    expect(screen.getByText("Create a new project with its own isolated VM.")).toBeInTheDocument();
  });

  it("creates a project via dialog", async () => {
    const user = userEvent.setup();
    const pushEvent = vi.fn();
    render(<ProjectDashboard projects={projects} pushEvent={pushEvent} />);

    await user.click(screen.getByText("+ New Project"));
    await user.paste("my-new-project");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(pushEvent).toHaveBeenCalledWith("create-project", { name: "my-new-project" });
  });

  it("shows validation error for invalid project name", async () => {
    const user = userEvent.setup();
    render(<ProjectDashboard projects={projects} pushEvent={vi.fn()} />);

    await user.click(screen.getByText("+ New Project"));
    await user.paste("INVALID NAME!");

    expect(
      screen.getByText("Use lowercase letters, numbers, and hyphens only. Must start and end with a letter or number."),
    ).toBeInTheDocument();
  });

  it("shows delete confirmation when clicking Delete in card menu", async () => {
    render(<ProjectDashboard projects={projects} pushEvent={vi.fn()} />);
    // Open the first card's dropdown menu
    const menuButtons = screen.getAllByRole("button", { name: /actions/ });
    await userEvent.click(menuButtons[0]);
    await userEvent.click(screen.getByText("Delete"));
    expect(screen.getByText(/destroy the VM and all its data/)).toBeInTheDocument();
  });

  it("calls pushEvent with delete-project after confirming", async () => {
    const pushEvent = vi.fn();
    render(<ProjectDashboard projects={projects} pushEvent={pushEvent} />);

    // Open the first card's dropdown menu and click Delete
    const menuButtons = screen.getAllByRole("button", { name: /actions/ });
    await userEvent.click(menuButtons[0]);
    await userEvent.click(screen.getByText("Delete"));

    // Confirm in alert dialog
    const confirmDelete = screen.getAllByText("Delete").find((el) => el.closest("[role='alertdialog']"));
    await userEvent.click(confirmDelete!);

    expect(pushEvent).toHaveBeenCalledWith("delete-project", { id: "p1" });
  });

  it("shows Restart option in menu for stopped projects", async () => {
    const stoppedProjects: Project[] = [{ id: "p5", name: "stopped-proj", status: "stopped" }];
    render(<ProjectDashboard projects={stoppedProjects} pushEvent={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /actions/ }));
    expect(screen.getByText("Restart")).toBeInTheDocument();
  });

  it("shows Restart option in menu for error projects", async () => {
    const errorProjects: Project[] = [{ id: "p6", name: "error-proj", status: "error" }];
    render(<ProjectDashboard projects={errorProjects} pushEvent={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /actions/ }));
    expect(screen.getByText("Restart")).toBeInTheDocument();
  });

  it("does not show Restart option for running projects", async () => {
    render(<ProjectDashboard projects={projects} pushEvent={vi.fn()} />);
    const menuButtons = screen.getAllByRole("button", { name: /actions/ });
    await userEvent.click(menuButtons[0]);
    expect(screen.queryByText("Restart")).not.toBeInTheDocument();
  });

  it("calls pushEvent with restart-project when clicking Restart in menu", async () => {
    const pushEvent = vi.fn();
    const stoppedProjects: Project[] = [{ id: "p7", name: "restart-me", status: "stopped" }];
    render(<ProjectDashboard projects={stoppedProjects} pushEvent={pushEvent} />);

    await userEvent.click(screen.getByRole("button", { name: /actions/ }));
    await userEvent.click(screen.getByText("Restart"));
    expect(pushEvent).toHaveBeenCalledWith("restart-project", { id: "p7" });
  });

  it("shows Restarting... text while restart is in progress", async () => {
    const pushEvent = vi.fn();
    const stoppedProjects: Project[] = [{ id: "p8", name: "restarting-proj", status: "stopped" }];
    render(<ProjectDashboard projects={stoppedProjects} pushEvent={pushEvent} />);

    await userEvent.click(screen.getByRole("button", { name: /actions/ }));
    await userEvent.click(screen.getByText("Restart"));
    // Reopen menu to check the text
    await userEvent.click(screen.getByRole("button", { name: /actions/ }));
    expect(screen.getByText("Restarting...")).toBeInTheDocument();
  });
});
