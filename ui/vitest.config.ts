import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // Exclude Next build output + e2e; only run unit/component tests.
    exclude: ["**/node_modules/**", "**/.next/**"],
  },
  resolve: { alias: { "@": resolve(__dirname, ".") } },
});
