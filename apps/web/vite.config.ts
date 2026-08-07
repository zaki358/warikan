import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    // Worker の assets がこのディレクトリを配信する（Task 2）
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // 開発中は API だけローカルの wrangler dev に転送する。
    // 本番は同一 Worker が両方を返すので、フロントのコードは常に相対パスで /api を叩けばよい。
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
