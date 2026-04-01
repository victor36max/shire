import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "bun:test";
import { http, HttpResponse } from "msw";
import { server } from "./msw-server";
import ProjectDetailsPage from "../components/ProjectDetailsPage";
import { renderWithProviders } from "./test-utils";

const routeOpts = {
  route: "/projects/test-project/details",
  routePath: "/projects/:projectName/details",
};

/** Override the project-doc endpoint to return specific content */
function setProjectDoc(content: string) {
  server.use(
    http.get("*/api/projects/:id/settings/project-doc", () => HttpResponse.json({ content })),
  );
}

describe("ProjectDetailsPage", () => {
  it("renders with Project Details heading", async () => {
    renderWithProviders(<ProjectDetailsPage />, routeOpts);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Project Details" })).toBeInTheDocument();
    });
  });

  it("renders back button", async () => {
    renderWithProviders(<ProjectDetailsPage />, routeOpts);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    });
  });

  it("shows project name in input", async () => {
    renderWithProviders(<ProjectDetailsPage />, routeOpts);
    await waitFor(() => {
      const input = screen.getByLabelText("Project Name");
      expect(input).toHaveValue("test-project");
    });
  });

  it("shows Rename button disabled when name is unchanged", async () => {
    renderWithProviders(<ProjectDetailsPage />, routeOpts);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled();
    });
  });

  it("enables Rename button after changing name", async () => {
    renderWithProviders(<ProjectDetailsPage />, routeOpts);
    await waitFor(() => {
      expect(screen.getByLabelText("Project Name")).toBeInTheDocument();
    });
    const input = screen.getByLabelText("Project Name");
    await userEvent.clear(input);
    await userEvent.type(input, "new-name");
    expect(screen.getByRole("button", { name: "Rename" })).toBeEnabled();
  });

  it("sends rename request with new name on Rename click", async () => {
    let renamedTo: string | undefined;
    server.use(
      http.patch("*/api/projects/:id", async ({ request }) => {
        const body = (await request.json()) as { name: string };
        renamedTo = body.name;
        return HttpResponse.json({ ok: true });
      }),
    );

    renderWithProviders(<ProjectDetailsPage />, routeOpts);
    await waitFor(() => {
      expect(screen.getByLabelText("Project Name")).toBeInTheDocument();
    });
    const input = screen.getByLabelText("Project Name");
    await userEvent.clear(input);
    await userEvent.type(input, "new-name");
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));

    await waitFor(() => expect(renamedTo).toBe("new-name"));
  });

  it("disables Rename button when slug is invalid", async () => {
    renderWithProviders(<ProjectDetailsPage />, routeOpts);
    await waitFor(() => {
      expect(screen.getByLabelText("Project Name")).toBeInTheDocument();
    });
    const input = screen.getByLabelText("Project Name");
    await userEvent.clear(input);
    await userEvent.type(input, "INVALID NAME!");
    expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled();
    expect(screen.getByText(/invalid name/i)).toBeInTheDocument();
  });

  it("shows PROJECT.md content in textarea", async () => {
    setProjectDoc("# My Project\n\nSome content here.");
    renderWithProviders(<ProjectDetailsPage />, routeOpts);
    await waitFor(() => {
      const textarea = screen.getByLabelText("PROJECT.md");
      expect(textarea).toHaveValue("# My Project\n\nSome content here.");
    });
  });

  it("shows Save Document button disabled when doc is unchanged", async () => {
    renderWithProviders(<ProjectDetailsPage />, routeOpts);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save Document" })).toBeDisabled();
    });
  });

  it("enables Save Document button after editing", async () => {
    renderWithProviders(<ProjectDetailsPage />, routeOpts);
    await waitFor(() => {
      expect(screen.getByLabelText("PROJECT.md")).toBeInTheDocument();
    });
    const textarea = screen.getByLabelText("PROJECT.md");
    await userEvent.type(textarea, " updated");
    expect(screen.getByRole("button", { name: "Save Document" })).toBeEnabled();
  });

  it("sends save request with new content on Save Document click", async () => {
    let savedContent: string | undefined;
    server.use(
      http.put("*/api/projects/:id/settings/project-doc", async ({ request }) => {
        const body = (await request.json()) as { content: string };
        savedContent = body.content;
        return HttpResponse.json({ ok: true });
      }),
    );

    renderWithProviders(<ProjectDetailsPage />, routeOpts);
    await waitFor(() => {
      expect(screen.getByLabelText("PROJECT.md")).toBeInTheDocument();
    });
    const textarea = screen.getByLabelText("PROJECT.md");
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "new content");
    await userEvent.click(screen.getByRole("button", { name: "Save Document" }));

    await waitFor(() => expect(savedContent).toBe("new content"));
  });
});
