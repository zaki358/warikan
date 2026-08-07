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
