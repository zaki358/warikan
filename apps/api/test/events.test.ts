import { beforeEach, describe, expect, it } from "vitest";

import { anonFetch, authedFetch, jsonBody, jsonInit, resetDb } from "./helpers.js";

type Member = { id: string; name: string; paid: number };
type Settlement = { id: string; fromMemberId: string; toMemberId: string; amount: number; isPaid: boolean };
type EventDetail = {
  id: string;
  title: string;
  mode: string;
  total: number;
  perPerson: number;
  members: Member[];
  items: { id: string; name: string; amount: number; paidByMemberId: string }[];
  settlements: Settlement[];
};
type Envelope<T> = { ok: boolean; data?: T; error?: { code: string } };

const simplePayload = {
  title: "飲み会 8/5",
  mode: "simple",
  members: [
    { name: "田中", paid: 10000 },
    { name: "佐藤", paid: 2000 },
    { name: "鈴木", paid: 0 },
  ],
  items: [],
};

const itemsPayload = {
  title: "旅行",
  mode: "items",
  members: [{ name: "田中", paid: 0 }, { name: "佐藤", paid: 0 }],
  items: [
    { name: "宿代", amount: 20000, paidByIndex: 0 },
    { name: "ガソリン", amount: 6000, paidByIndex: 1 },
    { name: "food", amount: 4000, paidByIndex: 0 },
  ],
};

async function createEvent(payload: unknown): Promise<EventDetail> {
  const res = await authedFetch("/api/events", jsonInit("POST", payload));
  const body = await jsonBody<Envelope<EventDetail>>(res);
  if (!body.data) throw new Error(`create failed: ${res.status} ${JSON.stringify(body)}`);
  return body.data;
}

describe("POST /api/events", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("シンプルモードで精算まで計算して保存する", async () => {
    const event = await createEvent(simplePayload);

    expect(event.total).toBe(12000);
    expect(event.perPerson).toBe(4000);
    expect(event.members).toHaveLength(3);
    expect(event.settlements).toHaveLength(2);

    const tanaka = event.members.find((member) => member.name === "田中")!;
    const received = event.settlements
      .filter((settlement) => settlement.toMemberId === tanaka.id)
      .reduce((sum, settlement) => sum + settlement.amount, 0);
    expect(received).toBe(6000);
  });

  it("品目モードで支払者ごとに合算される", async () => {
    const event = await createEvent(itemsPayload);

    expect(event.total).toBe(30000);
    expect(event.perPerson).toBe(15000);

    const tanaka = event.members.find((member) => member.name === "田中")!;
    const sato = event.members.find((member) => member.name === "佐藤")!;
    expect(tanaka.paid).toBe(24000);
    expect(sato.paid).toBe(6000);

    expect(event.settlements).toEqual([
      expect.objectContaining({ fromMemberId: sato.id, toMemberId: tanaka.id, amount: 9000 }),
    ]);
  });

  it("同名のメンバーが2人いても別々に集計される", async () => {
    const event = await createEvent({
      title: "同名テスト",
      mode: "simple",
      members: [
        { name: "田中", paid: 6000 },
        { name: "田中", paid: 0 },
      ],
      items: [],
    });

    expect(event.members).toHaveLength(2);
    expect(event.members[0]?.paid).toBe(6000);
    expect(event.members[1]?.paid).toBe(0);
    expect(event.settlements).toEqual([
      expect.objectContaining({ amount: 3000 }),
    ]);
  });

  it("タイトルが空なら日付から自動生成する", async () => {
    const event = await createEvent({ ...simplePayload, title: "" });

    expect(event.title).toMatch(/^割り勘 \d{2}\/\d{2}$/);
  });

  it("メンバーが1人未満なら 400", async () => {
    const res = await authedFetch("/api/events", jsonInit("POST", { ...simplePayload, members: [] }));

    expect(res.status).toBe(400);
  });

  it("メンバーが21人以上なら 400", async () => {
    const members = Array.from({ length: 21 }, (_, index) => ({ name: `M${index}`, paid: 0 }));
    const res = await authedFetch("/api/events", jsonInit("POST", { ...simplePayload, members }));

    expect(res.status).toBe(400);
  });

  it("品目の paidByIndex が範囲外なら 400", async () => {
    const res = await authedFetch(
      "/api/events",
      jsonInit("POST", { ...itemsPayload, items: [{ name: "x", amount: 100, paidByIndex: 5 }] }),
    );

    expect(res.status).toBe(400);
  });

  it("モードが不正なら 400", async () => {
    const res = await authedFetch("/api/events", jsonInit("POST", { ...simplePayload, mode: "unknown" }));

    expect(res.status).toBe(400);
  });

  it("認証なしでは 403", async () => {
    const res = await anonFetch("/api/events", jsonInit("POST", simplePayload));

    expect(res.status).toBe(403);
  });
});

describe("GET /api/events", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("新しい順で一覧を返す", async () => {
    await createEvent({ ...simplePayload, title: "古い" });
    await createEvent({ ...simplePayload, title: "新しい" });

    const body = await jsonBody<Envelope<{ id: string; title: string }[]>>(await authedFetch("/api/events"));

    expect(body.data?.[0]?.title).toBe("新しい");
    expect(body.data).toHaveLength(2);
  });

  it("6件以上でも切り捨てない", async () => {
    for (let index = 0; index < 7; index += 1) {
      await createEvent({ ...simplePayload, title: `会 ${index}` });
    }

    const body = await jsonBody<Envelope<unknown[]>>(await authedFetch("/api/events"));

    expect(body.data).toHaveLength(7);
  });
});

describe("GET / DELETE /api/events/:id", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("詳細を取得できる", async () => {
    const created = await createEvent(simplePayload);

    const body = await jsonBody<Envelope<EventDetail>>(await authedFetch(`/api/events/${created.id}`));

    expect(body.data?.title).toBe("飲み会 8/5");
    expect(body.data?.members).toHaveLength(3);
  });

  it("存在しない id は 404", async () => {
    const res = await authedFetch("/api/events/00000000-0000-0000-0000-000000000000");

    expect(res.status).toBe(404);
  });

  it("削除すると一覧から消え、関連行も消える", async () => {
    const created = await createEvent(simplePayload);

    const res = await authedFetch(`/api/events/${created.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);

    const detail = await authedFetch(`/api/events/${created.id}`);
    expect(detail.status).toBe(404);

    const { env } = await import("cloudflare:workers");
    const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM event_members WHERE event_id = ?")
      .bind(created.id)
      .first<{ count: number }>();
    expect(row?.count).toBe(0);
  });
});

describe("PATCH /api/events/:id/settlements/:settlementId", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("支払い済みに切り替えられる", async () => {
    const created = await createEvent(simplePayload);
    const target = created.settlements[0]!;

    const res = await authedFetch(
      `/api/events/${created.id}/settlements/${target.id}`,
      jsonInit("PATCH", { isPaid: true }),
    );
    const body = await jsonBody<Envelope<EventDetail>>(res);

    expect(res.status).toBe(200);
    expect(body.data?.settlements.find((s) => s.id === target.id)?.isPaid).toBe(true);
  });

  it("別イベントの settlement id を渡すと 404", async () => {
    const first = await createEvent(simplePayload);
    const second = await createEvent(simplePayload);

    const res = await authedFetch(
      `/api/events/${first.id}/settlements/${second.settlements[0]!.id}`,
      jsonInit("PATCH", { isPaid: true }),
    );

    expect(res.status).toBe(404);
  });
});
