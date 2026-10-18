import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
    testTimeout: 10000,
    // @workspace/db throws on import without DATABASE_URL; the pool never connects in tests.
    env: { DATABASE_URL: "postgres://test:test@localhost:5432/test" },
  },
});
