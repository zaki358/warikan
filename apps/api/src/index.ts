import { Hono } from "hono";

import type { AppEnv } from "./env.js";
import { ok } from "./lib/response.js";
import { accessAuth } from "./middleware/auth.js";
import { onError } from "./middleware/errors.js";
import { categoryRoutes } from "./routes/categories.js";
import { eventRoutes } from "./routes/events.js";
import { internalRoutes } from "./routes/internal.js";
import { meRoutes } from "./routes/me.js";
import { monthlyRoutes } from "./routes/monthly.js";
import { userRoutes } from "./routes/users.js";

const app = new Hono<AppEnv>();

app.onError(onError);

app.get("/api/health", (c) => c.json(ok({ status: "ok" })));

// 外部アプリ（家計簿ダッシュボード）向けの内部API。
// Service Binding 経由では Cloudflare Access の JWT が付かないため accessAuth より前に
// 登録し、内部用の共有トークンで認証する（internalRoutes 側で internalAuth を適用）。
// パスを /api/ 配下にしているのは wrangler.jsonc の run_worker_first が "/api/*" のため。
// /internal/* などにすると assets の SPA フォールバックに食われて Worker に届かない。
app.route("/api/internal", internalRoutes);

app.use("/api/*", accessAuth());

app.route("/api/me", meRoutes);
app.route("/api/users", userRoutes);
app.route("/api/categories", categoryRoutes);
app.route("/api/monthly", monthlyRoutes);
app.route("/api/events", eventRoutes);

app.notFound((c) => c.json({ ok: false, error: { code: "NOT_FOUND", message: "見つかりません" } }, 404));

export default app;
