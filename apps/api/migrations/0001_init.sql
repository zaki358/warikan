CREATE TABLE users (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE TABLE categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE monthly_periods (
  id            TEXT PRIMARY KEY,
  year          INTEGER NOT NULL,
  month         INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open',
  settled_at    TEXT,
  snapshot_json TEXT,
  is_dirty      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  UNIQUE (year, month)
);

CREATE TABLE monthly_expenses (
  id          TEXT PRIMARY KEY,
  period_id   TEXT NOT NULL REFERENCES monthly_periods(id) ON DELETE CASCADE,
  paid_by     TEXT NOT NULL REFERENCES users(id),
  amount      INTEGER NOT NULL,
  item_name   TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  spent_on    TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX idx_monthly_expenses_period ON monthly_expenses(period_id, spent_on);

CREATE TABLE events (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  mode       TEXT NOT NULL,
  total      INTEGER NOT NULL,
  per_person INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE event_members (
  id       TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  paid     INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL
);

CREATE INDEX idx_event_members_event ON event_members(event_id, position);

CREATE TABLE event_items (
  id                TEXT PRIMARY KEY,
  event_id          TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  amount            INTEGER NOT NULL,
  paid_by_member_id TEXT NOT NULL REFERENCES event_members(id) ON DELETE CASCADE,
  position          INTEGER NOT NULL
);

CREATE INDEX idx_event_items_event ON event_items(event_id, position);

CREATE TABLE event_settlements (
  id             TEXT PRIMARY KEY,
  event_id       TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  from_member_id TEXT NOT NULL REFERENCES event_members(id) ON DELETE CASCADE,
  to_member_id   TEXT NOT NULL REFERENCES event_members(id) ON DELETE CASCADE,
  amount         INTEGER NOT NULL,
  is_paid        INTEGER NOT NULL DEFAULT 0,
  position       INTEGER NOT NULL
);

CREATE INDEX idx_event_settlements_event ON event_settlements(event_id, position);
