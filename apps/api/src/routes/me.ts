import { Hono } from "hono";
import { z } from "zod";

import { updateDisplayName } from "../db/users.js";
import type { AppEnv } from "../env.js";
import { fail, ok } from "../lib/response.js";

const patchSchema = z.object({
  displayName: z.string().trim().min(1).max(20),
});

export const meRoutes = new Hono<AppEnv>();

meRoutes.get("/", (c) => {
  const user = c.get("user");
  return c.json(ok({ userId: user.id, email: user.email, displayName: user.displayName }));
});

meRoutes.patch("/", async (c) => {
  const parsed = patchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(fail("VALIDATION_ERROR", "表示名は1〜20文字で入力してください", { displayName: "1〜20文字" }), 400);
  }

  const user = c.get("user");
  await updateDisplayName(c.env.DB, user.id, parsed.data.displayName);

  return c.json(ok({ userId: user.id, email: user.email, displayName: parsed.data.displayName }));
});
