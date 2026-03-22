import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownProps {
  children: string;
  className?: string;
  inverted?: boolean;
}

export default function Markdown({ children, className, inverted }: MarkdownProps) {
  const codeBg = inverted ? "bg-background/20 text-inherit" : "bg-foreground text-background";

  return (
    <div className={`prose prose-sm max-w-none dark:prose-invert break-words ${className ?? ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <pre className={`overflow-x-auto rounded ${codeBg} p-2 text-xs`}>{children}</pre>,
          code: ({ children, className }) => {
            const isBlock = className?.startsWith("language-");
            if (isBlock) {
              return <code className={`${className} text-xs bg-transparent`}>{children}</code>;
            }
            return <code className={`rounded ${codeBg} px-1 py-0.5 text-xs font-mono`}>{children}</code>;
          },
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
