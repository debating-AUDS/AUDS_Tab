-- More feedback questions (the existing "score" column is the "overall" question, the only one that
-- counts towards adjudicator ratings) and a switch to leave one piece of feedback out of the rating.
ALTER TABLE feedback ADD COLUMN q_decision      REAL;
ALTER TABLE feedback ADD COLUMN q_justification REAL;
ALTER TABLE feedback ADD COLUMN q_chair         REAL;
ALTER TABLE feedback ADD COLUMN q_contribution  REAL;
ALTER TABLE feedback ADD COLUMN excluded        INTEGER NOT NULL DEFAULT 0;

-- Archive ordering: lets the organisers choose the order archived tournaments are listed in.
ALTER TABLE tournaments ADD COLUMN display_order INTEGER;
