import type { CategoryRow } from "./rows.js";

export async function listActiveCategories(db: D1Database): Promise<CategoryRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order, id")
    .all<CategoryRow>();
  return results;
}

export async function categoryExists(db: D1Database, id: number): Promise<boolean> {
  const row = await db
    .prepare("SELECT id FROM categories WHERE id = ? AND is_active = 1")
    .bind(id)
    .first<{ id: number }>();
  return row !== null;
}
