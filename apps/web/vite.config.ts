import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  envDir: "../..",
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      // Generates favicon/app/maskable/apple icons from public/icon.svg (adaptive icon with safe zone → no padding).
      pwaAssets: {
        image: "public/icon.svg",
        preset: {
          transparent: { sizes: [64, 192, 512], favicons: [[48, "favicon.ico"]], padding: 0 },
          maskable: { sizes: [512], padding: 0 },
          apple: { sizes: [180], padding: 0 },
        },
        includeHtmlHeadLinks: true,
        overrideManifestIcons: true,
      },
      manifest: {
        name: "Freezer Manager",
        short_name: "Freezer",
        description: "Was ist in welchem Fach eingefroren?",
        lang: "de",
        theme_color: "#f6fafa",
        background_color: "#f6fafa",
        display: "standalone",
        start_url: "/",
        scope: "/",
      },
      workbox: {
        // App shell offline; API, auth callbacks and data are never served from the SW.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        // Fonts: only the Latin subsets of Google Sans Flex plus the icon font (other scripts load on demand).
        globPatterns: ["**/*.{js,css,html,svg,png,ico,wasm}", "assets/google-sans-flex-latin*.woff2", "fonts/*.woff2"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://localhost:3000" },
  },
});
