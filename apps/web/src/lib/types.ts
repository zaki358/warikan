export type Me = {
  userId: string;
  email: string;
  displayName: string;
};

/** GET /api/users。email は返らない。 */
export type UserSummary = {
  userId: string;
  displayName: string;
};

export type Category = {
  id: number;
  name: string;
};

export type Period = {
  ym: string;
  year: number;
  month: number;
  status: string;
  isDirty: boolean;
  settledAt: string | null;
};

export type Expense = {
  id: string;
  paidBy: string;
  amount: number;
  itemName: string;
  categoryId: number | null;
  spentOn: string;
};

export type MonthlyDetail = {
  period: Period;
  expenses: Expense[];
};

export type Snapshot = {
  total: number;
  perPerson: number;
  byUser: { userId: string; displayName: string; paid: number; share: number }[];
  byCategory: { categoryId: number | null; name: string; amount: number }[];
  transfers: { fromId: string; toId: string; amount: number; isPaid: boolean }[];
  settledAt: string;
};

export type MonthlyResult = {
  snapshot: Snapshot;
  isDirty: boolean;
};

export type EventMode = "simple" | "items";

export type EventSummary = {
  id: string;
  title: string;
  mode: string;
  total: number;
  perPerson: number;
  createdAt: string;
};

export type EventDetail = EventSummary & {
  members: { id: string; name: string; paid: number }[];
  items: { id: string; name: string; amount: number; paidByMemberId: string }[];
  settlements: {
    id: string;
    fromMemberId: string;
    toMemberId: string;
    amount: number;
    isPaid: boolean;
  }[];
};

export type CreateEventPayload = {
  title: string;
  mode: EventMode;
  members: { name: string; paid: number }[];
  items: { name: string; amount: number; paidByIndex: number }[];
};
