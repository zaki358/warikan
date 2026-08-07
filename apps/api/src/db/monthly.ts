import { newId, nowIso } from "../lib/ids.js";
import type { MonthlyExpenseRow, MonthlyPeriodRow } from "./rows.js";

export async function getOrCreatePeriod(
  db: D1Database,
  year: number,
  month: number,
): Promise<MonthlyPeriodRow> {
  await db
    .prepare(
      `INSERT INTO monthly_periods (id, year, month, status, is_dirty, created_at)
       VALUES (?, ?, ?, 'open', 0, ?)
       ON CONFLICT (year, month) DO NOTHING`,
    )
    .bind(newId(), year, month, nowIso())
    .run();

  const row = await db
    .prepare("SELECT * FROM monthly_periods WHERE year = ? AND month = ?")
    .bind(year, month)
    .first<MonthlyPeriodRow>();

  if (!row) throw new Error(`period not found after insert: ${year}-${month}`);
  return row;
}

export async function findPeriodById(db: D1Database, id: string): Promise<MonthlyPeriodRow | null> {
  return db.prepare("SELECT * FROM monthly_periods WHERE id = ?").bind(id).first<MonthlyPeriodRow>();
}

export async function listPeriods(db: D1Database): Promise<MonthlyPeriodRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM monthly_periods ORDER BY year DESC, month DESC")
    .all<MonthlyPeriodRow>();
  return results;
}

export async function listExpenses(db: D1Database, periodId: string): Promise<MonthlyExpenseRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM monthly_expenses WHERE period_id = ? ORDER BY spent_on DESC, created_at DESC")
    .bind(periodId)
    .all<MonthlyExpenseRow>();
  return results;
}

export async function sumByPeriod(db: D1Database, periodId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM monthly_expenses WHERE period_id = ?")
    .bind(periodId)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

export type ExpenseInput = {
  periodId: string;
  paidBy: string;
  amount: number;
  itemName: string;
  categoryId: number | null;
  spentOn: string;
};

export async function findExpenseById(db: D1Database, id: string): Promise<MonthlyExpenseRow | null> {
  return db.prepare("SELECT * FROM monthly_expenses WHERE id = ?").bind(id).first<MonthlyExpenseRow>();
}

/**
 * 確定済み（status='settled'）の期間だけ is_dirty を立てる文を返す。
 * 呼び出し側で本体の更新文と一緒に batch に渡し、原子的に実行する。
 */
export const markDirtyStatement = (db: D1Database, periodId: string) =>
  db
    .prepare("UPDATE monthly_periods SET is_dirty = 1 WHERE id = ? AND status = 'settled'")
    .bind(periodId);

export async function insertExpense(db: D1Database, input: ExpenseInput): Promise<MonthlyExpenseRow> {
  const timestamp = nowIso();
  const row: MonthlyExpenseRow = {
    id: newId(),
    period_id: input.periodId,
    paid_by: input.paidBy,
    amount: input.amount,
    item_name: input.itemName,
    category_id: input.categoryId,
    spent_on: input.spentOn,
    created_at: timestamp,
    updated_at: timestamp,
  };

  await db.batch([
    db
      .prepare(
        `INSERT INTO monthly_expenses
           (id, period_id, paid_by, amount, item_name, category_id, spent_on, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        row.id,
        row.period_id,
        row.paid_by,
        row.amount,
        row.item_name,
        row.category_id,
        row.spent_on,
        row.created_at,
        row.updated_at,
      ),
    markDirtyStatement(db, input.periodId),
  ]);

  return row;
}

export async function updateExpense(
  db: D1Database,
  id: string,
  periodId: string,
  patch: { paidBy: string; amount: number; itemName: string; categoryId: number | null; spentOn: string },
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `UPDATE monthly_expenses
            SET paid_by = ?, amount = ?, item_name = ?, category_id = ?, spent_on = ?, updated_at = ?
          WHERE id = ?`,
      )
      .bind(patch.paidBy, patch.amount, patch.itemName, patch.categoryId, patch.spentOn, nowIso(), id),
    markDirtyStatement(db, periodId),
  ]);
}

export async function deleteExpense(db: D1Database, id: string, periodId: string): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM monthly_expenses WHERE id = ?").bind(id),
    markDirtyStatement(db, periodId),
  ]);
}
