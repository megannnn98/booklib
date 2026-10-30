import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["frontend/test/**/*.test.ts"],
    setupFiles: ["frontend/test/setup.ts"],
    restoreMocks: true,
  },
});
