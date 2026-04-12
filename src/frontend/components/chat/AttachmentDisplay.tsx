import * as React from "react";
import { Download } from "lucide-react";
import { type Attachment, formatFileSize } from "./types";
import { getFileIcon } from "../../lib/file-utils";

interface AttachmentDisplayProps {
  attachments: Attachment[];
  projectName: string;
  agentId: string;
}

export const AttachmentDisplay = React.memo(function AttachmentDisplay({
  attachments,
  projectName,
  agentId,
}: AttachmentDisplayProps) {
  if (!attachments.length) return null;

  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {attachments.map((att) => {
        const url = `/api/projects/${projectName}/agents/${agentId}/attachments/${att.id}/${encodeURIComponent(att.filename)}`;
        const isImage = att.content_type.startsWith("image/");

        const AttIcon = getFileIcon(att.filename);

        return isImage ? (
          <a
            key={att.id}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-md border border-border overflow-hidden hover:opacity-90 transition-opacity"
          >
            <img
              src={url}
              alt={att.filename}
              loading="lazy"
              className="max-w-48 max-h-32 object-cover"
            />
          </a>
        ) : (
          <a
            key={att.id}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 rounded-md border border-border hover:bg-muted/50 text-sm"
          >
            <AttIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate max-w-40">{att.filename}</span>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              ({formatFileSize(att.size)})
            </span>
            <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </a>
        );
      })}
    </div>
  );
});
