import { beforeEach, describe, expect, it } from "vitest";

import { ALLOWED_EMAIL, PARTNER_EMAIL, anonFetch, authedFetch, jsonBody, resetDb } from "./helpers.js";

type UserSummary = { userId: string; displayName: string };
type Envelope<T> = { ok: boolean; data?: T; error?: { code: string } };

/** 認証を1回通すと、その email の users 行が無ければ作られる（middleware/auth.ts）。 */
const signIn = (email: string) => authedFetch("/api/me", {}, email);

describe("GET /api/users", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("登録済みのユーザーを返す", async () => {
    await signIn(ALLOWED_EMAIL);
    await signIn(PARTNER_EMAIL);

    const res = await authedFetch("/api/users");
    const body = await jsonBody<Envelope<UserSummary[]>>(res);

    expect(res.status).toBe(200);
    // 並び順は created_at → id。同じミリ秒に作られると id（乱数）で決まるため、
    // 順序は固定できない。集合として一致することだけを見る。
    expect(body.data?.map((user) => user.displayName).sort()).toEqual(["me", "partner"]);
  });

  it("email を返さない", async () => {
    await signIn(ALLOWED_EMAIL);

    const res = await authedFetch("/api/users");
    const raw = await res.text();

    // 相手のメールアドレスを配る理由が無い。JSON 全体を文字列で見て、
    // キー名だけでなく値の混入も同時に弾く。
    expect(raw).not.toContain("@");
    expect(raw).not.toContain("email");
  });

  it("自分しか居なければ1件返る", async () => {
    await signIn(ALLOWED_EMAIL);

    const body = await jsonBody<Envelope<UserSummary[]>>(await authedFetch("/api/users"));

    expect(body.data).toHaveLength(1);
    expect(body.data?.[0]?.userId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("認証を通らないと 403", async () => {
    const res = await anonFetch("/api/users");
    const body = await jsonBody<Envelope<UserSummary[]>>(res);

    expect(res.status).toBe(403);
    expect(body.error?.code).toBe("FORBIDDEN");
  });
});
