import { Hono } from "hono";
import { z } from "zod";

import { upsertCategoryByName } from "../db/categories.js";
import {
  deleteExpense,
  findExpenseByExternalRef,
  findExpenseById,
  getOrCreatePeriod,
  insertExpense,
} from "../db/monthly.js";
import type { MonthlyExpenseRow } from "../db/rows.js";
import { findUserById, listUsers } from "../db/users.js";
import type { AppEnv } from "../env.js";
import { fail, ok } from "../lib/response.js";
import { parseYm, spentOnInPeriod } from "../lib/ym.js";
import { internalAuth } from "../middleware/internalAuth.js";

/**
 * 外部アプリ（家計簿ダッシュボード）向けの内部API。
 *
 * Cloudflare Access ではなく共有トークン（internalAuth）で認証する。
 * Service Binding 経由の呼び出しは Access のエッジを通らないため。
 *
 * 画面向けのAPI（/api/monthly など）とは分けてある。こちら側だけが
 * 「カテゴリ名での自動作成」と「由来キーによる冪等性」を持つ。
 */
export const internalRoutes = new Hono<AppEnv>();

internalRoutes.use("*", internalAuth());

const toExpenseJson = (row: MonthlyExpenseRow) => ({
  id: row.id,
  paidBy: row.paid_by,
  amount: row.amount,
  itemName: row.item_name,
  categoryId: row.category_id,
  spentOn: row.spent_on,
  externalRef: row.external_ref,
});

internalRoutes.get("/users", async (c) => {
  const rows = await listUsers(c.env.DB);

  return c.json(ok(rows.map((row) => ({ userId: row.id, displayName: row.display_name }))));
});

const expenseSchema = z.object({
  externalRef: z.string().trim().min(1).max(100),
  ym: z.string().regex(/^\d{4}-\d{2}$/),
  spentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paidBy: z.string().min(1),
  amount: z.number().int().min(1).max(10_000_000),
  itemName: z.string().trim().min(1).max(60),
  categoryName: z.string().trim().min(1).max(20).nullable().optional(),
});

internalRoutes.post("/expenses", async (c) => {
  const parsed = expenseSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(fail("VALIDATION_ERROR", "入力内容を確認してください"), 400);
  }

  const payload = parsed.data;
  const parsedYm = parseYm(payload.ym);
  if (!parsedYm) {
    return c.json(fail("VALIDATION_ERROR", "年月は YYYY-MM 形式で指定してください", { ym: "YYYY-MM" }), 400);
  }

  if (!spentOnInPeriod(payload.spentOn, parsedYm.year, parsedYm.month)) {
    return c.json(fail("VALIDATION_ERROR", "日付はその月の範囲で指定してください", { spentOn: "対象月外" }), 400);
  }

  // 冪等性: 同じ由来キーで二度呼ばれたら、新しく作らず既存の行をそのまま返す。
  const existing = await findExpenseByExternalRef(c.env.DB, payload.externalRef);
  if (existing) {
    return c.json(ok({ ...toExpenseJson(existing), created: false }));
  }

  const user = await findUserById(c.env.DB, payload.paidBy);
  if (!user) {
    return c.json(fail("VALIDATION_ERROR", "支払者が見つかりません", { paidBy: "存在しないユーザー" }), 400);
  }

  const categoryId = payload.categoryName ? await upsertCategoryByName(c.env.DB, payload.categoryName) : null;
  const period = await getOrCreatePeriod(c.env.DB, parsedYm.year, parsedYm.month);

  try {
    const row = await insertExpense(c.env.DB, {
      periodId: period.id,
      paidBy: payload.paidBy,
      amount: payload.amount,
      itemName: payload.itemName,
      categoryId,
      spentOn: payload.spentOn,
      externalRef: payload.externalRef,
    });

    return c.json(ok({ ...toExpenseJson(row), created: true }), 201);
  } catch (error: unknown) {
    // external_ref の UNIQUE インデックス違反 = ほぼ同時に同じエントリが反映された。
    // 先に入った行を返せば結果は同じなので、エラーにはしない。
    const raced = await findExpenseByExternalRef(c.env.DB, payload.externalRef);
    if (raced) {
      return c.json(ok({ ...toExpenseJson(raced), created: false }));
    }
    throw error;
  }
});

internalRoutes.delete("/expenses/:id", async (c) => {
  const existing = await findExpenseById(c.env.DB, c.req.param("id"));
  if (!existing) {
    return c.json(fail("NOT_FOUND", "支出が見つかりません"), 404);
  }

  // 割り勘アプリ内で手入力した支出を外部から消せないようにする安全弁。
  if (existing.external_ref === null) {
    return c.json(fail("FORBIDDEN", "外部連携で作られた支出ではありません"), 403);
  }

  await deleteExpense(c.env.DB, existing.id, existing.period_id);

  return c.json(ok({ id: existing.id, deleted: true }));
});
