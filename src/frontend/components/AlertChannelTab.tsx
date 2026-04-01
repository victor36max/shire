import { useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Switch } from "./ui/switch";
import { Spinner } from "./ui/spinner";
import { Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  useAlertChannel,
  useUpsertAlertChannel,
  useDeleteAlertChannel,
  useTestAlertChannel,
} from "../hooks";
import {
  channelTypeLabel,
  type AlertChannel,
  type AlertChannelConfig,
  type ChannelType,
} from "./types";

const CHANNEL_TYPES: ChannelType[] = ["discord", "slack", "telegram"];

function configToFormState(config: AlertChannelConfig) {
  switch (config.type) {
    case "discord":
      return {
        channelType: "discord" as const,
        webhookUrl: config.webhookUrl,
        botToken: "",
        chatId: "",
      };
    case "slack":
      return {
        channelType: "slack" as const,
        webhookUrl: config.webhookUrl,
        botToken: "",
        chatId: "",
      };
    case "telegram":
      return {
        channelType: "telegram" as const,
        webhookUrl: "",
        botToken: config.botToken,
        chatId: config.chatId,
      };
  }
}

function formStateToConfig(state: {
  channelType: ChannelType;
  webhookUrl: string;
  botToken: string;
  chatId: string;
}): AlertChannelConfig {
  switch (state.channelType) {
    case "discord":
      return { type: "discord", webhookUrl: state.webhookUrl };
    case "slack":
      return { type: "slack", webhookUrl: state.webhookUrl };
    case "telegram":
      return { type: "telegram", botToken: state.botToken, chatId: state.chatId };
  }
}

interface Props {
  projectId: string;
}

function AlertChannelForm({
  projectId,
  channel,
}: {
  projectId: string;
  channel: AlertChannel | null;
}) {
  const upsert = useUpsertAlertChannel(projectId);
  const remove = useDeleteAlertChannel(projectId);
  const test = useTestAlertChannel(projectId);

  const initial = channel ? configToFormState(channel.config) : null;
  const [channelType, setChannelType] = useState<ChannelType>(initial?.channelType ?? "discord");
  const [webhookUrl, setWebhookUrl] = useState(initial?.webhookUrl ?? "");
  const [botToken, setBotToken] = useState(initial?.botToken ?? "");
  const [chatId, setChatId] = useState(initial?.chatId ?? "");
  const [enabled, setEnabled] = useState(channel?.enabled ?? true);
  const [deleteOpen, setDeleteOpen] = useState(false);

  function buildConfig(): AlertChannelConfig {
    return formStateToConfig({
      channelType,
      webhookUrl: webhookUrl.trim(),
      botToken: botToken.trim(),
      chatId: chatId.trim(),
    });
  }

  function hasChanges(): boolean {
    if (!channel) return true;
    const current = buildConfig();
    return (
      JSON.stringify(current) !== JSON.stringify(channel.config) || channel.enabled !== enabled
    );
  }

  function handleSave() {
    if (channelType === "telegram") {
      if (!botToken.trim()) {
        toast.error("Bot token is required for Telegram");
        return;
      }
      if (!chatId.trim()) {
        toast.error("Chat ID is required for Telegram");
        return;
      }
    } else {
      if (!webhookUrl.trim()) {
        toast.error("Webhook URL is required");
        return;
      }
    }
    upsert.mutate(
      { config: buildConfig(), enabled },
      { onSuccess: () => toast.success("Alert channel saved") },
    );
  }

  function handleTest() {
    test.mutate(undefined, {
      onSuccess: () => toast.success("Test alert sent successfully"),
      onError: (err) => toast.error(`Test failed: ${err.message}`),
    });
  }

  function handleDelete() {
    remove.mutate(undefined, {
      onSuccess: () => {
        toast.success("Alert channel removed");
        setDeleteOpen(false);
      },
    });
  }

  return (
    <>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="channel-type">Channel Type</Label>
          <Select value={channelType} onValueChange={(v) => setChannelType(v as ChannelType)}>
            <SelectTrigger id="channel-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHANNEL_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {channelTypeLabel(t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {channelType === "telegram" ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="bot-token">Bot Token</Label>
              <Input
                id="bot-token"
                type="password"
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="chat-id">Chat ID</Label>
              <Input
                id="chat-id"
                value={chatId}
                onChange={(e) => setChatId(e.target.value)}
                placeholder="-1001234567890"
              />
            </div>
          </>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="webhook-url">Webhook URL</Label>
            <Input
              id="webhook-url"
              type="password"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://..."
            />
          </div>
        )}

        <div className="flex items-center gap-2">
          <Switch id="enabled" checked={enabled} onCheckedChange={setEnabled} />
          <Label htmlFor="enabled">Enabled</Label>
        </div>
      </div>

      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={!hasChanges() || upsert.isPending}>
          {upsert.isPending ? <Spinner className="mr-2 h-4 w-4" /> : null}
          Save
        </Button>

        {channel && (
          <>
            <Button variant="outline" onClick={handleTest} disabled={test.isPending}>
              {test.isPending ? (
                <Spinner className="mr-2 h-4 w-4" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Send Test
            </Button>

            <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="mr-2 h-4 w-4" />
              Remove
            </Button>
          </>
        )}
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove alert channel?</AlertDialogTitle>
            <AlertDialogDescription>
              Agents will no longer be able to send notifications. You can reconfigure a channel at
              any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function AlertChannelTab({ projectId }: Props) {
  const { data: channel, isLoading } = useAlertChannel(projectId);

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-lg">
      <p className="text-sm text-muted-foreground">
        Configure a notification channel to receive alerts from your agents. Agents will
        automatically send alerts for important events like task completions, errors, and warnings.
      </p>

      <AlertChannelForm
        key={channel?.id ?? "new"}
        projectId={projectId}
        channel={channel ?? null}
      />
    </div>
  );
}
