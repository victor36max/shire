import { screen } from "@testing-library/react";
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
});
