import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { authedFetch } from "./helpers.js";

// assets を設定すると、静的ファイルに当たらないリクエストが SPA の index.html に
// 吸われるようになる。/api/* がそれに巻き込まれると API が全滅するため、
// 「API は Worker に届く」「それ以外は SPA に落ちる」の両方を固定する。
describe("静的配信と API の振り分け", () => {
  it("/api/health は Worker が処理する", async () => {
    const res = await exports.default.fetch(new Request("https://warikan.test/api/health"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, data: { status: "ok" } });
  });

  it("未定義の /api/* は SPA に吸われず、JSON のエンベロープを返す", async () => {
    const res = await authedFetch("/api/nope");

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});
