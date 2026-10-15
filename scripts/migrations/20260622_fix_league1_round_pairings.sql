-- Fix duplicate matchup pairings in league 1 rounds 3-6.
--
-- Root cause: rounds 1 and 2 were generated in separate server calls that
-- returned players in different DB order (no ORDER BY id), so the circle-method
-- rotation used mismatched player sequences. Result: 6 repeat matchups scattered
-- across rounds 3-6 (Rapiel vs Sirman appears three times total).
--
-- Fix: delete upcoming rounds 3-6 (no completed matches in them) and reinsert
-- with a constraint-aware greedy-matching algorithm that avoids all pairs already
-- committed in rounds 1-2. Rounds 1 and 2 are untouched.
--
-- New pairings (verified zero conflicts against rounds 1-2 and within rounds 3-6):
--   Round 3: Rapiel-Borchert, Brighina-Patrick, Caico-Kerxhalli, Sirman-Markos, Brown-Carey
--   Round 4: Rapiel-Brighina, Borchert-Caico, Patrick-Sirman, Kerxhalli-Brown, Markos-Carey
--   Round 5: Rapiel-Caico, Borchert-Brighina, Patrick-Markos, Kerxhalli-Carey, Sirman-Brown
--   Round 6: Rapiel-Patrick, Borchert-Sirman, Brighina-Kerxhalli, Caico-Carey, Markos-Brown

DO $$
DECLARE
  r3_id integer;
  r4_id integer;
  r5_id integer;
  r6_id integer;
  completed_count integer;
  rounds_exist boolean;
BEGIN
  -- Safety: abort if any match in rounds 3-6 has already been completed
  SELECT COUNT(*) INTO completed_count
  FROM matches m
  JOIN league_rounds lr ON lr.id = m.round_id
  WHERE lr.league_id = 1 AND lr.round_number IN (3, 4, 5, 6) AND m.status = 'completed';

  IF completed_count > 0 THEN
    RAISE NOTICE 'Rounds 3-6 already have completed matches — skipping fix.';
    RETURN;
  END IF;

  -- Safety: abort if rounds 3-6 no longer exist (already cleaned up another way)
  SELECT EXISTS (
    SELECT 1 FROM league_rounds
    WHERE league_id = 1 AND round_number IN (3, 4, 5, 6)
  ) INTO rounds_exist;

  IF NOT rounds_exist THEN
    RAISE NOTICE 'Rounds 3-6 not found for league 1 — skipping fix.';
    RETURN;
  END IF;

  -- Remove the corrupted upcoming matches and round records
  DELETE FROM matches
  WHERE round_id IN (
    SELECT id FROM league_rounds WHERE league_id = 1 AND round_number IN (3, 4, 5, 6)
  );

  DELETE FROM league_rounds
  WHERE league_id = 1 AND round_number IN (3, 4, 5, 6);

  -- Round 3 (2026-06-28 to 2026-07-12)
  INSERT INTO league_rounds (league_id, round_number, start_date, end_date, status)
  VALUES (1, 3, '2026-06-28', '2026-07-12', 'upcoming')
  RETURNING id INTO r3_id;

  INSERT INTO matches (league_id, player1_id, player2_id, status, generated_from, week_of, round_id, season)
  VALUES
    (1, 1,  2,  'scheduled', 'round', '2026-06-28', r3_id, 'Summer League'),
    (1, 3,  5,  'scheduled', 'round', '2026-06-28', r3_id, 'Summer League'),
    (1, 4,  6,  'scheduled', 'round', '2026-06-28', r3_id, 'Summer League'),
    (1, 7,  8,  'scheduled', 'round', '2026-06-28', r3_id, 'Summer League'),
    (1, 9,  10, 'scheduled', 'round', '2026-06-28', r3_id, 'Summer League');

  -- Round 4 (2026-07-12 to 2026-07-26)
  INSERT INTO league_rounds (league_id, round_number, start_date, end_date, status)
  VALUES (1, 4, '2026-07-12', '2026-07-26', 'upcoming')
  RETURNING id INTO r4_id;

  INSERT INTO matches (league_id, player1_id, player2_id, status, generated_from, week_of, round_id, season)
  VALUES
    (1, 1,  3,  'scheduled', 'round', '2026-07-12', r4_id, 'Summer League'),
    (1, 2,  4,  'scheduled', 'round', '2026-07-12', r4_id, 'Summer League'),
    (1, 5,  7,  'scheduled', 'round', '2026-07-12', r4_id, 'Summer League'),
    (1, 6,  9,  'scheduled', 'round', '2026-07-12', r4_id, 'Summer League'),
    (1, 8,  10, 'scheduled', 'round', '2026-07-12', r4_id, 'Summer League');

  -- Round 5 (2026-07-26 to 2026-08-09)
  INSERT INTO league_rounds (league_id, round_number, start_date, end_date, status)
  VALUES (1, 5, '2026-07-26', '2026-08-09', 'upcoming')
  RETURNING id INTO r5_id;

  INSERT INTO matches (league_id, player1_id, player2_id, status, generated_from, week_of, round_id, season)
  VALUES
    (1, 1,  4,  'scheduled', 'round', '2026-07-26', r5_id, 'Summer League'),
    (1, 2,  3,  'scheduled', 'round', '2026-07-26', r5_id, 'Summer League'),
    (1, 5,  8,  'scheduled', 'round', '2026-07-26', r5_id, 'Summer League'),
    (1, 6,  10, 'scheduled', 'round', '2026-07-26', r5_id, 'Summer League'),
    (1, 7,  9,  'scheduled', 'round', '2026-07-26', r5_id, 'Summer League');

  -- Round 6 (2026-08-09 to 2026-08-23)
  INSERT INTO league_rounds (league_id, round_number, start_date, end_date, status)
  VALUES (1, 6, '2026-08-09', '2026-08-23', 'upcoming')
  RETURNING id INTO r6_id;

  INSERT INTO matches (league_id, player1_id, player2_id, status, generated_from, week_of, round_id, season)
  VALUES
    (1, 1,  5,  'scheduled', 'round', '2026-08-09', r6_id, 'Summer League'),
    (1, 2,  7,  'scheduled', 'round', '2026-08-09', r6_id, 'Summer League'),
    (1, 3,  6,  'scheduled', 'round', '2026-08-09', r6_id, 'Summer League'),
    (1, 4,  10, 'scheduled', 'round', '2026-08-09', r6_id, 'Summer League'),
    (1, 8,  9,  'scheduled', 'round', '2026-08-09', r6_id, 'Summer League');

  RAISE NOTICE 'Successfully rebuilt rounds 3-6 for league 1 — zero duplicate matchups.';
END $$;
