import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("疎通と DB の初期状態", () => {
  it("GET /api/health が 200 を返す", async () => {
    const res = await exports.default.fetch(new Request("https://warikan.test/api/health"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, data: { status: "ok" } });
  });

  it("未定義のパスは 404 エンベロープを返す", async () => {
    const res = await exports.default.fetch(new Request("https://warikan.test/api/nope"));

    expect(res.status).toBe(404);
  });

  it("マイグレーションでカテゴリが7件投入されている", async () => {
    const result = await env.DB.prepare("SELECT COUNT(*) AS count FROM categories").first<{ count: number }>();

    expect(result?.count).toBe(7);
  });

  it("全テーブルが作成されている", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all<{ name: string }>();
    const names = results.map((row) => row.name);

    for (const table of [
      "users",
      "categories",
      "monthly_periods",
      "monthly_expenses",
      "events",
      "event_members",
      "event_items",
      "event_settlements",
    ]) {
      expect(names).toContain(table);
    }
  });
});
