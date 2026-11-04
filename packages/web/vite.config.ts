import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // POTSCAN_API=https://potscan-production.up.railway.app develops the UI against live data.
    proxy: { "/api": { target: process.env.POTSCAN_API ?? "http://localhost:8787", changeOrigin: true } },
  },
});
