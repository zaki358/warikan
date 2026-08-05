import { HTTPException } from "hono/http-exception";
import type { ErrorHandler } from "hono";

import type { AppEnv } from "../env.js";
import { fail } from "../lib/response.js";

export const onError: ErrorHandler<AppEnv> = (err, c) => {
  if (err instanceof HTTPException) {
    return c.json(fail(err.message || "HTTP_ERROR", err.message), err.status);
  }

  // 内部エラーの詳細はクライアントに返さない
  console.error("unhandled error", err);
  return c.json(fail("INTERNAL_ERROR", "処理中にエラーが発生しました"), 500);
};
