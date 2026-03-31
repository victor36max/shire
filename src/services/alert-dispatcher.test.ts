import { describe, it, expect, beforeEach, mock, afterEach } from "bun:test";
import { useTestDb } from "../test/setup";
import * as projects from "./projects";
import * as alertChannels from "./alert-channels";
import { dispatchAlert, sendTestAlert } from "./alert-dispatcher";
import type { AlertChannelConfig } from "../db/schema";

describe("alert-dispatcher", () => {
  useTestDb();

  let projectId: string;
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof mock>;

  beforeEach(() => {
    const project = projects.createProject("dispatch-project");
    projectId = project.id;

    fetchMock = mock(() => Promise.resolve(new Response("ok", { status: 200 })));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("dispatchAlert", () => {
    it("does nothing when no channel is configured", async () => {
      await dispatchAlert(projectId, {
        title: "Test",
        body: "Test body",
        severity: "info",
        agentName: "agent-1",
        projectName: "test-project",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("does nothing when channel is disabled", async () => {
      alertChannels.upsertAlertChannel(projectId, {
        config: { type: "discord", webhookUrl: "https://discord.com/api/webhooks/123/abc" },
        enabled: false,
      });
      await dispatchAlert(projectId, {
        title: "Test",
        body: "Test body",
        severity: "info",
        agentName: "agent-1",
        projectName: "test-project",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("sends to discord webhook with embeds", async () => {
      alertChannels.upsertAlertChannel(projectId, {
        config: { type: "discord", webhookUrl: "https://discord.com/api/webhooks/123/abc" },
      });
      await dispatchAlert(projectId, {
        title: "Build failed",
        body: "Exit code 1",
        severity: "error",
        agentName: "ci-agent",
        projectName: "my-project",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, opts] = (fetchMock as ReturnType<typeof mock>).mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(url).toBe("https://discord.com/api/webhooks/123/abc");
      const body = JSON.parse(opts.body as string) as Record<string, unknown>;
      expect(body).toHaveProperty("embeds");
    });

    it("sends to slack webhook with blocks", async () => {
      alertChannels.upsertAlertChannel(projectId, {
        config: { type: "slack", webhookUrl: "https://hooks.slack.com/services/T00/B00/xxx" },
      });
      await dispatchAlert(projectId, {
        title: "Deploy complete",
        body: "Staging updated",
        severity: "success",
        agentName: "deploy-agent",
        projectName: "my-project",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, opts] = (fetchMock as ReturnType<typeof mock>).mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(url).toBe("https://hooks.slack.com/services/T00/B00/xxx");
      const body = JSON.parse(opts.body as string) as Record<string, unknown>;
      expect(body).toHaveProperty("blocks");
    });

    it("sends to telegram API with correct URL", async () => {
      alertChannels.upsertAlertChannel(projectId, {
        config: { type: "telegram", botToken: "123456:ABC-DEF", chatId: "-1001234567890" },
      });
      await dispatchAlert(projectId, {
        title: "Alert",
        body: "Something happened",
        severity: "warning",
        agentName: "monitor",
        projectName: "my-project",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, opts] = (fetchMock as ReturnType<typeof mock>).mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(url).toBe("https://api.telegram.org/bot123456:ABC-DEF/sendMessage");
      const body = JSON.parse(opts.body as string) as Record<string, unknown>;
      expect(body.chat_id).toBe("-1001234567890");
      expect(body.parse_mode).toBe("MarkdownV2");
    });

    it("does not throw when webhook fails", async () => {
      alertChannels.upsertAlertChannel(projectId, {
        config: { type: "discord", webhookUrl: "https://discord.com/api/webhooks/123/abc" },
      });
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response("error", { status: 500 })),
      ) as unknown as typeof fetch;
      await expect(
        dispatchAlert(projectId, {
          title: "Test",
          body: "Test body",
          severity: "error",
          agentName: "agent",
          projectName: "project",
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("sendTestAlert", () => {
    it("returns ok on success", async () => {
      const config: AlertChannelConfig = {
        type: "discord",
        webhookUrl: "https://discord.com/api/webhooks/123/abc",
      };
      const result = await sendTestAlert(config);
      expect(result.ok).toBe(true);
    });

    it("returns error on failure", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response("bad request", { status: 400 })),
      ) as unknown as typeof fetch;
      const config: AlertChannelConfig = {
        type: "discord",
        webhookUrl: "https://discord.com/api/webhooks/123/abc",
      };
      const result = await sendTestAlert(config);
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
