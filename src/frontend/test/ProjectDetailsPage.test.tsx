import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, mock } from "bun:test";
import ProjectDetailsPage from "../components/ProjectDetailsPage";
import { renderWithProviders } from "./test-utils";
import * as actualHooks from "../lib/hooks";

const renameMutate = mock(() => {});
const saveDocMutate = mock(() => {});

let mockProjectDoc = "# My Project\n\nSome content here.";

mock.module("../lib/hooks", () => ({
  ...actualHooks,
  useProjectId: () => ({ projectId: "p1", projectName: "test-project" }),
  useProjectDoc: () => ({ data: { content: mockProjectDoc }, isLoading: false }),
  useRenameProject: () => ({ mutate: renameMutate, isPending: false }),
  useSaveProjectDoc: () => ({ mutate: saveDocMutate, isPending: false }),
}));

describe("ProjectDetailsPage", () => {
  beforeEach(() => {
    mockProjectDoc = "# My Project\n\nSome content here.";
    renameMutate.mockClear();
    saveDocMutate.mockClear();
  });

  it("renders with Project Details heading", () => {
    renderWithProviders(<ProjectDetailsPage />);
    expect(screen.getByRole("heading", { name: "Project Details" })).toBeInTheDocument();
  });

  it("renders back button", () => {
    renderWithProviders(<ProjectDetailsPage />);
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });

  it("shows project name in input", () => {
    renderWithProviders(<ProjectDetailsPage />);
    const input = screen.getByLabelText("Project Name");
    expect(input).toHaveValue("test-project");
  });

  it("shows Rename button disabled when name is unchanged", () => {
    renderWithProviders(<ProjectDetailsPage />);
    expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled();
  });

  it("enables Rename button after changing name", async () => {
    renderWithProviders(<ProjectDetailsPage />);
    const input = screen.getByLabelText("Project Name");
    await userEvent.clear(input);
    await userEvent.type(input, "new-name");
    expect(screen.getByRole("button", { name: "Rename" })).toBeEnabled();
  });

  it("calls renameProject.mutate with new name on Rename click", async () => {
    renderWithProviders(<ProjectDetailsPage />);
    const input = screen.getByLabelText("Project Name");
    await userEvent.clear(input);
    await userEvent.type(input, "new-name");
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(renameMutate).toHaveBeenCalledWith("new-name");
  });

  it("disables Rename button when slug is invalid", async () => {
    renderWithProviders(<ProjectDetailsPage />);
    const input = screen.getByLabelText("Project Name");
    await userEvent.clear(input);
    await userEvent.type(input, "INVALID NAME!");
    expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled();
    expect(screen.getByText(/invalid name/i)).toBeInTheDocument();
  });

  it("shows PROJECT.md content in textarea", () => {
    renderWithProviders(<ProjectDetailsPage />);
    const textarea = screen.getByLabelText("PROJECT.md");
    expect(textarea).toHaveValue("# My Project\n\nSome content here.");
  });

  it("shows Save Document button disabled when doc is unchanged", () => {
    renderWithProviders(<ProjectDetailsPage />);
    expect(screen.getByRole("button", { name: "Save Document" })).toBeDisabled();
  });

  it("enables Save Document button after editing", async () => {
    renderWithProviders(<ProjectDetailsPage />);
    const textarea = screen.getByLabelText("PROJECT.md");
    await userEvent.type(textarea, " updated");
    expect(screen.getByRole("button", { name: "Save Document" })).toBeEnabled();
  });

  it("calls saveDoc.mutate with new content on Save Document click", async () => {
    renderWithProviders(<ProjectDetailsPage />);
    const textarea = screen.getByLabelText("PROJECT.md");
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "new content");
    await userEvent.click(screen.getByRole("button", { name: "Save Document" }));
    expect(saveDocMutate).toHaveBeenCalledWith("new content");
  });
});
