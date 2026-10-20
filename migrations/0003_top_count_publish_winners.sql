-- Admin-chosen size of the "top break-eligible teams" list (0 hides it) and the tournament winners.
ALTER TABLE tournaments ADD COLUMN top_count INTEGER NOT NULL DEFAULT 4;
ALTER TABLE tournaments ADD COLUMN winners   TEXT;

-- What the public sees of each completed round (all on by default, as before).
ALTER TABLE rounds ADD COLUMN show_placement      INTEGER NOT NULL DEFAULT 1;
ALTER TABLE rounds ADD COLUMN show_team_avg       INTEGER NOT NULL DEFAULT 1;
ALTER TABLE rounds ADD COLUMN show_speaker_scores INTEGER NOT NULL DEFAULT 1;
