import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  test: {
    globals: false,
    environment: "node",
    environmentMatchGlobs: [
      ["app/ui/graph/__tests__/pipeline-flow-node.test.tsx", "happy-dom"],
    ],
    include: ["app/**/*.{spec,test}.{ts,tsx}"],
    exclude: ["node_modules", ".next", "dist"],
    reporters: ["default"],
  },
});
