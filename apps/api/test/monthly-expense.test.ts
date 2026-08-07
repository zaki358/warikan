import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { authedFetch, jsonBody, jsonInit, resetDb } from "./helpers.js";

type Expense = {
  id: string;
  paidBy: string;
  amount: number;
  itemName: string;
  categoryId: number | null;
  spentOn: string;
};
type Envelope<T> = { ok: boolean; data?: T; error?: { code: string } };

async function meId(): Promise<string> {
  const body = await jsonBody<Envelope<{ userId: string }>>(await authedFetch("/api/me"));
  return body.data!.userId;
}

async function addExpense(overrides: Partial<Expense> = {}): Promise<Expense> {
  const userId = await meId();
  const res = await authedFetch(
    "/api/monthly/2026-08/expenses",
    jsonInit("POST", {
      paidBy: userId,
      amount: 1200,
      itemName: "牛乳と卵",
      categoryId: 1,
      spentOn: "2026-08-03",
      ...overrides,
    }),
  );
  const body = await jsonBody<Envelope<Expense>>(res);
  if (!body.data) throw new Error(`addExpense failed: ${res.status} ${JSON.stringify(body)}`);
  return body.data;
}

describe("POST /api/monthly/:ym/expenses", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("支出を追加できる", async () => {
    const expense = await addExpense();

    expect(expense.amount).toBe(1200);
    expect(expense.itemName).toBe("牛乳と卵");
    expect(expense.spentOn).toBe("2026-08-03");
    expect(expense.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("追加した支出が一覧に出る", async () => {
    await addExpense({ itemName: "ティッシュ" });

    const body = await jsonBody<Envelope<{ expenses: Expense[] }>>(await authedFetch("/api/monthly/2026-08"));

    expect(body.data?.expenses).toHaveLength(1);
    expect(body.data?.expenses[0]?.itemName).toBe("ティッシュ");
  });

  it("金額が負なら 400", async () => {
    const userId = await meId();
    const res = await authedFetch(
      "/api/monthly/2026-08/expenses",
      jsonInit("POST", { paidBy: userId, amount: -1, itemName: "x", categoryId: 1, spentOn: "2026-08-03" }),
    );

    expect(res.status).toBe(400);
  });

  it("金額が小数なら 400", async () => {
    const userId = await meId();
    const res = await authedFetch(
      "/api/monthly/2026-08/expenses",
      jsonInit("POST", { paidBy: userId, amount: 10.5, itemName: "x", categoryId: 1, spentOn: "2026-08-03" }),
    );

    expect(res.status).toBe(400);
  });

  it("品目名が空なら 400", async () => {
    const userId = await meId();
    const res = await authedFetch(
      "/api/monthly/2026-08/expenses",
      jsonInit("POST", { paidBy: userId, amount: 100, itemName: "  ", categoryId: 1, spentOn: "2026-08-03" }),
    );

    expect(res.status).toBe(400);
  });

  it("その月に属さない日付なら 400", async () => {
    const userId = await meId();
    const res = await authedFetch(
      "/api/monthly/2026-08/expenses",
      jsonInit("POST", { paidBy: userId, amount: 100, itemName: "x", categoryId: 1, spentOn: "2026-09-01" }),
    );

    expect(res.status).toBe(400);
  });

  it("存在しないユーザーを支払者にすると 400", async () => {
    const res = await authedFetch(
      "/api/monthly/2026-08/expenses",
      jsonInit("POST", {
        paidBy: "00000000-0000-0000-0000-000000000000",
        amount: 100,
        itemName: "x",
        categoryId: 1,
        spentOn: "2026-08-03",
      }),
    );

    expect(res.status).toBe(400);
  });

  it("存在しないカテゴリなら 400", async () => {
    const userId = await meId();
    const res = await authedFetch(
      "/api/monthly/2026-08/expenses",
      jsonInit("POST", { paidBy: userId, amount: 100, itemName: "x", categoryId: 9999, spentOn: "2026-08-03" }),
    );

    expect(res.status).toBe(400);
  });
});

describe("PATCH / DELETE /api/monthly/expenses/:id", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("支出を更新できる", async () => {
    const created = await addExpense();

    const res = await authedFetch(
      `/api/monthly/expenses/${created.id}`,
      jsonInit("PATCH", { amount: 2000, itemName: "牛乳と卵とパン" }),
    );
    const body = await jsonBody<Envelope<Expense>>(res);

    expect(res.status).toBe(200);
    expect(body.data?.amount).toBe(2000);
    expect(body.data?.itemName).toBe("牛乳と卵とパン");
  });

  it("支出を削除できる", async () => {
    const created = await addExpense();

    const res = await authedFetch(`/api/monthly/expenses/${created.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);

    const body = await jsonBody<Envelope<{ expenses: Expense[] }>>(await authedFetch("/api/monthly/2026-08"));
    expect(body.data?.expenses).toEqual([]);
  });

  it("存在しない支出の更新は 404", async () => {
    const res = await authedFetch(
      "/api/monthly/expenses/00000000-0000-0000-0000-000000000000",
      jsonInit("PATCH", { amount: 1 }),
    );

    expect(res.status).toBe(404);
  });

  it("存在しない支出の削除は 404", async () => {
    const res = await authedFetch("/api/monthly/expenses/00000000-0000-0000-0000-000000000000", {
      method: "DELETE",
    });

    expect(res.status).toBe(404);
  });
});

describe("確定済み期間への変更は is_dirty を立てる", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function markSettled(): Promise<string> {
    const body = await jsonBody<Envelope<{ period: { ym: string } }>>(await authedFetch("/api/monthly/2026-08"));
    void body;
    const row = await env.DB.prepare("SELECT id FROM monthly_periods WHERE year = 2026 AND month = 8").first<{
      id: string;
    }>();
    await env.DB.prepare("UPDATE monthly_periods SET status = 'settled', is_dirty = 0 WHERE id = ?")
      .bind(row!.id)
      .run();
    return row!.id;
  }

  async function isDirty(periodId: string): Promise<number> {
    const row = await env.DB.prepare("SELECT is_dirty FROM monthly_periods WHERE id = ?")
      .bind(periodId)
      .first<{ is_dirty: number }>();
    return row!.is_dirty;
  }

  it("追加で is_dirty が 1 になる", async () => {
    await meId();
    const periodId = await markSettled();

    await addExpense();

    expect(await isDirty(periodId)).toBe(1);
  });

  it("更新で is_dirty が 1 になる", async () => {
    const created = await addExpense();
    const periodId = await markSettled();

    await authedFetch(`/api/monthly/expenses/${created.id}`, jsonInit("PATCH", { amount: 999 }));

    expect(await isDirty(periodId)).toBe(1);
  });

  it("削除で is_dirty が 1 になる", async () => {
    const created = await addExpense();
    const periodId = await markSettled();

    await authedFetch(`/api/monthly/expenses/${created.id}`, { method: "DELETE" });

    expect(await isDirty(periodId)).toBe(1);
  });

  it("open の期間では is_dirty は 0 のまま", async () => {
    await addExpense();

    const row = await env.DB.prepare("SELECT is_dirty FROM monthly_periods WHERE year = 2026 AND month = 8").first<{
      is_dirty: number;
    }>();

    expect(row?.is_dirty).toBe(0);
  });
});
