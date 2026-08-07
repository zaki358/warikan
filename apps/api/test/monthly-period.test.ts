import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { anonFetch, authedFetch, jsonBody, resetDb } from "./helpers.js";

type Period = {
  ym: string;
  year: number;
  month: number;
  status: string;
  isDirty: boolean;
};
type PeriodData = { period: Period; expenses: unknown[] };
type Envelope<T> = { ok: boolean; data?: T; error?: { code: string } };

describe("GET /api/monthly/:ym", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("存在しない月なら open の期間を作って返す", async () => {
    const res = await authedFetch("/api/monthly/2026-08");
    const body = await jsonBody<Envelope<PeriodData>>(res);

    expect(res.status).toBe(200);
    expect(body.data?.period.ym).toBe("2026-08");
    expect(body.data?.period.year).toBe(2026);
    expect(body.data?.period.month).toBe(8);
    expect(body.data?.period.status).toBe("open");
    expect(body.data?.period.isDirty).toBe(false);
    expect(body.data?.expenses).toEqual([]);
  });

  it("2回呼んでも期間の行は1つだけ", async () => {
    await authedFetch("/api/monthly/2026-08");
    await authedFetch("/api/monthly/2026-08");

    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM monthly_periods WHERE year = 2026 AND month = 8",
    ).first<{ count: number }>();

    expect(row?.count).toBe(1);
  });

  it("不正な年月フォーマットは 400", async () => {
    for (const ym of ["2026-8", "202608", "2026-13", "2026-00", "abcd-ef"]) {
      const res = await authedFetch(`/api/monthly/${ym}`);
      expect(res.status, `ym=${ym}`).toBe(400);
    }
  });

  it("認証なしでは 403", async () => {
    const res = await anonFetch("/api/monthly/2026-08");

    expect(res.status).toBe(403);
  });
});

describe("GET /api/monthly", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("期間が無ければ空配列を返す", async () => {
    const body = await jsonBody<Envelope<Period[]>>(await authedFetch("/api/monthly"));

    expect(body.data).toEqual([]);
  });

  it("新しい月が先に来る順で返す", async () => {
    await authedFetch("/api/monthly/2026-06");
    await authedFetch("/api/monthly/2026-08");
    await authedFetch("/api/monthly/2026-07");

    const body = await jsonBody<Envelope<Period[]>>(await authedFetch("/api/monthly"));

    expect(body.data?.map((period) => period.ym)).toEqual(["2026-08", "2026-07", "2026-06"]);
  });
});
