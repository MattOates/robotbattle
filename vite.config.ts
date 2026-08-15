/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative asset paths, so the built site works at any URL prefix with no
  // configuration: a GitHub Pages project subpath, /robobattle/ on your own
  // server, or opened straight off disk. Routing is hash-based for the same
  // reason, so no server rewrites are needed either.
  base: "./",
  plugins: [react()],
  // Stamped into the build so a bug report can say which one it came from.
  define: {
    __APP_VERSION__: JSON.stringify(process.env["npm_package_version"] ?? "dev"),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString().slice(0, 16).replace("T", " ")),
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
