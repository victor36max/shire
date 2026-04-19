import * as React from "react";
import { Download } from "lucide-react";
import { type Attachment, formatFileSize } from "./types";
import { getFileIcon } from "../../lib/file-utils";
import { useAuthenticatedUrl } from "../../hooks/use-authenticated-url";
import { authenticatedDownload } from "../../lib/authenticated-download";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";

interface AttachmentDisplayProps {
  attachments: Attachment[];
  projectName: string;
  agentId: string;
}

function ImageAttachment({ url, filename }: { url: string; filename: string }) {
  const { blobUrl, isLoading } = useAuthenticatedUrl(url);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center max-w-48 max-h-32 rounded-md border border-border p-4">
        <Spinner size="sm" className="text-muted-foreground" />
      </div>
    );
  }

  if (!blobUrl) return null;

  return (
    <a
      href={blobUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-md border border-border overflow-hidden hover:opacity-90 transition-opacity"
    >
      <img src={blobUrl} alt={filename} loading="lazy" className="max-w-48 max-h-32 object-cover" />
    </a>
  );
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
          <ImageAttachment key={att.id} url={url} filename={att.filename} />
        ) : (
          <Button
            key={att.id}
            variant="outline"
            size="sm"
            onClick={() => authenticatedDownload(url, att.filename)}
            className="flex items-center gap-2"
          >
            <AttIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate max-w-40">{att.filename}</span>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              ({formatFileSize(att.size)})
            </span>
            <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </Button>
        );
      })}
    </div>
  );
});
