import { Navigate, Route, Routes } from "react-router";

import { todayYm } from "./lib/ym.js";
import { EventDetail } from "./routes/EventDetail.js";
import { EventInput } from "./routes/EventInput.js";
import { EventNew } from "./routes/EventNew.js";
import { Home } from "./routes/Home.js";
import { MonthlyRecord } from "./routes/MonthlyRecord.js";
import { MonthlyResult } from "./routes/MonthlyResult.js";

export function App() {
  return (
    <div className="container">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/monthly" element={<Navigate to={`/monthly/${todayYm()}`} replace />} />
        <Route path="/monthly/:ym" element={<MonthlyRecord />} />
        <Route path="/monthly/:ym/result" element={<MonthlyResult />} />
        <Route path="/events/new" element={<EventNew />} />
        <Route path="/events/new/input" element={<EventInput />} />
        <Route path="/events/:id" element={<EventDetail />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
