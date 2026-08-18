import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    // testing-library's auto-cleanup between tests registers via afterEach,
    // which it only finds when vitest exposes globals.
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // The supabase client is created at module load from these; without them
    // any component that transitively imports it throws before the test runs.
    env: {
      VITE_SUPABASE_URL: "http://localhost:54321",
      VITE_SUPABASE_PUBLISHABLE_KEY: "test-anon-key",
    },
  },
});
