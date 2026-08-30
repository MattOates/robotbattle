/// <reference types="vitest" />
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Serve the ONNX runtime's WebAssembly from our own origin.
 *
 * Piper is what needs it, and left alone it fetches these from a CDN at a
 * version it has hardcoded — 1.18.0 — while npm resolves the runtime itself to
 * whatever the lockfile says. When those two disagree the loader fetches a file
 * that is not there and the voice fails with "no available backend found",
 * which is a maddening thing to debug from a 404 on somebody else's CDN.
 *
 * Taking the files from the installed package means the WebAssembly is always
 * the same version as the JavaScript that loads it, and the voice stops
 * depending on a third party being up.
 *
 * Deliberately only the runtime. The phonemiser is left on its CDN: its data
 * file is 18 MB of eSpeak dictionaries under the GPL, and vendoring that into
 * an ISC-licensed project is a licensing question rather than a build step.
 */
const ORT_FILES = ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"];
const ORT_DIR = "piper-ort";

function onnxRuntimeAssets(): Plugin {
  const require = createRequire(import.meta.url);
  // Located from the package's own entry point. Its `exports` map lists
  // neither the WebAssembly nor `package.json`, so neither can be resolved by
  // subpath; the entry point resolves, and the files sit beside it.
  const dist = dirname(require.resolve("onnxruntime-web"));
  const resolve = (file: string) => `${dist}/${file}`;

  return {
    name: "onnx-runtime-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const file = ORT_FILES.find((name) => req.url?.startsWith(`/${ORT_DIR}/${name}`));
        if (!file) return next();
        res.setHeader(
          "Content-Type",
          file.endsWith(".wasm") ? "application/wasm" : "text/javascript",
        );
        res.end(readFileSync(resolve(file)));
      });
    },
    generateBundle() {
      for (const file of ORT_FILES) {
        this.emitFile({
          type: "asset",
          // A fixed name, not a hashed one: the loader builds these paths by
          // appending a filename to a prefix, so it has to be predictable.
          fileName: `${ORT_DIR}/${file}`,
          source: readFileSync(resolve(file)),
        });
      }
    },
  };
}

export default defineConfig({
  // Relative asset paths, so the built site works at any URL prefix with no
  // configuration: a GitHub Pages project subpath, /robobattle/ on your own
  // server, or opened straight off disk. Routing is hash-based for the same
  // reason, so no server rewrites are needed either.
  base: "./",
  plugins: [react(), onnxRuntimeAssets()],
  // The speech worker pulls in Piper, which code-splits; Vite's default IIFE
  // worker format cannot express that, so workers are built as modules. They
  // are already constructed with `type: "module"`.
  worker: { format: "es" },
  // Stamped into the build so a bug report can say which one it came from.
  define: {
    __APP_VERSION__: JSON.stringify(process.env["npm_package_version"] ?? "dev"),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString().slice(0, 16).replace("T", " ")),
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
