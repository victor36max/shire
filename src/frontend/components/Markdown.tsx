import { MessageResponse } from "@/components/ai-elements/message-response";

interface MarkdownProps {
  children: string;
  className?: string;
}

export default function Markdown({ children, className }: MarkdownProps) {
  return (
    <div className={`prose prose-sm max-w-none dark:prose-invert break-words ${className ?? ""}`}>
      <MessageResponse>{children}</MessageResponse>
    </div>
  );
}
