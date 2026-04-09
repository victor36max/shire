import { GripVertical } from "lucide-react";
import { Group, Panel, Separator } from "react-resizable-panels";
import type { ComponentProps } from "react";

import { cn } from "@/components/lib/utils";

const ResizablePanelGroup = ({ className, ...props }: ComponentProps<typeof Group>) => (
  <Group
    className={cn("flex h-full w-full aria-[orientation=vertical]:flex-col", className)}
    {...props}
  />
);

const ResizablePanel = Panel;

const ResizableHandle = ({
  withHandle,
  className,
  ...props
}: ComponentProps<typeof Separator> & {
  withHandle?: boolean;
}) => (
  <Separator
    className={cn(
      "relative flex w-px items-center justify-center bg-border after:absolute after:inset-y-0 after:-left-1 after:-right-1 after:content-[''] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 [&[data-resize-handle-state=drag]]:bg-ring [&[data-resize-handle-state=hover]]:bg-ring",
      className,
    )}
    {...props}
  >
    {withHandle && (
      <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border">
        <GripVertical className="h-2.5 w-2.5" />
      </div>
    )}
  </Separator>
);

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
