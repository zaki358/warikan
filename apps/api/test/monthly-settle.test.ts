import { beforeEach, describe, expect, it } from "vitest";

import { ALLOWED_EMAIL, PARTNER_EMAIL, authedFetch, jsonBody, jsonInit, resetDb } from "./helpers.js";

type Transfer = { fromId: string; toId: string; amount: number; isPaid: boolean };
type Snapshot = {
  total: number;
  perPerson: number;
  byUser: { userId: string; displayName: string; paid: number; share: number }[];
  byCategory: { categoryId: number | null; name: string; amount: number }[];
  transfers: Transfer[];
  settledAt: string;
};
type Envelope<T> = { ok: boolean; data?: T; error?: { code: string } };

async function userId(email: string): Promise<string> {
  const body = await jsonBody<Envelope<{ userId: string }>>(await authedFetch("/api/me", {}, email));
  return body.data!.userId;
}

async function add(paidBy: string, amount: number, categoryId: number, itemName = "x"): Promise<void> {
  const res = await authedFetch(
    "/api/monthly/2026-08/expenses",
    jsonInit("POST", { paidBy, amount, itemName, categoryId, spentOn: "2026-08-10" }),
  );
  if (res.status !== 201) throw new Error(`add failed: ${res.status} ${await res.text()}`);
}

describe("POST /api/monthly/:ym/settle", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("2人の支出を集計して1件の送金を返す", async () => {
    const me = await userId(ALLOWED_EMAIL);
    const partner = await userId(PARTNER_EMAIL);

    await add(me, 51000, 1);
    await add(partner, 33300, 2);

    const res = await authedFetch("/api/monthly/2026-08/settle", { method: "POST" });
    const body = await jsonBody<Envelope<Snapshot>>(res);

    expect(res.status).toBe(200);
    expect(body.data?.total).toBe(84300);
    expect(body.data?.perPerson).toBe(42150);
    expect(body.data?.transfers).toEqual([
      { fromId: partner, toId: me, amount: 8850, isPaid: false },
    ]);
  });

  it("byUser に各人の支払額と負担額が入る", async () => {
    const me = await userId(ALLOWED_EMAIL);
    const partner = await userId(PARTNER_EMAIL);

    await add(me, 51000, 1);
    await add(partner, 33300, 2);

    const body = await jsonBody<Envelope<Snapshot>>(
      await authedFetch("/api/monthly/2026-08/settle", { method: "POST" }),
    );
    const mine = body.data?.byUser.find((entry) => entry.userId === me);

    expect(mine?.paid).toBe(51000);
    expect(mine?.share).toBe(42150);
  });

  it("byCategory がカテゴリ別に合算され金額降順で並ぶ", async () => {
    const me = await userId(ALLOWED_EMAIL);

    await add(me, 3000, 1);
    await add(me, 5000, 2);
    await add(me, 4000, 1);

    const body = await jsonBody<Envelope<Snapshot>>(
      await authedFetch("/api/monthly/2026-08/settle", { method: "POST" }),
    );

    expect(body.data?.byCategory).toEqual([
      { categoryId: 1, name: "食費", amount: 7000 },
      { categoryId: 2, name: "日用品", amount: 5000 },
    ]);
  });

  it("同額のカテゴリは名前のコードユニット昇順で並ぶ", async () => {
    const me = await userId(ALLOWED_EMAIL);

    await add(me, 5000, 1);
    await add(me, 5000, 2);

    const body = await jsonBody<Envelope<Snapshot>>(
      await authedFetch("/api/monthly/2026-08/settle", { method: "POST" }),
    );

    // 日 (U+65E5) < 食 (U+98DF) なので、ロケールに依らず日用品が先に来る。
    // localeCompare を使うと環境の ICU データ次第で順序が変わりうる。
    expect(body.data?.byCategory.map((entry) => entry.name)).toEqual(["日用品", "食費"]);
  });

  it("確定すると status が settled になり is_dirty が下りる", async () => {
    const me = await userId(ALLOWED_EMAIL);
    await add(me, 1000, 1);

    await authedFetch("/api/monthly/2026-08/settle", { method: "POST" });

    const body = await jsonBody<Envelope<{ period: { status: string; isDirty: boolean } }>>(
      await authedFetch("/api/monthly/2026-08"),
    );

    expect(body.data?.period.status).toBe("settled");
    expect(body.data?.period.isDirty).toBe(false);
  });

  it("確定後に支出を足すと is_dirty が立つ", async () => {
    const me = await userId(ALLOWED_EMAIL);
    await add(me, 1000, 1);
    await authedFetch("/api/monthly/2026-08/settle", { method: "POST" });

    await add(me, 500, 1);

    const body = await jsonBody<Envelope<{ period: { isDirty: boolean } }>>(
      await authedFetch("/api/monthly/2026-08"),
    );

    expect(body.data?.period.isDirty).toBe(true);
  });

  it("支出が無い月を確定しても落ちない", async () => {
    await userId(ALLOWED_EMAIL);

    const res = await authedFetch("/api/monthly/2026-08/settle", { method: "POST" });
    const body = await jsonBody<Envelope<Snapshot>>(res);

    expect(res.status).toBe(200);
    expect(body.data?.total).toBe(0);
    expect(body.data?.transfers).toEqual([]);
  });
});

describe("GET /api/monthly/:ym/result", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("未確定の月は 404", async () => {
    await userId(ALLOWED_EMAIL);
    const res = await authedFetch("/api/monthly/2026-08/result");

    expect(res.status).toBe(404);
  });

  it("確定済みならスナップショットと isDirty を返す", async () => {
    const me = await userId(ALLOWED_EMAIL);
    await add(me, 1000, 1);
    await authedFetch("/api/monthly/2026-08/settle", { method: "POST" });

    const body = await jsonBody<Envelope<{ snapshot: Snapshot; isDirty: boolean }>>(
      await authedFetch("/api/monthly/2026-08/result"),
    );

    expect(body.data?.snapshot.total).toBe(1000);
    expect(body.data?.isDirty).toBe(false);
  });
});

describe("PATCH /api/monthly/:ym/result/transfers/:index", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function settleTwoPeople(): Promise<{ me: string; partner: string }> {
    const me = await userId(ALLOWED_EMAIL);
    const partner = await userId(PARTNER_EMAIL);
    await add(me, 10000, 1);
    await add(partner, 0, 1);
    await authedFetch("/api/monthly/2026-08/settle", { method: "POST" });
    return { me, partner };
  }

  it("支払い済みに切り替えられる", async () => {
    await settleTwoPeople();

    const res = await authedFetch(
      "/api/monthly/2026-08/result/transfers/0",
      jsonInit("PATCH", { isPaid: true }),
    );
    const body = await jsonBody<Envelope<Snapshot>>(res);

    expect(res.status).toBe(200);
    expect(body.data?.transfers[0]?.isPaid).toBe(true);
  });

  it("範囲外の index は 404", async () => {
    await settleTwoPeople();

    const res = await authedFetch(
      "/api/monthly/2026-08/result/transfers/9",
      jsonInit("PATCH", { isPaid: true }),
    );

    expect(res.status).toBe(404);
  });

  it("再計算で金額が変わらなければ isPaid を引き継ぐ", async () => {
    await settleTwoPeople();
    await authedFetch("/api/monthly/2026-08/result/transfers/0", jsonInit("PATCH", { isPaid: true }));

    const body = await jsonBody<Envelope<Snapshot>>(
      await authedFetch("/api/monthly/2026-08/settle", { method: "POST" }),
    );

    expect(body.data?.transfers[0]?.isPaid).toBe(true);
  });

  it("再計算で金額が変われば isPaid を false に戻す", async () => {
    const { me } = await settleTwoPeople();
    await authedFetch("/api/monthly/2026-08/result/transfers/0", jsonInit("PATCH", { isPaid: true }));

    await add(me, 2000, 1);

    const body = await jsonBody<Envelope<Snapshot>>(
      await authedFetch("/api/monthly/2026-08/settle", { method: "POST" }),
    );

    expect(body.data?.transfers[0]?.amount).toBe(6000);
    expect(body.data?.transfers[0]?.isPaid).toBe(false);
  });
});
