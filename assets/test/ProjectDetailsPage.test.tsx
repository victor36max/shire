import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import ProjectDetailsPage from "../react-components/ProjectDetailsPage";

const defaultProps = {
  project: { id: "p1", name: "test-project" },
  project_doc: "# My Project\n\nSome content here.",
  pushEvent: vi.fn(),
};

describe("ProjectDetailsPage", () => {
  it("renders with Project Details heading", () => {
    render(<ProjectDetailsPage {...defaultProps} />);
    expect(screen.getByRole("heading", { name: "Project Details" })).toBeInTheDocument();
  });

  it("renders back button", () => {
    render(<ProjectDetailsPage {...defaultProps} />);
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });

  it("shows project name in input", () => {
    render(<ProjectDetailsPage {...defaultProps} />);
    const input = screen.getByLabelText("Project Name");
    expect(input).toHaveValue("test-project");
  });

  it("shows Rename button disabled when name is unchanged", () => {
    render(<ProjectDetailsPage {...defaultProps} />);
    expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled();
  });

  it("enables Rename button after changing name", async () => {
    render(<ProjectDetailsPage {...defaultProps} />);
    const input = screen.getByLabelText("Project Name");
    await userEvent.clear(input);
    await userEvent.type(input, "new-name");
    expect(screen.getByRole("button", { name: "Rename" })).toBeEnabled();
  });

  it("calls pushEvent with rename-project on Rename click", async () => {
    const pushEvent = vi.fn();
    render(<ProjectDetailsPage {...defaultProps} pushEvent={pushEvent} />);
    const input = screen.getByLabelText("Project Name");
    await userEvent.clear(input);
    await userEvent.type(input, "new-name");
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(pushEvent).toHaveBeenCalledWith("rename-project", { name: "new-name" });
  });

  it("disables Rename button when slug is invalid", async () => {
    render(<ProjectDetailsPage {...defaultProps} />);
    const input = screen.getByLabelText("Project Name");
    await userEvent.clear(input);
    await userEvent.type(input, "INVALID NAME!");
    expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled();
    expect(screen.getByText(/invalid name/i)).toBeInTheDocument();
  });

  it("shows PROJECT.md content in textarea", () => {
    render(<ProjectDetailsPage {...defaultProps} />);
    const textarea = screen.getByLabelText("PROJECT.md");
    expect(textarea).toHaveValue("# My Project\n\nSome content here.");
  });

  it("shows Save Document button disabled when doc is unchanged", () => {
    render(<ProjectDetailsPage {...defaultProps} />);
    expect(screen.getByRole("button", { name: "Save Document" })).toBeDisabled();
  });

  it("enables Save Document button after editing", async () => {
    render(<ProjectDetailsPage {...defaultProps} />);
    const textarea = screen.getByLabelText("PROJECT.md");
    await userEvent.type(textarea, " updated");
    expect(screen.getByRole("button", { name: "Save Document" })).toBeEnabled();
  });

  it("calls pushEvent with save-project-doc on Save Document click", async () => {
    const pushEvent = vi.fn();
    render(<ProjectDetailsPage {...defaultProps} pushEvent={pushEvent} />);
    const textarea = screen.getByLabelText("PROJECT.md");
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "new content");
    await userEvent.click(screen.getByRole("button", { name: "Save Document" }));
    expect(pushEvent).toHaveBeenCalledWith("save-project-doc", { content: "new content" });
  });

  it("syncs name when project prop changes", () => {
    const { rerender } = render(<ProjectDetailsPage {...defaultProps} />);
    rerender(<ProjectDetailsPage {...defaultProps} project={{ id: "p1", name: "renamed" }} />);
    expect(screen.getByLabelText("Project Name")).toHaveValue("renamed");
  });

  it("syncs doc when project_doc prop changes", () => {
    const { rerender } = render(<ProjectDetailsPage {...defaultProps} />);
    rerender(<ProjectDetailsPage {...defaultProps} project_doc="updated doc" />);
    expect(screen.getByLabelText("PROJECT.md")).toHaveValue("updated doc");
  });
});
