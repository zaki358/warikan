import { Link, useParams } from "react-router";

import { Button } from "../components/Button.js";
import { ErrorBanner } from "../components/ErrorBanner.js";
import { ResultView } from "../features/monthly/ResultView.js";
import { useMonthlyResult, useSettle, useToggleTransfer } from "../features/monthly/queries.js";
import { useUsers } from "../features/users/queries.js";
import { ApiError } from "../lib/api.js";
import { todayYm, ymLabel } from "../lib/ym.js";

export function MonthlyResult() {
  const { ym = todayYm() } = useParams();

  const result = useMonthlyResult(ym);
  const users = useUsers();
  const settle = useSettle(ym);
  const toggleTransfer = useToggleTransfer(ym);

  // 未計算の月は 404 が返る。これはエラーではなく「まだ押していない」状態。
  const notCalculated = result.error instanceof ApiError && result.error.status === 404;
  const isBusy = settle.isPending || toggleTransfer.isPending;

  return (
    <>
      <div className="card">
        <h1>{ymLabel(ym)}の精算</h1>
        <div className="actions">
          <Button disabled={isBusy} onClick={() => settle.mutate(undefined)}>
            {settle.isPending ? "計算中…" : "計算する"}
          </Button>
          <Link className="btn btn-secondary" to={`/monthly/${ym}`}>
            記録に戻る
          </Link>
        </div>
      </div>

      {notCalculated ? null : (
        <ErrorBanner error={result.error ?? users.error ?? settle.error ?? toggleTransfer.error} />
      )}

      {result.isLoading ? (
        <div className="card">
          <p className="sub">読み込み中…</p>
        </div>
      ) : null}

      {notCalculated ? (
        <div className="card">
          <p className="sub">まだ計算していません。「計算する」を押してください。</p>
        </div>
      ) : null}

      {result.data ? (
        <ResultView
          snapshot={result.data.snapshot}
          users={users.data ?? []}
          isDirty={result.data.isDirty}
          isBusy={isBusy}
          onRecalculate={() => settle.mutate(undefined)}
          onToggleTransfer={(index, isPaid) => toggleTransfer.mutate({ index, isPaid })}
        />
      ) : null}
    </>
  );
}
