import { beforeEach, describe, expect, it } from "vitest";

import { MAX_DISPLAY_NAME } from "../src/lib/displayName.js";
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

  it("見えない文字を落として保存する", async () => {
    // スキーマは PATCH /api/users/:id と共有している。片方の口だけ
    // 素通りすることが無いよう、両方で同じ挙動を固定する。
    await authedFetch("/api/me");

    const zwsp = String.fromCharCode(0x200b);
    const res = await authedFetch("/api/me", jsonInit("PATCH", { displayName: `${zwsp}僕${zwsp}` }));
    const body = await jsonBody<Envelope<MeData>>(res);

    expect(res.status).toBe(200);
    expect(body.data?.displayName).toBe("僕");
  });

  it("400 の fields は上限の定数から作られている", async () => {
    // ここをベタ書きにすると MAX_DISPLAY_NAME を変えたとき黙ってズレる。
    const res = await authedFetch("/api/me", jsonInit("PATCH", { displayName: "" }));
    const body = await jsonBody<Envelope<MeData>>(res);

    expect(body.error?.fields?.displayName).toBe(`1〜${MAX_DISPLAY_NAME}文字`);
  });
});
