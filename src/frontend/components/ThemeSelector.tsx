import * as React from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { Button } from "./ui/button";
import { Label } from "./ui/label";

type Theme = "light" | "dark" | "system";

function applyTheme(theme: Theme) {
  const isDark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", isDark);
}

const themeOptions: { value: Theme; label: string; icon: React.ReactNode }[] = [
  { value: "light", label: "Light", icon: <Sun className="h-5 w-5" /> },
  { value: "dark", label: "Dark", icon: <Moon className="h-5 w-5" /> },
  { value: "system", label: "System", icon: <Monitor className="h-5 w-5" /> },
];

export default function ThemeSelector() {
  const [theme, setThemeState] = React.useState<Theme>(() => {
    const stored = localStorage.getItem("theme");
    return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
  });

  const setTheme = (newTheme: Theme) => {
    localStorage.setItem("theme", newTheme);
    setThemeState(newTheme);
    applyTheme(newTheme);
  };

  return (
    <div className="space-y-3">
      <Label>Theme</Label>
      <div className="flex gap-3">
        {themeOptions.map((opt) => (
          <Button
            key={opt.value}
            variant={theme === opt.value ? "default" : "outline"}
            className="flex flex-col items-center gap-2 h-auto py-4 px-6"
            onClick={() => setTheme(opt.value)}
            data-active={theme === opt.value}
            aria-label={opt.label}
          >
            {opt.icon}
            <span className="text-sm">{opt.label}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
