CREATE TABLE visitors (
  id TEXT PRIMARY KEY,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  visitor_id TEXT REFERENCES visitors(id),
  started_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  utm_source TEXT NOT NULL DEFAULT '',
  utm_medium TEXT NOT NULL DEFAULT '',
  utm_campaign TEXT NOT NULL DEFAULT '',
  session_key TEXT UNIQUE
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  path TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  properties TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX events_occurred_idx ON events(occurred_at);
CREATE INDEX events_session_time_idx ON events(session_id, occurred_at);
CREATE INDEX events_type_time_idx ON events(type, occurred_at);
CREATE INDEX sessions_started_idx ON sessions(started_at);
CREATE INDEX sessions_visitor_idx ON sessions(visitor_id, started_at);

PRAGMA user_version = 1;
