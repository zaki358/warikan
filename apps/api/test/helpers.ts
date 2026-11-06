import { env } from "cloudflare:workers";

import app from "../src/index.js";

export const ALLOWED_EMAIL = "me@example.com";
export const PARTNER_EMAIL = "partner@example.com";
export const INTERNAL_TOKEN = "test-internal-token";

const BASE = "https://warikan.test";

/**
 * リクエストごとに env を差し替えて Worker を呼ぶ。
 *
 * `exports.default.fetch` は Fetcher 相当で第2引数が RequestInit のため、
 * env を差し替えられない（渡しても実行時に捨てられる）。
 * Worker の default export は Hono アプリそのもので、Hono の
 * `app.fetch(request, env, ctx)` は第2引数が env なのでこちらを使う。
 * 呼び出しごとに独立した env を渡せるため、テスト間の実行順序に依存しない。
 */
// Hono の fetch は Response | Promise<Response> を返すため async で受けて揃える。
const fetchWithEnv = async (
  path: string,
  init: RequestInit,
  bypassEmail: string | undefined,
): Promise<Response> =>
  app.fetch(new Request(`${BASE}${path}`, init), {
    ...env,
    DEV_BYPASS_EMAIL: bypassEmail,
  });

/** DEV_BYPASS_EMAIL 経由で認証済みのリクエストを送る。 */
export async function authedFetch(
  path: string,
  init: RequestInit = {},
  asEmail: string = ALLOWED_EMAIL,
): Promise<Response> {
  return fetchWithEnv(path, init, asEmail);
}

/** 認証を通さないリクエストを送る。 */
export async function anonFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetchWithEnv(path, init, undefined);
}

/**
 * 内部API（Service Binding 経由相当）へのリクエスト。
 *
 * Access の JWT も DEV_BYPASS_EMAIL も付けない。認証は X-Internal-Token だけで通る。
 * `token` に null を渡すとヘッダ自体を付けず、`configuredToken` に null を渡すと
 * Worker 側が INTERNAL_API_TOKEN 未設定（連携無効）の状態を再現できる。
 * undefined ではなく null をセンチネルにしているのは、undefined だとデフォルト引数が
 * 効いてしまい「未設定」を表現できないため。
 */
export async function internalFetch(
  path: string,
  init: RequestInit = {},
  token: string | null = INTERNAL_TOKEN,
  configuredToken: string | null = INTERNAL_TOKEN,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token !== null) headers.set("X-Internal-Token", token);

  return app.fetch(new Request(`${BASE}${path}`, { ...init, headers }), {
    ...env,
    DEV_BYPASS_EMAIL: undefined,
    INTERNAL_API_TOKEN: configuredToken ?? undefined,
  });
}

export async function jsonBody<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** POST / PATCH 用の JSON リクエスト init を作る。 */
export const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** テスト間で DB を空に戻す。 */
export async function resetDb(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM event_settlements"),
    env.DB.prepare("DELETE FROM event_items"),
    env.DB.prepare("DELETE FROM event_members"),
    env.DB.prepare("DELETE FROM events"),
    env.DB.prepare("DELETE FROM monthly_expenses"),
    env.DB.prepare("DELETE FROM monthly_periods"),
    env.DB.prepare("DELETE FROM users"),
    // 内部API経由で自動作成されたカテゴリ（sort_order = 900）だけを消す。
    // seed の7個（sort_order 10〜99）はマイグレーション由来なので残す。
    env.DB.prepare("DELETE FROM categories WHERE sort_order >= 900"),
  ]);
}
