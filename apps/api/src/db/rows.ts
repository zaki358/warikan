export type UserRow = {
  id: string;
  email: string;
  display_name: string;
  created_at: string;
};

export type CategoryRow = {
  id: number;
  name: string;
  sort_order: number;
  is_active: number;
};

export type MonthlyPeriodRow = {
  id: string;
  year: number;
  month: number;
  status: string;
  settled_at: string | null;
  snapshot_json: string | null;
  is_dirty: number;
  created_at: string;
};

export type MonthlyExpenseRow = {
  id: string;
  period_id: string;
  paid_by: string;
  amount: number;
  item_name: string;
  category_id: number | null;
  spent_on: string;
  created_at: string;
  updated_at: string;
};

export type EventRow = {
  id: string;
  title: string;
  mode: string;
  total: number;
  per_person: number;
  created_at: string;
};

export type EventMemberRow = {
  id: string;
  event_id: string;
  name: string;
  paid: number;
  position: number;
};

export type EventItemRow = {
  id: string;
  event_id: string;
  name: string;
  amount: number;
  paid_by_member_id: string;
  position: number;
};

export type EventSettlementRow = {
  id: string;
  event_id: string;
  from_member_id: string;
  to_member_id: string;
  amount: number;
  is_paid: number;
  position: number;
};
