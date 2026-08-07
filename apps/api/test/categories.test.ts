import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { anonFetch, authedFetch, jsonBody, resetDb } from "./helpers.js";

type Category = { id: number; name: string };
type Envelope<T> = { ok: boolean; data?: T };

describe("GET /api/categories", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("有効なカテゴリを sort_order 順で返す", async () => {
    const res = await authedFetch("/api/categories");
    const body = await jsonBody<Envelope<Category[]>>(res);

    expect(res.status).toBe(200);
    expect(body.data?.map((category) => category.name)).toEqual([
      "食費",
      "日用品",
      "外食",
      "光熱費",
      "交通費",
      "娯楽",
      "その他",
    ]);
  });

  it("is_active が 0 のカテゴリは返さない", async () => {
    await env.DB.prepare("UPDATE categories SET is_active = 0 WHERE name = ?").bind("娯楽").run();

    const body = await jsonBody<Envelope<Category[]>>(await authedFetch("/api/categories"));

    expect(body.data?.map((category) => category.name)).not.toContain("娯楽");

    await env.DB.prepare("UPDATE categories SET is_active = 1 WHERE name = ?").bind("娯楽").run();
  });

  it("認証なしでは 403", async () => {
    const res = await anonFetch("/api/categories");

    expect(res.status).toBe(403);
  });
});
