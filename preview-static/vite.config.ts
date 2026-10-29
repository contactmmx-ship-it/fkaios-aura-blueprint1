import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const railwayPreviewHosts = [".up.railway.app"];

export default defineConfig({
  base: "/",
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist" },
  server: {
    allowedHosts: railwayPreviewHosts,
  },
  preview: {
    allowedHosts: railwayPreviewHosts,
  },
});
