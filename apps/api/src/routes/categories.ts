import { Hono } from "hono";

import { listActiveCategories } from "../db/categories.js";
import type { AppEnv } from "../env.js";
import { ok } from "../lib/response.js";

export const categoryRoutes = new Hono<AppEnv>();

categoryRoutes.get("/", async (c) => {
  const rows = await listActiveCategories(c.env.DB);

  return c.json(ok(rows.map((row) => ({ id: row.id, name: row.name }))));
});
