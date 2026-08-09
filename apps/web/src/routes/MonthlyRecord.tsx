import { Link, useNavigate, useParams } from "react-router";

import { Button } from "../components/Button.js";
import { ErrorBanner } from "../components/ErrorBanner.js";
import { ExpenseForm } from "../features/monthly/ExpenseForm.js";
import { ExpenseList } from "../features/monthly/ExpenseList.js";
import {
  useAddExpense,
  useCategories,
  useDeleteExpense,
  useMe,
  useMonthly,
  useUsers,
} from "../features/monthly/queries.js";
import { formatYen } from "../lib/format.js";
import { shiftYm, todayYm, ymLabel } from "../lib/ym.js";

export function MonthlyRecord() {
  const { ym = todayYm() } = useParams();
  const navigate = useNavigate();

  const me = useMe();
  const users = useUsers();
  const categories = useCategories();
  const monthly = useMonthly(ym);
  const addExpense = useAddExpense(ym);
  const deleteExpense = useDeleteExpense(ym);

  const error =
    me.error ?? users.error ?? categories.error ?? monthly.error ?? addExpense.error ?? deleteExpense.error;

  const total = (monthly.data?.expenses ?? []).reduce((sum, expense) => sum + expense.amount, 0);

  return (
    <>
      <div className="card">
        <div className="list-row">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate(`/monthly/${shiftYm(ym, -1)}`)}
          >
            ← 前月
          </Button>
          <div className="grow" style={{ textAlign: "center" }}>
            {/* この画面の見出し。精算画面（h1「◯年◯月の精算」）と階層を揃える。 */}
            <h1 className="month-title">{ymLabel(ym)}</h1>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate(`/monthly/${shiftYm(ym, 1)}`)}
          >
            次月 →
          </Button>
        </div>
        <div className="list-row">
          <div className="grow">今月の合計</div>
          <div className="amount">{formatYen(total)}</div>
        </div>
        <div className="actions">
          <Link className="btn btn-primary" to={`/monthly/${ym}/result`}>
            計算する
          </Link>
          <Link className="btn btn-secondary" to="/">
            ホーム
          </Link>
        </div>
      </div>

      <ErrorBanner error={error} />

      {me.data ? (
        <ExpenseForm
          ym={ym}
          users={users.data ?? []}
          categories={categories.data ?? []}
          defaultPaidBy={me.data.userId}
          isSubmitting={addExpense.isPending}
          onSubmit={(input) => addExpense.mutate(input)}
        />
      ) : null}

      {monthly.isLoading ? (
        <div className="card">
          <p className="sub">読み込み中…</p>
        </div>
      ) : (
        <ExpenseList
          expenses={monthly.data?.expenses ?? []}
          users={users.data ?? []}
          categories={categories.data ?? []}
          deletingId={deleteExpense.isPending ? (deleteExpense.variables ?? null) : null}
          onDelete={(id) => deleteExpense.mutate(id)}
        />
      )}
    </>
  );
}
