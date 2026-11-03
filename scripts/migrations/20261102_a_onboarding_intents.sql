-- Onboarding step 4 becomes an optional, multi-select research question
-- (Wave 1 review A14). Additive only; the single `intent` column stays for
-- anything that still writes it (the dev walkthrough seed).
--
-- intents: NULL = never answered, '{}' = skipped or nothing picked, otherwise
-- the picks. Analytics only: never shown back to the player.

ALTER TABLE users ADD COLUMN IF NOT EXISTS intents text[];

-- Carry over answers from the single-choice version, once.
UPDATE users SET intents = ARRAY[intent] WHERE intent IS NOT NULL AND intents IS NULL;
