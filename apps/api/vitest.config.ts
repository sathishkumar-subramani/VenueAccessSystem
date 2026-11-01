import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // A ledger test that spins up a database needs more than the default 5s.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // These must not run in parallel against one database.
    fileParallelism: false,
  },
});
