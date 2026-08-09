import type { Dispatch } from "react";

import { AmountInput } from "../../components/AmountInput.js";
import type { WizardAction, WizardState } from "./wizardReducer.js";

type Props = {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
};

export function SimpleInput({ state, dispatch }: Props) {
  return (
    <div className="card">
      <h2>立て替えた金額</h2>
      <p className="sub">立て替えていない人は空欄のままで大丈夫です。</p>

      {state.members.map((member, index) => (
        <div className="form-group" key={index}>
          <label htmlFor={`paid-${index}`}>{member.name.trim() || `参加者 ${index + 1}`}</label>
          <AmountInput
            id={`paid-${index}`}
            value={member.paid}
            placeholder="0"
            onChange={(paid) => dispatch({ type: "setMemberPaid", index, paid })}
          />
        </div>
      ))}
    </div>
  );
}
