import { Hono } from "hono";

import { listUsers } from "../db/users.js";
import type { AppEnv } from "../env.js";
import { ok } from "../lib/response.js";

export const userRoutes = new Hono<AppEnv>();

/**
 * 登録済みユーザーの一覧。月次の支払者トグルが使う。
 *
 * email は返さない。画面が要るのは表示名だけで、相手のメールアドレスを
 * 配る理由が無い（GET /api/me は自分の分だけ返す）。
 */
userRoutes.get("/", async (c) => {
  const rows = await listUsers(c.env.DB);

  return c.json(ok(rows.map((row) => ({ userId: row.id, displayName: row.display_name }))));
});
