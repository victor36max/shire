import { Loader2 } from "lucide-react";
import { cn } from "@/components/lib/utils";

const sizes = {
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-6 w-6",
};

export function Spinner({
  size = "md",
  className,
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return <Loader2 className={cn("animate-spin", sizes[size], className)} />;
}

export function PageLoader() {
  return (
    <div className="flex items-center justify-center py-24">
      <Spinner size="lg" className="text-muted-foreground" />
    </div>
  );
}
