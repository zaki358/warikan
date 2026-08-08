import { Button } from "../../components/Button.js";
import { formatDateLabel, formatYen } from "../../lib/format.js";
import type { Expense } from "../../lib/types.js";

type Props = {
  expenses: Expense[];
  users: { userId: string; displayName: string }[];
  categories: { id: number; name: string }[];
  onDelete: (id: string) => void;
  deletingId: string | null;
};

/** spent_on ごとにまとめる。API は spent_on の降順で返す。 */
function groupByDate(expenses: Expense[]): { date: string; rows: Expense[] }[] {
  const groups: { date: string; rows: Expense[] }[] = [];

  for (const expense of expenses) {
    const last = groups.at(-1);
    if (last && last.date === expense.spentOn) {
      last.rows.push(expense);
    } else {
      groups.push({ date: expense.spentOn, rows: [expense] });
    }
  }

  return groups;
}

export function ExpenseList({ expenses, users, categories, onDelete, deletingId }: Props) {
  if (expenses.length === 0) {
    return (
      <div className="card">
        <p className="sub">まだ記録がありません。</p>
      </div>
    );
  }

  const nameByUser = new Map(users.map((user) => [user.userId, user.displayName]));
  const nameByCategory = new Map(categories.map((category) => [category.id, category.name]));

  return (
    <>
      {groupByDate(expenses).map((group) => (
        <div className="card" key={group.date}>
          <h2>{formatDateLabel(group.date)}</h2>
          {group.rows.map((expense) => (
            <div className="list-row" key={expense.id}>
              <div className="grow">
                <div className="ellipsis">{expense.itemName}</div>
                <div className="muted">
                  {nameByUser.get(expense.paidBy) ?? "不明"}
                  {expense.categoryId === null
                    ? ""
                    : ` ・ ${nameByCategory.get(expense.categoryId) ?? "不明"}`}
                </div>
              </div>
              <div className="amount">{formatYen(expense.amount)}</div>
              <Button
                variant="danger"
                size="sm"
                aria-label={`${expense.itemName} を削除`}
                disabled={deletingId === expense.id}
                onClick={() => onDelete(expense.id)}
              >
                削除
              </Button>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
