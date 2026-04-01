import * as React from "react";

interface AppLayoutProps {
  children: React.ReactNode;
  maxWidth?: "default" | "wide";
}

export default function AppLayout({ children, maxWidth = "default" }: AppLayoutProps) {
  const widthClass = maxWidth === "wide" ? "max-w-7xl" : "max-w-5xl";
  return (
    <main className="pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))] lg:pl-[max(2rem,env(safe-area-inset-left))] lg:pr-[max(2rem,env(safe-area-inset-right))]">
      <div className={`mx-auto ${widthClass}`}>{children}</div>
    </main>
  );
}
