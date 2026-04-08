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

describe("VersionFooter", () => {
  it("shows current version in the sidebar", async () => {
    renderWithProviders(<AgentSidebar {...defaultProps} />, routeOpts);

    await waitFor(() => {
      expect(screen.getByText(/^v\d/)).toBeInTheDocument();
    });
  });

  it("shows upgrade button when update is available", async () => {
    server.use(
      http.get("*/api/version", () =>
        HttpResponse.json({
          current: "1.0.20",
          latest: "1.0.22",
          updateAvailable: true,
          upgradeCommands: [
            "npm install -g agents-shire@latest",
            "bun install -g agents-shire@latest",
          ],
        }),
      ),
    );
    renderWithProviders(<AgentSidebar {...defaultProps} />, routeOpts);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Update Available/ })).toBeInTheDocument();
    });
  });

  it("does not show upgrade button when no update available", async () => {
    renderWithProviders(<AgentSidebar {...defaultProps} />, routeOpts);

    await waitFor(() => {
      expect(screen.getByText(/^v\d/)).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /Update Available/ })).not.toBeInTheDocument();
  });
});
