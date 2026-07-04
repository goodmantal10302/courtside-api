CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS orgs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  type       TEXT DEFAULT 'parks',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         TEXT UNIQUE NOT NULL,
  display_name  TEXT,
  push_token    TEXT,
  role          TEXT DEFAULT 'player',
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS locations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  sport         TEXT NOT NULL,
  type          TEXT NOT NULL,
  address       TEXT NOT NULL,
  city          TEXT NOT NULL,
  lat           DOUBLE PRECISION NOT NULL,
  lng           DOUBLE PRECISION NOT NULL,
  hours_json    JSONB,
  surface       TEXT,
  setting       TEXT DEFAULT 'outdoor',
  lights        BOOLEAN DEFAULT false,
  parking       BOOLEAN DEFAULT false,
  restrooms     BOOLEAN DEFAULT false,
  water         BOOLEAN DEFAULT false,
  owner_org_id  UUID REFERENCES orgs(id),
  active        BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS courts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id   UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  status        TEXT DEFAULT 'available',
  close_reason  TEXT,
  qr_code_url   TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  court_id        UUID NOT NULL REFERENCES courts(id),
  location_id     UUID NOT NULL REFERENCES locations(id),
  user_id         UUID REFERENCES users(id),
  player_name     TEXT NOT NULL,
  partners_json   JSONB,
  duration_mins   INTEGER NOT NULL CHECK (duration_mins IN (30, 60, 90)),
  started_at      TIMESTAMPTZ DEFAULT now(),
  ends_at         TIMESTAMPTZ NOT NULL,
  ended_at        TIMESTAMPTZ,
  extended_count  INTEGER DEFAULT 0,
  status          TEXT DEFAULT 'active',
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS queue_entries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id  UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES users(id),
  guest_name   TEXT,
  joined_at    TIMESTAMPTZ DEFAULT now(),
  notified_at  TIMESTAMPTZ,
  claimed_at   TIMESTAMPTZ,
  status       TEXT DEFAULT 'waiting'
);

CREATE TABLE IF NOT EXISTS corrections (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  court_id      UUID NOT NULL REFERENCES courts(id),
  location_id   UUID NOT NULL REFERENCES locations(id),
  corrected_by  UUID NOT NULL REFERENCES users(id),
  action        TEXT NOT NULL,
  note          TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ratings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES locations(id),
  user_id     UUID NOT NULL REFERENCES users(id),
  score       INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (location_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_courts_location ON courts(location_id);
CREATE INDEX IF NOT EXISTS idx_sessions_court_active ON sessions(court_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_queue_location_waiting ON queue_entries(location_id, joined_at) WHERE status = 'waiting';
CREATE INDEX IF NOT EXISTS idx_locations_city ON locations(city);