import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["scenarios/**/*.test.ts"],
    testTimeout: 15000, // E2E tests spawn server processes
    hookTimeout: 10000,
  },
});
