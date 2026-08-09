import type { Dispatch } from "react";
import { Link, useNavigate } from "react-router";

import { Button } from "../components/Button.js";
import { ErrorBanner } from "../components/ErrorBanner.js";
import { ItemsInput } from "../features/events/ItemsInput.js";
import { SimpleInput } from "../features/events/SimpleInput.js";
import { useCreateEvent } from "../features/events/queries.js";
import { toCreatePayload, wizardErrors } from "../features/events/wizardReducer.js";
import type { WizardAction, WizardState } from "../features/events/wizardReducer.js";

type Props = {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
  onCreated: () => void;
};

export function EventInput({ state, dispatch, onCreated }: Props) {
  const navigate = useNavigate();
  const createEvent = useCreateEvent();

  const errors = wizardErrors(state);

  const submit = () => {
    if (errors.length > 0 || createEvent.isPending) return;

    createEvent.mutate(toCreatePayload(state), {
      onSuccess: (event) => {
        onCreated();
        navigate(`/events/${event.id}`);
      },
    });
  };

  return (
    <>
      <div className="card">
        <span className="tag tag-blue">ステップ 2 / 2</span>
        <h1>{state.mode === "simple" ? "金額の入力" : "品目の入力"}</h1>
      </div>

      <ErrorBanner error={createEvent.error} />

      {errors.length > 0 ? (
        <div role="alert" className="banner banner-warn">
          <ul style={{ paddingLeft: 18 }}>
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {state.mode === "simple" ? (
        <SimpleInput state={state} dispatch={dispatch} />
      ) : (
        <ItemsInput state={state} dispatch={dispatch} />
      )}

      <div className="card">
        <div className="actions">
          <Link className="btn btn-secondary" to="/events/new">
            戻る
          </Link>
          <Button disabled={errors.length > 0 || createEvent.isPending} onClick={submit}>
            {createEvent.isPending ? "計算中…" : "計算する"}
          </Button>
        </div>
      </div>
    </>
  );
}
