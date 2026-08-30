import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { mockupPreviewPlugin } from "./mockupPreviewPlugin";

// PORT is only meaningful for the dev server and `vite preview`. A production
// build does not need it, and platforms that inject PORT at runtime only (e.g.
// Railway) would otherwise be unable to run `vite build`. When it is set it is
// still validated strictly — a bad value is a mistake, not a default.
const rawPort = process.env.PORT;

const port = rawPort === undefined ? undefined : Number(rawPort);

if (port !== undefined && (Number.isNaN(port) || port <= 0)) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

export default defineConfig({
  base: basePath,
  plugins: [
    mockupPreviewPlugin(),
    react(),
    tailwindcss(),
    // Replit-only dev plugins. Imported dynamically inside the guard so a build
    // outside Replit (e.g. Railway) never needs them to resolve.
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-runtime-error-modal").then((m) =>
            m.default(),
          ),
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
  },
  server: {
    // When PORT is set, bind to it. When unset, let Vite pick as it normally does.
    ...(port === undefined ? {} : { port }),
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    ...(port === undefined ? {} : { port }),
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
