import type { AlertChannel, AlertSeverity } from "../db/schema";
import { getAlertChannel } from "./alert-channels";

export interface AlertPayload {
  title: string;
  body: string;
  severity: AlertSeverity;
  agentName: string;
  projectName: string;
}

const SEVERITY_EMOJI: Record<AlertSeverity, string> = {
  info: "\u2139\uFE0F",
  success: "\u2705",
  warning: "\u26A0\uFE0F",
  error: "\uD83D\uDEA8",
};

const DISCORD_SEVERITY_COLOR: Record<AlertSeverity, number> = {
  info: 3447003,
  success: 5763719,
  warning: 16776960,
  error: 15548997,
};

function formatDiscord(alert: AlertPayload): object {
  return {
    embeds: [
      {
        title: `${SEVERITY_EMOJI[alert.severity]} ${alert.title}`,
        description: alert.body,
        color: DISCORD_SEVERITY_COLOR[alert.severity],
        footer: { text: `${alert.agentName} \u2022 ${alert.projectName}` },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

function formatSlack(alert: AlertPayload): object {
  return {
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${SEVERITY_EMOJI[alert.severity]} ${alert.title}`,
        },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: alert.body },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `${alert.agentName} \u2022 ${alert.projectName} \u2022 ${alert.severity}`,
          },
        ],
      },
    ],
  };
}

function escapeTelegramMarkdownV2(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

function formatTelegram(alert: AlertPayload): object {
  const title = escapeTelegramMarkdownV2(alert.title);
  const body = escapeTelegramMarkdownV2(alert.body);
  const agent = escapeTelegramMarkdownV2(alert.agentName);
  const project = escapeTelegramMarkdownV2(alert.projectName);
  const text = [
    `${SEVERITY_EMOJI[alert.severity]} *${title}*`,
    "",
    body,
    "",
    `_${agent} \u2022 ${project}_`,
  ].join("\n");
  return { text, parse_mode: "MarkdownV2" };
}

function buildRequest(channel: AlertChannel, alert: AlertPayload): { url: string; body: object } {
  switch (channel.channelType) {
    case "discord":
      return { url: channel.webhookUrl, body: formatDiscord(alert) };
    case "slack":
      return { url: channel.webhookUrl, body: formatSlack(alert) };
    case "telegram":
      return {
        url: `https://api.telegram.org/bot${channel.webhookUrl}/sendMessage`,
        body: { chat_id: channel.chatId, ...formatTelegram(alert) },
      };
  }
}

async function postWebhook(url: string, body: object): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Webhook failed (${res.status}): ${text}`);
  }
}

export async function dispatchAlert(projectId: string, alert: AlertPayload): Promise<void> {
  const channel = getAlertChannel(projectId);
  if (!channel || !channel.enabled) return;

  const { url, body } = buildRequest(channel, alert);
  try {
    await postWebhook(url, body);
  } catch (err) {
    console.error(`Alert dispatch failed for project ${projectId}:`, err);
  }
}

export async function sendTestAlert(
  channel: AlertChannel,
): Promise<{ ok: boolean; error?: string }> {
  const alert: AlertPayload = {
    title: "Test Alert",
    body: "This is a test alert from Shire. If you see this, your alert channel is configured correctly.",
    severity: "info",
    agentName: "system",
    projectName: "test",
  };
  const { url, body } = buildRequest(channel, alert);
  try {
    await postWebhook(url, body);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
