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

/**
 * 名前でカテゴリを引き、無ければ作る。
 *
 * 家計簿ダッシュボードから反映されたカテゴリ名をそのまま受け入れるための入口。
 * カテゴリの正本は家計簿側なので、割り勘アプリ側では対応表を持たずに
 * 「使われた名前がそのまま生える」方式にしている。
 *
 * - name は UNIQUE なので ON CONFLICT で競合しても1行に収まる。
 * - sort_order = 900 で seed の7個（10〜99）より後ろに並べ、手入力フォームの
 *   ドロップダウンの先頭を荒らさない。
 * - 既存行が is_active = 0 だった場合は 1 に戻す。家計簿側で実際に使われている
 *   カテゴリなので、非表示のままだと一覧でカテゴリ名が出なくなる。
 */
export async function upsertCategoryByName(db: D1Database, name: string): Promise<number> {
  await db
    .prepare(
      `INSERT INTO categories (name, sort_order, is_active)
       VALUES (?, 900, 1)
       ON CONFLICT (name) DO UPDATE SET is_active = 1`,
    )
    .bind(name)
    .run();

  const row = await db
    .prepare("SELECT id FROM categories WHERE name = ?")
    .bind(name)
    .first<{ id: number }>();

  if (!row) throw new Error(`category not found after upsert: ${name}`);
  return row.id;
}
