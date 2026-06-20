import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Teal accent + neutral surfaces (v0.2 design palette).
        accent: {
          DEFAULT: "#0d9488", // teal-600
          fg: "#ffffff",
          muted: "#ccfbf1", // teal-100
        },
        surface: {
          DEFAULT: "#ffffff",
          subtle: "#f8fafc", // slate-50
          border: "#e2e8f0", // slate-200
        },
      },
      fontFamily: {
        // Geist is bundled via the `geist` npm package (node_modules) — distinctive
        // typography with no CDN at build or runtime (air-gapped-first).
        sans: ["var(--font-geist-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
