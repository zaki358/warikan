import { useReducer } from "react";
import { Navigate, Route, Routes } from "react-router";

import { initialWizardState, wizardReducer } from "./features/events/wizardReducer.js";
import { todayYm } from "./lib/ym.js";
import { EventDetail } from "./routes/EventDetail.js";
import { EventInput } from "./routes/EventInput.js";
import { EventNew } from "./routes/EventNew.js";
import { Home } from "./routes/Home.js";
import { MonthlyRecord } from "./routes/MonthlyRecord.js";
import { MonthlyResult } from "./routes/MonthlyResult.js";
import { Settings } from "./routes/Settings.js";

export function App() {
  // ウィザードの途中状態はここだけが持つ。
  // 旧 Flask は Cookie に載せていたため別タブで壊れたが、その依存を無くす。
  const [wizard, dispatch] = useReducer(wizardReducer, undefined, initialWizardState);

  return (
    <div className="container">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/monthly" element={<Navigate to={`/monthly/${todayYm()}`} replace />} />
        <Route path="/monthly/:ym" element={<MonthlyRecord />} />
        <Route path="/monthly/:ym/result" element={<MonthlyResult />} />
        <Route path="/events/new" element={<EventNew state={wizard} dispatch={dispatch} />} />
        <Route
          path="/events/new/input"
          element={
            <EventInput
              state={wizard}
              dispatch={dispatch}
              onCreated={() => dispatch({ type: "reset" })}
            />
          }
        />
        <Route path="/events/:id" element={<EventDetail />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
