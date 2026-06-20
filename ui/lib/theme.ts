export type Theme = "light" | "dark";

export const THEME_KEY = "theme";

// resolveTheme picks the effective theme: a valid stored choice wins; otherwise
// fall back to the system (prefers-color-scheme) preference.
export function resolveTheme(stored: string | null, prefersDark: boolean): Theme {
  if (stored === "dark" || stored === "light") return stored;
  return prefersDark ? "dark" : "light";
}

// applyTheme reflects the theme onto <html> (the .dark class Tailwind keys off)
// and persists the choice to localStorage.
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore storage failures (private mode, etc.) */
  }
}
