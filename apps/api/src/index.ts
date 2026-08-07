import { Hono } from "hono";

import type { AppEnv } from "./env.js";
import { ok } from "./lib/response.js";
import { accessAuth } from "./middleware/auth.js";
import { onError } from "./middleware/errors.js";
import { categoryRoutes } from "./routes/categories.js";
import { eventRoutes } from "./routes/events.js";
import { meRoutes } from "./routes/me.js";
import { monthlyRoutes } from "./routes/monthly.js";

const app = new Hono<AppEnv>();

app.onError(onError);

app.get("/api/health", (c) => c.json(ok({ status: "ok" })));

app.use("/api/*", accessAuth());

app.route("/api/me", meRoutes);
app.route("/api/categories", categoryRoutes);
app.route("/api/monthly", monthlyRoutes);
app.route("/api/events", eventRoutes);

app.notFound((c) => c.json({ ok: false, error: { code: "NOT_FOUND", message: "見つかりません" } }, 404));

export default app;
