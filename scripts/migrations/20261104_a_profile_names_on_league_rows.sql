-- Wave 1 review A1, S6: the profile is the one source of a signed-up player's
-- name. Rosters, pairings and Manage read users.display_name directly; this
-- brings the copy on league rows (read by standings, scores and
-- notifications) in line once, replacing names older app builds saved, such
-- as the part of an email address before the @. From now on the API keeps the
-- copy in step whenever a player saves their name.
--
-- Data only, no schema change. Touches only rows linked to an account with a
-- profile name; placeholder players (no account) keep the name their admin
-- typed. Safe to run again: a second run changes nothing.

UPDATE players AS p
SET name = btrim(u.display_name), updated_at = now()
FROM users AS u
WHERE p.clerk_user_id = u.clerk_user_id
  AND btrim(u.display_name) <> ''
  AND p.name IS DISTINCT FROM btrim(u.display_name);
