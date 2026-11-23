import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { brand, brandTitle } from "./src/brand";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["icon.svg", "manifest-ar.webmanifest"],
      manifest: {
        id: "/",
        name: brandTitle("en"),
        short_name: brand.englishShortName,
        description: brand.arabicName,
        lang: "en",
        dir: "ltr",
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
