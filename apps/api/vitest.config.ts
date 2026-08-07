import path from "node:path";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));

      return {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            ACCESS_TEAM_DOMAIN: "test.cloudflareaccess.com",
            ACCESS_AUD: "test-audience",
            ACCESS_ALLOWED_EMAILS: "me@example.com,partner@example.com",
            // apps/api/.dev.vars があると vitest-pool-workers もそれを読み込み、
            // 開発者の手元だけ DEV_BYPASS_EMAIL が入った状態でテストが走ってしまう。
            // 未認証を前提とするテストが認証済みとして通ってしまうため、ここで打ち消す。
            // バイパスが必要なテストは app.fetch(request, env) でリクエストごとに指定する。
            DEV_BYPASS_EMAIL: "",
          },
        },
      };
    }),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
  },
});
