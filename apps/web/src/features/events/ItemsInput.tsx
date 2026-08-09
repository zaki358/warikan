import type { Dispatch } from "react";

import { AmountInput } from "../../components/AmountInput.js";
import { Button } from "../../components/Button.js";
import { formatYen } from "../../lib/format.js";
import type { WizardAction, WizardState } from "./wizardReducer.js";

type Props = {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
};

/**
 * ラベルには行番号を入れる。計画どおりの「品目名」「金額」「支払った人」だと
 * 全行のアクセシブル名が揃い、読み上げでも自動テストでも行を区別できない
 * （実測で `Found multiple elements with the text of: 品目名`）。Task 8 の
 * 送金ボタンと同根の問題。行の見出しを兼ねるので見た目にも意味がある。
 */
export function ItemsInput({ state, dispatch }: Props) {
  const total = state.items.reduce((sum, item) => sum + (item.amount === "" ? 0 : item.amount), 0);

  return (
    <div className="card">
      <h2>品目</h2>

      {state.items.map((item, index) => (
        <div className="item-row" key={index}>
          <div className="form-group">
            <label htmlFor={`item-name-${index}`}>品目 {index + 1} の品目名</label>
            <input
              id={`item-name-${index}`}
              type="text"
              value={item.name}
              maxLength={60}
              placeholder="宿代"
              onChange={(event) =>
                dispatch({ type: "setItemName", index, name: event.target.value })
              }
            />
          </div>

          <div className="row2 row2-amount-payer">
            <div className="form-group">
              <label htmlFor={`item-amount-${index}`}>品目 {index + 1} の金額</label>
              <AmountInput
                id={`item-amount-${index}`}
                value={item.amount}
                placeholder="20000"
                onChange={(amount) => dispatch({ type: "setItemAmount", index, amount })}
              />
            </div>

            <div className="form-group">
              <label htmlFor={`item-paid-by-${index}`}>品目 {index + 1} の支払った人</label>
              <select
                id={`item-paid-by-${index}`}
                value={item.paidByIndex}
                onChange={(event) =>
                  dispatch({
                    type: "setItemPaidBy",
                    index,
                    paidByIndex: Number(event.target.value),
                  })
                }
              >
                {state.members.map((member, memberIndex) => (
                  <option key={memberIndex} value={memberIndex}>
                    {member.name.trim() || `参加者 ${memberIndex + 1}`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <Button
            variant="danger"
            size="sm"
            aria-label={`品目 ${index + 1} を削除`}
            onClick={() => dispatch({ type: "removeItem", index })}
          >
            この品目を削除
          </Button>
        </div>
      ))}

      <div className="list-row">
        <div className="grow">合計</div>
        <div className="amount">{formatYen(total)}</div>
      </div>

      <Button variant="secondary" onClick={() => dispatch({ type: "addItem" })}>
        ＋ 品目を追加
      </Button>
    </div>
  );
}
