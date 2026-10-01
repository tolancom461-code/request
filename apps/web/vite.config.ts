import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Restaurant Branch Requisition",
        short_name: "Branch Requisition",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#F7FAF8",
        theme_color: "#087E63",
        icons: [
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        runtimeCaching: [],
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
      },
    }),
  ],
  server: {
    proxy: {
      "/api": {
        target: process.env.API_DEV_TARGET ?? "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
