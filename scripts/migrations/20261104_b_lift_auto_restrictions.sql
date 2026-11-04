-- John dropped automatic restriction on Nov 4, 2026 (Wave 1 review): nothing
-- happens to an account until a moderator or the Claude agent acts. Lift every
-- restriction the old automatic rules set ("auto" from reports or behavior,
-- "stream" from Stream's filter) that is still active. Rows stay for history.
-- Manual ("admin") and agent restrictions are untouched. Safe to run twice.
UPDATE messaging_restrictions
SET lifted_at = now(),
    lifted_by = 'system: automatic restriction removed'
WHERE lifted_at IS NULL
  AND source IN ('auto', 'stream');
