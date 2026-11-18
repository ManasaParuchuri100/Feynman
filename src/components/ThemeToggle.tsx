import React from "react";
import { Sun, Moon } from "lucide-react";
import { useTheme } from "../lib/theme";

interface ThemeToggleProps {
  compact?: boolean;
}

export default function ThemeToggle({ compact = false }: ThemeToggleProps) {
  const { theme, setTheme, toggleTheme } = useTheme();

  if (compact) {
    return (
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.04] text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:border-slate-300 dark:hover:border-white/20 transition-all cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
      >
        {theme === "dark" ? (
          <Sun className="w-4 h-4 text-amber-400" />
        ) : (
          <Moon className="w-4 h-4 text-violet-600" />
        )}
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label="Color theme"
      className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-white/[0.05] border border-slate-200/90 dark:border-white/[0.08] shrink-0"
    >
      <button
        type="button"
        id="btn-theme-light"
        onClick={() => setTheme("light")}
        aria-pressed={theme === "light"}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
          theme === "light"
            ? "bg-white text-slate-900 shadow-xs"
            : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
        }`}
      >
        <Sun className={`w-3.5 h-3.5 ${theme === "light" ? "text-amber-500" : ""}`} />
        <span>Light</span>
      </button>
      <button
        type="button"
        id="btn-theme-dark"
        onClick={() => setTheme("dark")}
        aria-pressed={theme === "dark"}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
          theme === "dark"
            ? "bg-[#19192e] text-white shadow-xs"
            : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
        }`}
      >
        <Moon className={`w-3.5 h-3.5 ${theme === "dark" ? "text-violet-400" : ""}`} />
        <span>Dark</span>
      </button>
    </div>
  );
}
