import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, mock } from "bun:test";
import { http, HttpResponse } from "msw";
import { server } from "./msw-server";
import { renderWithProviders } from "./test-utils";
import type { AgentOverview, Project } from "../components/types";

mock.module("../lib/ws", () => ({
  useSubscription: mock(() => {}),
}));

import ProjectLayout from "../components/ProjectLayout";

const projects: Project[] = [{ id: "p1", name: "test-project", status: "running" }];
const agents: AgentOverview[] = [
  { id: "a1", name: "test-agent", status: "active", busy: false, unreadCount: 0 },
];

function setProjects() {
  server.use(http.get("*/api/projects", () => HttpResponse.json(projects)));
}

function setAgents(agentList: AgentOverview[] = agents) {
  server.use(http.get("*/api/projects/:id/agents", () => HttpResponse.json(agentList)));
}

const routeOpts = {
  route: "/projects/test-project",
  routePath: "/projects/:projectName",
};

describe("ProjectLayout", () => {
  it("renders sidebar with agents heading", async () => {
    setProjects();
    setAgents();
    renderWithProviders(<ProjectLayout />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("Agents")).toBeInTheDocument();
    });
  });

  it("renders + New Agent button in sidebar", async () => {
    setProjects();
    setAgents();
    renderWithProviders(<ProjectLayout />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("+ New Agent")).toBeInTheDocument();
    });
  });

  it("opens agent form dialog when clicking New Agent", async () => {
    setProjects();
    setAgents();
    renderWithProviders(<ProjectLayout />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("+ New Agent")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText("+ New Agent"));
    expect(screen.getByText("New Agent")).toBeInTheDocument();
  });

  it("opens catalog browser when clicking Browse Catalog", async () => {
    setProjects();
    setAgents();
    server.use(
      http.get("*/api/catalog/agents", () => HttpResponse.json([])),
      http.get("*/api/catalog/categories", () => HttpResponse.json([])),
    );
    renderWithProviders(<ProjectLayout />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText("Browse Catalog")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText("Browse Catalog"));
    await waitFor(() => {
      expect(screen.getByText("Agent Catalog")).toBeInTheDocument();
    });
  });

  it("shows spinner when projectId is not resolved", async () => {
    server.use(http.get("*/api/projects", () => HttpResponse.json([])));
    renderWithProviders(<ProjectLayout />, {
      route: "/projects/nonexistent-project",
      routePath: "/projects/:projectName",
    });
    // Should show spinner while waiting for project resolution
    await waitFor(() => {
      const spinner = document.querySelector(".animate-spin");
      expect(spinner).toBeTruthy();
    });
  });

  it("sends create-agent request when form is saved for new agent", async () => {
    let createdBody: Record<string, unknown> | undefined;
    server.use(
      http.post("*/api/projects/:id/agents", async ({ request }) => {
        createdBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "a-new" }, { status: 201 });
      }),
    );
    setProjects();
    setAgents([]);
    const user = userEvent.setup();
    renderWithProviders(<ProjectLayout />, routeOpts);

    await waitFor(() => {
      expect(screen.getByText("+ New Agent")).toBeInTheDocument();
    });
    await user.click(screen.getByText("+ New Agent"));

    const nameInput = screen.getByLabelText("Name");
    await user.type(nameInput, "new-agent");
    await user.click(screen.getByText("Save Agent"));

    await waitFor(() => {
      expect(createdBody).toBeDefined();
      expect(createdBody!.name).toBe("new-agent");
    });
  });
});
