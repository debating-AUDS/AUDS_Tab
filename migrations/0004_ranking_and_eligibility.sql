-- Admin-chosen break eligibility threshold and leaderboard ranking criteria (ordered JSON lists).
ALTER TABLE tournaments ADD COLUMN min_debates   INTEGER NOT NULL DEFAULT 3;
ALTER TABLE tournaments ADD COLUMN team_rank     TEXT    NOT NULL DEFAULT '["avgTeamPoints","avgSpeakerScore","feedback"]';
ALTER TABLE tournaments ADD COLUMN speaker_rank  TEXT    NOT NULL DEFAULT '["average","totalScore"]';
