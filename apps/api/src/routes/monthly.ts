import { Hono } from "hono";
import { z } from "zod";

import { categoryExists } from "../db/categories.js";
import {
  deleteExpense,
  findExpenseById,
  findPeriodById,
  getOrCreatePeriod,
  insertExpense,
  listExpenses,
  listPeriods,
  updateExpense,
} from "../db/monthly.js";
import type { MonthlyExpenseRow, MonthlyPeriodRow } from "../db/rows.js";
import { findUserById } from "../db/users.js";
import type { AppEnv } from "../env.js";
import { fail, ok } from "../lib/response.js";
import { daysInMonth, formatYm, parseYm } from "../lib/ym.js";

export const monthlyRoutes = new Hono<AppEnv>();

const toPeriodJson = (row: MonthlyPeriodRow) => ({
  ym: formatYm(row.year, row.month),
  year: row.year,
  month: row.month,
  status: row.status,
  isDirty: row.is_dirty === 1,
  settledAt: row.settled_at,
});

const toExpenseJson = (row: MonthlyExpenseRow) => ({
  id: row.id,
  paidBy: row.paid_by,
  amount: row.amount,
  itemName: row.item_name,
  categoryId: row.category_id,
  spentOn: row.spent_on,
});

const invalidYm = () => fail("VALIDATION_ERROR", "年月は YYYY-MM 形式で指定してください", { ym: "YYYY-MM" });

monthlyRoutes.get("/", async (c) => {
  const rows = await listPeriods(c.env.DB);
  return c.json(ok(rows.map(toPeriodJson)));
});

monthlyRoutes.get("/:ym", async (c) => {
  const parsed = parseYm(c.req.param("ym"));
  if (!parsed) return c.json(invalidYm(), 400);

  const period = await getOrCreatePeriod(c.env.DB, parsed.year, parsed.month);
  const expenses = await listExpenses(c.env.DB, period.id);

  return c.json(ok({ period: toPeriodJson(period), expenses: expenses.map(toExpenseJson) }));
});

const expenseSchema = z.object({
  paidBy: z.string().min(1),
  amount: z.number().int().min(0).max(10_000_000),
  itemName: z.string().trim().min(1).max(60),
  categoryId: z.number().int().positive().nullable().optional(),
  spentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

type ExpensePayload = z.infer<typeof expenseSchema>;

/** spentOn がその年月の実在する日付かを確認する。 */
function spentOnInPeriod(spentOn: string, year: number, month: number): boolean {
  const [y, m, d] = spentOn.split("-").map(Number);
  if (y !== year || m !== month) return false;
  return d !== undefined && d >= 1 && d <= daysInMonth(year, month);
}

/** 支払者とカテゴリの実在を確認する。問題があればエラーメッセージを返す。 */
async function validateRefs(
  db: D1Database,
  payload: ExpensePayload,
): Promise<{ message: string; fields: Record<string, string> } | null> {
  const user = await findUserById(db, payload.paidBy);
  if (!user) return { message: "支払者が見つかりません", fields: { paidBy: "存在しないユーザー" } };

  const categoryId = payload.categoryId ?? null;
  if (categoryId !== null && !(await categoryExists(db, categoryId))) {
    return { message: "カテゴリが見つかりません", fields: { categoryId: "存在しないカテゴリ" } };
  }

  return null;
}

monthlyRoutes.post("/:ym/expenses", async (c) => {
  const parsedYm = parseYm(c.req.param("ym"));
  if (!parsedYm) return c.json(invalidYm(), 400);

  const parsed = expenseSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(fail("VALIDATION_ERROR", "入力内容を確認してください"), 400);
  }

  if (!spentOnInPeriod(parsed.data.spentOn, parsedYm.year, parsedYm.month)) {
    return c.json(
      fail("VALIDATION_ERROR", "日付はその月の範囲で指定してください", { spentOn: "対象月外" }),
      400,
    );
  }

  const refError = await validateRefs(c.env.DB, parsed.data);
  if (refError) return c.json(fail("VALIDATION_ERROR", refError.message, refError.fields), 400);

  const period = await getOrCreatePeriod(c.env.DB, parsedYm.year, parsedYm.month);
  const row = await insertExpense(c.env.DB, {
    periodId: period.id,
    paidBy: parsed.data.paidBy,
    amount: parsed.data.amount,
    itemName: parsed.data.itemName,
    categoryId: parsed.data.categoryId ?? null,
    spentOn: parsed.data.spentOn,
  });

  return c.json(ok(toExpenseJson(row)), 201);
});

monthlyRoutes.patch("/expenses/:id", async (c) => {
  const existing = await findExpenseById(c.env.DB, c.req.param("id"));
  if (!existing) return c.json(fail("NOT_FOUND", "支出が見つかりません"), 404);

  const period = await findPeriodById(c.env.DB, existing.period_id);
  if (!period) return c.json(fail("NOT_FOUND", "期間が見つかりません"), 404);

  const merged = {
    paidBy: existing.paid_by,
    amount: existing.amount,
    itemName: existing.item_name,
    categoryId: existing.category_id,
    spentOn: existing.spent_on,
    ...((await c.req.json().catch(() => ({}))) as Partial<ExpensePayload>),
  };

  const parsed = expenseSchema.safeParse(merged);
  if (!parsed.success) return c.json(fail("VALIDATION_ERROR", "入力内容を確認してください"), 400);

  if (!spentOnInPeriod(parsed.data.spentOn, period.year, period.month)) {
    return c.json(
      fail("VALIDATION_ERROR", "日付はその月の範囲で指定してください", { spentOn: "対象月外" }),
      400,
    );
  }

  const refError = await validateRefs(c.env.DB, parsed.data);
  if (refError) return c.json(fail("VALIDATION_ERROR", refError.message, refError.fields), 400);

  await updateExpense(c.env.DB, existing.id, period.id, {
    paidBy: parsed.data.paidBy,
    amount: parsed.data.amount,
    itemName: parsed.data.itemName,
    categoryId: parsed.data.categoryId ?? null,
    spentOn: parsed.data.spentOn,
  });

  const updated = await findExpenseById(c.env.DB, existing.id);
  return c.json(ok(toExpenseJson(updated!)));
});

monthlyRoutes.delete("/expenses/:id", async (c) => {
  const existing = await findExpenseById(c.env.DB, c.req.param("id"));
  if (!existing) return c.json(fail("NOT_FOUND", "支出が見つかりません"), 404);

  await deleteExpense(c.env.DB, existing.id, existing.period_id);

  return c.json(ok({ id: existing.id }));
});
