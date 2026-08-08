import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // 日付を JST で読むと、UTC として解釈される "2026-08-03" 形式の文字列を
    // ローカル系メソッドで処理する実装（getDay() など）でも偶然テストが通ってしまう。
    // UTC より西のタイムゾーンに固定して、その手の実装を必ず落とす。
    env: { TZ: "America/New_York" },
  },
});
