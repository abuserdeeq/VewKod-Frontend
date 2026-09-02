import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: "jsdom",
    setupFiles: "./tests/setup.js",
    globals: true,
    // tests/localEngine/*.test.js are node:test files (run via
    // `npm run test`), not vitest files. Vitest's default include
    // glob matches them anyway, and since they call node:test's
    // test() instead of vitest's, vitest sees zero registered tests
    // and reports each one as a failed suite ("No test suite found").
    // Excluding them here stops that false failure.
    exclude: ["node_modules/**", "dist/**", "tests/localEngine/**"],
  },
});