// Unit tests for the app's pure helpers (lib/__tests__). They run in Node,
// so test only modules that don't import React Native.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: { environment: "node", include: ["lib/__tests__/**/*.test.ts"] },
});
