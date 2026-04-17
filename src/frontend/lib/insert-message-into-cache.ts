import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type { MessagesResponse } from "../hooks/messages";
import type { WsSerializedMessage } from "./ws";

/** Convert a WsSerializedMessage to the API row format and append it to the query cache. */
export function insertMessageIntoCache(
  queryClient: QueryClient,
  projectId: string,
  agentId: string,
  msg: WsSerializedMessage,
) {
  const row: MessagesResponse["messages"][number] = {
    id: msg.id,
    projectId,
    agentId,
    role: msg.role,
    content: {
      ...(msg.text != null && { text: msg.text }),
      ...(msg.tool != null && { tool: msg.tool }),
      ...(msg.tool_use_id != null && { tool_use_id: msg.tool_use_id }),
      ...(msg.input != null && { input: msg.input }),
      // null output means "tool still running" — preserve it distinct from undefined (absent)
      ...(msg.output !== undefined && { output: msg.output }),
      ...(msg.isError != null && { isError: msg.isError }),
      ...(msg.fromAgent != null && { fromAgent: msg.fromAgent }),
      ...(msg.attachments != null && { attachments: msg.attachments }),
    },
    createdAt: msg.ts,
  };

  queryClient.setQueryData<InfiniteData<MessagesResponse>>(
    ["messages", projectId, agentId],
    (old) => {
      if (!old || old.pages.length === 0) return old;
      // Page 0 = newest (no cursor). Skip if already present.
      const firstPage = old.pages[0];
      if (firstPage.messages.some((m) => m.id === row.id)) return old;
      return {
        ...old,
        pages: [{ ...firstPage, messages: [...firstPage.messages, row] }, ...old.pages.slice(1)],
      };
    },
  );
}
