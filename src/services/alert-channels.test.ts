import { describe, it, expect, beforeEach } from "bun:test";
import { useTestDb } from "../test/setup";
import * as alertChannels from "./alert-channels";
import * as projects from "./projects";

describe("alert-channels service", () => {
  useTestDb();

  let projectId: string;

  beforeEach(() => {
    const project = projects.createProject("alert-project");
    projectId = project.id;
  });

  describe("getAlertChannel", () => {
    it("returns undefined when no channel exists", () => {
      expect(alertChannels.getAlertChannel(projectId)).toBeUndefined();
    });

    it("returns the channel when one exists", () => {
      alertChannels.upsertAlertChannel(projectId, {
        config: { type: "discord", webhookUrl: "https://discord.com/api/webhooks/123/abc" },
      });
      const channel = alertChannels.getAlertChannel(projectId);
      expect(channel).toBeDefined();
      expect(channel!.config.type).toBe("discord");
      expect((channel!.config as { webhookUrl: string }).webhookUrl).toBe(
        "https://discord.com/api/webhooks/123/abc",
      );
    });
  });

  describe("upsertAlertChannel", () => {
    it("creates a new channel", () => {
      const channel = alertChannels.upsertAlertChannel(projectId, {
        config: { type: "slack", webhookUrl: "https://hooks.slack.com/services/T00/B00/xxx" },
      });
      expect(channel.config.type).toBe("slack");
      expect(channel.enabled).toBe(true);
    });

    it("updates an existing channel", () => {
      alertChannels.upsertAlertChannel(projectId, {
        config: { type: "discord", webhookUrl: "https://old-url" },
      });
      const updated = alertChannels.upsertAlertChannel(projectId, {
        config: { type: "slack", webhookUrl: "https://new-url" },
      });
      expect(updated.config.type).toBe("slack");

      // Should still be just one channel
      const channel = alertChannels.getAlertChannel(projectId);
      expect(channel!.id).toBe(updated.id);
    });

    it("creates telegram channel with botToken and chatId", () => {
      const channel = alertChannels.upsertAlertChannel(projectId, {
        config: { type: "telegram", botToken: "123456:ABC-DEF", chatId: "-1001234567890" },
      });
      expect(channel.config.type).toBe("telegram");
      if (channel.config.type === "telegram") {
        expect(channel.config.botToken).toBe("123456:ABC-DEF");
        expect(channel.config.chatId).toBe("-1001234567890");
      }
    });
  });

  describe("deleteAlertChannel", () => {
    it("removes the channel", () => {
      alertChannels.upsertAlertChannel(projectId, {
        config: { type: "discord", webhookUrl: "https://discord.com/api/webhooks/123/abc" },
      });
      alertChannels.deleteAlertChannel(projectId);
      expect(alertChannels.getAlertChannel(projectId)).toBeUndefined();
    });

    it("does nothing when no channel exists", () => {
      expect(() => alertChannels.deleteAlertChannel(projectId)).not.toThrow();
    });
  });

  describe("hasAlertChannel", () => {
    it("returns false when no channel exists", () => {
      expect(alertChannels.hasAlertChannel(projectId)).toBe(false);
    });

    it("returns true when an enabled channel exists", () => {
      alertChannels.upsertAlertChannel(projectId, {
        config: { type: "discord", webhookUrl: "https://discord.com/api/webhooks/123/abc" },
        enabled: true,
      });
      expect(alertChannels.hasAlertChannel(projectId)).toBe(true);
    });

    it("returns false when channel is disabled", () => {
      alertChannels.upsertAlertChannel(projectId, {
        config: { type: "discord", webhookUrl: "https://discord.com/api/webhooks/123/abc" },
        enabled: false,
      });
      expect(alertChannels.hasAlertChannel(projectId)).toBe(false);
    });
  });

  describe("cascade delete", () => {
    it("deletes channel when project is deleted", () => {
      alertChannels.upsertAlertChannel(projectId, {
        config: { type: "discord", webhookUrl: "https://discord.com/api/webhooks/123/abc" },
      });
      projects.deleteProject(projectId);
      expect(alertChannels.getAlertChannel(projectId)).toBeUndefined();
    });
  });
});
