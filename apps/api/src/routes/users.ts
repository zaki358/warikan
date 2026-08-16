import { Hono } from "hono";

import { findUserById, listUsers, updateDisplayName } from "../db/users.js";
import type { AppEnv } from "../env.js";
import { DISPLAY_NAME_ERROR, displayNameSchema } from "../lib/displayName.js";
import { fail, ok } from "../lib/response.js";

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

/**
 * 表示名の変更。夫婦2人だけのアプリなので、自分・相手のどちらの表示名も
 * 双方が変更してよい（設定画面から一括で直せるようにするための決定）。
 *
 * email は返さない（GET と同じ方針）。
 */
userRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");

  const existing = await findUserById(c.env.DB, id);
  if (!existing) {
    return c.json(fail("NOT_FOUND", "見つかりません"), 404);
  }

  const parsed = displayNameSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(fail("VALIDATION_ERROR", DISPLAY_NAME_ERROR, { displayName: "1〜20文字" }), 400);
  }

  await updateDisplayName(c.env.DB, id, parsed.data.displayName);

  return c.json(ok({ userId: id, displayName: parsed.data.displayName }));
});
