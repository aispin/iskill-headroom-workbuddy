import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// 构建产物由 scripts/dashboard.py 直接托管（单端口），所以用相对 base。
// 开发模式：vite dev server 跑在 5173，把 /api 反代到本地控制台后端。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8786",
        changeOrigin: true,
      },
    },
  },
});
