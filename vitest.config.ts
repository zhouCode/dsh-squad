import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/plugin/src/**/*.test.ts"],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    pool: "forks",
  },
});
