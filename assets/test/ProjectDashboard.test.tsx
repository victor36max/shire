import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import ProjectDashboard from "../react-components/ProjectDashboard";
import type { Project } from "../react-components/types";

const projects: Project[] = [
  { name: "test-project", status: "running" },
  { name: "other-project", status: "running" },
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
    expect(screen.getByText("No projects yet. Create one to get started.")).toBeInTheDocument();
  });

  it("shows status badges on project cards", () => {
    const mixedProjects: Project[] = [
      { name: "running-project", status: "running" },
      { name: "error-project", status: "error" },
    ];
    render(<ProjectDashboard projects={mixedProjects} pushEvent={vi.fn()} />);
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText("error")).toBeInTheDocument();
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

  it("shows delete confirmation when clicking Delete on a project card", async () => {
    render(<ProjectDashboard projects={projects} pushEvent={vi.fn()} />);
    const deleteButtons = screen.getAllByText("Delete");
    await userEvent.click(deleteButtons[0]);
    expect(screen.getByText(/destroy the VM and all its data/)).toBeInTheDocument();
  });

  it("calls pushEvent with delete-project after confirming", async () => {
    const pushEvent = vi.fn();
    render(<ProjectDashboard projects={projects} pushEvent={pushEvent} />);

    // Click Delete on first project card
    const deleteButtons = screen.getAllByText("Delete");
    await userEvent.click(deleteButtons[0]);

    // Confirm in alert dialog
    const confirmDelete = screen.getAllByText("Delete").find((el) => el.closest("[role='alertdialog']"));
    await userEvent.click(confirmDelete!);

    expect(pushEvent).toHaveBeenCalledWith("delete-project", { name: "test-project" });
  });
});
