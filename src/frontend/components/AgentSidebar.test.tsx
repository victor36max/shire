import { screen, waitFor } from "@testing-library/react";
import { describe, it, expect, mock } from "bun:test";
import { http, HttpResponse } from "msw";
import { server } from "../test/msw-server";
import AgentSidebar from "./AgentSidebar";
import { renderWithProviders } from "../test/test-utils";

const routeOpts = {
  route: "/projects/test-project",
  routePath: "/projects/:projectName",
};

const defaultProps = {
  onNewAgent: mock(() => {}),
  onBrowseCatalog: mock(() => {}),
};

function setVersionResponse(response: {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  upgradeCommand: string;
}) {
  server.use(http.get("*/api/version", () => HttpResponse.json(response)));
}

describe("VersionFooter", () => {
  it("shows current version in the sidebar", async () => {
    setVersionResponse({
      current: "1.0.20",
      latest: null,
      updateAvailable: false,
      upgradeCommand: "npm install -g agents-shire@latest",
    });
    renderWithProviders(<AgentSidebar {...defaultProps} />, routeOpts);

    await waitFor(() => {
      expect(screen.getByText("v1.0.20")).toBeInTheDocument();
    });
  });

  it("shows upgrade indicator when update is available", async () => {
    setVersionResponse({
      current: "1.0.20",
      latest: "1.0.22",
      updateAvailable: true,
      upgradeCommand: "npm install -g agents-shire@latest",
    });
    renderWithProviders(<AgentSidebar {...defaultProps} />, routeOpts);

    await waitFor(() => {
      expect(screen.getByText("v1.0.20")).toBeInTheDocument();
    });
    expect(screen.getByText(/v1\.0\.22/)).toBeInTheDocument();
  });

  it("does not show upgrade indicator when no update available", async () => {
    setVersionResponse({
      current: "1.0.22",
      latest: "1.0.22",
      updateAvailable: false,
      upgradeCommand: "npm install -g agents-shire@latest",
    });
    renderWithProviders(<AgentSidebar {...defaultProps} />, routeOpts);

    await waitFor(() => {
      expect(screen.getByText("v1.0.22")).toBeInTheDocument();
    });
    // Only one version element should exist (the current version)
    expect(screen.queryByTitle("npm install -g agents-shire@latest")).not.toBeInTheDocument();
  });
});
