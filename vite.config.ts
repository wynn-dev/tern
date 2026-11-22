import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/web",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": resolve(import.meta.dirname, "src/web") } },
  build: { outDir: resolve(import.meta.dirname, "dist/web"), emptyOutDir: true, target: "es2022" },
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://127.0.0.1:7420", changeOrigin: false }, "/oauth": "http://127.0.0.1:7420" },
  },
});
