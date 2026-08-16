import { Button } from "../../components/Button.js";
import { formatYen, percent } from "../../lib/format.js";
import type { Snapshot, UserSummary } from "../../lib/types.js";

type Props = {
  snapshot: Snapshot;
  users: UserSummary[];
  isDirty: boolean;
  isBusy: boolean;
  onRecalculate: () => void;
  onToggleTransfer: (index: number, isPaid: boolean) => void;
};

export function ResultView({ snapshot, users, isDirty, isBusy, onRecalculate, onToggleTransfer }: Props) {
  // スナップショットは計算した時点の表示名を保存している（改名前の記録として
  // 正しい）。改名後に古い名前のまま残らないよう、現在の users を後ろから
  // 重ねて上書きする。users に居ない相手（退会など）はスナップショットの
  // 名前にフォールバックする。
  const nameByUser = new Map<string, string>([
    ...snapshot.byUser.map((entry) => [entry.userId, entry.displayName] as const),
    ...users.map((user) => [user.userId, user.displayName] as const),
  ]);

  return (
    <>
      {isDirty ? (
        <div role="alert" className="banner banner-warn">
          計算したあとに記録が変わっています。金額が古い可能性があります。
          <div style={{ marginTop: 10 }}>
            <Button size="sm" disabled={isBusy} onClick={onRecalculate}>
              再計算する
            </Button>
          </div>
        </div>
      ) : null}

      <div className="card">
        <div className="list-row">
          <div className="grow">今月の合計</div>
          <div className="amount">{formatYen(snapshot.total)}</div>
        </div>
        <div className="list-row">
          <div className="grow">一人あたり</div>
          <div className="amount">{formatYen(snapshot.perPerson)}</div>
        </div>
      </div>

      <div className="card">
        <h2>カテゴリ別内訳</h2>
        {snapshot.byCategory.length === 0 ? (
          <p className="sub">記録がありません。</p>
        ) : (
          snapshot.byCategory.map((entry) => (
            <div className="list-row" key={String(entry.categoryId ?? "none")}>
              <div className="grow ellipsis">{entry.name}</div>
              <div className="amount">{formatYen(entry.amount)}</div>
              <div className="muted">{percent(entry.amount, snapshot.total)}%</div>
            </div>
          ))
        )}
      </div>

      <div className="card">
        <h2>支払い状況</h2>
        {snapshot.byUser.map((entry) => (
          <div className="list-row" key={entry.userId}>
            <div className="grow ellipsis">{nameByUser.get(entry.userId) ?? entry.displayName}</div>
            <div className="amount">{formatYen(entry.paid)}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>精算</h2>
        {snapshot.transfers.length === 0 ? (
          <p className="sub">精算は不要です</p>
        ) : (
          snapshot.transfers.map((transfer, index) => {
            const from = nameByUser.get(transfer.fromId) ?? "?";
            const to = nameByUser.get(transfer.toId) ?? "?";
            // どの送金に対する操作かをボタン名に含める。名前が全部同じだと、
            // 読み上げでも自動テストでも行を区別できず、並べ替えで別の送金を
            // 消し込む不具合を誰も検知できない（API は配列の index で指すため）。
            const what = `${from} から ${to} への ${formatYen(transfer.amount)}`;

            return (
              <div
                className="list-row transfer-row"
                key={`${transfer.fromId}-${transfer.toId}-${index}`}
              >
                <div className="grow">
                  💸 {from} → {to}
                </div>
                <div className="amount">{formatYen(transfer.amount)}</div>
                <Button
                  variant={transfer.isPaid ? "success" : "secondary"}
                  size="sm"
                  disabled={isBusy}
                  aria-label={`${what}を${transfer.isPaid ? "未払いに戻す" : "支払い済みにする"}`}
                  onClick={() => onToggleTransfer(index, !transfer.isPaid)}
                >
                  {transfer.isPaid ? "未払いに戻す" : "支払い済みにする"}
                </Button>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
