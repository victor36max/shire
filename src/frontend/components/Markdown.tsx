import { MessageResponse } from "@/components/ai-elements/message-response";
import { useProjectLayout } from "@/providers/ProjectLayoutProvider";

interface MarkdownProps {
  children: string;
  className?: string;
}

export default function Markdown({ children, className }: MarkdownProps) {
  const { projectName } = useProjectLayout();
  return (
    <div className={`prose prose-sm max-w-none dark:prose-invert break-words ${className ?? ""}`}>
      <MessageResponse projectName={projectName}>{children}</MessageResponse>
    </div>
  );
}
