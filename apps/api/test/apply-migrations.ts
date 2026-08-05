import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// setup ファイルはテストファイルごとのストレージ分離の外で、複数回実行されうる。
// applyD1Migrations は未適用のものだけを適用するので、ここで呼んで安全。
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
