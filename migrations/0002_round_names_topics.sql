-- Custom round names (e.g. "Quarter Final") and a topic/motion per round.
ALTER TABLE rounds ADD COLUMN name  TEXT;
ALTER TABLE rounds ADD COLUMN topic TEXT;

-- Adjudicator scores are per tournament now; clear any carried-over history.
UPDATE adjudicators SET base_avg = NULL, base_count = 0, base_sd = NULL;
