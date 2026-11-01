import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": "http://localhost:8000" } },
  build: {
    chunkSizeWarningLimit: 1800,
    rollupOptions: { output: { manualChunks: { babylon: ["@babylonjs/core"], maplibre: ["maplibre-gl"] } } },
  },
});
