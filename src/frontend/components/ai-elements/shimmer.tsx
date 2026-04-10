/**
 * CSS-only shimmer effect — replaces AI Elements' motion-based Shimmer
 * to avoid the ~15KB motion dependency.
 */

import { cn } from "@/components/lib/utils";
import type { CSSProperties, HTMLAttributes } from "react";

interface ShimmerProps extends HTMLAttributes<HTMLSpanElement> {
  /** Duration of one shimmer cycle in seconds */
  duration?: number;
  /** HTML element type */
  as?: "span" | "p" | "div";
}

export function Shimmer({
  children,
  className,
  duration = 2,
  as: Tag = "span",
  ...props
}: ShimmerProps) {
  return (
    <Tag
      className={cn(
        "inline-block bg-clip-text bg-[length:200%_100%] animate-[shimmer_var(--shimmer-duration)_ease-in-out_infinite]",
        "bg-gradient-to-r from-current via-muted-foreground/40 to-current",
        className,
      )}
      style={{ "--shimmer-duration": `${duration}s` } as CSSProperties}
      {...props}
    >
      {children}
    </Tag>
  );
}
