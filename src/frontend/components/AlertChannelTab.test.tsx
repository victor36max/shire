import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, mock } from "bun:test";
import { http, HttpResponse } from "msw";
import { server } from "../test/msw-server";
import AlertChannelTab from "../components/AlertChannelTab";
import { renderWithProviders } from "../test/test-utils";

mock.module("../hooks/ws", () => ({
  useSubscription: mock(() => {}),
}));

const routeOpts = {
  route: "/projects/test-project/settings",
  routePath: "/projects/:projectName/settings",
};

describe("AlertChannelTab", () => {
  it("renders description text", async () => {
    renderWithProviders(<AlertChannelTab projectId="test-project" />, routeOpts);
    await waitFor(() => {
      expect(screen.getByText(/notification channel/i)).toBeInTheDocument();
    });
  });

  it("renders Save button", async () => {
    renderWithProviders(<AlertChannelTab projectId="test-project" />, routeOpts);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
    });
  });

  it("shows webhook URL field for Discord by default", async () => {
    renderWithProviders(<AlertChannelTab projectId="test-project" />, routeOpts);
    await waitFor(() => {
      expect(screen.getByLabelText(/webhook url/i)).toBeInTheDocument();
    });
  });

  it("shows Telegram fields when Telegram is selected", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AlertChannelTab projectId="test-project" />, routeOpts);

    await waitFor(() => {
      expect(screen.getByRole("combobox")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("combobox"));
    await waitFor(() => {
      expect(screen.getByText("Telegram")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Telegram"));

    await waitFor(() => {
      expect(screen.getByLabelText(/bot token/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/chat id/i)).toBeInTheDocument();
    });
  });

  it("shows Send Test and Remove buttons when channel exists", async () => {
    server.use(
      http.get("*/api/projects/*/alert-channel", () =>
        HttpResponse.json({
          channelType: "discord",
          config: { type: "discord", webhookUrl: "https://discord.com/api/webhooks/test" },
          enabled: true,
        }),
      ),
    );
    renderWithProviders(<AlertChannelTab projectId="test-project" />, routeOpts);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /test/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /remove/i })).toBeInTheDocument();
    });
  });

  it("saves a new discord webhook channel", async () => {
    let savedBody: Record<string, unknown> | undefined;
    server.use(
      http.put("*/api/projects/*/alert-channel", async ({ request }) => {
        savedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<AlertChannelTab projectId="test-project" />, routeOpts);

    await waitFor(() => {
      expect(screen.getByLabelText(/webhook url/i)).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/webhook url/i), "https://discord.com/api/webhooks/123");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(savedBody).toBeDefined();
    });
  });

  it("sends test alert when Send Test is clicked", async () => {
    let testCalled = false;
    server.use(
      http.get("*/api/projects/*/alert-channel", () =>
        HttpResponse.json({
          id: "ch1",
          channelType: "discord",
          config: { type: "discord", webhookUrl: "https://discord.com/api/webhooks/test" },
          enabled: true,
        }),
      ),
      http.post("*/api/projects/*/alert-channel/test", () => {
        testCalled = true;
        return HttpResponse.json({ ok: true });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<AlertChannelTab projectId="test-project" />, routeOpts);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /test/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /test/i }));

    await waitFor(() => {
      expect(testCalled).toBe(true);
    });
  });

  it("shows delete confirmation and removes channel", async () => {
    let deleteCalled = false;
    server.use(
      http.get("*/api/projects/*/alert-channel", () =>
        HttpResponse.json({
          id: "ch1",
          channelType: "discord",
          config: { type: "discord", webhookUrl: "https://discord.com/api/webhooks/test" },
          enabled: true,
        }),
      ),
      http.delete("*/api/projects/*/alert-channel", () => {
        deleteCalled = true;
        return HttpResponse.json({ ok: true });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<AlertChannelTab projectId="test-project" />, routeOpts);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /remove/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /remove/i }));

    // Confirm deletion in dialog
    await waitFor(() => {
      expect(screen.getByText("Remove alert channel?")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /^Remove$/ }));

    await waitFor(() => {
      expect(deleteCalled).toBe(true);
    });
  });

  it("loads existing Telegram channel config into form", async () => {
    server.use(
      http.get("*/api/projects/*/alert-channel", () =>
        HttpResponse.json({
          id: "ch1",
          channelType: "telegram",
          config: { type: "telegram", botToken: "tok123", chatId: "-100999" },
          enabled: true,
        }),
      ),
    );
    renderWithProviders(<AlertChannelTab projectId="test-project" />, routeOpts);

    await waitFor(() => {
      expect(screen.getByLabelText(/bot token/i)).toBeInTheDocument();
    });
  });
});
