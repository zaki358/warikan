import { defineConfig } from "@playwright/test";

import { BASE_URL } from "./global-setup.js";

export default defineConfig({
  testDir: ".",
  globalSetup: "./global-setup.ts",
  // 同じ D1 を共有するため直列で流す。並列にすると月次の期間を取り合う。
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    browserName: "chromium",
    // スマホ前提のアプリなので視野を狭くする。devices["iPhone 13"] を展開すると
    // defaultBrowserType: "webkit" まで持ち込まれ、入れていない WebKit を
    // 起動しようとして落ちる。必要な値だけを直に書く。
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    trace: "retain-on-failure",
  },
});
