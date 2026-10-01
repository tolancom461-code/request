import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "virtual:pwa-register/react": path.resolve(import.meta.dirname, "stubs/pwa-register-react.ts"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["apps/web/src/**/*.dom.harness.tsx"],
    setupFiles: [path.resolve(import.meta.dirname, "dom.setup.ts")],
    testTimeout: 30_000,
  },
});
