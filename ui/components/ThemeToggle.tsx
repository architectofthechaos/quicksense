"use client";
import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
import { applyTheme, type Theme } from "@/lib/theme";

// Menu-item theme toggle. Reads the current theme from the <html> class (set by
// the no-FOUC script in the root layout) and flips it, persisting the choice.
export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  }

  const isDark = theme === "dark";
  return (
    <button type="button" role="menuitem" onClick={toggle} className={className}>
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      <span>{isDark ? "Light mode" : "Dark mode"}</span>
    </button>
  );
}
