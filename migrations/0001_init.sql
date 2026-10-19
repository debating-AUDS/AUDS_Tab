-- AUDS Tournament Leaderboard - initial schema (Cloudflare D1 / SQLite)

CREATE TABLE tournaments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  slug           TEXT    NOT NULL UNIQUE,
  name           TEXT    NOT NULL,
  format         TEXT    NOT NULL CHECK (format IN ('3v3', 'BP')),
  total_rounds   INTEGER NOT NULL CHECK (total_rounds BETWEEN 1 AND 20),
  current_round  INTEGER NOT NULL DEFAULT 1,
  weight_k       REAL    NOT NULL DEFAULT 0.1,
  status         TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  rooms_json     TEXT    NOT NULL DEFAULT '[]',
  roll_complete  INTEGER NOT NULL DEFAULT 0,
  feedback_open  INTEGER NOT NULL DEFAULT 1,
  feedback_code  TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  archived_at    TEXT
);

-- Who is in the tournament (the "Roll" sheet).
CREATE TABLE roll (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id  INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name           TEXT    NOT NULL,
  team           INTEGER NOT NULL,
  present        INTEGER NOT NULL DEFAULT 1,
  sort           INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX roll_name ON roll (tournament_id, name COLLATE NOCASE);

-- Y/N answers for one-person teams ('solo', key = speaker name) and two-person 3v3 teams ('pair', key = team number).
CREATE TABLE roll_decisions (
  tournament_id  INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  kind           TEXT    NOT NULL CHECK (kind IN ('solo', 'pair')),
  key            TEXT    NOT NULL,
  value          TEXT    NOT NULL CHECK (value IN ('Y', 'N')),
  PRIMARY KEY (tournament_id, kind, key)
);

-- Adjudicators persist across tournaments. base_* hold their history from earlier tournaments
-- (or a subjective prior when base_count = 0; confidence then says how much to trust it).
CREATE TABLE adjudicators (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  trainee     INTEGER NOT NULL DEFAULT 0,
  confidence  REAL    NOT NULL DEFAULT 50,
  base_avg    REAL,
  base_count  INTEGER NOT NULL DEFAULT 0,
  base_sd     REAL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX adjudicator_name ON adjudicators (name COLLATE NOCASE);

CREATE TABLE tournament_adjudicators (
  tournament_id  INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  adjudicator_id INTEGER NOT NULL REFERENCES adjudicators(id) ON DELETE CASCADE,
  attending      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tournament_id, adjudicator_id)
);

-- One row per round: where it is in the workflow.
CREATE TABLE rounds (
  tournament_id  INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round          INTEGER NOT NULL,
  status         TEXT    NOT NULL DEFAULT 'empty' CHECK (status IN ('empty', 'drawn', 'scoring', 'completed')),
  published      INTEGER NOT NULL DEFAULT 0,
  power          TEXT,
  completed_at   TEXT,
  PRIMARY KEY (tournament_id, round)
);

-- The draw ("Display" sheet + persistent draw record).
CREATE TABLE draw_rooms (
  tournament_id      INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round              INTEGER NOT NULL,
  idx                INTEGER NOT NULL,
  room               TEXT    NOT NULL,
  adjudicators_json  TEXT    NOT NULL DEFAULT '[]',
  PRIMARY KEY (tournament_id, round, room)
);

CREATE TABLE draw_entries (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id  INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round          INTEGER NOT NULL,
  room           TEXT    NOT NULL,
  position       TEXT    NOT NULL,
  team           INTEGER NOT NULL,
  speaker        TEXT    NOT NULL,
  original_team  INTEGER NOT NULL,
  merged         INTEGER NOT NULL DEFAULT 0,
  seq            INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX draw_entries_round ON draw_entries (tournament_id, round);

-- Results ("Round N" sheets).
CREATE TABLE results (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id  INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round          INTEGER NOT NULL,
  room           TEXT    NOT NULL,
  position       TEXT    NOT NULL,
  team           INTEGER NOT NULL,
  speaker        TEXT    NOT NULL,
  original_team  INTEGER NOT NULL,
  merged         INTEGER NOT NULL DEFAULT 0,
  score          REAL,
  placement      INTEGER,
  team_total     REAL,
  seq            INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX results_round ON results (tournament_id, round);

-- Adjudicator feedback. One row per submission; a "slot" is (round, room, adjudicator, giver)
-- and its value is the mean of its rows.
CREATE TABLE feedback (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id  INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round          INTEGER NOT NULL,
  room           TEXT    NOT NULL,
  adjudicator    TEXT    NOT NULL,
  giver          TEXT    NOT NULL,
  score          REAL    NOT NULL CHECK (score BETWEEN 1 AND 10),
  comment        TEXT,
  source         TEXT    NOT NULL DEFAULT 'public' CHECK (source IN ('public', 'admin')),
  fingerprint    TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX feedback_round ON feedback (tournament_id, round);
CREATE INDEX feedback_fp ON feedback (tournament_id, fingerprint, created_at);

-- Failed admin logins, used to slow down password guessing.
CREATE TABLE login_attempts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  fingerprint  TEXT    NOT NULL,
  at           INTEGER NOT NULL
);
CREATE INDEX login_attempts_fp ON login_attempts (fingerprint, at);
