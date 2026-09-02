import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

/**
 * The panel is always served from `/agente/` — Express mounts it there and the
 * Desk widget points an iframe at it. So the base path is a constant, not a
 * deployment choice.
 *
 * It deliberately does NOT read `BASE_PATH`. That variable is already set to
 * `/` for the supervisor client and is shared across every service that builds
 * this repo; reusing it here would mean one value having to be two things, and
 * whoever changed it for one artifact would silently break the other.
 * `AGENTE_BASE_PATH` exists only as an escape hatch for a preview deployment.
 */
const basePath = process.env.AGENTE_BASE_PATH ?? "/agente/";

const rawPort = process.env.AGENTE_PORT;
const port = rawPort === undefined ? undefined : Number(rawPort);
if (port !== undefined && (Number.isNaN(port) || port <= 0)) {
  throw new Error(`Invalid AGENTE_PORT value: "${rawPort}"`);
}

export default defineConfig({
  base: basePath,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    ...(port === undefined ? {} : { port, strictPort: true }),
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: { "/api": "http://localhost:3000" },
    fs: { strict: true },
  },
  preview: {
    ...(port === undefined ? {} : { port, strictPort: true }),
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
