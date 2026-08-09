import type { Dispatch } from "react";
import { Link, useNavigate } from "react-router";

import { Button } from "../components/Button.js";
import { Toggle } from "../components/Toggle.js";
import type { WizardAction, WizardState } from "../features/events/wizardReducer.js";

type Props = {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
};

export function EventNew({ state, dispatch }: Props) {
  const navigate = useNavigate();

  return (
    <>
      <div className="card">
        <span className="tag tag-blue">ステップ 1 / 2</span>
        <h1>新しい割り勘</h1>

        <div className="form-group">
          <label htmlFor="title">タイトル</label>
          <input
            id="title"
            type="text"
            value={state.title}
            maxLength={60}
            placeholder="空欄なら日付から自動でつけます"
            onChange={(event) => dispatch({ type: "setTitle", title: event.target.value })}
          />
        </div>

        <div className="form-group">
          <span className="form-label">計算のしかた</span>
          <Toggle
            label="計算のしかた"
            options={[
              { value: "simple", label: "シンプル" },
              { value: "items", label: "品目別" },
            ]}
            value={state.mode}
            onChange={(mode) => dispatch({ type: "setMode", mode: mode as WizardState["mode"] })}
          />
          <p className="sub" style={{ marginTop: 8 }}>
            {state.mode === "simple"
              ? "参加者ごとに立て替えた金額をまとめて入力します。"
              : "品目ごとに金額と支払った人を記録し、支払者ごとに合算します。"}
          </p>
        </div>
      </div>

      <div className="card">
        <h2>参加者</h2>

        {state.members.map((member, index) => (
          <div className="list-row" key={index}>
            <div className="grow">
              <label htmlFor={`member-${index}`} className="sr-only">
                参加者 {index + 1} の名前
              </label>
              <input
                id={`member-${index}`}
                type="text"
                value={member.name}
                maxLength={30}
                placeholder={`参加者 ${index + 1}`}
                onChange={(event) =>
                  dispatch({ type: "setMemberName", index, name: event.target.value })
                }
              />
            </div>
            <Button
              variant="danger"
              size="sm"
              aria-label={`参加者 ${index + 1} を削除`}
              disabled={state.members.length <= 1}
              onClick={() => dispatch({ type: "removeMember", index })}
            >
              削除
            </Button>
          </div>
        ))}

        <Button
          variant="secondary"
          disabled={state.members.length >= 20}
          onClick={() => dispatch({ type: "addMember" })}
        >
          ＋ 参加者を追加
        </Button>

        <div className="actions">
          <Link className="btn btn-secondary" to="/">
            やめる
          </Link>
          <Button onClick={() => navigate("/events/new/input")}>次へ</Button>
        </div>
      </div>
    </>
  );
}
