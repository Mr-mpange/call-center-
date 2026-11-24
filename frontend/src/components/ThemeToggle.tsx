import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/ThemeProvider";

export function ThemeToggle({
  showLabel = false,
  className,
}: {
  showLabel?: boolean;
  className?: string;
}) {
  const { theme, toggleTheme, isTransitioning } = useTheme();
  const dark = theme === "dark";
  const Icon = dark ? Sun : Moon;
  const label = dark ? "Switch to light theme" : "Switch to dark theme";

  return (
    <button
      type="button"
      onClick={(event) => toggleTheme({ x: event.clientX, y: event.clientY })}
      aria-label={label}
      aria-pressed={dark}
      aria-busy={isTransitioning}
      data-theme-toggle
      data-theme={theme}
      disabled={isTransitioning}
      title={label}
      className={cn("theme-toggle", showLabel && "theme-toggle-labeled", className)}
    >
      <span className="theme-toggle-icon" aria-hidden>
        <Icon className="h-4 w-4" />
      </span>
      {showLabel && <span>{dark ? "Light theme" : "Dark theme"}</span>}
    </button>
  );
}
