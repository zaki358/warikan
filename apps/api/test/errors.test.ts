import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";

import type { AppEnv } from "../src/env.js";
import { onError } from "../src/middleware/errors.js";

type Envelope = { ok: boolean; error?: { code: string; message: string } };

// db/monthly.ts の getOrCreatePeriod が投げる例外と同じ形。
// 年月やテーブルの内部事情が含まれており、クライアントに見せてはいけない。
const INTERNAL_DETAIL = "period not found after insert: 2026-08";

/** onError だけを載せた最小アプリ。本番のルートに影響を与えずに 500 経路を通す。 */
const probeApp = () => {
  const app = new Hono<AppEnv>();
  app.onError(onError);
  app.get("/boom", () => {
    throw new Error(INTERNAL_DETAIL);
  });
  app.get("/http-error", () => {
    throw new HTTPException(429, { message: "TOO_MANY_REQUESTS" });
  });

  return (path: string) => app.fetch(new Request(`https://warikan.test${path}`), { ...env });
};

describe("未捕捉エラーの扱い", () => {
  it("想定外の例外は 500 を返し、内部の詳細を含めない", async () => {
    const res = await probeApp()("/boom");
    const body = (await res.json()) as Envelope;

    expect(res.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("INTERNAL_ERROR");
    expect(body.error?.message).toBe("処理中にエラーが発生しました");

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(INTERNAL_DETAIL);
    expect(serialized).not.toContain("period");
    expect(serialized).not.toContain("Error");
  });

  it("HTTPException はそのステータスを保つ", async () => {
    const res = await probeApp()("/http-error");
    const body = (await res.json()) as Envelope;

    expect(res.status).toBe(429);
    expect(body.ok).toBe(false);
  });
});
