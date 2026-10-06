export const SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  display_name TEXT NOT NULL,
  google_id TEXT UNIQUE,
  is_guest INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL,
  role TEXT NOT NULL,
  description TEXT NOT NULL,
  model TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  user_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  peer_id TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tools_json TEXT NOT NULL DEFAULT '[]',
  attachments_json TEXT NOT NULL DEFAULT '[]',
  provider TEXT,
  model TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  title TEXT NOT NULL,
  destination TEXT NOT NULL,
  origin TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  travelers INTEGER NOT NULL,
  budget_cents INTEGER,
  currency TEXT NOT NULL,
  pace TEXT NOT NULL,
  status TEXT NOT NULL,
  interests_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS itinerary_days (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  day_index INTEGER NOT NULL,
  date TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  places_json TEXT NOT NULL,
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS memory_notes (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  note_date TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS heartbeat_jobs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  name TEXT NOT NULL UNIQUE,
  every TEXT NOT NULL,
  prompt TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  next_run_at TEXT,
  last_result TEXT
);

CREATE TABLE IF NOT EXISTS tool_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  trip_id TEXT,
  tool TEXT NOT NULL,
  ok INTEGER NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  message_id TEXT,
  kind TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  request TEXT NOT NULL,
  pass INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Offers a provider returned to a desk. Every number here is the provider's own:
-- the desk stores what it was told and never fills a gap with an estimate.
CREATE TABLE IF NOT EXISTS offers (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  provider TEXT NOT NULL,
  -- Stable operator-assigned connector id, in addition to the endpoint snapshot below.
  provider_id TEXT NOT NULL,
  -- Snapshot of the non-secret endpoint identity. Holds never silently go to a new provider.
  provider_base_url TEXT NOT NULL,
  provider_offer_id TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  currency TEXT NOT NULL,
  total_amount REAL NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  hold TEXT NOT NULL DEFAULT 'none',
  -- Whether the source behind this offer can confirm a hold at all. A value of
  -- 'unsupported' means the vendor only quotes prices, so the UI offers no hold.
  hold_support TEXT NOT NULL DEFAULT 'provider',
  hold_ref TEXT,
  hold_expires_at TEXT,
  hold_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES agent_tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS browser_procedures (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  template_json TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  UNIQUE(site_id, origin, template_json)
);

CREATE TABLE IF NOT EXISTS browser_runs (
  task_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  state_json TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES agent_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_offers_task ON offers(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_offers_session ON offers(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_session ON agent_tasks(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_trips_start ON trips(start_date);
CREATE INDEX IF NOT EXISTS idx_memory_agent ON memory_notes(agent_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_user_key ON sessions(user_id, key);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_users_google ON users(google_id);
`;
