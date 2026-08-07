import { calculateSettlement, compareStr } from "@warikan/shared";
import type { Participant } from "@warikan/shared";

import { listActiveCategories } from "../db/categories.js";
import { listExpenses } from "../db/monthly.js";
import type { MonthlyPeriodRow } from "../db/rows.js";
import { listUsers } from "../db/users.js";
import { nowIso } from "../lib/ids.js";

export type SnapshotTransfer = {
  fromId: string;
  toId: string;
  amount: number;
  isPaid: boolean;
};

export type Snapshot = {
  total: number;
  perPerson: number;
  byUser: { userId: string; displayName: string; paid: number; share: number }[];
  byCategory: { categoryId: number | null; name: string; amount: number }[];
  transfers: SnapshotTransfer[];
  settledAt: string;
};

const UNCATEGORIZED = "未分類";

export async function buildSnapshot(db: D1Database, period: MonthlyPeriodRow): Promise<Snapshot> {
  const [users, expenses, categories] = await Promise.all([
    listUsers(db),
    listExpenses(db, period.id),
    listActiveCategories(db),
  ]);

  const paidByUser = new Map<string, number>(users.map((user) => [user.id, 0]));
  for (const expense of expenses) {
    paidByUser.set(expense.paid_by, (paidByUser.get(expense.paid_by) ?? 0) + expense.amount);
  }

  const participants: Participant[] = users.map((user) => ({
    id: user.id,
    name: user.display_name,
    paid: paidByUser.get(user.id) ?? 0,
  }));

  const settlement = calculateSettlement(participants);
  const shareById = new Map(settlement.shares.map((share) => [share.id, share.share]));

  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const amountByCategory = new Map<number | null, number>();
  for (const expense of expenses) {
    const key = expense.category_id;
    amountByCategory.set(key, (amountByCategory.get(key) ?? 0) + expense.amount);
  }

  const byCategory = [...amountByCategory.entries()]
    .map(([categoryId, amount]) => ({
      categoryId,
      name: categoryId === null ? UNCATEGORIZED : (categoryNames.get(categoryId) ?? UNCATEGORIZED),
      amount,
    }))
    .sort((a, b) => b.amount - a.amount || compareStr(a.name, b.name));

  return {
    total: settlement.total,
    perPerson: settlement.perPerson,
    byUser: users.map((user) => ({
      userId: user.id,
      displayName: user.display_name,
      paid: paidByUser.get(user.id) ?? 0,
      share: shareById.get(user.id) ?? 0,
    })),
    byCategory,
    transfers: settlement.transfers.map((transfer) => ({ ...transfer, isPaid: false })),
    settledAt: nowIso(),
  };
}

/**
 * 再計算後の送金に、旧スナップショットの isPaid を引き継ぐ。
 * fromId / toId / amount がすべて一致するものだけ引き継ぐ。
 * 「すでに渡した」という事実は金額とセットでしか意味を持たないため、
 * 1円でも変わっていれば未払いに戻す。
 */
export function mergeIsPaid(next: Snapshot, previous: Snapshot | null): Snapshot {
  if (!previous) return next;

  const paidKeys = new Set(
    previous.transfers
      .filter((transfer) => transfer.isPaid)
      .map((transfer) => `${transfer.fromId}|${transfer.toId}|${transfer.amount}`),
  );

  return {
    ...next,
    transfers: next.transfers.map((transfer) => ({
      ...transfer,
      isPaid: paidKeys.has(`${transfer.fromId}|${transfer.toId}|${transfer.amount}`),
    })),
  };
}

export function readSnapshot(period: MonthlyPeriodRow): Snapshot | null {
  if (!period.snapshot_json) return null;
  return JSON.parse(period.snapshot_json) as Snapshot;
}
