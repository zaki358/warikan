import { Hono } from "hono";

import { getOrCreatePeriod, listExpenses, listPeriods } from "../db/monthly.js";
import type { MonthlyExpenseRow, MonthlyPeriodRow } from "../db/rows.js";
import type { AppEnv } from "../env.js";
import { fail, ok } from "../lib/response.js";
import { formatYm, parseYm } from "../lib/ym.js";

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
