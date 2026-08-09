import { Link, useNavigate, useParams } from "react-router";

import { Button } from "../components/Button.js";
import { ErrorBanner } from "../components/ErrorBanner.js";
import { useDeleteEvent, useEvent, useToggleSettlement } from "../features/events/queries.js";
import { formatYen } from "../lib/format.js";

export function EventDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();

  const event = useEvent(id);
  const toggleSettlement = useToggleSettlement(id);
  const deleteEvent = useDeleteEvent();

  if (event.isLoading) {
    return (
      <div className="card">
        <p className="sub">読み込み中…</p>
      </div>
    );
  }

  if (!event.data) {
    return (
      <div className="card">
        <h1>見つかりません</h1>
        <ErrorBanner error={event.error} />
        <Link className="btn btn-secondary" to="/">
          ホームへ
        </Link>
      </div>
    );
  }

  const detail = event.data;
  const nameByMember = new Map(detail.members.map((member) => [member.id, member.name]));
  // 参加者名は重複しうるので、入力画面と同じ「1. 名前」で行を指せるようにする。
  const numberByMember = new Map(detail.members.map((member, index) => [member.id, index + 1]));
  const isBusy = toggleSettlement.isPending || deleteEvent.isPending;

  const memberLabel = (memberId: string) => {
    const name = nameByMember.get(memberId);
    if (name === undefined) return "不明";
    return `${numberByMember.get(memberId)}. ${name}`;
  };

  return (
    <>
      <div className="card">
        <h1>{detail.title}</h1>
        <div className="list-row">
          <div className="grow">合計</div>
          <div className="amount">{formatYen(detail.total)}</div>
        </div>
        <div className="list-row">
          <div className="grow">一人あたり</div>
          <div className="amount">{formatYen(detail.perPerson)}</div>
        </div>
      </div>

      <ErrorBanner error={toggleSettlement.error ?? deleteEvent.error} />

      <div className="card">
        <h2>支払い状況</h2>
        {detail.members.map((member) => (
          <div className="list-row" key={member.id}>
            <div className="grow ellipsis">{memberLabel(member.id)}</div>
            <div className="amount">{formatYen(member.paid)}</div>
          </div>
        ))}
      </div>

      {detail.items.length > 0 ? (
        <div className="card">
          <h2>品目</h2>
          {detail.items.map((item) => (
            <div className="list-row" key={item.id}>
              <div className="grow">
                <div className="ellipsis">{item.name}</div>
                <div className="muted">{memberLabel(item.paidByMemberId)}</div>
              </div>
              <div className="amount">{formatYen(item.amount)}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="card">
        <h2>精算</h2>
        {detail.settlements.length === 0 ? (
          <p className="sub">精算は不要です</p>
        ) : (
          detail.settlements.map((settlement, index) => {
            const from = nameByMember.get(settlement.fromMemberId) ?? "?";
            const to = nameByMember.get(settlement.toMemberId) ?? "?";
            // 単発は参加者が最大20人＝送金が最大19件並ぶ。ボタン名が全行同じだと
            // 読み上げでも自動テストでも行を区別できない。誰から誰へ何円かを名前に
            // 入れ、さらに同名の参加者どうしでも一意になるよう行番号を前に置く。
            const what = `${index + 1}. ${from} から ${to} への ${formatYen(settlement.amount)}`;

            return (
              <div className="list-row" key={settlement.id}>
                <div className="grow">
                  💸 {from} → {to}
                </div>
                <div className="amount">{formatYen(settlement.amount)}</div>
                <Button
                  variant={settlement.isPaid ? "success" : "secondary"}
                  size="sm"
                  disabled={isBusy}
                  aria-label={`${what}を${settlement.isPaid ? "未払いに戻す" : "支払い済みにする"}`}
                  onClick={() =>
                    // 位置ではなく id で指す。API は
                    // PATCH /api/events/:id/settlements/:settlementId。
                    toggleSettlement.mutate({
                      settlementId: settlement.id,
                      isPaid: !settlement.isPaid,
                    })
                  }
                >
                  {settlement.isPaid ? "未払いに戻す" : "支払い済みにする"}
                </Button>
              </div>
            );
          })
        )}
      </div>

      <div className="card">
        <div className="actions">
          <Link className="btn btn-secondary" to="/">
            ホームへ
          </Link>
          <Button
            variant="danger"
            disabled={isBusy}
            onClick={() => {
              if (!window.confirm("この割り勘を削除しますか。元に戻せません。")) return;
              deleteEvent.mutate(detail.id, { onSuccess: () => navigate("/") });
            }}
          >
            削除する
          </Button>
        </div>
      </div>
    </>
  );
}
