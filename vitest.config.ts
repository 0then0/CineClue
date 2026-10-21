import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "backend",
          environment: "node",
          include: ["packages/**/*.test.ts", "apps/api/test/unit.test.ts", "scripts/**/*.test.ts"],
        },
      },
      {
        test: { name: "frontend", environment: "jsdom", include: ["apps/web/**/*.test.{ts,tsx}"] },
      },
      {
        test: {
          name: "integration",
          environment: "node",
          include: ["apps/api/test/integration.test.ts"],
          fileParallelism: false,
          testTimeout: 20000,
        },
      },
    ],
  },
});
