import { beforeEach, describe, expect, it } from "vitest";

import { ALLOWED_EMAIL, authedFetch, jsonBody, jsonInit, resetDb } from "./helpers.js";

type MeData = { userId: string; email: string; displayName: string };
type Envelope<T> = { ok: boolean; data?: T; error?: { code: string; fields?: Record<string, string> } };

describe("GET /api/me", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("自分の情報を返す", async () => {
    const res = await authedFetch("/api/me");
    const body = await jsonBody<Envelope<MeData>>(res);

    expect(res.status).toBe(200);
    expect(body.data?.email).toBe(ALLOWED_EMAIL);
    expect(body.data?.displayName).toBe("me");
    expect(body.data?.userId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("PATCH /api/me", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("表示名を変更できる", async () => {
    await authedFetch("/api/me");

    const res = await authedFetch("/api/me", jsonInit("PATCH", { displayName: "僕" }));
    const body = await jsonBody<Envelope<MeData>>(res);

    expect(res.status).toBe(200);
    expect(body.data?.displayName).toBe("僕");

    const after = await jsonBody<Envelope<MeData>>(await authedFetch("/api/me"));
    expect(after.data?.displayName).toBe("僕");
  });

  it("空の表示名は 400", async () => {
    const res = await authedFetch("/api/me", jsonInit("PATCH", { displayName: "   " }));

    expect(res.status).toBe(400);
    const body = await jsonBody<Envelope<MeData>>(res);
    expect(body.error?.code).toBe("VALIDATION_ERROR");
  });

  it("21文字以上の表示名は 400", async () => {
    const res = await authedFetch("/api/me", jsonInit("PATCH", { displayName: "あ".repeat(21) }));

    expect(res.status).toBe(400);
  });
});
