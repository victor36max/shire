import * as React from "react";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent | { matches: boolean }) => {
      const theme = localStorage.getItem("theme");
      if (!theme || theme === "system") {
        document.documentElement.classList.toggle("dark", e.matches);
      }
    };
    handler({ matches: mq.matches });
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return <>{children}</>;
}
