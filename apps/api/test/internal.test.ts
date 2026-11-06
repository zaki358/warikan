import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { INTERNAL_TOKEN, authedFetch, internalFetch, jsonBody, jsonInit, resetDb } from "./helpers.js";

type ExpenseResult = {
  id: string;
  paidBy: string;
  amount: number;
  itemName: string;
  categoryId: number | null;
  spentOn: string;
  externalRef: string | null;
  created: boolean;
};
type Envelope<T> = { ok: boolean; data?: T; error?: { code: string; message: string } };

async function meId(): Promise<string> {
  const body = await jsonBody<Envelope<{ userId: string }>>(await authedFetch("/api/me"));
  return body.data!.userId;
}

const payload = (overrides: Record<string, unknown> = {}) => ({
  externalRef: "kakei:entry:1",
  ym: "2026-11",
  spentOn: "2026-11-05",
  amount: 3500,
  itemName: "食材",
  categoryName: "食費",
  ...overrides,
});

async function post(
  body: Record<string, unknown>,
  token: string | null = INTERNAL_TOKEN,
  configured: string | null = INTERNAL_TOKEN,
) {
  return internalFetch("/api/internal/expenses", jsonInit("POST", body), token, configured);
}

async function expenseCount(): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM monthly_expenses").first<{ n: number }>();
  return row?.n ?? 0;
}

describe("内部APIの認証", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("トークンヘッダが無ければ403", async () => {
    const res = await internalFetch("/api/internal/users", {}, null);

    expect(res.status).toBe(403);
  });

  it("トークンが違えば403", async () => {
    const res = await internalFetch("/api/internal/users", {}, "wrong-token");

    expect(res.status).toBe(403);
  });

  it("INTERNAL_API_TOKEN が未設定なら、正しいトークンを送っても403（キルスイッチ）", async () => {
    const res = await internalFetch("/api/internal/users", {}, INTERNAL_TOKEN, null);

    expect(res.status).toBe(403);
  });

  it("Access の JWT は不要（内部トークンだけで通る）", async () => {
    const res = await internalFetch("/api/internal/users");

    expect(res.status).toBe(200);
  });
});

describe("GET /api/internal/users", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("ユーザーの userId と displayName を返す", async () => {
    const userId = await meId();

    const body = await jsonBody<Envelope<{ userId: string; displayName: string }[]>>(
      await internalFetch("/api/internal/users"),
    );

    expect(body.data).toEqual([{ userId, displayName: "me" }]);
  });

  it("ユーザーが1人もいなければ空配列", async () => {
    const body = await jsonBody<Envelope<unknown[]>>(await internalFetch("/api/internal/users"));

    expect(body.data).toEqual([]);
  });
});

describe("POST /api/internal/expenses", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("支出を作成できる", async () => {
    const paidBy = await meId();
    const res = await post(payload({ paidBy }));
    const body = await jsonBody<Envelope<ExpenseResult>>(res);

    expect(res.status).toBe(201);
    expect(body.data?.created).toBe(true);
    expect(body.data?.amount).toBe(3500);
    expect(body.data?.itemName).toBe("食材");
    expect(body.data?.spentOn).toBe("2026-11-05");
    expect(body.data?.externalRef).toBe("kakei:entry:1");
  });

  it("作成した支出は画面向けAPIの一覧にも出る", async () => {
    const paidBy = await meId();
    await post(payload({ paidBy }));

    const body = await jsonBody<Envelope<{ expenses: { itemName: string }[] }>>(
      await authedFetch("/api/monthly/2026-11"),
    );

    expect(body.data?.expenses).toHaveLength(1);
    expect(body.data?.expenses[0]?.itemName).toBe("食材");
  });

  it("同じ externalRef で2回送っても1件のまま（2回目は created:false で同じidを返す）", async () => {
    const paidBy = await meId();
    const first = await jsonBody<Envelope<ExpenseResult>>(await post(payload({ paidBy })));

    const second = await post(payload({ paidBy }));
    const secondBody = await jsonBody<Envelope<ExpenseResult>>(second);

    expect(second.status).toBe(200);
    expect(secondBody.data?.created).toBe(false);
    expect(secondBody.data?.id).toBe(first.data?.id);
    expect(await expenseCount()).toBe(1);
  });

  it("externalRef が違えば別の支出として作られる", async () => {
    const paidBy = await meId();
    await post(payload({ paidBy }));
    await post(payload({ paidBy, externalRef: "kakei:entry:2" }));

    expect(await expenseCount()).toBe(2);
  });

  it("割り勘に無いカテゴリ名を送るとカテゴリが自動作成され、カテゴリ一覧にも出る", async () => {
    const paidBy = await meId();
    const body = await jsonBody<Envelope<ExpenseResult>>(
      await post(payload({ paidBy, categoryName: "消耗品" })),
    );

    const categories = await jsonBody<Envelope<{ id: number; name: string }[]>>(
      await authedFetch("/api/categories"),
    );
    const created = categories.data?.find((category) => category.name === "消耗品");

    expect(created).toBeDefined();
    expect(body.data?.categoryId).toBe(created?.id);
  });

  it("既にあるカテゴリ名なら作らずに既存のIDを使う", async () => {
    const paidBy = await meId();
    const before = await jsonBody<Envelope<{ id: number; name: string }[]>>(
      await authedFetch("/api/categories"),
    );
    const seeded = before.data?.find((category) => category.name === "食費");

    const body = await jsonBody<Envelope<ExpenseResult>>(await post(payload({ paidBy })));

    expect(before.data).toHaveLength(7);
    expect(body.data?.categoryId).toBe(seeded?.id);
  });

  it("categoryName を省略すると categoryId は null", async () => {
    const paidBy = await meId();
    const body = await jsonBody<Envelope<ExpenseResult>>(
      await post(payload({ paidBy, categoryName: undefined })),
    );

    expect(body.data?.categoryId).toBeNull();
  });

  it("対象月の外の日付は400", async () => {
    const paidBy = await meId();
    const res = await post(payload({ paidBy, spentOn: "2026-12-01" }));

    expect(res.status).toBe(400);
    expect(await expenseCount()).toBe(0);
  });

  it("実在しない日付は400", async () => {
    const paidBy = await meId();
    const res = await post(payload({ paidBy, ym: "2026-02", spentOn: "2026-02-30" }));

    expect(res.status).toBe(400);
  });

  it("存在しない支払者は400", async () => {
    const res = await post(payload({ paidBy: "no-such-user" }));

    expect(res.status).toBe(400);
    expect(await expenseCount()).toBe(0);
  });

  it("金額が0以下は400", async () => {
    const paidBy = await meId();
    const res = await post(payload({ paidBy, amount: 0 }));

    expect(res.status).toBe(400);
  });

  it("品目名が空は400", async () => {
    const paidBy = await meId();
    const res = await post(payload({ paidBy, itemName: "   " }));

    expect(res.status).toBe(400);
  });

  it("確定済みの月に反映すると is_dirty が立つ", async () => {
    const paidBy = await meId();
    await post(payload({ paidBy }));
    await env.DB.prepare("UPDATE monthly_periods SET status = 'settled', is_dirty = 0").run();

    await post(payload({ paidBy, externalRef: "kakei:entry:2" }));

    const row = await env.DB.prepare("SELECT is_dirty FROM monthly_periods").first<{ is_dirty: number }>();
    expect(row?.is_dirty).toBe(1);
  });
});

describe("DELETE /api/internal/expenses/:id", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("外部連携で作られた支出は削除できる", async () => {
    const paidBy = await meId();
    const created = await jsonBody<Envelope<ExpenseResult>>(await post(payload({ paidBy })));

    const res = await internalFetch(`/api/internal/expenses/${created.data!.id}`, { method: "DELETE" });

    expect(res.status).toBe(200);
    expect(await expenseCount()).toBe(0);
  });

  it("割り勘アプリ内で手入力した支出は削除できない（403）", async () => {
    const paidBy = await meId();
    const manual = await jsonBody<Envelope<{ id: string }>>(
      await authedFetch(
        "/api/monthly/2026-11/expenses",
        jsonInit("POST", { paidBy, amount: 1200, itemName: "牛乳", categoryId: 1, spentOn: "2026-11-05" }),
      ),
    );

    const res = await internalFetch(`/api/internal/expenses/${manual.data!.id}`, { method: "DELETE" });

    expect(res.status).toBe(403);
    expect(await expenseCount()).toBe(1);
  });

  it("存在しないIDは404", async () => {
    const res = await internalFetch("/api/internal/expenses/no-such-id", { method: "DELETE" });

    expect(res.status).toBe(404);
  });
});
