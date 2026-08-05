// `import { env } from "cloudflare:workers"` の env は Cloudflare.Env 型なので、
// テスト専用のバインディングはこの namespace に対して宣言マージする。
// トップレベル import を書くとモジュール扱いになり global に届かないため、
// 型は inline import で参照する。
declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import("@cloudflare/vitest-pool-workers").D1Migration[];
  }
}
