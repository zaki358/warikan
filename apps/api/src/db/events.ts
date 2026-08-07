import { newId, nowIso } from "../lib/ids.js";
import type {
  EventItemRow,
  EventMemberRow,
  EventRow,
  EventSettlementRow,
} from "./rows.js";

export type EventDetail = {
  event: EventRow;
  members: EventMemberRow[];
  items: EventItemRow[];
  settlements: EventSettlementRow[];
};

export type CreateEventInput = {
  title: string;
  mode: string;
  total: number;
  perPerson: number;
  members: { id: string; name: string; paid: number }[];
  items: { name: string; amount: number; paidByMemberId: string }[];
  settlements: { fromMemberId: string; toMemberId: string; amount: number }[];
};

export async function createEvent(db: D1Database, input: CreateEventInput): Promise<string> {
  const eventId = newId();
  const createdAt = nowIso();

  const statements = [
    db
      .prepare(
        "INSERT INTO events (id, title, mode, total, per_person, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(eventId, input.title, input.mode, input.total, input.perPerson, createdAt),
    ...input.members.map((member, position) =>
      db
        .prepare("INSERT INTO event_members (id, event_id, name, paid, position) VALUES (?, ?, ?, ?, ?)")
        .bind(member.id, eventId, member.name, member.paid, position),
    ),
    ...input.items.map((item, position) =>
      db
        .prepare(
          "INSERT INTO event_items (id, event_id, name, amount, paid_by_member_id, position) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(newId(), eventId, item.name, item.amount, item.paidByMemberId, position),
    ),
    ...input.settlements.map((settlement, position) =>
      db
        .prepare(
          `INSERT INTO event_settlements
             (id, event_id, from_member_id, to_member_id, amount, is_paid, position)
           VALUES (?, ?, ?, ?, ?, 0, ?)`,
        )
        .bind(newId(), eventId, settlement.fromMemberId, settlement.toMemberId, settlement.amount, position),
    ),
  ];

  await db.batch(statements);

  return eventId;
}

export async function findEventDetail(db: D1Database, id: string): Promise<EventDetail | null> {
  const event = await db.prepare("SELECT * FROM events WHERE id = ?").bind(id).first<EventRow>();
  if (!event) return null;

  const [members, items, settlements] = await Promise.all([
    db.prepare("SELECT * FROM event_members WHERE event_id = ? ORDER BY position").bind(id).all<EventMemberRow>(),
    db.prepare("SELECT * FROM event_items WHERE event_id = ? ORDER BY position").bind(id).all<EventItemRow>(),
    db
      .prepare("SELECT * FROM event_settlements WHERE event_id = ? ORDER BY position")
      .bind(id)
      .all<EventSettlementRow>(),
  ]);

  return {
    event,
    members: members.results,
    items: items.results,
    settlements: settlements.results,
  };
}

export async function listEventSummaries(db: D1Database): Promise<EventRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM events ORDER BY created_at DESC, id DESC")
    .all<EventRow>();
  return results;
}

export async function deleteEvent(db: D1Database, id: string): Promise<void> {
  // D1 は既定で外部キーを強制しないため、子テーブルも明示的に消す
  await db.batch([
    db.prepare("DELETE FROM event_settlements WHERE event_id = ?").bind(id),
    db.prepare("DELETE FROM event_items WHERE event_id = ?").bind(id),
    db.prepare("DELETE FROM event_members WHERE event_id = ?").bind(id),
    db.prepare("DELETE FROM events WHERE id = ?").bind(id),
  ]);
}

export async function findSettlement(
  db: D1Database,
  eventId: string,
  settlementId: string,
): Promise<EventSettlementRow | null> {
  return db
    .prepare("SELECT * FROM event_settlements WHERE id = ? AND event_id = ?")
    .bind(settlementId, eventId)
    .first<EventSettlementRow>();
}

export async function setSettlementPaid(db: D1Database, id: string, isPaid: boolean): Promise<void> {
  await db
    .prepare("UPDATE event_settlements SET is_paid = ? WHERE id = ?")
    .bind(isPaid ? 1 : 0, id)
    .run();
}
