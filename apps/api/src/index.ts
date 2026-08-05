import { Hono } from "hono";

import type { AppEnv } from "./env.js";
import { ok } from "./lib/response.js";
import { onError } from "./middleware/errors.js";

const app = new Hono<AppEnv>();

app.onError(onError);

app.get("/api/health", (c) => c.json(ok({ status: "ok" })));

app.notFound((c) => c.json({ ok: false, error: { code: "NOT_FOUND", message: "見つかりません" } }, 404));

export default app;
