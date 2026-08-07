import { calculateSettlement } from "@warikan/shared";
import type { Participant } from "@warikan/shared";
import { Hono } from "hono";
import { z } from "zod";

import {
  createEvent,
  deleteEvent,
  findEventDetail,
  findSettlement,
  listEventSummaries,
  setSettlementPaid,
} from "../db/events.js";
import type { EventDetail } from "../db/events.js";
import type { AppEnv } from "../env.js";
import { newId } from "../lib/ids.js";
import { fail, ok } from "../lib/response.js";

const payloadSchema = z.object({
  title: z.string().trim().max(60),
  mode: z.enum(["simple", "items"]),
  members: z
    .array(z.object({ name: z.string().trim().min(1).max(30), paid: z.number().int().min(0).max(10_000_000) }))
    .min(1)
    .max(20),
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(60),
        amount: z.number().int().min(0).max(10_000_000),
        paidByIndex: z.number().int().min(0),
      }),
    )
    .max(200)
    .default([]),
});

export const eventRoutes = new Hono<AppEnv>();

const defaultTitle = (): string => {
  const today = new Date();
  const month = String(today.getUTCMonth() + 1).padStart(2, "0");
  const day = String(today.getUTCDate()).padStart(2, "0");
  return `割り勘 ${month}/${day}`;
};

const toDetailJson = (detail: EventDetail) => ({
  id: detail.event.id,
  title: detail.event.title,
  mode: detail.event.mode,
  total: detail.event.total,
  perPerson: detail.event.per_person,
  createdAt: detail.event.created_at,
  members: detail.members.map((member) => ({ id: member.id, name: member.name, paid: member.paid })),
  items: detail.items.map((item) => ({
    id: item.id,
    name: item.name,
    amount: item.amount,
    paidByMemberId: item.paid_by_member_id,
  })),
  settlements: detail.settlements.map((settlement) => ({
    id: settlement.id,
    fromMemberId: settlement.from_member_id,
    toMemberId: settlement.to_member_id,
    amount: settlement.amount,
    isPaid: settlement.is_paid === 1,
  })),
});

eventRoutes.get("/", async (c) => {
  const rows = await listEventSummaries(c.env.DB);

  return c.json(
    ok(
      rows.map((row) => ({
        id: row.id,
        title: row.title,
        mode: row.mode,
        total: row.total,
        perPerson: row.per_person,
        createdAt: row.created_at,
      })),
    ),
  );
});

eventRoutes.post("/", async (c) => {
  const parsed = payloadSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(fail("VALIDATION_ERROR", "入力内容を確認してください"), 400);

  const { title, mode, items } = parsed.data;

  // メンバーに id を振る。名前ではなく id で識別するので同名でも破綻しない。
  const members = parsed.data.members.map((member) => ({ ...member, id: newId() }));

  for (const item of items) {
    if (item.paidByIndex >= members.length) {
      return c.json(
        fail("VALIDATION_ERROR", "品目の支払者が不正です", { items: "paidByIndex が範囲外" }),
        400,
      );
    }
  }

  // 品目モードでは、品目の金額を支払者ごとに合算して paid とする
  const paidByMemberId = new Map(members.map((member) => [member.id, member.paid]));
  if (mode === "items") {
    for (const member of members) paidByMemberId.set(member.id, 0);
    for (const item of items) {
      const memberId = members[item.paidByIndex]!.id;
      paidByMemberId.set(memberId, (paidByMemberId.get(memberId) ?? 0) + item.amount);
    }
  }

  const participants: Participant[] = members.map((member) => ({
    id: member.id,
    name: member.name,
    paid: paidByMemberId.get(member.id) ?? 0,
  }));

  const settlement = calculateSettlement(participants);

  const eventId = await createEvent(c.env.DB, {
    title: title.length > 0 ? title : defaultTitle(),
    mode,
    total: settlement.total,
    perPerson: settlement.perPerson,
    members: members.map((member) => ({
      id: member.id,
      name: member.name,
      paid: paidByMemberId.get(member.id) ?? 0,
    })),
    items: items.map((item) => ({
      name: item.name,
      amount: item.amount,
      paidByMemberId: members[item.paidByIndex]!.id,
    })),
    settlements: settlement.transfers.map((transfer) => ({
      fromMemberId: transfer.fromId,
      toMemberId: transfer.toId,
      amount: transfer.amount,
    })),
  });

  const detail = await findEventDetail(c.env.DB, eventId);
  return c.json(ok(toDetailJson(detail!)), 201);
});

eventRoutes.get("/:id", async (c) => {
  const detail = await findEventDetail(c.env.DB, c.req.param("id"));
  if (!detail) return c.json(fail("NOT_FOUND", "見つかりません"), 404);

  return c.json(ok(toDetailJson(detail)));
});

eventRoutes.delete("/:id", async (c) => {
  const detail = await findEventDetail(c.env.DB, c.req.param("id"));
  if (!detail) return c.json(fail("NOT_FOUND", "見つかりません"), 404);

  await deleteEvent(c.env.DB, detail.event.id);

  return c.json(ok({ id: detail.event.id }));
});

eventRoutes.patch("/:id/settlements/:settlementId", async (c) => {
  const parsed = z
    .object({ isPaid: z.boolean() })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(fail("VALIDATION_ERROR", "isPaid は真偽値で指定してください"), 400);

  const eventId = c.req.param("id");
  const target = await findSettlement(c.env.DB, eventId, c.req.param("settlementId"));
  if (!target) return c.json(fail("NOT_FOUND", "該当する送金がありません"), 404);

  await setSettlementPaid(c.env.DB, target.id, parsed.data.isPaid);

  const detail = await findEventDetail(c.env.DB, eventId);
  return c.json(ok(toDetailJson(detail!)));
});
