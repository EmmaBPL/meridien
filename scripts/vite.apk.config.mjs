import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "android/app/src/main/assets/www");

export default defineConfig({
  root,
  base: "/assets/www/",
  publicDir: false,
  plugins: [
    tailwindcss(),
    react(),
    {
      name: "apk-www-layout",
      closeBundle() {
        const nested = resolve(outDir, "android-shell/index.html");
        if (existsSync(nested)) {
          renameSync(nested, resolve(outDir, "index.html"));
          rmSync(resolve(outDir, "android-shell"), { recursive: true, force: true });
        }
        const textures = resolve(outDir, "textures");
        mkdirSync(textures, { recursive: true });
        cpSync(resolve(root, "public/textures/earth-day.jpg"), resolve(textures, "earth-day.jpg"));
        cpSync(resolve(root, "public/textures/earth-night.jpg"), resolve(textures, "earth-night.jpg"));
      },
    },
  ],
  resolve: {
    alias: { "@": resolve(root, "src") },
  },
  build: {
    outDir,
    emptyOutDir: true,
    assetsDir: "assets",
    cssCodeSplit: false,
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      input: resolve(root, "android-shell/index.html"),
    },
  },
});
