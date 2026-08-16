import { Link } from "react-router";

import { useEvents } from "../features/events/queries.js";
import { useMonthly } from "../features/monthly/queries.js";
import { formatYen } from "../lib/format.js";
import { todayYm, ymLabel } from "../lib/ym.js";

export function Home() {
  const ym = todayYm();
  const monthly = useMonthly(ym);
  const events = useEvents();

  // 「今月の合計」は API が返さないのでここで足す。金額はすべて整数（円）。
  const monthTotal = (monthly.data?.expenses ?? []).reduce(
    (sum, expense) => sum + expense.amount,
    0,
  );

  return (
    <>
      <div className="card">
        <h1>割り勘</h1>
        <p className="sub">夫婦2人の記録と、その場かぎりの割り勘。</p>
        <div className="actions">
          <Link className="btn btn-secondary" to="/settings">
            ⚙️ 設定
          </Link>
        </div>
      </div>

      <div className="card">
        <h2>{ymLabel(ym)}</h2>
        <div className="list-row">
          <div className="grow">今月の合計</div>
          <div className="amount">{formatYen(monthTotal)}</div>
        </div>
        {monthly.data?.period.isDirty ? (
          <div role="alert" className="banner banner-warn" style={{ marginTop: 12 }}>
            計算後に記録が変わっています。
          </div>
        ) : null}
        <div className="actions">
          <Link className="btn btn-primary" to={`/monthly/${ym}`}>
            📅 今月の記録
          </Link>
          <Link className="btn btn-secondary" to={`/monthly/${ym}/result`}>
            精算を見る
          </Link>
        </div>
      </div>

      <div className="card">
        <h2>単発の割り勘</h2>
        {events.isLoading ? (
          <p className="sub">読み込み中…</p>
        ) : (events.data?.length ?? 0) === 0 ? (
          <p className="sub">まだありません。</p>
        ) : (
          events.data?.map((event) => (
            <Link className="list-row" key={event.id} to={`/events/${event.id}`}>
              <div className="grow">
                <div className="ellipsis">{event.title}</div>
                <div className="muted">
                  {event.mode === "items" ? "品目別" : "シンプル"}・一人 {formatYen(event.perPerson)}
                </div>
              </div>
              <div className="amount">{formatYen(event.total)}</div>
            </Link>
          ))
        )}
        <Link className="btn btn-primary" to="/events/new" style={{ marginTop: 12 }}>
          ＋ 新しい割り勘
        </Link>
      </div>
    </>
  );
}
