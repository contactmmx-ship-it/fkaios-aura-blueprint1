import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({ base: "/fkaios-aura-blueprint1/", plugins: [react(), tailwindcss()], build: { outDir: "dist" } });
