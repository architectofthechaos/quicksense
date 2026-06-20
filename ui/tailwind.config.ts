import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // All colors resolve to the design tokens in globals.css (light/.dark).
        background: "var(--bg)",
        surface: "var(--surface)",
        muted: "var(--surface-2)",
        border: "var(--border)",
        foreground: "var(--text)",
        "muted-foreground": "var(--text-muted)",
        faint: "var(--text-faint)",
        primary: {
          DEFAULT: "var(--primary)",
          strong: "var(--primary-strong)",
          hover: "var(--primary-hover)",
          tint: "var(--primary-tint)",
          fg: "var(--primary-fg)",
        },
        success: "var(--success)",
        warning: "var(--warning)",
        error: "var(--error)",
        ring: "var(--ring)",
      },
      fontFamily: {
        // Self-hosted via @fontsource-variable (imported in app/layout.tsx) —
        // air-gapped, no CDN at build or runtime.
        sans: ["Inter Variable", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono Variable", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        topbar: "var(--shadow-topbar)",
        card: "var(--shadow-card)",
        pop: "var(--shadow-pop)",
      },
      keyframes: {
        "dot-pulse": {
          "0%,100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.4", transform: "scale(0.8)" },
        },
        "slide-in-right": {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" },
        },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "toast-in": {
          from: { opacity: "0", transform: "translateY(10px) scale(0.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
      },
      animation: {
        "dot-pulse": "dot-pulse 1.4s ease-in-out infinite",
        "slide-in-right": "slide-in-right 180ms cubic-bezier(0.16,1,0.3,1)",
        "fade-in": "fade-in 140ms ease-out",
        "toast-in": "toast-in 160ms cubic-bezier(0.16,1,0.3,1)",
      },
    },
  },
  plugins: [],
};

export default config;
