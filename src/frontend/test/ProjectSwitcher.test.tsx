import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "bun:test";
import ProjectSwitcher from "../components/ProjectSwitcher";
import type { Project } from "../components/types";
import { renderWithProviders } from "./test-utils";

const projects: Project[] = [
  { id: "p1", name: "test-project", status: "running" },
  { id: "p2", name: "other-project", status: "running" },
];

describe("ProjectSwitcher", () => {
  it("renders with current project selected", () => {
    renderWithProviders(<ProjectSwitcher projects={projects} currentProjectName="test-project" />);
    expect(screen.getByText("test-project")).toBeInTheDocument();
  });

  it("renders as a select trigger", () => {
    renderWithProviders(<ProjectSwitcher projects={projects} currentProjectName="test-project" />);
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("navigates to other project on select change", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProjectSwitcher projects={projects} currentProjectName="test-project" />);
    await user.click(screen.getByRole("combobox"));
    await waitFor(() => {
      expect(screen.getByText("other-project")).toBeInTheDocument();
    });
    await user.click(screen.getByText("other-project"));
  });

  it("navigates to home when All Projects is selected", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProjectSwitcher projects={projects} currentProjectName="test-project" />);
    await user.click(screen.getByRole("combobox"));
    await waitFor(() => {
      expect(screen.getByText("All Projects")).toBeInTheDocument();
    });
    await user.click(screen.getByText("All Projects"));
  });
});
