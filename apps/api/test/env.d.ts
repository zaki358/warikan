// `import { env } from "cloudflare:workers"` の env は Cloudflare.Env 型なので、
// テストから参照するバインディングはこの namespace に対して宣言マージする。
// トップレベル import を書くとモジュール扱いになり global に届かないため、
// 型は inline import で参照する。
//
// ACCESS_AUD / ACCESS_ALLOWED_EMAILS は本番では secret、テストでは
// vitest.config.ts の miniflare.bindings で注入するため、
// wrangler types が生成する型には含まれない。
// TEST_MIGRATIONS はテスト専用。
declare namespace Cloudflare {
  interface Env {
    ACCESS_AUD: string;
    ACCESS_ALLOWED_EMAILS: string;
    DEV_BYPASS_EMAIL?: string;
    TEST_MIGRATIONS: import("@cloudflare/vitest-pool-workers").D1Migration[];
  }
}
