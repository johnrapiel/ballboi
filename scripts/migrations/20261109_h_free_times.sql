-- Free times (John, Nov 9; spec decision 156, replacing F7's hour grid).
-- Additive and idempotent.
--
-- weekly_availability.free_times: the new editor's times, a JSON list of
--   { day, start, end } (day 0 is Monday; start and end are minutes after
--   midnight, end exclusive). NULL means the player hasn't saved in the new
--   editor yet, so the API converts their old `slots` hour grid exactly
--   (each run of back-to-back hours becomes one time).
-- `slots` stays as it is. Dropping it waits for John's go-ahead.

ALTER TABLE weekly_availability ADD COLUMN IF NOT EXISTS free_times jsonb;
