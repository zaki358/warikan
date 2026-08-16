import { Hono } from "hono";

import { updateDisplayName } from "../db/users.js";
import type { AppEnv } from "../env.js";
import { DISPLAY_NAME_ERROR, displayNameSchema } from "../lib/displayName.js";
import { fail, ok } from "../lib/response.js";

export const meRoutes = new Hono<AppEnv>();

meRoutes.get("/", (c) => {
  const user = c.get("user");
  return c.json(ok({ userId: user.id, email: user.email, displayName: user.displayName }));
});

meRoutes.patch("/", async (c) => {
  const parsed = displayNameSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(fail("VALIDATION_ERROR", DISPLAY_NAME_ERROR, { displayName: "1〜20文字" }), 400);
  }

  const user = c.get("user");
  await updateDisplayName(c.env.DB, user.id, parsed.data.displayName);

  return c.json(ok({ userId: user.id, email: user.email, displayName: parsed.data.displayName }));
});
