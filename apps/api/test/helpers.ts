import { env } from "cloudflare:workers";

import app from "../src/index.js";

export const ALLOWED_EMAIL = "me@example.com";
export const PARTNER_EMAIL = "partner@example.com";

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
  ]);
}
