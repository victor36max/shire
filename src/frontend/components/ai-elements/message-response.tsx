/**
 * Adapted from AI Elements (https://github.com/vercel/ai-elements)
 * Streaming-aware markdown renderer using Streamdown.
 */

import { cn } from "@/components/lib/utils";
import { code } from "@streamdown/code";
import type { ComponentProps } from "react";
import { memo, useMemo } from "react";
import { Streamdown, type Components } from "streamdown";
import remarkGfm from "remark-gfm";
import remarkSharedLinks from "@/lib/remark-shared-links";
import { SharedDriveLink } from "@/components/chat/SharedDriveLink";
import type { Pluggable } from "unified";

export type MessageResponseProps = ComponentProps<typeof Streamdown> & {
  projectName?: string;
};

const streamdownPlugins = { code };
const baseRemarkPlugins: Pluggable[] = [remarkGfm, remarkSharedLinks];

export const MessageResponse = memo(
  ({
    className,
    projectName,
    remarkPlugins,
    components: componentsProp,
    ...props
  }: MessageResponseProps) => {
    const components = useMemo<Components | undefined>(() => {
      if (!projectName) return componentsProp;
      return {
        ...componentsProp,
        a: (linkProps) => <SharedDriveLink {...linkProps} projectName={projectName} />,
      };
    }, [projectName, componentsProp]);

    const mergedRemarkPlugins = useMemo(() => {
      return remarkPlugins ? [...baseRemarkPlugins, ...remarkPlugins] : baseRemarkPlugins;
    }, [remarkPlugins]);

    return (
      <Streamdown
        className={cn("size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}
        plugins={streamdownPlugins}
        remarkPlugins={mergedRemarkPlugins}
        components={components}
        {...props}
      />
    );
  },
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    nextProps.isAnimating === prevProps.isAnimating &&
    prevProps.projectName === nextProps.projectName,
);

MessageResponse.displayName = "MessageResponse";
