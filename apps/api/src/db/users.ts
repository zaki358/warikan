import { newId, nowIso } from "../lib/ids.js";
import type { UserRow } from "./rows.js";

export async function findUserByEmail(db: D1Database, email: string): Promise<UserRow | null> {
  return db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<UserRow>();
}

export async function findUserById(db: D1Database, id: string): Promise<UserRow | null> {
  return db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
}

export async function listUsers(db: D1Database): Promise<UserRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM users ORDER BY created_at, id")
    .all<UserRow>();
  return results;
}

export async function createUser(db: D1Database, email: string, displayName: string): Promise<UserRow> {
  const row: UserRow = {
    id: newId(),
    email,
    display_name: displayName,
    created_at: nowIso(),
  };

  await db
    .prepare("INSERT INTO users (id, email, display_name, created_at) VALUES (?, ?, ?, ?)")
    .bind(row.id, row.email, row.display_name, row.created_at)
    .run();

  return row;
}

export async function updateDisplayName(
  db: D1Database,
  userId: string,
  displayName: string,
): Promise<void> {
  await db
    .prepare("UPDATE users SET display_name = ? WHERE id = ?")
    .bind(displayName, userId)
    .run();
}
