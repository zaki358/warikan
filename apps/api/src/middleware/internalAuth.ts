import type { MiddlewareHandler } from "hono";

import type { AppEnv } from "../env.js";
import { fail } from "../lib/response.js";

/**
 * 文字列の定数時間比較。
 * 早期 return で異なる位置が分かると、トークンを1文字ずつ推測できてしまうため、
 * 長さが同じ場合は必ず全文字を走査する。
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return diff === 0;
}

/**
 * 外部アプリ（家計簿ダッシュボード）からの Service Binding 経由の呼び出しを認証する。
 *
 * Service Binding は Cloudflare のエッジを通らずに Worker を直接呼ぶため、
 * Cloudflare Access の JWT は付かない。その代わりに共有トークンで認証する。
 *
 * INTERNAL_API_TOKEN が未設定なら常に 403（fail-closed）。
 * これが連携のキルスイッチも兼ねる —
 * `wrangler secret delete INTERNAL_API_TOKEN` すれば内部APIは閉じ、
 * 割り勘アプリは連携前とまったく同じ挙動に戻る。
 */
export function internalAuth(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const expected = c.env.INTERNAL_API_TOKEN;
    if (!expected) {
      return c.json(fail("FORBIDDEN", "内部APIは無効です"), 403);
    }

    const presented = c.req.header("X-Internal-Token");
    if (!presented || !timingSafeEqual(presented, expected)) {
      return c.json(fail("FORBIDDEN", "アクセス権がありません"), 403);
    }

    await next();
  };
}
