import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  server: {
    host: "127.0.0.1",
    strictPort: true,
    proxy: { "/api": { target: "http://localhost:3001" } },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
