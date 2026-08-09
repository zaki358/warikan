import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// `new URL(...).pathname` は Windows で "/C:/Users/..." になり cwd に渡せない。
// fileURLToPath を通す。
const API_DIR = fileURLToPath(new URL("../../apps/api/", import.meta.url));
const WRANGLER = fileURLToPath(new URL("../../node_modules/wrangler/bin/wrangler.js", import.meta.url));

/**
 * ローカルの D1 に SQL を流す。
 *
 * E2E は wrangler dev（--local）が握っている miniflare の SQLite を見るため、
 * 同じ `wrangler d1 execute --local` 経由でしか触れない。
 * **`--remote` は絶対に付けない。** 本番の DB を壊す。
 *
 * `npx wrangler` ではなく node で wrangler.js を直に叩くのは、Windows では
 * .cmd を shell 無しで起動できず、shell 経由にすると SQL 内の空白・引用符・
 * セミコロンがシェルに再解釈されるため。引数配列のまま渡せばその問題が起きない。
 *
 * `wrangler dev` が同じ SQLite を開いたままでも書き込みは通り、走っている
 * サーバ側にも反映される（Plan 2 Task 12 で実際に確認済み）。
 */
export function execSql(sql: string): void {
  execFileSync(
    process.execPath,
    [WRANGLER, "d1", "execute", "warikan-db", "--local", "--command", sql],
    { cwd: API_DIR, stdio: "pipe" },
  );
}
